/* =============================================================================
   PRÉPARER UNE BASE NEON POUR JOKSWED
   -----------------------------------------------------------------------------
   Crée les trois rôles, applique les migrations, puis VÉRIFIE que rien n'a
   été accordé en trop. À jouer une fois par environnement (Preview, puis
   production), avec des mots de passe DIFFÉRENTS.

   Usage :
     DATABASE_URL_MIGRATEUR=<chaîne du propriétaire Neon> \
     MDP_MIGRATEUR=… MDP_APP=… MDP_AUTH=… \
     npm run neon:preparer

   ⚠️ AUCUN MOT DE PASSE N'EST AFFICHÉ NI JOURNALISÉ.
   Le script les lit dans l'environnement et n'en ressort jamais la valeur.
   Il refuse ceux du développement : s'en servir en production reviendrait à
   publier la base.

   ⚠️ IL NE CRÉE AUCUNE BASE ET NE DÉPENSE RIEN.
   Le projet et la base Neon se créent dans leur interface. Le script se
   connecte à une base existante et s'arrête là.
   ============================================================================= */
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MDP_INTERDITS = [
  "mot-de-passe-de-developpement", "dev", "developpement", "jokswed",
  "postgres", "changeme", "motdepasse",
];

const url = process.env.DATABASE_URL_MIGRATEUR;
if (!url) {
  console.error("DATABASE_URL_MIGRATEUR manquante (chaîne du propriétaire Neon).");
  process.exit(1);
}

const roles = {
  jokswed_migrateur: process.env.MDP_MIGRATEUR,
  jokswed_app: process.env.MDP_APP,
  jokswed_auth: process.env.MDP_AUTH,
};

