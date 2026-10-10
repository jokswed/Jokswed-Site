import "server-only";
import { randomBytes } from "node:crypto";

/* =============================================================================
   ADRESSES DE RÉPONSE
   -----------------------------------------------------------------------------
   ⚠️ C'EST LE SEUL MÉCANISME DE RATTACHEMENT QUI TIENNE.

   Quand on écrit à un couple, le message porte
   `Reply-To: rep+<jeton>@reply.jokswed.com`. Le jeton fait 128 bits et
   n'appartient qu'à cette conversation. Une réponse arrivée à cette adresse
   ne peut venir que de quelqu'un à qui nous avons écrit.

   Les autres pistes ont toutes été écartées, et pour de bonnes raisons :

     · le SUJET — « Re: Votre mariage » rattacherait le courrier du couple A
       à la conversation du couple B ;
     · `In-Reply-To` — n'importe qui peut l'écrire ; s'y fier laisserait un
       tiers injecter un message dans un fil dont il devine l'identifiant ;
     · l'ADRESSE DE L'EXPÉDITEUR — un couple peut écrire de deux boîtes, et
       deux couples peuvent partager une adresse.

   `In-Reply-To` est conservé, mais comme information, jamais comme autorité.

   ⚠️ LE DOMAINE DE RÉCEPTION DOIT ÊTRE DISTINCT DU DOMAINE D'ENVOI.
   Brevo l'exige : les MX du sous-domaine pointent vers ses serveurs
   entrants, ce qu'on ne peut pas faire sur le domaine qui envoie.
   ============================================================================= */

/** Base32 sans voyelles : 128 bits, illisible mais recopiable au besoin. */
export function engendrerJetonConversation(): string {
  const alphabet = "0123456789bcdfghjkmnpqrstvwxyz";
  const octets = randomBytes(20);
  let jeton = "";
  for (const o of octets) jeton += alphabet[o % alphabet.length];
  return jeton;
}

export function domaineReponse(): string | null {
  return process.env.JOKSWED_DOMAINE_REPONSE?.trim() || null;
}

/**
 * L'adresse de réponse d'une conversation, ou `null` si le domaine de
 * réception n'est pas configuré.
 *
 * ⚠️ `null` N'EST PAS UNE ERREUR À AVALER. Sans domaine de réception, on
 * peut écrire au client, mais sa réponse n'arrivera nulle part. L'appelant
 * doit le dire à l'utilisateur plutôt que de laisser croire au contraire.
 */
export function adresseReponse(jeton: string): string | null {
  const domaine = domaineReponse();
  if (!domaine) return null;
  return `rep+${jeton}@${domaine}`;
}

/**
 * Extrait le jeton d'une liste d'adresses destinataires.
 *
 * On accepte `rep+<jeton>@domaine` et `rep-<jeton>@domaine` : certains
 * clients de messagerie réécrivent le `+`.
 */
export function jetonDepuisDestinataires(adresses: readonly string[]): string | null {
  const domaine = domaineReponse();
  for (const brute of adresses) {
    const adresse = (brute ?? "").trim().toLowerCase();
    const correspondance = adresse.match(/^rep[+-]([0-9a-z]{10,64})@([^@\s>]+)$/);
    if (!correspondance) continue;
    /* Si un domaine est configuré, on exige qu'il corresponde : sinon
       n'importe quel `rep+…@ailleurs.test` serait accepté. */
    if (domaine && correspondance[2] !== domaine.toLowerCase()) continue;
    return correspondance[1];
  }
  return null;
}

/** Toutes les adresses d'une charge utile Brevo : To, Cc, Recipients. */
export function adressesDUnePayload(item: Record<string, unknown>): string[] {
  const boites: string[] = [];
  for (const champ of ["To", "Cc", "Recipients", "Bcc"]) {
    const valeur = item[champ];
    if (!Array.isArray(valeur)) continue;
    for (const m of valeur) {
      const adresse = typeof m === "string" ? m : (m as { Address?: string })?.Address;
      if (adresse) boites.push(adresse);
    }
  }
  /* `Delivered-To` et `X-Original-To` survivent à certains transferts. */
  const entetes = item.Headers as Record<string, unknown> | undefined;
  for (const cle of ["Delivered-To", "X-Original-To", "To"]) {
    const v = entetes?.[cle];
    if (typeof v === "string") boites.push(...v.split(",").map((x) => x.trim()));
    else if (Array.isArray(v)) boites.push(...v.map(String));
  }
  /* Une adresse peut arriver sous la forme « Nom <adresse> ». */
  return boites.map((b) => {
    const m = b.match(/<([^>]+)>/);
    return (m ? m[1] : b).trim();
  });
}
