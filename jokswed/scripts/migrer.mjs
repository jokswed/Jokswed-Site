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

/* =============================================================================
   ⚠️ `FORCE ROW LEVEL SECURITY` S'APPLIQUE AUSSI AU PROPRIÉTAIRE.
   -----------------------------------------------------------------------------
   En développement, le migrateur est SUPERUTILISATEUR : il contourne toute
   RLS, et les migrations qui lisent ou écrivent des données passent sans
   obstacle. Sur un PostgreSQL géré — Neon — aucun rôle client n'est
   superutilisateur. Les politiques s'appliquent alors au migrateur pendant
   la migration elle-même : une simple ligne de données à poser se heurte à
   une politique qui attend une session d'utilisateur, laquelle n'existe pas
   au moment d'une migration.

   On lève donc FORCE le temps de la migration, et on le remet ensuite —
   toujours, y compris en cas d'échec. `row_security = off` ne convient pas :
   il FAIT ÉCHOUER la requête au lieu de l'exempter.

   Ce n'est pas un affaiblissement : pendant une migration, il n'y a aucune
   session d'utilisateur à cloisonner, et le rôle applicatif n'est pas
   connecté. L'état final est identique — un contrôle le vérifie.
   ============================================================================= */
async function tablesForcees(client) {
  const { rows } = await client.query(`
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity`);
  return rows.map((r) => r.relname);
}

async function basculerForce(client, tables, actif) {
  for (const t of tables) {
    await client.query(
      `ALTER TABLE public.${JSON.stringify(t).replace(/"/g, '"')} `
      + `${actif ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`);
  }
}

export async function migrer(connexion, { silencieux = false } = {}) {
  const client = new pg.Client({
    connectionString: connexion,
    ssl: /\bneon\.tech\b/.test(connexion) ? { rejectUnauthorized: true } : undefined,
  });
  await client.connect();
  let forcees = [];
  try {
    const { rows: su } = await client.query(
      "SELECT coalesce(usesuper, false) s FROM pg_user WHERE usename = current_user");
    const superutilisateur = su[0]?.s === true;
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
      /* ⚠️ ON RECALCULE AVANT CHAQUE PALIER, PAS UNE FOIS AU DÉBUT.
         Sur une base neuve, il n'existe aucune table forcée au premier
         palier : lever FORCE une seule fois n'aurait donc rien levé du
         tout, et le palier qui pose une donnée de référence se serait
         heurté à sa propre politique. */
      if (!superutilisateur) {
        const aLever = await tablesForcees(client);
        if (aLever.length > 0) {
          await basculerForce(client, aLever, false);
          forcees = [...new Set([...forcees, ...aLever])];
        }
      }
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
    /* ⚠️ ON NE REMET PLUS `FORCE` — VOIR LE PALIER 056.
       `FORCE` ne contraint que le PROPRIÉTAIRE des tables, c'est-à-dire ce
       migrateur, et personne d'autre. Or c'est lui qui possède les fonctions
       `SECURITY DEFINER` sur lesquelles repose tout l'accès contrôlé : les
       soumettre aux politiques de leur appelant les fait échouer, ou renvoyer
       un résultat vide. Les rôles applicatifs, eux, ne possèdent aucune table
       et restent intégralement soumis à la RLS.

       L'ancienne logique reforçait ici une liste de tables, avec une liste
       d'exclusion qui n'a cessé de grandir à chaque fonction `SECURITY
       DEFINER` ajoutée. Le palier 056 tranche à la racine ; ce bloc n'a plus
       rien à restaurer. La levée ci-dessus reste nécessaire : les paliers 006
       à 055 posent `FORCE` au fil de l'eau, et 056 ne le retire qu'à la fin. */
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
