/**
 * Sous-ensemble volontairement limité du Markdown pour les e-mails JoksWed :
 * paragraphes, retours à la ligne, gras, italique, code, listes, liens HTTPS
 * et mailto. Pas de HTML brut, d'images distantes, de tables ni de scripts.
 *
 * Sécurité : toutes les portions utilisateur sont échappées AVANT insertion
 * dans du HTML ; les seuls tags émis sont des littéraux de ce module.
 * Les protocoles dangereux (javascript:, data:, file:, etc.) sont refusés.
 * Le rendu ne dépend d'aucun parseur HTML ou moteur dans le navigateur.
 */

export function echapperHtml(texte: string): string {
  return String(texte ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function urlAutorisee(brute: string): boolean {
  if (!brute || /[\s\u0000-\u001f\u007f<>"']/.test(brute)) return false;
  try {
    const url = new URL(brute);
    if (url.protocol === "mailto:") {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname);
    }
    return (url.protocol === "https:" || url.protocol === "http:")
      && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Ne traite qu'un jeu fermé de syntaxes simples. Une syntaxe non reconnue est
 * affichée comme du texte ordinaire, jamais interprétée comme HTML.
 */
function inlineMarkdown(source: string, profondeur = 0): string {
  if (profondeur > 3) return echapperHtml(source);
  const motif = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let resultat = "";
  let precedent = 0;
  for (const m of source.matchAll(motif)) {
    const index = m.index ?? 0;
    resultat += echapperHtml(source.slice(precedent, index));
    const morceau = m[0];
    if (morceau.startsWith("`")) {
      resultat += `<code style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:0.92em">${echapperHtml(morceau.slice(1, -1))}</code>`;
    } else if (morceau.startsWith("[")) {
      const ferme = morceau.indexOf("](");
      const libelle = morceau.slice(1, ferme);
      const url = morceau.slice(ferme + 2, -1);
      resultat += urlAutorisee(url)
        ? `<a href="${echapperHtml(url)}" style="color:#141312;text-decoration:underline;text-underline-offset:3px">${echapperHtml(libelle)}</a>`
        : echapperHtml(libelle);
    } else if (morceau.startsWith("**") || morceau.startsWith("__")) {
      resultat += `<strong>${inlineMarkdown(morceau.slice(2, -2), profondeur + 1)}</strong>`;
    } else {
      resultat += `<em>${inlineMarkdown(morceau.slice(1, -1), profondeur + 1)}</em>`;
    }
    precedent = index + morceau.length;
  }
  return resultat + echapperHtml(source.slice(precedent));
}

const POLICE = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#45423d";

export function markdownVersHtml(texte: string): string {
  const normalise = String(texte ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalise) return "";
  return normalise.split(/\n[ \t]*\n/).map((bloc) => {
    const lignes = bloc.split("\n");
    const estListe = lignes.length > 0
      && lignes.every((ligne) => /^\s*(?:[-+*]\s+|\d+\.\s+)/.test(ligne));
    if (estListe) {
      const ordonnee = lignes.every((l) => /^\s*\d+\.\s+/.test(l));
      const tag = ordonnee ? "ol" : "ul";
      const elements = lignes.map((l) =>
        `<li>${inlineMarkdown(l.replace(/^\s*(?:[-+*]\s+|\d+\.\s+)/, ""))}</li>`,
      ).join("");
      return `<${tag} style="margin:0 0 16px;padding-left:24px;${POLICE}">${elements}</${tag}>`;
    }
    return `<p style="margin:0 0 14px;${POLICE}">${lignes.map((l) =>
      inlineMarkdown(l)).join("<br>")}</p>`;
  }).join("");
}

/** Texte brut lisible : les marqueurs Markdown ne doivent pas apparaître
 *  comme des étoiles parasites dans les lecteurs sans HTML. */
export function markdownVersTexte(texte: string): string {
  return String(texte ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (_tout, libelle: string, url: string) =>
      urlAutorisee(url) ? (libelle === url ? url : `${libelle} (${url})`) : libelle)
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "");
}

/** Pour les notifications uniquement : éviter citations, HTML, Markdown et
 *  longues chaînes de contrôle. Ne jamais envoyer le fil entier. */
export function extraitNotification(texte: string, limite = 150): string {
  const original = markdownVersTexte(texte)
    .split(/\n\s*\n/)[0]
    .replace(/<[^>]{0,500}>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!original) return "Vous avez reçu un nouveau message.";
  return original.length > limite ? original.slice(0, limite - 1).trimEnd() + "…" : original;
}
