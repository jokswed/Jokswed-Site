import "server-only";
import { chiffrer, dechiffrer } from "@/lib/auth/secrets";
import { rafraichir, gmailConfigure } from "./oauth";

/* =============================================================================
   OBTENIR UN JETON UTILISABLE — EN LE RENOUVELANT S'IL FAUT
   -----------------------------------------------------------------------------
   Un jeton d'accès Google vit une heure. Le drain, lui, tourne quand il tourne :
   il trouvera presque toujours un jeton périmé. Le renouvellement n'est donc
   pas un cas d'exception, c'est le cas courant.
   ============================================================================= */

/** Marge avant expiration : un jeton valable 20 s ne survivrait pas à l'envoi. */
const MARGE_MS = 120_000;

export interface CompteUtilisable {
  compteId: string;
  adresse: string;
  jetonAcces: string;
}

type Requete = (texte: string, valeurs?: unknown[]) =>
  Promise<{ rows: Record<string, any>[] }>;

/**
 * Le compte Gmail à utiliser pour ce message, prêt à servir.
 *
 * `null` quand il n'y a pas de compte connecté, quand Google n'est pas
 * configuré, ou quand l'autorisation est perdue. L'appelant retombe alors sur
 * l'envoi habituel — une réponse qui part par Brevo vaut mieux qu'une réponse
 * qui ne part pas.
 */
export async function compteGmailPourMessage(
  q: Requete,
  messageId: string
): Promise<CompteUtilisable | null> {
  if (!gmailConfigure()) return null;

  const { rows } = await q("SELECT * FROM app.gmail_pour_message($1)", [messageId]);
  const c = rows[0];
  if (!c) return null;

  const expire = new Date(c.expire_le).getTime();
  if (expire - Date.now() > MARGE_MS) {
    return {
      compteId: c.compte_id,
      adresse: String(c.adresse),
      jetonAcces: dechiffrer(c.jeton_acces),
    };
  }

  /* ⚠️ SANS JETON DE RAFRAÎCHISSEMENT, IL N'Y A RIEN À FAIRE.
     Google ne l'émet qu'au premier consentement. Le cas se produit quand
     quelqu'un a reconnecté le compte sans `prompt=consent` : on le marque en
     panne pour que l'écran de réglages le dise, au lieu de laisser l'envoi
     échouer silencieusement à chaque tentative. */
  if (!c.jeton_rafraichissement) {
    await q("SELECT app.gmail_panne($1,$2)",
      [c.compte_id, "jeton de rafraîchissement absent : reconnecter le compte"]);
    return null;
  }

  try {
    const neuf = await rafraichir(dechiffrer(c.jeton_rafraichissement));
    await q("SELECT app.gmail_jeton_maj($1,$2,$3)",
      [c.compte_id, chiffrer(neuf.acces), neuf.expireLe.toISOString()]);
    return {
      compteId: c.compte_id,
      adresse: String(c.adresse),
      jetonAcces: neuf.acces,
    };
  } catch (erreur) {
    /* ⚠️ UNE AUTORISATION RÉVOQUÉE DOIT SE VOIR.
       Sur l'autre plateforme, un accès Gmail révoqué a cessé de fonctionner en
       silence pendant des jours. Ici on l'inscrit, et l'écran de réglages
       l'affiche. Le message part quand même, par l'autre fournisseur. */
    const motif = erreur instanceof Error ? erreur.message : "renouvellement impossible";
    await q("SELECT app.gmail_panne($1,$2)", [c.compte_id, motif]);
    return null;
  }
}
