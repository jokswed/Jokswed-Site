import "server-only";
import { createHash } from "node:crypto";
import type { Requete } from "@/lib/db/client";
import {
  dessinerCommercial, euros, repartir, type InstantaneCommercial,
} from "./gabarit-commercial";
import { dessinerContrat } from "./gabarit-contrat";
import { contexteDepuisInclusions } from "./clauses";
import { formaterDateSql } from "@/lib/dates";

/* =============================================================================
   GÉNÉRATION D'UN DOCUMENT DEPUIS UNE DEMANDE
   -----------------------------------------------------------------------------
   ⚠️ TOUT EST PRÉREMPLI, RIEN N'EST RESSAISI.

   Le devis reprend l'identité du prestataire, celle des clients, la date et
   les lieux du mariage, la formule, ses inclusions, les suppléments retenus
   et l'échéancier. C'est l'instantané de la demande qui alimente le document,
   pas une nouvelle lecture du catalogue : si un tarif a changé depuis, le
   devis porte celui que le client a vu.

   ⚠️ ET UN DOCUMENT NAÎT TOUJOURS EN BROUILLON.

   L'émission est un geste distinct, soumis à la garde du palier 017 : tant
   que le médiateur n'est pas désigné et que le régime de TVA n'est pas
   qualifié, le brouillon se prépare, se relit, se corrige — mais ne devient
   jamais définitif.
   ============================================================================= */

export interface ResultatGeneration {
  documentId: string;
  lignesAChiffrer: string[];
}

/** Nombre d'échéances par défaut. Modifiable document par document ensuite. */
export const ECHEANCES_PAR_DEFAUT = 3;

