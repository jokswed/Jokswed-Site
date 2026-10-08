/* =============================================================================
   BANC — LE SITEMAP NE DOIT ANNONCER QUE DES PAGES QUI EXISTENT
   -----------------------------------------------------------------------------
   Le défaut qu'il attrape est réel : la version livrée déclarait /mariages et
   une URL par reportage sans qu'aucune route n'existe, et omettait /faq.

   Il compare la liste de app/sitemap.js aux dossiers de app/ portant un
   page.jsx, et il échoue dans les DEUX sens — URL annoncée sans page, page
   publique absente du plan.
   ============================================================================= */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const RACINE = new URL("..", import.meta.url).pathname;

/** Pages publiques réellement rendues : un dossier de app/ avec un page.jsx. */
async function routesReelles() {
  const routes = new Set();
  const app = join(RACINE, "app");
  if (await existe(join(app, "page.jsx"))) routes.add("");

  for (const entree of await readdir(app, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    // Les routes techniques et les groupes ne sont pas des pages publiques.
    if (entree.name.startsWith("_") || entree.name.startsWith("(")) continue;
    if (entree.name === "api" || entree.name === "fonts") continue;
    if (await existe(join(app, entree.name, "page.jsx"))) routes.add(`/${entree.name}`);
  }
  return routes;
}

async function existe(chemin) {
  try {
    await stat(chemin);
    return true;
  } catch {
    return false;
  }
}

/** On lit le tableau exporté sans importer de JSX. */
async function routesAnnoncees() {
  const source = await readFile(join(RACINE, "app/sitemap.js"), "utf8");
  const bloc = source.match(/export const PAGES = \[([\s\S]*?)\];/);
  if (!bloc) throw new Error("app/sitemap.js : tableau PAGES introuvable.");
  return new Set(
    [...bloc[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]),
  );
}

const reelles = await routesReelles();
const annoncees = await routesAnnoncees();

const fantomes = [...annoncees].filter((r) => !reelles.has(r));
const oubliees = [...reelles].filter((r) => !annoncees.has(r));

let echec = false;
if (fantomes.length) {
  console.error(`✗ Annoncées au sitemap sans page correspondante : ${fantomes.join(", ")}`);
  echec = true;
}
if (oubliees.length) {
  console.error(`✗ Pages publiques absentes du sitemap : ${oubliees.join(", ")}`);
  echec = true;
}
if (echec) process.exit(1);

console.log(`✓ Sitemap cohérent — ${annoncees.size} pages, toutes réelles, aucune oubliée.`);
