/* =============================================================================
   MIGRATIONS — appliquées dans l'ordre, une fois, et tracées.
   -----------------------------------------------------------------------------
   Exécuté par le rôle PROPRIÉTAIRE (jokswed_migrateur), jamais par le rôle
   applicatif : seul le propriétaire peut créer des objets et des politiques.
   ============================================================================= */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const DOSSIER = new URL("../lib/db/migrations", import.meta.url).pathname;

export async function migrer(connexion, { silencieux = false } = {}) {
  const client = new pg.Client({ connectionString: connexion });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nom text PRIMARY KEY,
        appliquee_le timestamptz NOT NULL DEFAULT now()
      )`);

    const fichiers = (await readdir(DOSSIER)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query("SELECT nom FROM schema_migrations");
    const deja = new Set(rows.map((r) => r.nom));

    let appliquees = 0;
    for (const fichier of fichiers) {
      if (deja.has(fichier)) continue;
      const sql = await readFile(join(DOSSIER, fichier), "utf8");
      /* Chaque migration est une TRANSACTION : elle passe en entier, ou pas du
         tout. Une migration à moitié appliquée est pire qu'une migration
         échouée — on ne sait plus dans quel état est la base. */
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (nom) VALUES ($1)", [fichier]);
        await client.query("COMMIT");
        if (!silencieux) console.log(`  ✓ ${fichier}`);
        appliquees += 1;
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`${fichier} : ${e.message}`);
      }
    }
    return { appliquees, total: fichiers.length };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { demarrer, urlMigrateur } = await import("./pg-dev.mjs");
  const pgdev = await demarrer();
  try {
    const r = await migrer(process.env.DATABASE_URL_MIGRATEUR ?? urlMigrateur());
    console.log(`${r.appliquees} migration(s) appliquée(s) sur ${r.total}.`);
  } finally {
    await pgdev.stop();
  }
}
