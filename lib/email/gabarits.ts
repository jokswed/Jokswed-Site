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
}

function enveloppe({ preEntete, titre, corps, bouton, pied }: Enveloppe): string {
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
                  letter-spacing:0.04em;color:${ENCRE}">Joks<em>Wed</em></p>
        <p style="margin:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;
                  letter-spacing:0.28em;text-transform:uppercase;color:${GRIS}">
          Photographe de mariage</p>
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
}): Gabarit {
  const quand = donnees.dateMariage
    ? ` du <strong>${echapper(donnees.dateMariage)}</strong>`
    : "";
  const quandTexte = donnees.dateMariage ? ` du ${donnees.dateMariage}` : "";

  return {
    sujet: `Votre demande a bien été reçue — JoksWed`,
    html: enveloppe({
      preEntete: `Demande ${donnees.reference} bien reçue. Je reviens vers vous sous 48 heures.`,
      titre: "Merci pour votre confiance",
      corps: [
        paragraphe(`Bonjour ${echapper(donnees.prenoms)},`),
        paragraphe(`J'ai bien reçu votre demande pour votre mariage${quand}.`),
        donnees.formule
          ? paragraphe(`Formule envisagée : <strong>${echapper(donnees.formule)}</strong>.`)
          : "",
        paragraphe(
          "Je vais étudier les informations transmises et je reviendrai vers vous " +
            "personnellement, en général sous 48 heures.",
        ),
        paragraphe(
          `<em>Votre date n'est pas encore réservée</em> : elle le sera à la signature ` +
            `du contrat et au versement de l'acompte. Je vérifie ma disponibilité et ` +
            `vous le confirme par écrit.`,
        ),
        paragraphe(
          `Référence de votre demande : <strong>${echapper(donnees.reference)}</strong>`,
        ),
        paragraphe("À très bientôt,<br>John — JoksWed"),
      ].join(""),
      pied:
        "Vous recevez ce message parce que vous avez envoyé une demande sur jokswed.com. " +
        "Pour toute question, répondez simplement à cet e-mail.",
    }),
    texte: [
      `Bonjour ${donnees.prenoms},`,
      "",
      `J'ai bien reçu votre demande pour votre mariage${quandTexte}.`,
      donnees.formule ? `Formule envisagée : ${donnees.formule}.` : "",
      "",
      "Je vais étudier les informations transmises et je reviendrai vers vous",
      "personnellement, en général sous 48 heures.",
      "",
      "Votre date n'est pas encore réservée : elle le sera à la signature du",
      "contrat et au versement de l'acompte.",
      "",
      `Référence de votre demande : ${donnees.reference}`,
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