export async function genererDevisDepuisDemande(
  q: Requete,
  demandeId: string,
  entrepriseId: string,
  acteurId: string,
  nombreEcheances = ECHEANCES_PAR_DEFAUT,
): Promise<ResultatGeneration> {
  const { rows: demandes } = await q("SELECT * FROM demandes WHERE id = $1", [demandeId]);
  if (demandes.length === 0) throw new Error("demande introuvable");
  const demande = demandes[0];

  const { rows: lignesDemande } = await q(
    "SELECT * FROM demande_lignes WHERE demande_id = $1 ORDER BY ordre", [demandeId]);

  const { rows: entreprises } = await q(
    "SELECT * FROM entreprises WHERE id = $1", [entrepriseId]);
  const entreprise = entreprises[0];

  /* ⚠️ LE RÉGIME FISCAL APPLICABLE À LA DATE DU JOUR, PAS « LE » RÉGIME.
     Il est figé dans l'instantané : un changement de régime l'an prochain ne
     réécrira pas ce document. */
  const { rows: regimes } = await q(
    `SELECT * FROM regimes_tva
      WHERE entreprise_id = $1 AND debut_le <= current_date
        AND (fin_le IS NULL OR fin_le > current_date)`, [entrepriseId]);
  const regime = regimes[0] ?? null;
  const tauxBp = regime?.regime === "assujetti" ? 2000 : 0;

  /* ── Les lignes facturables ──
     Une ligne « incluse dans la formule » est MONTRÉE au client mais ne
     constitue jamais une ligne vendue : elle rejoint les inclusions. */
  const facturables = lignesDemande.filter((l) => l.compatibilite !== "inclus");
  const incluses = lignesDemande.filter((l) => l.compatibilite === "inclus");
  const lignesAChiffrer = facturables
    .filter((l) => l.prix_cents === null)
    .map((l) => l.libelle);

  /* Les totaux ne comptent que ce qui est chiffré. Un supplément « sur
     devis » apparaît sur le document, sans montant, et la garde d'émission
     refusera le passage au définitif tant qu'il n'est pas chiffré. */
  const totalTtc = facturables.reduce((s, l) => s + (l.prix_cents ?? 0), 0);
  /* ⚠️ HT CALCULÉ DEPUIS LE TTC, EN CENTIMES ENTIERS.
     Les prix publics sont des TTC (le devis fourni le confirme). On déduit
     donc la TVA, et le HT absorbe l'arrondi pour que HT + TVA = TTC
     exactement — la contrainte `totaux_coherents` l'exige. */
  const totalTva = tauxBp === 0 ? 0 : Math.round((totalTtc * tauxBp) / (10000 + tauxBp));
  const totalHt = totalTtc - totalTva;

  const formule = lignesDemande.find((l) => l.type === "formule");
  const inclusionsFormule: string[] =
    (demande.instantane?.lignes ?? []).find((l: any) => l.type === "formule")?.inclus ?? [];

  const instantane: InstantaneCommercial = {
    titre: "DEVIS",
    numero: null,
    dateEmission: new Date().toLocaleDateString("fr-FR"),
    validite: "30 jours",
    prestataire: {
      nomCommercial: entreprise.nom_commercial,
      responsable: entreprise.raison_sociale,
      adresse: entreprise.adresse_ligne1,
      codePostal: entreprise.code_postal,
      ville: entreprise.ville,
      telephone: entreprise.telephone,
      email: entreprise.email,
      siret: entreprise.siret,
      codeApe: entreprise.code_ape,
      tvaNumero: regime?.tva_numero ?? null,
      mentionTva: regime?.mention_legale ?? null,
    },
    client: {
      nom: demande.contact_nom,
      email: demande.contact_email,
      telephone: demande.contact_telephone,
    },
    formuleNom: formule?.libelle ?? "Prestation sur mesure",
    lignes: facturables.map((l) => ({
      description: l.libelle,
      livraison: l.type === "formule"
        ? (inclusionsFormule.some((i) => /album/i.test(i))
            ? "Galerie :\n13-15 jours\nAlbum :\n~1 mois*"
            : "Galerie :\n13-15 jours")
        : null,
      lieu: demande.lieu ?? demande.ville ?? null,
      prix: l.prix_cents === null ? "Sur devis" : `${euros(l.prix_cents)}\nTTC`,
      quantite: l.type === "formule" ? "Minimum\n800 photos\nretouchées" : null,
      duree: l.type === "formule" ? dureeLisible(demande.instantane) : null,
      date: demande.date_mariage ? formaterDateSql(demande.date_mariage) : "à confirmer",
    })),
    inclusions: [
      ...inclusionsFormule,
      ...incluses.map((l) => `${l.libelle} (incluse dans la formule)`),
    ],
    totalHtCents: totalHt,
    totalTvaCents: totalTva,
    totalTtcCents: totalTtc,
    tauxTvaBp: tauxBp,
    echeances: repartir(totalTtc, nombreEcheances).map((montant, i, tableau) => ({
      libelle:
        i === 0
          ? "1er versement / acompte, à la signature"
          : i === tableau.length - 1
            ? "Solde, avant le déblocage de la galerie complète"
            : `${i + 1}e versement, à une échéance convenue par écrit`,
      montantCents: montant,
    })),
    conditions:
      "Le premier versement est expressément qualifié d'acompte et matérialise " +
      "l'engagement ferme des parties. Après le mariage, un aperçu représentant " +
      "environ un tiers des photographies finales est mis à disposition sans " +
      "téléchargement HD. Le solde est exigible avant le déblocage de la galerie " +
      "complète en haute définition. Les autres conditions figurent au contrat de " +
      "prestation et aux CGV." +
      "",
    mentionFin: "Merci de votre confiance",
    noteBasDePage: inclusionsFormule.some((i) => /album/i.test(i))
      ? "* Délai indicatif après validation de la maquette et selon le laboratoire."
      : null,
    mentionsLegales: regime?.mention_legale ? [regime.mention_legale] : [],
    brouillon: true,
  };

  const { rows: cree } = await q(
    `INSERT INTO documents (entreprise_id, demande_id, type, statut, total_ht_cents,
                            total_tva_cents, total_ttc_cents, instantane, cree_par)
     VALUES ($1,$2,'devis','brouillon',$3,$4,$5,$6::jsonb,$7) RETURNING id`,
    [entrepriseId, demandeId, totalHt, totalTva, totalTtc,
     JSON.stringify(instantane), acteurId]);
  const documentId = cree[0].id;

  for (const [i, ligne] of facturables.entries()) {
    const prix = ligne.prix_cents ?? 0;
    const tva = tauxBp === 0 ? 0 : Math.round((prix * tauxBp) / (10000 + tauxBp));
    await q(
      `INSERT INTO document_lignes (document_id, entreprise_id, ordre, designation,
                                    prix_unitaire_cents, tva_taux_bp,
                                    total_ht_cents, total_tva_cents, origine_type, origine_cle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [documentId, entrepriseId, i, ligne.libelle, prix, tauxBp,
       prix - tva, tva, ligne.type, ligne.cle]);
  }

  for (const [i, e] of instantane.echeances.entries()) {
    await q(
      `INSERT INTO echeances (entreprise_id, document_id, ordre, libelle,
                              montant_cents, nature)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [entrepriseId, documentId, i, e.libelle, e.montantCents,
       i === 0 ? "acompte" : i === instantane.echeances.length - 1 ? "solde" : "intermediaire"]);
  }

  return { documentId, lignesAChiffrer };
}

