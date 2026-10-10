import "server-only";

/* =============================================================================
   GABARITS D'E-MAIL — IDENTITÉ JOKSWED
   -----------------------------------------------------------------------------
   ⚠️ CSS EN LIGNE, TABLEAUX, ET POLICES SYSTÈME.

   Les clients de messagerie ne sont pas des navigateurs : Outlook ignore la
   plupart des feuilles de style, Gmail retire les balises <style> dans
   certaines vues, et aucun ne charge de police distante de façon fiable. On
   écrit donc ce qu'on écrirait en 2005 — et le rendu, lui, reste celui de
   JoksWed : beaucoup de blanc, un filet, une capitale espacée, un bouton
   encre.

   ⚠️ CHAQUE GABARIT A SA VERSION TEXTE.

   Ce n'est pas une politesse : un message sans partie texte part plus souvent
   en indésirable, et certains lecteurs n'affichent que celle-là.
   ============================================================================= */

const ENCRE = "#141312";
const GRIS = "#8b8781";
const LIGNE = "#e8e5df";
const PAPIER = "#fbfaf8";

function echapper(valeur: string): string {
  return String(valeur ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

interface Enveloppe {
  preEntete: string;
  titre: string;
  corps: string;
  bouton?: { libelle: string; lien: string } | null;
  pied?: string;
  /** Identité professionnelle invitée, sans supposer un métier. */
  marque?: string;
  sousTitreMarque?: string;
}

function enveloppe({ preEntete, titre, corps, bouton, pied, marque, sousTitreMarque }: Enveloppe): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${echapper(titre)}</title></head>
<body style="margin:0;padding:0;background:${PAPIER};">
<!-- Le pré-en-tête est le texte que les clients affichent à côté de l'objet.
     Sans lui, ils y mettent le début du HTML, souvent illisible. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${echapper(preEntete)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${PAPIER};padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:560px;background:#ffffff;border:1px solid ${LIGNE}">
      <tr><td style="padding:34px 34px 0">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;
                  letter-spacing:0.04em;color:${ENCRE}">${marque ? echapper(marque) : "Joks<em>Wed</em>"}</p>
        <p style="margin:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;
                  letter-spacing:0.28em;text-transform:uppercase;color:${GRIS}">
          ${echapper(sousTitreMarque ?? "Photographe de mariage")}</p>
      </td></tr>
      <tr><td style="padding:26px 34px 0">
        <hr style="border:0;border-top:1px solid ${LIGNE};margin:0">
      </td></tr>
      <tr><td style="padding:26px 34px 0">
        <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;
                   font-size:26px;font-weight:400;line-height:1.25;color:${ENCRE}">
          ${echapper(titre)}</h1>
        ${corps}
      </td></tr>
      ${bouton ? `<tr><td style="padding:26px 34px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${ENCRE}">
            <a href="${echapper(bouton.lien)}"
               style="display:inline-block;padding:15px 30px;font-family:Helvetica,Arial,sans-serif;
                      font-size:11px;letter-spacing:0.22em;text-transform:uppercase;
                      color:#ffffff;text-decoration:none">${echapper(bouton.libelle)}</a>
          </td></tr></table>
      </td></tr>` : ""}
      <tr><td style="padding:30px 34px 34px">
        <hr style="border:0;border-top:1px solid ${LIGNE};margin:0 0 18px">
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;
                  line-height:1.6;color:${GRIS}">
          ${pied ?? "JoksWed — Photographe de mariage, Paris &amp; International."}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function paragraphe(texte: string): string {
  return `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;
                    line-height:1.7;color:#45423d">${texte}</p>`;
}

export interface Gabarit {
  sujet: string;
  html: string;
  texte: string;
}

/* ─────────────────────────── ACCUSÉ DE RÉCEPTION ───────────────────────────
   ⚠️ IL NE PROMET PAS UNE RÉSERVATION.
   Une demande n'est pas une date bloquée : la confondre créerait exactement
   le malentendu que le contrat cherche à éviter (article 2). Le texte le dit
   explicitement, et il reste chaleureux.
   ------------------------------------------------------------------------- */
export function accuseReception(donnees: {
  prenoms: string;
  reference: string;
  dateMariage?: string | null;
  formule?: string | null;
  /** Vraie boîte de réponse ; aucun lien vers l'administration privée. */
  emailReponse?: string | null;
}): Gabarit {
  const quand = donnees.dateMariage
    ? ` du <strong>${echapper(donnees.dateMariage)}</strong>`
    : "";
  const quandTexte = donnees.dateMariage ? ` du ${donnees.dateMariage}` : "";
  const adresse = donnees.emailReponse?.trim() || "jokswed@gmail.com";
  const objetContact = encodeURIComponent(`Suivi de ma demande ${donnees.reference} — JoksWed`);
  const lienContact = `mailto:${adresse}?subject=${objetContact}`;

  return {
    sujet: "Votre demande a bien été reçue — JoksWed",
    html: enveloppe({
      preEntete: `Demande ${donnees.reference} reçue. Voici les prochaines étapes.`,
      titre: "Merci pour votre confiance",
      corps: [
        paragraphe(`Bonjour ${echapper(donnees.prenoms)},`),
        paragraphe(`J'ai bien reçu votre demande pour votre mariage${quand}.`),
        donnees.formule
          ? paragraphe(`Formule envisagée : <strong>${echapper(donnees.formule)}</strong>.`)
          : "",
        paragraphe(
          "Je vais prendre le temps d'étudier votre projet et votre planning. " +
          "Je reviens personnellement vers vous, en général sous 48 heures."
        ),
        paragraphe(
          "Votre demande est enregistrée, mais <strong>votre date n'est pas encore réservée</strong> : " +
          "la réservation sera confirmée après signature du contrat et versement de l'acompte."
        ),
        `<div style="border:1px solid ${LIGNE};background:${PAPIER};padding:18px 20px;margin:24px 0">
          <p style="margin:0 0 7px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${GRIS}">Référence de votre demande</p>
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:21px;color:${ENCRE}">${echapper(donnees.reference)}</p>
        </div>`,
        paragraphe(
          "Vous souhaitez ajouter une information ou poser une question ? " +
          "Utilisez le bouton ci-dessous : votre référence sera déjà indiquée."
        ),
        paragraphe("À très bientôt,<br>John — JoksWed"),
      ].join(""),
      bouton: { libelle: "Contacter JoksWed", lien: lienContact },
      pied:
        "Ce message confirme la réception de votre demande, pas une réservation. " +
        "Pour toute question, vous pouvez répondre directement à cet e-mail.",
    }),
    texte: [
      `Bonjour ${donnees.prenoms},`,
      "",
      `J'ai bien reçu votre demande pour votre mariage${quandTexte}.`,
      donnees.formule ? `Formule envisagée : ${donnees.formule}.` : "",
      "",
      "Je vais étudier votre projet et votre planning, et revenir personnellement",
      "vers vous, en général sous 48 heures.",
      "",
      "Votre date n'est pas encore réservée : la réservation sera confirmée",
      "après signature du contrat et versement de l'acompte.",
      "",
      `Référence de votre demande : ${donnees.reference}`,
      "Pour la compléter, répondez à cet e-mail en rappelant votre référence.",
      "",
      "À très bientôt,",
      "John — JoksWed",
    ].filter(Boolean).join("\n"),
  };
}

/* ─────────────────────── ALERTE ADMINISTRATEUR ───────────────────────
   ⚠️ LE MINIMUM D'INFORMATION PERSONNELLE.
   Un e-mail d'alerte s'affiche en notification sur un écran verrouillé, et
   transite par une boîte dont on ne maîtrise pas la sécurité. Il porte donc
   la référence et le strict nécessaire ; le détail se consulte dans l'espace
   authentifié, derrière le lien.
   ------------------------------------------------------------------------- */
export function alerteAdministrateur(donnees: {
  reference: string;
  ville?: string | null;
  dateMariage?: string | null;
  videoDemandee: boolean;
  lien: string;
}): Gabarit {
  /* Le prédicat typé garde l'information « plus aucun null » : sans lui,
     TypeScript conserve `(string | null)[]` et refuse `.map(echapper)`. */
  const details = [
    donnees.dateMariage ? `Date : ${donnees.dateMariage}` : "Date : à définir",
    donnees.ville ? `Ville : ${donnees.ville}` : null,
    donnees.videoDemandee ? "Prestation vidéo demandée" : null,
  ].filter((v): v is string => v !== null);

  return {
    sujet: `Nouvelle demande ${donnees.reference}`,
    html: enveloppe({
      preEntete: `Une nouvelle demande vient d'arriver (${donnees.reference}).`,
      titre: "Nouvelle demande",
      corps: [
        paragraphe(`Demande <strong>${echapper(donnees.reference)}</strong>.`),
        paragraphe(details.map(echapper).join("<br>")),
        paragraphe(
          "Les coordonnées du couple et le détail de sa demande sont dans votre " +
            "espace, derrière votre connexion.",
        ),
      ].join(""),
      bouton: { libelle: "Ouvrir la demande", lien: donnees.lien },
      pied: "Notification automatique de votre administration JoksWed.",
    }),
    texte: [
      `Nouvelle demande ${donnees.reference}.`,
      "",
      ...details,
      "",
      "Les coordonnées du couple sont dans votre espace :",
      donnees.lien,
    ].join("\n"),
  };
}

/* ─────────────────── PROPOSITION À UN COLLABORATEUR ───────────────────
   ⚠️ CE GABARIT EXISTE, MAIS N'EST PAS ENCORE UTILISÉ.
   Tant que le compte du vidéaste n'est pas activé et ses permissions
   opérationnelles, aucune proposition n'est transmise. Le gabarit est écrit
   pour que, le jour venu, on n'improvise pas son contenu — et il ne porte
   AUCUNE coordonnée client : la date, la ville, la prestation, et un lien.
   ------------------------------------------------------------------------- */
export function propositionCollaborateur(donnees: {
  prenom: string;
  dateMariage?: string | null;
  ville?: string | null;
  prestation: string;
  lien: string;
}): Gabarit {
  const details = [
    donnees.dateMariage ? `Date : ${donnees.dateMariage}` : "Date : à confirmer",
    donnees.ville ? `Lieu : ${donnees.ville}` : null,
    `Prestation : ${donnees.prestation}`,
  ].filter((v): v is string => v !== null);

  return {
    sujet: `Nouvelle proposition — mariage${donnees.dateMariage ? ` du ${donnees.dateMariage}` : ""}`,
    html: enveloppe({
      preEntete: "Une nouvelle proposition de prestation vous attend.",
      titre: "Une proposition vous attend",
      corps: [
        paragraphe(`Bonjour ${echapper(donnees.prenom)},`),
        paragraphe("Une demande de prestation vient d'être reçue pour un mariage."),
        paragraphe(details.map(echapper).join("<br>")),
        paragraphe(
          "Connectez-vous à votre espace collaborateur pour consulter les " +
            "informations et répondre. Les coordonnées des clients n'y figurent " +
            "qu'une fois la proposition acceptée.",
        ),
      ].join(""),
      bouton: { libelle: "Consulter la proposition", lien: donnees.lien },
      pied: "JoksWed — espace collaborateur.",
    }),
    texte: [
      `Bonjour ${donnees.prenom},`,
      "",
      "Une demande de prestation vient d'être reçue pour un mariage.",
      "",
      ...details,
      "",
      "Connectez-vous à votre espace collaborateur pour répondre :",
      donnees.lien,
    ].join("\n"),
  };
}

/**
 * Invitation d'un collaborateur.
 *
 * ⚠️ LE LIEN EST LE SECRET. Il n'est stocké nulle part — seule son empreinte
 * l'est — et il expire. On n'y joint donc aucun mot de passe, aucune
 * coordonnée de client, et aucune information sur les dossiers : la personne
 * n'est pas encore membre quand elle lit ce message.
 */
export function invitationCollaborateur(donnees: {
  prenom?: string | null;
  entreprise: string;
  lien: string;
  expireLe: string;
}): Gabarit {
  const salutation = donnees.prenom ? `Bonjour ${echapper(donnees.prenom)},` : "Bonjour,";
  const nomEntreprise = echapper(donnees.entreprise);
  return {
    sujet: `Activez votre espace ${donnees.entreprise} — JoksWed`,
    html: enveloppe({
      preEntete: `Votre accès à l'espace professionnel ${donnees.entreprise} est prêt.`,
      marque: donnees.entreprise,
      sousTitreMarque: "Espace professionnel · JoksWed",
      titre: "Bienvenue dans votre espace",
      corps: [
        paragraphe(salutation),
        paragraphe(
          `Vous êtes invité(e) à activer l'espace professionnel de <strong>${nomEntreprise}</strong> ` +
          "sur la plateforme JoksWed."
        ),
        paragraphe(
          "Selon les autorisations de votre compte, vous pourrez consulter les propositions " +
          "qui vous sont adressées, gérer vos prestations et préparer vos devis, contrats et factures."
        ),
        paragraphe(
          "Vous choisirez personnellement votre mot de passe. " +
          "Utilisez un mot de passe unique, jamais employé sur un autre site."
        ),
        paragraphe(`Ce lien est personnel et expire le <strong>${echapper(donnees.expireLe)}</strong>.`),
      ].join(""),
      bouton: { libelle: "Activer mon espace", lien: donnees.lien },
      pied: `Invitation sécurisée pour ${nomEntreprise} · JoksWed. ` +
        "Si vous n'attendiez pas cette invitation, ignorez ce message.",
    }),
    texte: [
      donnees.prenom ? `Bonjour ${donnees.prenom},` : "Bonjour,",
      "",
      `Vous êtes invité(e) à activer l'espace professionnel de ${donnees.entreprise} sur JoksWed.`,
      "Selon vos droits, vous pourrez consulter les propositions, gérer vos prestations",
      "et préparer vos devis, contrats et factures.",
      "Choisissez un mot de passe unique, non utilisé ailleurs.",
      "",
      `Lien personnel (expire le ${donnees.expireLe}) :`,
      donnees.lien,
      "",
      "Si vous n'attendiez pas cette invitation, ignorez ce message.",
    ].join("\n"),
  };
}


/* ───────────────────── TARIFS SUR DEMANDE ─────────────────────
   Bouton explicite de la fiche : aucun envoi automatique de tarifs.
   Le partenaire facture séparément ; l'adresse de réponse de l'expéditeur
   technique est celle de JoksWed jusqu'à ce que le routage e-mail soit validé.
   Données tarifaires vidéo : devis DON YC communiqué le 10 octobre 2026.
   Les tarifs photo sont ceux du catalogue public en vigueur. */
import { formules, formaterPrix, tarifsDonYC } from "@/content/offres";

function ligneTarif(nom: string, prix: string, detail: string): string {
  return `<tr><td style="padding:15px 0;border-bottom:1px solid ${LIGNE};vertical-align:top">
    <strong style="display:block;font-family:Georgia,serif;font-size:19px;font-weight:400;color:${ENCRE}">${echapper(nom)}</strong>
    <span style="display:block;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${GRIS}">${echapper(detail)}</span>
    </td><td style="padding:15px 0 15px 16px;border-bottom:1px solid ${LIGNE};vertical-align:top;text-align:right;white-space:nowrap;font-family:Georgia,serif;font-size:19px;color:${ENCRE}">${echapper(prix)}</td></tr>`;
}

export function tarifsSurDemande(donnees: {
  nom: string;
  reference: string;
  nature: "photo" | "video";
}): Gabarit {
  const video = donnees.nature === "video";
  const titre = video ? "Votre reportage vidéo" : "Votre reportage photo";
  const introduction = video
    ? "Notre vidéaste partenaire DON YC (Yvann) vous présente sa prestation, facturée séparément de la photographie."
    : "Voici les trois formules JoksWed pour immortaliser votre mariage.";
  const lignes = video ? [
    ligneTarif("Film de mariage · 12 h", `Dès ${formaterPrix(tarifsDonYC.reportageCents)}`, "Un film de 3 à 5 min et un film cinématique de 45 s à 1 min 30, en Full HD ou 4K Ultra HD."),
    ligneTarif("Heure supplémentaire", `+${formaterPrix(tarifsDonYC.heureSupplementaireCents)}`, "Possible jusqu'à 2 h du matin."),
    ligneTarif("Déplacement hors Île-de-France", `+${formaterPrix(tarifsDonYC.deplacementHorsIdfCents)}`, "Une heure de présence offerte, soit 13 h au total."),
    ligneTarif("Déplacement au-delà de 150 km", `+${formaterPrix(tarifsDonYC.deplacementLongueDistanceCents)}`, "Trois heures de présence offertes, soit 15 h au total."),
    ligneTarif("Rushes stabilisés et étalonnés", `+${formaterPrix(tarifsDonYC.rushesCents)}`, "Stabilisation, correction des couleurs et livraison des fichiers."),
  ] : formules.filter((f) => f.visible).map((f) =>
    ligneTarif(`${f.nom} · ${f.dureeTexte}`, formaterPrix(f.prixCents), f.inclus.join(" · ")));
  const tableau = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:12px 0 20px">${lignes.join("")}</table>`;
  const complement = video
    ? paragraphe("Les frais de déplacement ne se cumulent pas : seul le tarif correspondant à la distance la plus élevée s'applique.")
      + paragraphe('Découvrez le travail de DON YC sur <a style="color:#141312" href="https://www.instagram.com/_don_yc_/">Instagram @_don_yc_</a>.')
    : paragraphe("Les déplacements en France métropolitaine sont inclus. Les options complémentaires restent à chiffrer sur devis.");
  const texte = video ? [
    "DON YC — Vidéaste partenaire JoksWed",
    `Film 12 h, 3–5 min + film cinématique 45 s–1 min 30, Full HD ou 4K : dès ${formaterPrix(tarifsDonYC.reportageCents)}.`,
    `Heure supplémentaire : +${formaterPrix(tarifsDonYC.heureSupplementaireCents)}/h (jusqu'à 2 h du matin).`,
    `Hors Île-de-France : +${formaterPrix(tarifsDonYC.deplacementHorsIdfCents)}, 1 h offerte (13 h).`,
    `Au-delà de 150 km : +${formaterPrix(tarifsDonYC.deplacementLongueDistanceCents)}, 3 h offertes (15 h).`,
    "Déplacements non cumulables : la distance la plus élevée détermine le tarif.",
    `Rushes stabilisés et corrigés : +${formaterPrix(tarifsDonYC.rushesCents)}.`,
    "Instagram : https://www.instagram.com/_don_yc_/",
  ] : formules.filter((f) => f.visible).map((f) =>
    `${f.nom} — ${formaterPrix(f.prixCents)} — ${f.dureeTexte} : ${f.inclus.join(" ; ")}`);
  return {
    sujet: `${video ? "DON YC · Tarifs vidéo" : "JoksWed · Tarifs photo"} — votre mariage`,
    html: enveloppe({
      preEntete: `Tarifs ${video ? "vidéo" : "photo"} pour votre mariage — référence ${donnees.reference}`,
      titre,
      corps: [
        paragraphe(`Bonjour ${echapper(donnees.nom)},`),
        paragraphe(introduction),
        tableau,
        complement,
        paragraphe("Ces tarifs sont indicatifs : disponibilité et prestation seront confirmées par un devis personnalisé. Votre date n'est pas encore réservée."),
        paragraphe(video
          ? "Au plaisir d'échanger avec vous,<br>Yvann — DON YC"
          : "Au plaisir d'échanger avec vous,<br>John — JoksWed"),
      ].join(""),
      bouton: { libelle: "Découvrir JoksWed", lien: "https://jokswed.com/tarifs" },
      pied: video
        ? "Tarifs de DON YC, vidéaste indépendant partenaire de JoksWed. La prestation vidéo et la facturation sont séparées. Pour répondre, utilisez votre messagerie habituelle."
        : "JoksWed — photographie de mariage. Pour répondre, utilisez votre messagerie habituelle.",
    }),
    texte: [
      `Bonjour ${donnees.nom},`, "", introduction, "", ...texte,
      "", "Disponibilité et prestation à confirmer sur devis. La date n'est pas réservée.",
      `Référence de votre demande : ${donnees.reference}`,
      "", video ? "Yvann — DON YC" : "John — JoksWed",
    ].join("\n"),
  };
}
