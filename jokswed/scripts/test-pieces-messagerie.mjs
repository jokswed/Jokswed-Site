/* =============================================================================
   TEST SANS ENVOI RÉEL : fichiers locaux de la messagerie.
   Vérifie le contenu de la charge Brevo, le MIME Gmail et la validation de
   format. Aucune vraie adresse ni donnée cliente.
   ============================================================================= */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

const {
  nomFichierSecurise, mimeFichier, verifierDebut,
  TAILLE_BLOC_MAX, TAILLE_FICHIER_MAX, TAILLE_ENVOI_MAX,
} = await import("../lib/messagerie/pieces.ts");
const { chargeBrevo } = await import("../lib/email/fournisseur.ts");
const { composerMime } = await import("../lib/gmail/envoi.ts");

assert.equal(TAILLE_BLOC_MAX, 2 * 1024 * 1024);
assert.equal(TAILLE_FICHIER_MAX, 8 * 1024 * 1024);
assert.equal(TAILLE_ENVOI_MAX, 10 * 1024 * 1024);
assert.equal(nomFichierSecurise("Devis Gabriel & Jimmy.pdf"),
  "Devis Gabriel & Jimmy.pdf");
assert.equal(mimeFichier("devis.pdf"), "application/pdf");
assert.equal(mimeFichier("photo.JPG"), "image/jpeg");
assert.equal(mimeFichier("contrat.docx"),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
assert.throws(() => mimeFichier("script.exe"));
assert.throws(() => mimeFichier("image.svg"));
assert.throws(() => nomFichierSecurise("../document.pdf"));
assert.throws(() => nomFichierSecurise("devis\r\nX-Evil: hi.pdf"));

const pdf = Buffer.from("%PDF-1.7\n%%EOF\n", "utf8");
const png = Buffer.from([137,80,78,71,13,10,26,10, 0,0,0,0, 1,2,3]);
assert.doesNotThrow(() => verifierDebut("devis.pdf", pdf));
assert.doesNotThrow(() => verifierDebut("image.png", png));
assert.throws(() => verifierDebut("devis.pdf", Buffer.from("MZ fake.exe")));
assert.throws(() => verifierDebut("photo.png", Buffer.from("<script>oops</script>")));

const envoi = {
  destinataire: "client@example.invalid",
  destinataireNom: "Test",
  sujet: "Re: Demande mariage — JoksWed",
  html: "<p>Vous trouverez votre devis en pièce jointe.</p>",
  texte: "Vous trouverez votre devis en pièce jointe.",
  repondreA: "rep+test@reply.jokswed.com",
  pieces: [{ nom: "devis-test.pdf", contenu: pdf, type: "application/pdf" }],
  etiquettes: ["jokswed", "messagerie"],
};
const charge = chargeBrevo(envoi, { email: "contact@jokswed.com", nom: "JoksWed" });
assert.equal(charge.attachment.length, 1);
assert.equal(charge.attachment[0].name, "devis-test.pdf");
assert.equal(charge.attachment[0].content, pdf.toString("base64"));
assert.equal(charge.replyTo.email, envoi.repondreA);
assert.equal(charge.htmlContent, envoi.html);
assert.equal(charge.textContent, envoi.texte);

const mime = composerMime({
  de: { email: "contact@jokswed.com", nom: "JoksWed" },
  pour: { email: envoi.destinataire, nom: envoi.destinataireNom },
  repondreA: envoi.repondreA,
  sujet: envoi.sujet,
  html: envoi.html,
  texte: envoi.texte,
  pieces: envoi.pieces,
});
assert.match(mime, /Content-Type: multipart\/mixed/);
assert.match(mime, /Content-Type: multipart\/alternative/);
assert.match(mime, /Content-Disposition: attachment; filename="devis-test.pdf"/);
assert.ok(mime.includes(pdf.toString("base64")), "PDF inclus dans MIME");
assert.ok(mime.includes("Reply-To: rep+test@reply.jokswed.com"));
console.log("✓ PDF, JPEG, PNG et Office : validation, Base64 Brevo, MIME Gmail et Reply-To.");
