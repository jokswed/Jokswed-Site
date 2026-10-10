/* =============================================================================
   PRÉPARATION DE NEON PRODUCTION, EN UNE SEULE COMMANDE
   -----------------------------------------------------------------------------
   Lit la chaîne propriétaire de la branche `production`, crée quatre rôles avec
   des mots de passe forts et DISTINCTS de ceux de Preview, applique les 56
   paliers, puis compose les variables Vercel Production.

   AUCUN SECRET N'EST IMPRIMÉ. Les fichiers sont écrits en droits 600.

   ⚠️ REFUSE DE TOUCHER AUTRE CHOSE QUE LA BRANCHE `production` DE JOKSWED :
      la base doit s'appeler `jokswed`, et être vierge de toute table inconnue.
      Le script s'arrête avant d'écrire si la chaîne fournie est celle de
      Preview, ou si la base contient déjà des données.
   ============================================================================= */
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

const base = process.env.HOME + "/.config/jokswed";
const cheminUrl = `${base}/neon-production-owner.url`;
if (!fs.existsSync(cheminUrl)) {
  console.error(`✗ Fichier absent : ${cheminUrl}`);
  process.exit(2);
}
const owner = fs.readFileSync(cheminUrl, "utf8").trim();
const preview = fs.readFileSync(`${base}/neon-preview-owner.url`, "utf8").trim();

const hote = (u) => u.replace(/^postgres(ql)?:\/\/[^@]*@/, "").split("/")[0];
if (hote(owner) === hote(preview)) {
  console.error("✗ La chaîne fournie désigne le même point d'accès que Preview.");
  console.error("  Dans Neon, choisis la branche `production`, puis Connection string.");
  process.exit(2);
}
console.log(`Point d'accès production : …${hote(owner).slice(-28)}`);

/* ── 1. Contrôle en lecture seule avant toute écriture ───────────────────── */
const c = new pg.Client({ connectionString: owner, ssl: { rejectUnauthorized: true } });
c.on("error", () => {});
await c.connect();
const { rows: [b] } = await c.query("SELECT current_database() d, current_user u");
if (b.d !== "jokswed") {
  console.error(`✗ Base « ${b.d} » au lieu de « jokswed ». Arrêt.`);
  process.exit(2);
}
const { rows: [t] } = await c.query(
  "SELECT count(*)::int n FROM pg_class k JOIN pg_namespace ns ON ns.oid=k.relnamespace WHERE ns.nspname='public' AND k.relkind='r'");
console.log(`Base « ${b.d} » — ${t.n} table(s) existante(s)`);
if (t.n > 0) {
  const { rows: [d] } = await c.query(
    "SELECT count(*)::int n FROM pg_class k JOIN pg_namespace ns ON ns.oid=k.relnamespace WHERE ns.nspname='public' AND k.relname='utilisateurs'");
  if (d.n > 0) {
    const { rows: [q] } = await c.query("SELECT count(*)::int n FROM utilisateurs");
    if (q.n > 0) {
      console.error(`✗ La base contient déjà ${q.n} utilisateur(s). Je n'écrase rien. Arrêt.`);
      process.exit(2);
    }
  }
}
await c.end();

/* ── 2. Mots de passe forts, distincts de Preview ────────────────────────── */
const cheminRoles = `${base}/neon-production-roles.env`;
let roles;
if (fs.existsSync(cheminRoles)) {
  roles = fs.readFileSync(cheminRoles, "utf8");
  console.log("Mots de passe de production : déjà présents, réutilisés");
} else {
  const fort = () => crypto.randomBytes(24).toString("base64url");
  roles = ["MDP_MIGRATEUR", "MDP_APP", "MDP_AUTH", "MDP_PUBLIC"]
    .map((k) => `${k}=${fort()}`).join("\n") + "\n";
  fs.writeFileSync(cheminRoles, roles, { mode: 0o600 });
  fs.chmodSync(cheminRoles, 0o600);
  console.log("Mots de passe de production : 4 générés (32 caractères, aléatoire fort)");
}
const mdp = (k) => roles.match(new RegExp(k + "=(.+)"))[1].trim();

/* Les mots de passe de production ne doivent RIEN partager avec Preview. */
const rolesPreview = fs.readFileSync(`${base}/neon-preview-roles.env`, "utf8");
for (const k of ["MDP_MIGRATEUR", "MDP_APP", "MDP_AUTH", "MDP_PUBLIC"]) {
  if (mdp(k) === rolesPreview.match(new RegExp(k + "=(.+)"))?.[1]?.trim()) {
    console.error(`✗ ${k} est identique à celui de Preview. Arrêt.`);
    process.exit(2);
  }
}

/* ⚠️ SI NEON REFUSE `CREATE ROLE` au propriétaire de la base — c'est arrivé
   sur Preview — les quatre rôles se créent à la main dans l'éditeur SQL de la
   console Neon. On dépose donc le script prêt à coller, en droits 600, pour
   n'avoir jamais à faire transiter un mot de passe par une réponse. */
const cheminSql = `${base}/neon-production-roles.sql`;
fs.writeFileSync(cheminSql,
  ["jokswed_migrateur", "jokswed_app", "jokswed_auth", "jokswed_public"]
    .map((r) => {
      const k = "MDP_" + r.replace("jokswed_", "").toUpperCase().replace("MIGRATEUR", "MIGRATEUR");
      return `CREATE ROLE ${r} LOGIN PASSWORD '${mdp(k)}';`;
    }).join("\n") + "\nGRANT CREATE, CONNECT ON DATABASE jokswed TO jokswed_migrateur;\n",
  { mode: 0o600 });
fs.chmodSync(cheminSql, 0o600);
console.log(`Script de repli écrit : ${cheminSql} (à coller dans Neon si CREATE ROLE est refusé)`);

/* ── 3. La procédure existante, inchangée ────────────────────────────────── */
process.env.DATABASE_URL_MIGRATEUR = owner;
for (const k of ["MDP_MIGRATEUR", "MDP_APP", "MDP_AUTH", "MDP_PUBLIC"]) process.env[k] = mdp(k);
console.log("\n→ npm run neon:preparer sur la branche production\n");
await import("./neon-preparer.mjs");