function dureeLisible(instantane: any): string {
  const minutes = instantane?.lignes?.find((l: any) => l.type === "formule")?.duree_minutes;
  return minutes
    ? `Jusqu'à ${Math.round(minutes / 60)} h\nhoraires finaux\nà confirmer`
    : "à confirmer";
}

/* =============================================================================
   CONTRAT
   ============================================================================= */
export async function genererContratDepuisDevis(
  q: Requete,
  devisId: string,
  entrepriseId: string,
  acteurId: string,
): Promise<{ documentId: string }> {
  const { rows: devis } = await q("SELECT * FROM documents WHERE id = $1", [devisId]);
  if (devis.length === 0) throw new Error("devis introuvable");
  const source = devis[0];
  const inst = source.instantane as InstantaneCommercial;

  const { rows: demandes } = await q(
    "SELECT * FROM demandes WHERE id = $1", [source.demande_id]);
  const demande = demandes[0];

  const { rows: entreprises } = await q(
    "SELECT * FROM entreprises WHERE id = $1", [entrepriseId]);
  const entreprise = entreprises[0];

  const { rows: echeances } = await q(
    "SELECT * FROM echeances WHERE document_id = $1 ORDER BY ordre", [devisId]);

  const inclusions = inst.inclusions ?? [];
  const contexte = contexteDepuisInclusions(inclusions, echeances.length);

  /* ⚠️ LES MENTIONS MANQUANTES SONT ÉCRITES TELLES QUELLES DANS LE BROUILLON.
     « À COMPLÉTER AVANT SIGNATURE » est exactement ce que porte ton modèle.
     On ne masque pas le trou : on le rend visible, et la garde d'émission
     refuse de passer ce contrat en définitif tant qu'il subsiste. */
  const instantaneContrat = {
    numero: null,
    dateContrat: new Date().toLocaleDateString("fr-FR"),
    prestataire: inst.prestataire,
    clients: [{ nom: demande.contact_nom, telephone: demande.contact_telephone }],
    emailClient: demande.contact_email,
    adresseClient: null,
    mariage: {
      date: demande.date_mariage ? formaterDateSql(demande.date_mariage) : "à confirmer",
      ceremonie: null,
      reception: demande.lieu ?? demande.ville ?? null,
      formule: inst.formuleNom,
      duree: dureeContrat(demande.instantane),
    },
    devisReference: source.numero ? `Devis ${source.numero}` : "Devis final",
    totalTtc: euros(source.total_ttc_cents),
    detailTva: source.total_tva_cents > 0
      ? `, soit ${euros(source.total_ht_cents)} HT et ${euros(source.total_tva_cents)} de TVA`
      : "",
    acompte: euros(echeances[0]?.montant_cents ?? source.total_ttc_cents),
    solde: euros(echeances[echeances.length - 1]?.montant_cents ?? source.total_ttc_cents),
    echeances: echeances.map((e, i) => ({
      libelle: i === 0 ? "à la réservation"
        : i === echeances.length - 1 ? "après mise à disposition de l'aperçu prévu à l'article 7"
        : "à une échéance convenue avant le mariage",
      montant: euros(e.montant_cents),
    })),
    inclusions,
    contexte,
    mediateurNom: entreprise.mediateur_nom ?? "À COMPLÉTER AVANT SIGNATURE",
    mediateurUrl: entreprise.mediateur_url ?? "À COMPLÉTER AVANT SIGNATURE",
  };

  const { rows: cree } = await q(
    `INSERT INTO documents (entreprise_id, demande_id, type, statut, devis_source_id,
                            total_ht_cents, total_tva_cents, total_ttc_cents,
                            instantane, cree_par)
     VALUES ($1,$2,'contrat','brouillon',$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
    [entrepriseId, source.demande_id, devisId, source.total_ht_cents,
     source.total_tva_cents, source.total_ttc_cents,
     JSON.stringify(instantaneContrat), acteurId]);

  return { documentId: cree[0].id };
}

function dureeContrat(instantane: any): string {
  const minutes = instantane?.lignes?.find((l: any) => l.type === "formule")?.duree_minutes;
  return minutes ? `${Math.round(minutes / 60)} heures` : "la durée convenue";
}

/* =============================================================================
   FACTURES ET AVOIRS
   ============================================================================= */
export type RoleFacture = "acompte" | "solde" | "totale";

const TITRES: Record<RoleFacture, string> = {
  acompte: "FACTURE D'ACOMPTE",
  solde: "FACTURE DE SOLDE",
  totale: "FACTURE",
};

export async function genererFactureDepuisDevis(
  q: Requete,
  devisId: string,
  role: RoleFacture,
  entrepriseId: string,
  acteurId: string,
): Promise<{ documentId: string; montantCents: number }> {
  const { rows: devis } = await q("SELECT * FROM documents WHERE id = $1", [devisId]);
  if (devis.length === 0) throw new Error("devis introuvable");
  const source = devis[0];
  const inst = source.instantane as InstantaneCommercial;

  const { rows: echeances } = await q(
    "SELECT * FROM echeances WHERE document_id = $1 ORDER BY ordre", [devisId]);
  const { rows: situation } = await q(
    "SELECT * FROM app.situation_financiere($1)", [source.demande_id]);
  const { rows: demandes } = await q(
    "SELECT date_mariage FROM demandes WHERE id = $1", [source.demande_id]);

  /* ⚠️ LE MONTANT DÉPEND DU RÔLE, ET DU DÉJÀ-FACTURÉ.
     Facturer l'acompte puis le total reviendrait à réclamer deux fois la
     même somme. Le solde se déduit donc de ce qui est DÉJÀ FACTURÉ, jamais
     de ce qui est encaissé — ce sont deux grandeurs différentes. */
  const dejaFacture = situation[0].facture_cents - situation[0].avoirs_cents;
  const montant =
    role === "acompte" ? (echeances[0]?.montant_cents ?? source.total_ttc_cents)
    : role === "solde" ? source.total_ttc_cents - dejaFacture
    : source.total_ttc_cents - dejaFacture;

  if (montant <= 0) {
    throw new Error("rien ne reste à facturer sur ce devis");
  }

  const tauxBp = inst.tauxTvaBp ?? 0;
  const tva = tauxBp === 0 ? 0 : Math.round((montant * tauxBp) / (10000 + tauxBp));

  const instantaneFacture: InstantaneCommercial = {
    ...inst,
    titre: TITRES[role],
    numero: null,
    validite: null,
    datePrestation: demandes[0]?.date_mariage
      ? formaterDateSql(demandes[0].date_mariage) : null,
    lignes: role === "acompte"
      ? [{
          description: `Acompte sur ${inst.formuleNom}`,
          lieu: inst.lignes[0]?.lieu ?? null,
          prix: `${euros(montant)}
TTC`,
          date: inst.lignes[0]?.date ?? null,
        }]
      : inst.lignes,
    totalHtCents: montant - tva,
    totalTvaCents: tva,
    totalTtcCents: montant,
    dejaRegleCents: situation[0].encaisse_cents,
    echeances: [],
    conditions: role === "acompte"
      ? "Facture d'acompte. Le solde fera l'objet d'une facture distincte, " +
        "exigible selon l'échéancier du devis signé."
      : "Facture de solde. Les conditions d'exécution figurent au contrat de " +
        "prestation et aux CGV.",
    brouillon: true,
  };

  const { rows: cree } = await q(
    `INSERT INTO documents (entreprise_id, demande_id, type, role_facture, statut,
                            devis_source_id, total_ht_cents, total_tva_cents,
                            total_ttc_cents, instantane, cree_par)
     VALUES ($1,$2,'facture',$3,'brouillon',$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`,
    [entrepriseId, source.demande_id, role, devisId,
     montant - tva, tva, montant, JSON.stringify(instantaneFacture), acteurId]);

  return { documentId: cree[0].id, montantCents: montant };
}

/** Avoir : il annule tout ou partie d'une facture émise. */
export async function genererAvoir(
  q: Requete,
  factureId: string,
  montantCents: number | null,
  motif: string,
  entrepriseId: string,
  acteurId: string,
): Promise<{ documentId: string }> {
  const { rows } = await q("SELECT * FROM documents WHERE id = $1", [factureId]);
  if (rows.length === 0) throw new Error("facture introuvable");
  const facture = rows[0];
  if (facture.statut === "brouillon") {
    /* ⚠️ ON N'AVOIRE PAS UN BROUILLON : on le supprime. Émettre un avoir sur
       un document qui n'a jamais existé fiscalement créerait une pièce
       comptable sans contrepartie. */
    throw new Error("un brouillon se supprime, il ne s'avoire pas");
  }
  const montant = montantCents ?? facture.total_ttc_cents;
  const inst = facture.instantane as InstantaneCommercial;
  const tauxBp = inst.tauxTvaBp ?? 0;
  const tva = tauxBp === 0 ? 0 : Math.round((montant * tauxBp) / (10000 + tauxBp));

  const instantaneAvoir: InstantaneCommercial = {
    ...inst,
    titre: "AVOIR",
    numero: null,
    referenceOrigine: facture.numero,
    lignes: [{
      description: `Avoir sur facture ${facture.numero}`,
      prix: `${euros(montant)}
TTC`,
      lieu: motif,
    }],
    totalHtCents: montant - tva,
    totalTvaCents: tva,
    totalTtcCents: montant,
    dejaRegleCents: null,
    echeances: [],
    conditions: `Avoir émis en rectification de la facture ${facture.numero}. Motif : ${motif}.`,
    brouillon: true,
  };

  const { rows: cree } = await q(
    `INSERT INTO documents (entreprise_id, demande_id, type, statut,
                            document_origine_id, total_ht_cents, total_tva_cents,
                            total_ttc_cents, instantane, cree_par)
     VALUES ($1,$2,'avoir','brouillon',$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
    [entrepriseId, facture.demande_id, factureId, montant - tva, tva, montant,
     JSON.stringify(instantaneAvoir), acteurId]);

  return { documentId: cree[0].id };
}

/**
 * Rend le PDF d'un document, et son empreinte — qui servira de preuve.
 *
 * Le contrat et les documents commerciaux n'ont pas la même mise en page :
 * on choisit sur la nature de l'instantané, pas sur un drapeau que l'appelant
 * pourrait oublier de passer.
 */
export function rendrePdf(
  instantane: Record<string, unknown>,
  brouillon: boolean,
): { pdf: Buffer; empreinte: string } {
  const pdf = "mariage" in instantane
    ? dessinerContrat({ ...instantane, brouillon } as never)
    : dessinerCommercial({ ...instantane, brouillon } as never);
  return { pdf, empreinte: createHash("sha256").update(pdf).digest("hex") };
}
