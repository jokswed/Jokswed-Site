/* =============================================================================
   REMETTRE LA BASE DE DÉVELOPPEMENT À NEUF
   -----------------------------------------------------------------------------
   `schema_migrations` est une liste de noms de FICHIERS appliqués : corriger
   un palier avant tout déploiement — donc avant qu'il existe ailleurs — laisse
   la base locale avec l'ancienne version et la nouvelle jamais appliquée.
   Les bancs ne sont pas concernés (chacun repart d'une base vierge) ; la base
   de développement, elle, doit être refaite.

   ⚠️ ELLE DÉTRUIT LA BASE LOCALE. Elle ne touche à rien d'autre : l'URL est
   celle du PostgreSQL embarqué, pas celle d'une variable d'environnement.
   ============================================================================= */
import { demarrer, urlMigrateur, BASE } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const dev = await demarrer();
try {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: urlMigrateur("postgres") });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`, [BASE]);
    await admin.query(`DROP DATABASE IF EXISTS ${BASE}`);
    await admin.query(`CREATE DATABASE ${BASE}`);
  } finally { await admin.end(); }

  await migrer(urlMigrateur(BASE));
  await semer(urlMigrateur(BASE));
  console.log(`\nBase « ${BASE} » refaite, migrée et semée.`);
} finally {
  await dev.stop();
}
