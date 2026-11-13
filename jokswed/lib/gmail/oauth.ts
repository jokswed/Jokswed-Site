import "server-only";

/* =============================================================================
   AUTORISATION GOOGLE — LE MINIMUM, ET RIEN DE PLUS
   -----------------------------------------------------------------------------
   ⚠️ UNE SEULE PORTÉE GMAIL : `gmail.send`.

   Elle est « sensible » : Google demande une vérification de l'application
   pour la publier, mais aucune évaluation de sécurité payante. Lire la boîte
   demanderait `gmail.readonly`, portée RESTREINTE, soumise à une évaluation
   tierce renouvelée chaque année. La réception passe donc par le webhook
   entrant déjà en place, et cette portée-là n'est pas demandée.

   `gmail.send` ne permet que d'envoyer. Elle ne donne accès ni à la lecture,
   ni à la suppression, ni aux brouillons — c'est volontaire : une autorisation
   qu'on ne peut pas utiliser pour nuire est une autorisation qu'on n'a pas à
   défendre.

   `openid email` sert uniquement à savoir QUELLE boîte vient d'être
   connectée, pour l'afficher et pour refuser un envoi depuis une autre.
   ============================================================================= */
export const PORTEES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
] as const;

const AUTORISATION = "https://accounts.google.com/o/oauth2/v2/auth";
const JETON = "https://oauth2.googleapis.com/token";
const REVOCATION = "https://oauth2.googleapis.com/revoke";

export function gmailConfigure(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** L'adresse de retour, qui doit figurer À L'IDENTIQUE dans Google Cloud. */
export function adresseRetour(): string {
  const site = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? "https://jokswed.com";
  return `${site.replace(/\/$/, "")}/api/admin/gmail/callback`;
}

export function urlAutorisation(etat: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: adresseRetour(),
    response_type: "code",
    scope: PORTEES.join(" "),
    /* ⚠️ LES DEUX SONT NÉCESSAIRES POUR OBTENIR UN JETON DE RAFRAÎCHISSEMENT.
       `access_type=offline` le demande ; `prompt=consent` le force même quand
       l'utilisateur a déjà consenti — sans quoi une reconnexion rend un accès
       d'une heure et rien pour le renouveler, et l'envoi s'arrête tout seul
       soixante minutes plus tard. */
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: etat,
  });
  return `${AUTORISATION}?${p.toString()}`;
}

export interface JetonsGoogle {
  acces: string;
  rafraichissement: string | null;
  expireLe: Date;
  portees: string[];
  adresse: string | null;
}

/**
 * ⚠️ L'ADRESSE EST LUE DANS LE `id_token`, SANS VÉRIFICATION DE SIGNATURE.
 *
 * C'est légitime ici, et seulement ici : le jeton arrive en réponse DIRECTE à
 * notre propre échange de code, sur une connexion TLS vers le point d'accès de
 * Google. Il n'a pas transité par le navigateur. Vérifier la signature d'un
 * jeton qu'on vient de recevoir de son émetteur n'ajouterait rien.
 */
function adresseDuJeton(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const charge = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(charge, "base64url").toString("utf8"));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

async function demanderJetons(corps: URLSearchParams): Promise<JetonsGoogle> {
  const r = await fetch(JETON, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: corps,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    /* ⚠️ AUCUN SECRET DANS LE MESSAGE D'ERREUR. Google renvoie le motif, pas
       le jeton ; on ne recopie que le motif. */
    const motif = typeof data.error === "string" ? data.error : `HTTP ${r.status}`;
    throw new Error(`Google a refusé : ${motif}`);
  }
  return {
    acces: String(data.access_token),
    rafraichissement: data.refresh_token ? String(data.refresh_token) : null,
    expireLe: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000),
    portees: String(data.scope ?? "").split(" ").filter(Boolean),
    adresse: adresseDuJeton(data.id_token),
  };
}

export function echangerCode(code: string): Promise<JetonsGoogle> {
  return demanderJetons(new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: adresseRetour(),
    grant_type: "authorization_code",
  }));
}

export function rafraichir(jetonRafraichissement: string): Promise<JetonsGoogle> {
  return demanderJetons(new URLSearchParams({
    refresh_token: jetonRafraichissement,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
  }));
}

/** Révoquer chez Google, et pas seulement chez nous. */
export async function revoquer(jeton: string): Promise<void> {
  await fetch(REVOCATION, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: jeton }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    /* Révocation refusée ou injoignable : la ligne locale part quand même.
       Garder un jeton qu'on ne veut plus serait le pire des deux. */
  });
}
