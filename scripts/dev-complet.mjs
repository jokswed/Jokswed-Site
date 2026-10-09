/* Environnement de développement complet : PostgreSQL isolé + migrations +
   fixtures + Next en mode dev (cookie sans préfixe __Host-, donc utilisable
   en HTTP local). Ctrl-C arrête les deux. */
import { spawn } from "node:child_process";
import { demarrer, urlMigrateur, urlApplication, urlAuth, BASE } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const PORT = Number(process.env.PORT ?? 3144);
const pgdev = await demarrer();
await migrer(urlMigrateur(), { silencieux: true });
const f = await semer(urlMigrateur(), { silencieux: true });

console.log(`PostgreSQL de dev prêt. Comptes (fixtures, domaine .invalid) :`);
console.log(`  proprietaire@exemple.invalid · videaste@exemple.invalid · assistant@exemple.invalid`);
console.log(`  mot de passe : ${f.motDePasse}`);
console.log(`Next : http://127.0.0.1:${PORT}/admin`);

const next = spawn("npx", ["next", "dev", "--port", String(PORT)], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    DATABASE_URL_APP: urlApplication(BASE),
    DATABASE_URL_AUTH: urlAuth(BASE),
    JOKSWED_CHIFFREMENT_CLE: Buffer.alloc(32, 7).toString("base64"),
    SITE_URL: `http://127.0.0.1:${PORT}`,
  },
  stdio: "inherit",
});

const arreter = async () => { next.kill("SIGTERM"); await pgdev.stop(); process.exit(0); };
process.on("SIGINT", arreter);
process.on("SIGTERM", arreter);
