import "server-only";
import pg, { Pool, type PoolClient } from "pg";

/* =============================================================================
   ACCÈS À LA BASE — L'UNIQUE PORTE AUTHENTIFIÉE
   -----------------------------------------------------------------------------
   ⚠️ POURQUOI UN POOL WEBSOCKET/TCP ET PAS LE PILOTE HTTP DE NEON.

   Le pilote HTTP (`neon()`) envoie CHAQUE requête comme une requête HTTP
   indépendante, qui peut atterrir sur une autre connexion serveur. Un
   `SET app.acteur_id` posé dans un appel n'existe plus au suivant.

   Bâtir des politiques RLS sur un réglage posé ainsi donnerait un RLS qui ne
   filtre RIEN, tout en laissant croire le contraire — le pire des deux
   mondes. L'identité doit donc vivre dans une TRANSACTION, et la transaction
   suppose une connexion tenue.

   ⚠️ ET LE RÔLE DE CONNEXION N'EST PAS LE PROPRIÉTAIRE.

   Le propriétaire des tables ignore les politiques (sauf FORCE). La chaîne
   utilisée ici est celle de `jokswed_app` : ni propriétaire, ni
   superutilisateur, ni BYPASSRLS. Un banc le vérifie à chaque exécution.
   ============================================================================= */

/* ⚠️ LES COLONNES `date` RESTENT DES CHAÎNES « AAAA-MM-JJ ».

   Par défaut, `pg` transforme une colonne `date` en objet `Date` à minuit
   HEURE LOCALE. Reformatée ensuite en UTC, la date recule d'un jour en heure
   d'été : un mariage du 24 juillet s'affichait « 23 juillet ». Observé à
   l'écran sur le tableau de bord.

   Une date de mariage n'a pas d'heure ni de fuseau — c'est un jour sur un
   calendrier. On la laisse donc telle que PostgreSQL l'écrit, et on la
   formate à partir de ses composantes. Le même raisonnement vaudra pour les
   échéances et les dates de document.

   OID 1082 = `date`. Les `timestamptz` (OID 1184), eux, gardent leur
   conversion : ce sont de vrais instants. */
pg.types.setTypeParser(1082, (valeur: string) => valeur);

let pool: Pool | null = null;
let poolAuth: Pool | null = null;

function construire(url: string, max: number): Pool {
  return new Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

function obtenirPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL_APP;
  if (!url) {
    throw new Error(
      "DATABASE_URL_APP absente. Cette variable doit porter le rôle jokswed_app, " +
        "PAS le rôle propriétaire : ce dernier contournerait les politiques RLS.",
    );
  }
  pool = construire(url, 8);
  return pool;
}

/**
 * Connexion RÉSERVÉE au chemin d'authentification.
 *
 * ⚠️ POURQUOI UN SECOND RÔLE, ET PAS LE RÔLE MÉTIER.
 *
 * `app.auth_creer_session(utilisateur_id, …)` ouvre une session pour
 * N'IMPORTE QUEL identifiant. Tant qu'elle était accordée à `jokswed_app`,
 * la moindre exécution SQL arbitraire sous ce rôle — une injection dans une
 * requête métier — permettait de se forger une session de propriétaire et de
 * faire tomber tout le cloisonnement d'un coup.
 *
 * `jokswed_auth` ne possède AUCUN privilège de table : il ne peut
 * qu'appeler les sept fonctions d'authentification. Une faille dans une
 * requête métier ne l'atteint pas, puisqu'elle s'exécute sur l'autre pool.
 */
function obtenirPoolAuth(): Pool {
  if (poolAuth) return poolAuth;
  const url = process.env.DATABASE_URL_AUTH;
  if (!url) {
    throw new Error(
      "DATABASE_URL_AUTH absente. Elle doit porter le rôle jokswed_auth, distinct " +
        "de jokswed_app : c'est ce qui empêche une injection métier de forger une session.",
    );
  }
  poolAuth = construire(url, 4);
  return poolAuth;
}

export interface Acteur {
  utilisateurId: string;
  /**
   * ⚠️ C'EST CE CHAMP QUI PORTE L'IDENTITÉ, PAS `utilisateurId`.
   *
   * L'empreinte du jeton de session — la même que celle du cookie. La base la
   * résout elle-même en utilisateur : elle ne croit pas sur parole un
   * identifiant qu'on lui tend. `utilisateurId` ne sert plus qu'au code
   * applicatif, pour éviter une relecture.
   */
  jetonHache: string;
  sessionId?: string;
}

