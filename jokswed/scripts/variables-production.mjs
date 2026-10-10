/* Compose les variables Vercel PRODUCTION. Rien de secret n'est imprimé. */
import fs from "node:fs";
import crypto from "node:crypto";
const base = process.env.HOME + "/.config/jokswed";
const owner = fs.readFileSync(`${base}/neon-production-owner.url`, "utf8").trim();
const roles = fs.readFileSync(`${base}/neon-production-roles.env`, "utf8");
const mdp = (k) => roles.match(new RegExp(k + "=(.+)"))[1].trim();
const avec = (r, k) => owner.replace(/^postgres(ql)?:\/\/[^:]+:[^@]+@/,
  `postgresql://${r}:${encodeURIComponent(mdp(k))}@`);
/* Vercel est serverless : une connexion par requête. Le pooler Neon est
   indispensable en production, sans quoi la branche épuise ses connexions. */
const pooler = (u) => u.replace(/@([^.]+)\./, "@$1-pooler.");
const v = {
  DATABASE_URL_APP: pooler(avec("jokswed_app", "MDP_APP")),
  DATABASE_URL_AUTH: pooler(avec("jokswed_auth", "MDP_AUTH")),
  JOKSWED_CHIFFREMENT_CLE: crypto.randomBytes(32).toString("base64"),
  JOKSWED_WEBHOOK_ENTRANT: crypto.randomBytes(24).toString("base64url"),
  CRON_SECRET: crypto.randomBytes(24).toString("base64url"),
  SITE_URL: "https://jokswed.com",
  NEXT_PUBLIC_SITE_URL: "https://jokswed.com",
  JOKSWED_EMAIL_EXPEDITEUR: "contact@jokswed.com",
  JOKSWED_EMAIL_NOM: "JoksWed",
  JOKSWED_EMAIL_REPONSE: "jokswed@gmail.com",
  JOKSWED_DOMAINE_REPONSE: "reply.jokswed.com",
  /* ⚠️ ON DÉPLOIE D'ABORD MUET. Tant que cette variable vaut 1, aucun e-mail
     ne part, même avec une clé Brevo valide. On la retire APRÈS avoir vérifié
     le parcours en production — et avant d'inviter Yvann. */
  EMAIL_DRY_RUN: "1",
};
const chemin = `${base}/vercel-production.env`;
fs.writeFileSync(chemin, Object.entries(v).map(([k, x]) => `${k}=${x}`).join("\n") + "\n", { mode: 0o600 });
fs.chmodSync(chemin, 0o600);
const secret = new Set(["DATABASE_URL_APP","DATABASE_URL_AUTH","JOKSWED_CHIFFREMENT_CLE","JOKSWED_WEBHOOK_ENTRANT","CRON_SECRET"]);
console.log(`${chemin} — ${Object.keys(v).length} variables, droits 600 :`);
for (const [k, x] of Object.entries(v)) console.log(`  ${k.padEnd(26)} ${secret.has(k) ? "« masquée »" : x}`);
console.log("\nÀ ajouter par John : BREVO_API_KEY");
