import "server-only";

/* =============================================================================
   MODÈLES DE RÉPONSE — SUBSTITUTION DES VARIABLES
   -----------------------------------------------------------------------------
   ⚠️ LISTE FERMÉE, ET UNE VARIABLE INCONNUE RESTE VISIBLE.

   Remplacer silencieusement `{{inconnue}}` par du vide enverrait au client
   une phrase trouée — « Je vous confirme ma disponibilité pour votre mariage
   du . » — sans que personne ne s'en aperçoive. On laisse donc le marqueur
   tel quel : il saute aux yeux dans l'aperçu, et l'aperçu est obligatoire.
   ============================================================================= */

export interface VariablesDossier {
  prenom_client?: string | null;
  date_mariage?: string | null;
  lieu?: string | null;
  formule?: string | null;
  reference?: string | null;
  montant_total_cents?: number | null;
  montant_restant_cents?: number | null;
  montant_acompte_cents?: number | null;
  signature?: string | null;
}

function euros(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} €`;
}

/** Les valeurs réellement substituables, dérivées des variables du dossier. */
export function tableDeSubstitution(v: VariablesDossier): Record<string, string> {
  const table: Record<string, string> = {};
  const poser = (cle: string, valeur: string | null | undefined) => {
    if (valeur !== null && valeur !== undefined && valeur !== "") table[cle] = valeur;
  };
  poser("prenom_client", v.prenom_client);
  poser("date_mariage", v.date_mariage);
  poser("lieu", v.lieu);
  poser("formule", v.formule);
  poser("reference", v.reference);
  poser("montant_total", euros(v.montant_total_cents));
  poser("montant_restant", euros(v.montant_restant_cents));
  poser("montant_acompte", euros(v.montant_acompte_cents));
  poser("signature", v.signature);
  /* Une tournure qui disparaît proprement quand le lieu est inconnu, plutôt
     qu'une phrase bancale avec un « à  » suivi de rien. */
  table.lieu_phrase = v.lieu ? ` à ${v.lieu}` : "";
  return table;
}

export interface Substitution {
  texte: string;
  /** Les marqueurs restés sans valeur : l'aperçu doit les signaler. */
  manquantes: string[];
}

export function substituer(gabarit: string, table: Record<string, string>): Substitution {
  const manquantes = new Set<string>();
  const texte = gabarit.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (marqueur, cle: string) => {
    const valeur = table[cle];
    if (valeur === undefined) {
      manquantes.add(cle);
      return marqueur;
    }
    return valeur;
  });
  return { texte, manquantes: [...manquantes] };
}

/** Un corps en texte brut devient un HTML sobre, sans rien injecter. */
export function texteVersHtml(texte: string): string {
  const echappe = texte
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphes = echappe.split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 1em;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`
    + `font-size:15px;color:#141312">${paragraphes.join("")}</div>`;
}
