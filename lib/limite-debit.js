/* =============================================================================
   LIMITATION DE DÉBIT — FENÊTRE GLISSANTE EN MÉMOIRE
   -----------------------------------------------------------------------------
   ⚠️ CE QUE CETTE IMPLÉMENTATION FAIT, ET CE QU'ELLE NE FAIT PAS.

   Elle compte les soumissions par clé dans une fenêtre glissante, en mémoire du
   processus. Sur Vercel, chaque instance de fonction a sa propre mémoire :
   un attaquant réparti sur plusieurs instances obtient donc plus que la limite
   affichée, et une instance fraîchement démarrée repart de zéro.

   Ce n'est donc PAS une protection forte. C'est un garde-fou qui arrête le cas
   réel et courant — un script naïf, ou un visiteur qui martèle le bouton — sans
   rien ajouter à l'infrastructure.

   La vraie limitation est prévue en V3, en base, avec la table `limites_debit`
   partagée entre toutes les instances. Le patron existe déjà, éprouvé, dans
   `lib/rate-limit.ts` du projet EyesofJoks.

   Je l'écris explicitement pour qu'on ne prenne pas ce garde-fou pour un mur.
   ============================================================================= */

/** @type {Map<string, number[]>} clé → horodatages des soumissions retenues */
const journal = new Map();

/** Au-delà, on purge les clés les plus anciennes : la mémoire reste bornée. */
const CLES_MAX = 5_000;

/**
 * @param {string} cle          Ce qu'on limite (ici : une IP tronquée).
 * @param {number} limite       Soumissions autorisées dans la fenêtre.
 * @param {number} fenetreMs    Largeur de la fenêtre glissante.
 * @returns {{ autorise: boolean, restant: number, reessayerDansS: number }}
 */
export function limiterDebit(cle, limite, fenetreMs) {
  const maintenant = Date.now();
  const depuis = maintenant - fenetreMs;

  // Purge bornée : on ne laisse pas la Map croître indéfiniment.
  if (journal.size > CLES_MAX) {
    for (const [k, horodatages] of journal) {
      if (horodatages.every((h) => h <= depuis)) journal.delete(k);
      if (journal.size <= CLES_MAX / 2) break;
    }
  }

  const precedents = (journal.get(cle) ?? []).filter((h) => h > depuis);

  if (precedents.length >= limite) {
    const plusAncien = Math.min(...precedents);
    journal.set(cle, precedents);
    return {
      autorise: false,
      restant: 0,
      reessayerDansS: Math.max(1, Math.ceil((plusAncien + fenetreMs - maintenant) / 1000)),
    };
  }

  precedents.push(maintenant);
  journal.set(cle, precedents);
  return { autorise: true, restant: limite - precedents.length, reessayerDansS: 0 };
}

/**
 * Clé de limitation dérivée de l'IP, TRONQUÉE.
 *
 * ⚠️ On ne conserve jamais l'IP complète : /24 en IPv4, /48 en IPv6. C'est
 * suffisant pour limiter un débit, et cela reste proportionné au regard du
 * RGPD — une IP complète est une donnée personnelle qu'on n'a pas besoin de
 * garder pour cet usage.
 */
export function cleDepuisRequete(request) {
  const brut =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "inconnue";

  if (brut.includes(":")) {
    return brut.split(":").slice(0, 3).join(":") + "::/48";
  }
  const octets = brut.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24` : brut;
}
