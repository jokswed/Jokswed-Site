/* =============================================================================
   JOKSWED — IDENTITÉ LÉGALE ET MENTIONS
   -----------------------------------------------------------------------------
   Données reprises du devis et du contrat fournis. Elles alimentent
   /mentions-legales, /confidentialite et — en V5 — l'en-tête des devis et des
   factures.

   ⚠️ DEUX CHAMPS VALENT `null`, ET JE NE LES REMPLIS PAS.

   `mediateur` et `tvaIntracommunautaire`.

   SUR LA TVA — correction apportée après vérification.
   J'avais présenté le numéro de TVA intracommunautaire comme une mention
   obligatoire générale. C'est inexact : l'obligation dépend du régime.

     · Franchise en base (art. 293 B du CGI) : aucune TVA facturée, et la
       mention « TVA non applicable, article 293 B du CGI » est obligatoire sur
       chaque facture. Le numéro intracommunautaire n'est PAS requis pour des
       opérations purement internes.
     · Assujetti qui facture la TVA : le numéro individuel d'identification du
       vendeur figure parmi les mentions de l'article 242 nonies A, annexe II
       du CGI.

   Le devis fourni applique 20 % de TVA sur 1 083,33 € HT. Sous ce régime, le
   numéro manque. Si le régime réel est la franchise, alors c'est le taux de
   20 % qui est l'anomalie. Les deux cas se corrigent, mais pas de la même
   façon, et c'est au comptable de trancher — pas à moi.

   `regimeTva` ci-dessous pilote ce que les pages affichent. Tant qu'il vaut
   `indetermine`, rien n'est affirmé.
   ============================================================================= */

export const entreprise = {
  nomCommercial: "JoksWed",
  responsable: "RAHARISON John",
  statut: "Entrepreneur individuel",
  adresse: "7 rue Emmanuel Rain",
  codePostal: "95500",
  ville: "Gonesse",
  pays: "France",
  siret: "93760042700010",
  codeApe: "74201",
  activite: "Activités photographiques",
  email: "jokswed@gmail.com",
  telephone: "07 69 90 25 99",

  /**
   * Régime réel, à confirmer par le comptable.
   * 'franchise_base' | 'assujetti' | 'indetermine'
   */
  regimeTva: "indetermine" as "franchise_base" | "assujetti" | "indetermine",
  /** Requis seulement si `regimeTva` vaut 'assujetti'. */
  tvaIntracommunautaire: null as string | null,
  /** @see le commentaire d'en-tête. À renseigner avant mise en ligne. */
  mediateur: null as { nom: string; adresse: string; site: string } | null,
} as const;

export const hebergeur = {
  nom: "Vercel Inc.",
  adresse: "340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis",
  site: "https://vercel.com",
} as const;

/**
 * Les sous-traitants techniques, au sens du RGPD.
 *
 * La liste doit rester exacte : c'est elle qui est opposable. Si l'envoi passe
 * un jour par Brevo au lieu de Resend, cette ligne change le même jour.
 */
export const sousTraitants = [
  {
    nom: "Vercel Inc.",
    role: "Hébergement du site et des journaux techniques",
    zone: "États-Unis et Union européenne",
  },
  {
    nom: "Resend, Inc.",
    role: "Acheminement des e-mails de demande de contact",
    zone: "États-Unis",
  },
] as const;

export const traitements = [
  {
    finalite: "Répondre à une demande de prestation et établir un devis",
    donnees:
      "Prénoms, adresse e-mail, téléphone, date et lieu du mariage, contenu du message",
    baseLegale:
      "Exécution d'un contrat ou mesures précontractuelles prises à votre demande",
    conservation:
      "3 ans à compter du dernier échange si la demande n'aboutit pas ; durée du contrat puis durées légales d'archivage si elle aboutit",
  },
  {
    finalite:
      "Transmettre vos coordonnées au vidéaste partenaire pour qu'il établisse son devis",
    donnees: "Prénoms, adresse e-mail, téléphone, date et lieu du mariage",
    baseLegale: "Votre consentement, recueilli par une case distincte et facultative",
    conservation: "Jusqu'au retrait de votre consentement ou la fin de la relation",
  },
  {
    finalite: "Limiter les envois abusifs du formulaire",
    donnees: "Adresse IP tronquée (/24 en IPv4, /48 en IPv6)",
    baseLegale: "Intérêt légitime à protéger le service",
    conservation: "30 minutes",
  },
  {
    finalite:
      "Publier des photographies sur lesquelles les mariés sont reconnaissables, à des fins de portfolio",
    donnees: "Photographies",
    baseLegale:
      "Votre consentement, recueilli séparément au contrat et révocable pour l'avenir",
    conservation: "Jusqu'au retrait de votre accord, pour les usages futurs",
  },
] as const;

/** Phrase exacte tant que le médiateur n'est pas désigné. */
export const mentionMediateur = entreprise.mediateur
  ? `Médiateur de la consommation : ${entreprise.mediateur.nom}, ${entreprise.mediateur.adresse} — ${entreprise.mediateur.site}`
  : "Médiateur de la consommation : en cours de désignation. Ses coordonnées seront publiées ici et figureront dans votre contrat avant toute signature.";

/**
 * Mention fiscale affichée, selon le régime — et rien du tout tant qu'il n'est
 * pas qualifié. On n'affiche pas un numéro qu'on n'a pas, et on n'affirme pas
 * un régime qu'on n'a pas vérifié.
 */
export const mentionTva =
  entreprise.regimeTva === "assujetti" && entreprise.tvaIntracommunautaire
    ? `Numéro de TVA intracommunautaire : ${entreprise.tvaIntracommunautaire}`
    : entreprise.regimeTva === "franchise_base"
      ? "TVA non applicable, article 293 B du Code général des impôts"
      : null;