export interface Requete {
  (texte: string, valeurs?: unknown[]): Promise<{ rows: Record<string, any>[]; rowCount: number }>;
}

function enveloppe(client: PoolClient): Requete {
  return async (texte, valeurs = []) => {
    const r = await client.query(texte, valeurs as any[]);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
}

/**
 * Exécute un travail dans une transaction portant l'identité de l'acteur.
 *
 * ⚠️ ON POSE UNE EMPREINTE DE SESSION, PLUS UN IDENTIFIANT D'UTILISATEUR.
 *
 * Les paramètres personnalisés PostgreSQL (`app.*`) sont réglables par TOUT
 * rôle : `GRANT SET ON PARAMETER` ne couvre que les paramètres système. Tant
 * qu'on y posait un `utilisateur_id`, n'importe quelle exécution SQL sous le
 * rôle applicatif pouvait se déclarer propriétaire — vérifié, puis corrigé au
 * palier 013.
 *
 * Désormais le réglage porte l'empreinte du jeton de session, et `app.acteur()`
 * la RÉSOUT en base. Déclarer une valeur arbitraire ne donne rien : il
 * faudrait posséder le cookie d'une personne réellement connectée.
 *
 * ⚠️ `set_config(..., true)` — LE TROISIÈME ARGUMENT RESTE CRITIQUE.
 *
 * `true` = local à la TRANSACTION : au COMMIT ou au ROLLBACK, le réglage
 * disparaît. Avec `false`, il survivrait sur la connexion rendue au pool, et
 * la requête d'un autre visiteur hériterait de l'identité du précédent.
 */
export async function avecActeur<T>(
  acteur: Acteur,
  travail: (q: Requete) => Promise<T>,
): Promise<T> {
  const client = await obtenirPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.session_jeton', $1, true)", [acteur.jetonHache]);
    const resultat = await travail(enveloppe(client));
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    /* Sans ce ROLLBACK, une connexion rendue au pool en état d'échec
       propagerait son erreur à la requête suivante. */
    try {
      await client.query("ROLLBACK");
    } catch {
      /* la connexion est peut-être déjà perdue : rien de plus à faire */
    }
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Transaction du chemin d'authentification, sur le rôle `jokswed_auth`.
 *
 * ⚠️ CE N'EST PAS UNE PORTE DÉROBÉE.
 *
 * Avant d'être authentifié, il n'y a pas d'acteur — on doit pourtant lire
 * `utilisateurs` et `identifiants` pour vérifier un mot de passe. Les
 * politiques restent actives : sans `app.acteur_id`, `app.acteur()` rend NULL,
 * `entreprises_de_lacteur()` rend un tableau vide, et toute comparaison est
 * fausse. Le comportement par défaut est donc le REFUS TOTAL, pas l'accès
 * total — c'est précisément ce qu'un banc vérifie.
 *
 * Les quelques lectures nécessaires à la connexion passent par des fonctions
 * dédiées en `SECURITY DEFINER` (voir lib/auth/connexion.ts), au périmètre
 * strictement limité à la vérification d'identité.
 */
export async function avecAuth<T>(travail: (q: Requete) => Promise<T>): Promise<T> {
  const client = await obtenirPoolAuth().connect();
  try {
    await client.query("BEGIN");
    const resultat = await travail(enveloppe(client));
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignoré */
    }
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Transaction SANS identité, pour les traitements internes.
 *
 * ⚠️ CE N'EST PAS UNE PORTE DÉROBÉE.
 *
 * Aucune politique n'est levée : `app.acteur()` rend NULL, donc toute
 * comparaison est fausse et le défaut reste le REFUS TOTAL. Les seules
 * écritures possibles passent par des fonctions `SECURITY DEFINER` au
 * périmètre fixe — dépôt d'une demande, drain de la file — qui n'ont pas
 * besoin de savoir qui parle parce qu'elles ne font qu'une chose.
 */
export async function sansIdentite<T>(travail: (q: Requete) => Promise<T>): Promise<T> {
  const client = await obtenirPool().connect();
  try {
    await client.query("BEGIN");
    const resultat = await travail(enveloppe(client));
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    try { await client.query("ROLLBACK"); } catch { /* connexion perdue */ }
    throw erreur;
  } finally {
    client.release();
  }
}

export async function fermerPool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
  if (poolAuth) { await poolAuth.end(); poolAuth = null; }
}
