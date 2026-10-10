import "server-only";
import { sansIdentite } from "@/lib/db/client";

/* =============================================================================
   LIMITATION DE DÉBIT DU FORMULAIRE PUBLIC — EN BASE
   -----------------------------------------------------------------------------
   ⚠️ DEUX ÉCHELLES, ET C'EST LE POINT IMPORTANT.

   Une limite stricte par adresse IP interdirait le formulaire à tout un
   opérateur mobile : derrière le CGNAT d'un réseau 4G, des milliers
   d'abonnés partagent la même adresse publique. Un seul visiteur insistant
   bloquerait alors de vrais clients — un faux positif coûte une demande
   perdue, c'est-à-dire un mariage perdu.

   On combine donc :

     · par ADRESSE E-MAIL — stricte (3 / heure), car elle désigne une
       personne. Un couple qui hésite et renvoie son formulaire passe ;
     · par RÉSEAU /24 — large (40 / heure), car elle peut désigner une ville
       entière derrière un même opérateur.

   Un script qui varie les adresses e-mail depuis une seule IP finit par
   buter sur la seconde. Un script distribué passe les deux — c'est assumé :
   le honeypot, la vérification d'origine et l'idempotence restent en
   première ligne, et une demande parasite coûte une ligne en base, pas un
   e-mail parti.
   ============================================================================= */

export const LIMITE_EMAIL = 3;
export const LIMITE_RESEAU = 40;
export const FENETRE_SECONDES = 3600;

export interface Verdict {
  autorise: boolean;
  /** `email` ou `reseau` : utile pour adapter le message, pas pour l'exposer. */
  motif?: "email" | "reseau";
  reessayerDans: number;
}

export async function verifierLimite(
  ipTronquee: string,
  email: string,
): Promise<Verdict> {
  return sansIdentite(async (q) => {
    /* L'adresse d'abord : c'est la plus discriminante, et la plus souvent
       atteinte par un vrai visiteur qui réessaie. */
    const { rows: parEmail } = await q("SELECT * FROM app.limiter($1,$2,$3)", [
      `demande:email:${email.toLowerCase()}`, LIMITE_EMAIL, FENETRE_SECONDES,
    ]);
    if (!parEmail[0].autorise) {
      return {
        autorise: false,
        motif: "email" as const,
        reessayerDans: parEmail[0].reessayer_dans,
      };
    }

    const { rows: parReseau } = await q("SELECT * FROM app.limiter($1,$2,$3)", [
      `demande:reseau:${ipTronquee}`, LIMITE_RESEAU, FENETRE_SECONDES,
    ]);
    if (!parReseau[0].autorise) {
      return {
        autorise: false,
        motif: "reseau" as const,
        reessayerDans: parReseau[0].reessayer_dans,
      };
    }

    return { autorise: true, reessayerDans: 0 };
  });
}
