/* LECTURE SEULE sur Neon production — npm run verifier:neon-prod, avec les VRAIS rôles applicatifs.
   Aucune écriture : la production ne doit contenir AUCUNE donnée fictive. */
import fs from "node:fs"; import pg from "pg";
const base = process.env.HOME + "/.config/jokswed";
const owner = fs.readFileSync(`${base}/neon-production-owner.url`, "utf8").trim();
const roles = fs.readFileSync(`${base}/neon-production-roles.env`, "utf8");
const mdp = (k) => roles.match(new RegExp(k + "=(.+)"))[1].trim();
const avec = (r, k) => owner.replace(/^postgres(ql)?:\/\/[^:]+:[^@]+@/,
  `postgresql://${r}:${encodeURIComponent(mdp(k))}@`);
const cl = (u) => { const c = new pg.Client({ connectionString: u, ssl: { rejectUnauthorized: true } }); c.on("error", () => {}); return c; };
const res = []; const v = (n, ok, d = "") => { res.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${ok ? "" : ` — ${d}`}`); };

const app = cl(avec("jokswed_app", "MDP_APP")); await app.connect();
const auth = cl(avec("jokswed_auth", "MDP_AUTH")); await auth.connect();

const { rows: [a] } = await app.query(
  "SELECT usesuper s, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) b FROM pg_user WHERE usename=current_user");
v("Le rôle applicatif n'est ni superutilisateur ni BYPASSRLS", a.s === false && a.b === false);
const { rows: [p] } = await app.query(
  `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relkind='r' AND pg_get_userbyid(c.relowner)=current_user`);
v("…et propriétaire d'aucune table", p.n === 0, `${p.n}`);
const { rows: [d] } = await app.query("SELECT count(*)::int n FROM demandes");
v("Sans session, aucune demande visible", d.n === 0, `${d.n}`);
let bloque = null;
try { await auth.query("SELECT count(*) FROM dossiers"); } catch (e) { bloque = e.code; }
v("Le rôle d'authentification ne lit aucune table métier", bloque === "42501", String(bloque));
const { rows: [am] } = await auth.query("SELECT app.auth_amorcage_possible() x");
v("L'amorçage du propriétaire est possible (base vierge)", am.x === true);

/* AUCUNE DONNÉE FICTIVE : on compte tout ce qui pourrait en être. */
const mig = cl(avec("jokswed_migrateur", "MDP_MIGRATEUR")); await mig.connect();
const { rows: [n] } = await mig.query(`SELECT
  (SELECT count(*) FROM utilisateurs)::int u, (SELECT count(*) FROM entreprises)::int e,
  (SELECT count(*) FROM demandes)::int d, (SELECT count(*) FROM dossiers)::int o,
  (SELECT count(*) FROM documents)::int c, (SELECT count(*) FROM paiements)::int p,
  (SELECT count(*) FROM messages)::int m, (SELECT count(*) FROM journal_audit)::int j,
  (SELECT count(*) FROM permissions)::int perm,
  (SELECT count(*) FROM roles WHERE entreprise_id IS NULL)::int modeles,
  (SELECT count(*) FROM types_notification)::int types, (SELECT count(*) FROM taux_tva)::int tva`);
const fictif = n.u + n.e + n.d + n.o + n.c + n.p + n.m + n.j;
v("⚠️ Aucune donnée en production", fictif === 0,
  `utilisateurs ${n.u}, entreprises ${n.e}, demandes ${n.d}, dossiers ${n.o}, documents ${n.c}, paiements ${n.p}, messages ${n.m}, audit ${n.j}`);
v("Données de référence présentes",
  n.perm === 28 && n.modeles === 7 && n.types === 8 && n.tva === 4,
  `permissions ${n.perm}, rôles modèles ${n.modeles}, types ${n.types}, TVA ${n.tva}`);

/* Les mots de passe de production ne sont pas ceux de Preview. */
const pv = fs.readFileSync(`${base}/neon-preview-roles.env`, "utf8");
const distincts = ["MDP_MIGRATEUR","MDP_APP","MDP_AUTH","MDP_PUBLIC"]
  .every((k) => mdp(k) !== pv.match(new RegExp(k + "=(.+)"))?.[1]?.trim());
v("Mots de passe distincts de ceux de Preview", distincts);

for (const c of [app, auth, mig]) await c.end();
console.log(`\n${res.filter(Boolean).length}/${res.length} contrôles de production (lecture seule).`);
process.exit(res.every(Boolean) ? 0 : 1);
