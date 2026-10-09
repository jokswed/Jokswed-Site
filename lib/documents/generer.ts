import "server-only";
import { createHash } from "node:crypto";
import type { Requete } from "@/lib/db/client";
import { dessinerDevis, repartir, type InstantaneDocument } from "./gabarit-devis";
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

  const instantane: InstantaneDocument = {
    type: "devis",
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
      designation: l.libelle,
      livraison: l.type === "formule" ? "Galerie : 13-15 jours\nAlbum : ~1 mois*" : null,
      lieu: demande.lieu ?? demande.ville ?? null,
      prixCents: l.prix_cents,
      quantite: l.type === "formule" ? "Minimum 800 photos retouchées" : null,
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
      (regime?.mention_legale ? `\n${regime.mention_legale}` : ""),
    mentionFin: "Merci de votre confiance",
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
  return minutes ? `Jusqu'à ${Math.round(minutes / 60)} h` : "à confirmer";
}

/** Rend le PDF d'un document, et son empreinte — qui servira de preuve. */
export function rendrePdf(instantane: InstantaneDocument, brouillon: boolean): {
  pdf: Buffer;
  empreinte: string;
} {
  const pdf = dessinerDevis({ ...instantane, brouillon });
  return { pdf, empreinte: createHash("sha256").update(pdf).digest("hex") };
}
