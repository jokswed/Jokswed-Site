import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

let verts = 0;
let rouges = 0;
const lire = (p) => readFileSync(p, "utf8");
const test = (nom, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${nom}`);
  ok ? verts++ : rouges++;
};

const form = lire("components/FormulaireContact.jsx");
const route = lire("app/api/contact/route.js");
const drain = lire("lib/demandes/drain.ts");
const mail = lire("lib/email/gabarits.ts");
const admin = lire("app/admin/page.jsx");
const msg = lire("app/admin/messagerie/[id]/page.jsx");
const demandeAdmin = lire("app/admin/demandes/[id]/page.jsx");
const messagerie = lire("app/admin/messagerie/page.jsx");
const migrations = (await readdir("lib/db/migrations"))
  .filter((x) => x.endsWith("_workflow_demande_suivi_push.sql"));
const migration = migrations.length ? lire(`lib/db/migrations/${migrations[0]}`) : "";

test("succès plein écran", form.includes('position: "fixed"') && form.includes("100dvh"));
test("référence obligatoire avant succès", form.includes("if (!resultat.reference)"));
test("lien de suivi renvoyé au client", route.includes("suiviUrl"));
test("drain hors temps de réponse avec after()", route.includes("after(async () =>"));
test("route de suivi client présente", existsSync("app/(site)/suivi/[id]/page.jsx"));
test("jeton de suivi HMAC", lire("lib/suivi/demande.ts").includes("createHmac"));
test("vue SQL publique minimale", migration.includes("demande_suivi_public"));
test("table d'abonnements Push", migration.includes("CREATE TABLE push_abonnements"));
test("Push Web réel", lire("lib/push/envoyer.js").includes("sendNotification"));
test("service worker Push", lire("public/jokswed-sw.js").includes('addEventListener("push"'));
test("activation Push côté admin", admin.includes("<PushAdmin"));
test("accusé e-mail avec bouton suivi", mail.includes("Suivre ma demande"));
test("drain envoie le lien de suivi", drain.includes("lienSuivi: lienSuiviDemande"));
test("réponse admin déclenche le drain immédiatement", msg.includes("after(async () =>") && msg.includes("await drainer()"));
test("bouton répondre depuis la demande", demandeAdmin.includes("Répondre au client"));
test("messagerie préremplit la demande", messagerie.includes("demandeInitiale") && messagerie.includes("demandePreferee"));

console.log(`\n${verts} vert(s) · ${rouges} rouge(s)`);
process.exit(rouges ? 1 : 0);
