import pg from "pg";
import { demarrer, urlMigrateur, urlApplication, baseVierge } from "../scripts/pg-dev.mjs";
import { migrer } from "../scripts/migrer.mjs";
import { semer } from "../scripts/semer.mjs";
const pgdev = await demarrer();
try {
  const base = await baseVierge("jokswed_dbg");
  await migrer(urlMigrateur(base), { silencieux: true });
  const f = await semer(urlMigrateur(base), { silencieux: true });
  const v = new pg.Client(urlMigrateur(base)); v.on("error", () => {}); await v.connect();
  const a = new pg.Client(urlApplication(base)); a.on("error", () => {}); await a.connect();
  await v.query(`INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
                 VALUES ($1,'dbg', now() + interval '1 day', true)`, [f.utilisateurs.assistant]);
  await a.query("BEGIN");
  await a.query("SELECT set_config('app.session_jeton','dbg',true)");
  console.log("acteur:", (await a.query("SELECT app.acteur() AS x")).rows[0]);
  console.log("entreprises:", (await a.query("SELECT app.entreprises_de_lacteur() AS x")).rows[0]);
  console.log("perms:", (await a.query("SELECT * FROM app.permissions_effectives($1)", [f.entreprises.jokswed])).rows.map(r=>r.permission_cle));
  console.log("porte:", (await a.query("SELECT app.acteur_porte($1, ARRAY['dossier.lire','dossier.ecrire']) AS x", [f.entreprises.jokswed])).rows[0]);
  console.log("dossiers:", (await a.query("SELECT count(*)::int n FROM dossiers")).rows[0]);
  await a.query("COMMIT");
  await v.end(); await a.end();
} finally { await pgdev.stop(); }
