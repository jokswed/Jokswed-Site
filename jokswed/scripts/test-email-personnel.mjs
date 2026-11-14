/* =============================================================================
   RÉGRESSION — ENVOI MANUEL JOKSWED AUX COULEURS DES E-MAILS TRANSACTIONNELS
   Aucun e-mail envoyé, aucune base de données requise.
   ============================================================================= */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// server-only protège la production Next.js ; ce banc lit le module en Node.
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

const { messagePersonnel } = await import("../lib/email/gabarits.ts");
const { composerMime } = await import("../lib/gmail/envoi.ts");

const texteSaisi = "Bonjour,\nVotre rendez-vous est confirmé.\n\nMerci & à bientôt !\n<script>alert(1)</script>";
const signature = "John Raharison\nJoksWed — Photographe de mariage";
const sujet = "Re: Votre demande de mariage DEM-2026-0001 — JoksWed";
const mail = messagePersonnel({ sujet, corps: texteSaisi, signature });

assert.equal(mail.sujet, sujet, "Le sujet et le fil de conversation sont conservés");
assert.equal(mail.texte, texteSaisi + "\n\n" + signature,
  "La version texte conserve intégralement le corps et la signature");
assert.match(mail.html, /Joks<em>Wed<\/em>/, "Identité visuelle de l'accusé");
assert.match(mail.html, /Votre échange avec JoksWed/, "En-tête de l'e-mail");
assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
  "Le contenu utilisateur est échappé");
assert.doesNotMatch(mail.html, /<script>/, "Pas de script HTML injecté");
assert.ok(mail.html.includes("Bonjour,<br>Votre rendez-vous"),
  "Les retours à la ligne restent visibles");
assert.equal(mail.html.split("John Raharison").length - 1, 1,
  "La signature n'est insérée qu'une fois");
assert.ok(!/<img\b|<link\b/i.test(mail.html),
  "Pas d'images distantes ni de CSS externe");

const sansSignature = messagePersonnel({
  sujet: "Échange personnalisé",
  corps: "Message court",
});
assert.equal(sansSignature.texte, "Message court");
assert.ok(sansSignature.html.includes("Message court"));

const mime = composerMime({
  de: { email: "contact@jokswed.com", nom: "JoksWed" },
  pour: { email: "couple@example.invalid" },
  repondreA: "rep+jetonvalide@reply.jokswed.com",
  sujet: mail.sujet,
  texte: mail.texte,
  html: mail.html,
});
assert.match(mime, /Content-Type: multipart\/alternative/,
  "Gmail conserve les deux versions du message");
assert.ok(mime.includes("Reply-To: rep+jetonvalide@reply.jokswed.com"),
  "La réponse reste rattachable à la conversation");
assert.ok(mime.includes(Buffer.from(mail.html, "utf8").toString("base64").slice(0, 60)),
  "La version HTML est bien incluse dans le message Gmail");

console.log("✓ Rendu JoksWed, échappement, signature, texte brut et MIME Gmail.");
