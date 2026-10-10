import "server-only";
import { sansIdentite, type Requete } from "@/lib/db/client";
import { formules, supplements, statutSupplement } from "@/content/offres";

/* =============================================================================
   DÉPÔT D'UNE DEMANDE
   -----------------------------------------------------------------------------
   ⚠️ L'ORDRE EST LA GARANTIE : ON ENREGISTRE, PUIS ON NOTIFIE.

   La demande, ses lignes, ses consentements, la proposition vidéo éventuelle
   et l'événement de notification sont écrits dans UNE SEULE transaction
   PostgreSQL. Les cinq existent, ou aucun des cinq.

   Avant la V4, l'e-mail était le seul support : un échec d'envoi perdait la
   demande définitivement, et rien ne le signalait. Désormais, un échec
   d'envoi retarde la notification — la demande, elle, est déjà là.
   ============================================================================= */

export interface ChargeDemande {
  cleIdempotence: string;
  contactNom: string;
  contactEmail: string;
  contactTelephone?: string | null;
  contactPrefere?: string | null;
  dateMariage?: string | null;
  lieu?: string | null;
  message: string;
  formuleCle?: string | null;
  supplementsCles: string[];
  consentementDemande: boolean;
  consentementPartenaire: boolean;
  ipTronquee: string;
  origine?: string;
}

/** Textes exacts soumis au visiteur : ce sont eux qui font foi, pas un résumé. */
export const TEXTES_CONSENTEMENT = {
  reponse_demande:
    "J'accepte que mes informations soient utilisées pour étudier ma demande et me répondre.",
  partage_partenaire_video:
    "Si je souhaite une prestation vidéo, j'accepte que mes coordonnées soient " +
    "transmises au vidéaste partenaire pour qu'il établisse son devis.",
} as const;

export interface ResultatDepot {
  demandeId: string;
  reference: string;
  rejeu: boolean;
  videoDemandee: boolean;
  lignesAChiffrer: string[];
  dejaIncluses: string[];
}

/**
 * Construit l'instantané et dépose la demande.
 *
 * ⚠️ LE CATALOGUE EST RÉSOLU ICI, CÔTÉ SERVEUR.
 *
 * Le navigateur n'envoie que des CLÉS. Les libellés, les prix et les règles de
 * compatibilité viennent du catalogue du serveur, et sont figés dans
 * `instantane` : changer un tarif demain ne réécrira pas ce que ce client a vu.
 */
export async function deposerDemande(charge: ChargeDemande): Promise<ResultatDepot> {
  const formule = charge.formuleCle
    ? formules.find((f) => f.cle === charge.formuleCle) ?? null
    : null;

  const lignes: Record<string, unknown>[] = [];
  const lignesAChiffrer: string[] = [];
  const dejaIncluses: string[] = [];
  let ordre = 0;

  if (formule) {
    lignes.push({
      type: "formule",
      cle: formule.cle,
      libelle: `${formule.nom} — ${formule.surnom}`,
      prix_cents: formule.prixCents,
      type_tarif: "fixe",
      compatibilite: "proposable",
      ordre: ordre++,
      inclus: formule.inclus,
      duree_minutes: formule.dureeMinutes,
    });
  }

  let videoDemandee = false;
  for (const cle of charge.supplementsCles) {
    const s = supplements.find((x) => x.cle === cle);
    if (!s) continue; // clé inconnue : ignorée en silence
    const statut = statutSupplement(s, formule?.cle ?? null);
    if (statut === "incompatible") continue;

    if (statut === "inclus") dejaIncluses.push(s.nom);
    else if (s.prixCents === null) lignesAChiffrer.push(s.nom);
    if (s.executantPartenaire && statut !== "inclus") videoDemandee = true;

    lignes.push({
      type: "supplement",
      cle: s.cle,
      libelle: s.nom,
      /* ⚠️ Une ligne « incluse » porte un prix NUL, pas zéro : elle est
         affichée au client, et ne sera jamais facturée. La distinction est
         conservée jusque dans la base. */
      prix_cents: statut === "inclus" ? null : s.prixCents,
      type_tarif: s.typeTarif,
      compatibilite: statut,
      executant_partenaire: s.executantPartenaire,
      ordre: ordre++,
    });
  }

  const consentements = [
    {
      finalite: "reponse_demande",
      accorde: charge.consentementDemande,
      texte_version: TEXTES_CONSENTEMENT.reponse_demande,
      source: "formulaire_public",
    },
    {
      finalite: "partage_partenaire_video",
      accorde: charge.consentementPartenaire,
      texte_version: TEXTES_CONSENTEMENT.partage_partenaire_video,
      source: "formulaire_public",
    },
  ];

  const chargeUtile = {
    cle_idempotence: charge.cleIdempotence,
    entreprise_slug: "jokswed",
    partenaire_video_slug: "videaste-partenaire",
    origine: charge.origine ?? "formulaire_public",
    contact_nom: charge.contactNom,
    contact_email: charge.contactEmail,
    contact_telephone: charge.contactTelephone ?? null,
    contact_prefere: charge.contactPrefere ?? null,
    date_mariage: charge.dateMariage || null,
    date_incertaine: !charge.dateMariage,
    lieu: charge.lieu ?? null,
    formule_cle: formule?.cle ?? null,
    formule_nom: formule ? `${formule.nom} — ${formule.surnom}` : null,
    formule_prix_cents: formule?.prixCents ?? null,
    video_demandee: videoDemandee,
    message: charge.message,
    ip_tronquee: charge.ipTronquee,
    lignes,
    consentements,
    /* L'instantané porte aussi la version du catalogue : si les offres
       changent, on saura lesquelles ce client a vues. */
    catalogue_version: `${formules.length}f/${supplements.length}s`,
  };

  /* ⚠️ AUCUNE IDENTITÉ, ET C'EST VOULU.
     Le dépôt est public : il n'y a pas d'acteur. `app.deposer_demande` est
     `SECURITY DEFINER` et n'en a pas besoin — c'est la seule écriture
     publique autorisée, et elle ne sait rien faire d'autre que déposer une
     demande. */
  const { rows } = await sansIdentite((q: Requete) =>
    q("SELECT * FROM app.deposer_demande($1::jsonb)", [JSON.stringify(chargeUtile)]),
  );

  return {
    demandeId: rows[0].demande_id,
    reference: rows[0].reference,
    rejeu: rows[0].rejeu,
    videoDemandee,
    lignesAChiffrer,
    dejaIncluses,
  };
}
