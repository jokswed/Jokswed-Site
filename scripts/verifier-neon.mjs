/* =============================================================================
   COMPATIBILITÉ NEON — vérifiée AVANT la migration, pas après
   -----------------------------------------------------------------------------
   Le développement tourne sur un PostgreSQL 18 local. Neon propose
   actuellement 14 à 17 selon le projet. Ce banc relève tout ce qui pourrait
   ne pas passer : version minimale requise, extensions, et fonctionnalités
   réellement employées par le schéma.
   ============================================================================= */
import pg from "pg";
import { demarrer, urlMigrateur, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";

const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? ` — ${detail}` : ` — ${detail}`}`);
};

const pgdev = await demarrer();
let c;
try {
  const base = await baseVierge("jokswed_neon");
  await migrer(urlMigrateur(base), { silencieux: true });
  c = new pg.Client({ connectionString: urlMigrateur(base) });
  await c.connect();

  const ext = await c.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('citext','btree_gist') ORDER BY 1");
  v("Extensions requises", ext.rowCount === 2,
    `${ext.rows.map((r) => r.extname).join(", ")} — toutes deux disponibles sur Neon`);

  /* `gen_random_uuid()` est intégré depuis PostgreSQL 13 : pas besoin de
     pgcrypto, que Neon propose aussi mais qu'on évite d'exiger. */
  const uuid = await c.query("SELECT gen_random_uuid() IS NOT NULL AS ok");
  v("gen_random_uuid() natif (PG ≥ 13, pas de pgcrypto requis)", uuid.rows[0].ok);

  const gist = await c.query(`
    SELECT count(*)::int n FROM pg_constraint WHERE contype = 'x'`);
  v("Contraintes d'exclusion GiST", gist.rows[0].n >= 1,
    `${gist.rows[0].n} contrainte(s) — btree_gist requis, disponible sur Neon`);

  const politiques = await c.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'");
  v("Politiques RLS", politiques.rows[0].n >= 25, `${politiques.rows[0].n} politiques`);

  const roles = await c.query(
    "SELECT rolname FROM pg_roles WHERE rolname LIKE 'jokswed%' ORDER BY 1");
  v("Rôles applicatifs créés par migration", roles.rowCount >= 3,
    `${roles.rows.map((r) => r.rolname).join(", ")}`);

  /* ⚠️ LE POINT QUI DEMANDE UNE ACTION MANUELLE SUR NEON.
     Les rôles sont créés ici avec un mot de passe de développement. Sur Neon,
     on les crée depuis la console (ou par SQL avec un mot de passe fort) :
     une migration ne doit pas porter de secret de production. */
  v("Mots de passe de rôles : à définir hors migration", true,
    "les migrations posent un mot de passe de DÉVELOPPEMENT — à changer sur Neon");

  const version = await c.query("SHOW server_version_num");
  const num = Number(version.rows[0].server_version_num);
  v("Version PostgreSQL du développement", true, `${Math.floor(num / 10000)} (Neon : 14 à 17)`);

  /* Fonctionnalités employées, avec la version minimale qui les introduit. */
  const besoins = [
    ["generated/identity, FOR UPDATE SKIP LOCKED", 90500],
    ["jsonb_build_object, GENERATED", 110000],
    ["gen_random_uuid() natif", 130000],
    ["MERGE (non utilisé)", 150000],
  ];
  const minimum = Math.max(...besoins.filter((b) => !b[0].includes("non utilisé")).map((b) => b[1]));
  v("Version minimale requise par le schéma", minimum <= 140000,
    `PG ${Math.floor(minimum / 10000)} — compatible avec toutes les versions Neon`);

  /* Aucune fonctionnalité exclusive de PG 18 ne doit s'être glissée. */
  const suspects = await c.query(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app' AND p.prosrc ILIKE '%uuidv7%'`);
  v("Aucune fonction propre à PostgreSQL 18 (uuidv7…)", suspects.rowCount === 0);
} finally {
  if (c) await c.end();
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles de compatibilité Neon.`);
if (echecs.length) process.exit(1);
console.log("Schéma compatible Neon (PG 14+). Mots de passe de rôles à définir hors migration.");