for (const [role, mdp] of Object.entries(roles)) {
  if (!mdp || mdp.length < 24) {
    console.error(`Mot de passe de ${role} absent ou trop court (24 caractères minimum).`);
    console.error("  openssl rand -base64 32");
    process.exit(1);
  }
  if (MDP_INTERDITS.some((x) => mdp.toLowerCase().includes(x))) {
    console.error(`Mot de passe de ${role} refusé : il ressemble à un mot de passe de développement.`);
    process.exit(1);
  }
}
if (new Set(Object.values(roles)).size !== 3) {
  console.error("Les trois rôles doivent avoir des mots de passe DIFFÉRENTS.");
  process.exit(1);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
c.on("error", () => {});
await c.connect();

try {
  const { rows: [v] } = await c.query("SELECT current_database() d, version() v");
  console.log(`Base : ${v.d}`);
  console.log(`Serveur : ${v.v.split(",")[0]}`);

  /* ⚠️ UN GARDE-FOU CONTRE LA PIRE DES ERREURS.
     Se tromper de chaîne et préparer la base d'EyesofJoks y créerait des
     rôles et y jouerait 47 migrations. On refuse toute base qui porte déjà
     des tables qu'on ne connaît pas. */
  const { rows: tables } = await c.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const connues = new Set(["schema_migrations", "permissions", "taux_tva"]);
  const etrangeres = tables.map((t) => t.tablename)
    .filter((t) => !connues.has(t));
  const { rows: [dejaNous] } = await c.query(
    `SELECT count(*)::int n FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'schema_migrations'`);
  if (etrangeres.length > 0 && dejaNous.n === 0) {
    console.error("\n⚠️  REFUS : cette base contient déjà des tables inconnues.");
    console.error("   " + etrangeres.slice(0, 8).join(", "));
    console.error("   Ce n'est pas une base JoksWed neuve. Vérifiez la chaîne.");
    process.exit(1);
  }

  console.log("\nRôles…");
  for (const [role, mdp] of Object.entries(roles)) {
    const { rows } = await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    if (rows.length === 0) {
      await c.query(`CREATE ROLE ${role} LOGIN PASSWORD $1`.replace("$1", "'" + mdp.replace(/'/g, "''") + "'"));
      console.log(`  ✓ ${role} créé`);
    } else {
      await c.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${mdp.replace(/'/g, "''")}'`);
      console.log(`  ✓ ${role} mis à jour`);
    }
    /* Aucun de nos rôles n'a besoin de créer des rôles, d'hériter de
       superutilisateur, ni de contourner la RLS. On le dit explicitement. */
    await c.query(`ALTER ROLE ${role} NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`);
  }

  /* Neon donne la base à `neondb_owner` : nos objets doivent appartenir au
     migrateur, sinon la RLS FORCE ne protège pas ce qu'on croit. */
  await c.query("GRANT jokswed_migrateur TO CURRENT_USER");
  await c.query(`ALTER SCHEMA public OWNER TO jokswed_migrateur`);
  console.log("  ✓ schéma public confié au migrateur");

  console.log("\nMigrations…");
  const { migrer } = await import("./migrer.mjs");
  const dossier = new URL("../lib/db/migrations/", import.meta.url).pathname;
  const fichiers = (await readdir(dossier)).filter((f) => f.endsWith(".sql")).sort();
  const urlMigrateur = url.replace(
    /^postgres(ql)?:\/\/[^:]+:[^@]+@/,
    `postgresql://jokswed_migrateur:${encodeURIComponent(roles.jokswed_migrateur)}@`);
  await migrer(urlMigrateur, { silencieux: false });
  console.log(`  ✓ ${fichiers.length} fichier(s) de migration pris en compte`);

  console.log("\nVérifications…");
  const m = new pg.Client({ connectionString: urlMigrateur, ssl: { rejectUnauthorized: true } });
  m.on("error", () => {});
  await m.connect();
  const controles = [];
  const ctl = (nom, ok, detail = "") => {
    controles.push({ nom, ok });
    console.log(`  ${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
  };

  const { rows: attributs } = await m.query(
    `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole FROM pg_roles
      WHERE rolname LIKE 'jokswed_%' ORDER BY rolname`);
  for (const r of attributs) {
    ctl(`${r.rolname} : ni superutilisateur, ni BYPASSRLS, ni créateur de rôles`,
      !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole);
  }
  const { rows: [prop] } = await m.query(
    `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname='public' AND c.relkind='r'
        AND pg_get_userbyid(c.relowner) <> 'jokswed_migrateur'`);
  ctl("Toutes les tables appartiennent au migrateur", prop.n === 0, `${prop.n} exception(s)`);

  const { rows: [sansRls] } = await m.query(
    `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
        AND c.relname NOT IN ('schema_migrations','permissions','taux_tva','types_notification')`);
  ctl("RLS activé sur toute table métier", sansRls.n === 0, `${sansRls.n} sans RLS`);

  const { rows: [tablesApp] } = await m.query(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE grantee = 'jokswed_auth'`);
  ctl("Le rôle d'authentification n'a AUCUN privilège de table",
    tablesApp.n === 0, `${tablesApp.n} privilège(s)`);

  const { rows: [politiques] } = await m.query("SELECT count(*)::int n FROM pg_policies");
  ctl(`Politiques RLS en place (${politiques.n})`, politiques.n > 40);

  const { rows: [migrations] } = await m.query(
    "SELECT count(*)::int n FROM schema_migrations");
  ctl(`Migrations appliquées (${migrations.n}/${fichiers.length})`,
    migrations.n === fichiers.length);

  await m.end();

  const echecs = controles.filter((x) => !x.ok).length;
  console.log(`\n${controles.length - echecs}/${controles.length} contrôles.`);
  if (echecs > 0) process.exit(1);

  console.log("\nÀ déclarer maintenant dans Vercel, pour CET environnement :");
  console.log("  DATABASE_URL_APP        = postgresql://jokswed_app:<MDP_APP>@<hôte>/<base>?sslmode=require");
  console.log("  DATABASE_URL_AUTH       = postgresql://jokswed_auth:<MDP_AUTH>@<hôte>/<base>?sslmode=require");
  console.log("  (le migrateur ne va PAS dans Vercel : migrations à la main)");
} finally {
  await c.end();
}
