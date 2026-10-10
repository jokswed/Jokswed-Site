/* =============================================================================
   POSTGRESQL DE DÉVELOPPEMENT — ISOLÉ, LOCAL, JETABLE
   -----------------------------------------------------------------------------
   ⚠️ CE SERVEUR N'EST PAS NEON, ET IL N'EST PAS LA PRODUCTION.

   Il tourne sur le port 54329, dans .pgdev/, et ne contient que des fixtures.
   Aucune base distante n'est jointe, aucun compte réel n'est créé.

   Pourquoi un vrai serveur plutôt qu'un Postgres en mémoire : les politiques
   RLS s'évaluent contre `current_user`. Les éprouver sérieusement suppose de
   se CONNECTER avec le rôle applicatif — pas de simuler un changement de rôle
   depuis une session superutilisateur, qui ne prouverait pas la même chose.
   ============================================================================= */
import EmbeddedPostgres from "embedded-postgres";
import { mkdir } from "node:fs/promises";

export const PORT = 54329;
export const BASE = "jokswed_dev";
export const SUPER = "jokswed_migrateur";
export const MOT_DE_PASSE_SUPER = "dev_migrateur";

export async function demarrer({ silencieux = true } = {}) {
  await mkdir(new URL("../.pgdev", import.meta.url).pathname, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: new URL("../.pgdev/data", import.meta.url).pathname,
    user: SUPER,
    password: MOT_DE_PASSE_SUPER,
    port: PORT,
    persistent: true,
    onLog: silencieux ? () => {} : console.log,
    onError: silencieux ? () => {} : console.error,
  });

  try {
    await pg.initialise();
  } catch {
    /* Déjà initialisé : c'est le cas normal au deuxième lancement. */
  }
  await pg.start();
  try {
    await pg.createDatabase(BASE);
  } catch {
    /* Déjà créée. */
  }
  return pg;
}

export function urlMigrateur(base = BASE) {
  return `postgres://${SUPER}:${MOT_DE_PASSE_SUPER}@127.0.0.1:${PORT}/${base}`;
}

/**
 * Recrée une base VIERGE et rend son URL.
 *
 * ⚠️ UN BANC DE SÉCURITÉ QUI HÉRITE DE L'ÉTAT PRÉCÉDENT NE PROUVE RIEN.
 *
 * Constaté sur ce projet : trois épreuves ont échoué non parce qu'une
 * politique cédait, mais parce qu'un passage antérieur avait laissé un
 * partage retiré, une permission déjà posée et un membre déjà révoqué. Les
 * verdicts dépendaient alors de l'ordre et de l'historique — autrement dit,
 * ils ne voulaient rien dire.
 *
 * Chaque exécution repart donc d'une base neuve.
 */
export async function baseVierge(nom = "jokswed_banc") {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: urlMigrateur("postgres") });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`, [nom]);
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
  } finally {
    await admin.end();
  }
  return nom;
}

export function urlApplication(base = BASE, motDePasse = "dev_app") {
  return `postgres://jokswed_app:${motDePasse}@127.0.0.1:${PORT}/${base}`;
}

export function urlAuth(base = BASE, motDePasse = "dev_auth") {
  return `postgres://jokswed_auth:${motDePasse}@127.0.0.1:${PORT}/${base}`;
}

export function urlPublic(base = BASE, motDePasse = "dev_public") {
  return `postgres://jokswed_public:${motDePasse}@127.0.0.1:${PORT}/${base}`;
}
