/* Banc isolé : aucune base de données et aucun envoi d'e-mail ni de push. */
import assert from "node:assert/strict";
import {
  markdownVersHtml,
  markdownVersTexte,
  extraitNotification,
} from "../lib/messagerie/markdown.ts";

const saisie = [
  "Bonjour **Camille**,",
  "",
  "Voici *notre proposition* :",
  "",
  "- **Photos** du mariage",
  "- Photos de couple",
  "",
  "Consultez [le dossier](https://jokswed.com/?x=1&y=2).",
].join("\n");

const html = markdownVersHtml(saisie);
assert.match(html, /<strong>Camille<\/strong>/);
assert.match(html, /<em>notre proposition<\/em>/);
assert.match(html, /<ul[^>]*><li><strong>Photos<\/strong> du mariage<\/li>/);
assert.match(html, /href="https:\/\/jokswed.com\/\?x=1&amp;y=2"/);
assert.match(html, /<p[^>]*>Bonjour <strong>Camille<\/strong>,<\/p>/);

const texte = markdownVersTexte(saisie);
assert.ok(!texte.includes("**"), "Pas de marqueurs d'emphase dans le texte brut");
assert.ok(!texte.includes("*notre"), "L'italique n'est pas affiché avec une étoile");
assert.match(texte, /Consultez le dossier \(https:\/\/jokswed.com\/\?x=1&y=2\)/);
assert.match(texte, /- Photos du mariage/);

for (const injection of [
  '<script>alert("attaque")</script>',
  '<img src=x onerror=alert(1)>',
  '[Cliquez](javascript:alert)',
  '[Cliquez](data:text/html,hello)',
]) {
  const rendu = markdownVersHtml(injection);
  assert.doesNotMatch(rendu, /<script|<img|href="javascript:|href="data:/i);
}
assert.match(markdownVersHtml("<script>"), /&lt;script&gt;/);
assert.match(markdownVersHtml("[écrire](mailto:contact@jokswed.com)"),
  /href="mailto:contact@jokswed.com"/);
assert.ok(!markdownVersHtml("[dangereux](javascript:alert)").includes("<a "));
assert.match(markdownVersHtml("prix & taxe"), /prix &amp; taxe/);

const extrait = extraitNotification("**Bonjour** !\n\n> Historique confidentiel", 150);
assert.equal(extrait, "Bonjour !");
const long = extraitNotification("A".repeat(1000), 150);
assert.ok(long.length <= 150 && long.endsWith("…"));

console.log("✓ Markdown sûr : gras, italique, listes, liens, texte brut et aperçu push.");
