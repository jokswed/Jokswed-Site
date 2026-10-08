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

/* ⚠️ LES ROUTES PRIVÉES SONT DÉCLARÉES ICI, PAS OUBLIÉES AILLEURS.

   `/admin` est une vraie page, mais elle ne doit JAMAIS figurer au plan du
   site : elle est protégée, `noindex`, et l'annoncer à Google reviendrait à
   publier la porte d'entrée de l'administration. Une liste explicite vaut
   mieux qu'une omission tacite — le jour où une page privée est ajoutée, le
   banc échoue tant qu'on n'a pas dit ce qu'elle est. */
const PRIVEES = new Set(["/admin"]);

/** Pages publiques réellement rendues : un dossier de app/ avec un page.jsx. */
async function routesReelles() {
  const routes = new Set();
  const app = join(RACINE, "app");
  if (await existe(join(app, "page.jsx"))) routes.add("");
  if (await existe(join(app, "(site)", "page.jsx"))) routes.add("");

  /* ⚠️ IL FAUT DESCENDRE DANS LES GROUPES DE ROUTES.

     Depuis la V3, les pages publiques vivent dans `app/(site)/`. Les
     parenthèses n'apparaissent PAS dans l'URL : `app/(site)/tarifs` répond
     sur `/tarifs`. Un banc qui sauterait ces dossiers ne verrait plus aucune
     page publique et déclarerait tout le sitemap fantôme. */
  async function parcourir(repertoire, prefixe) {
    for (const entree of await readdir(repertoire, { withFileTypes: true })) {
      if (!entree.isDirectory()) continue;
      if (entree.name.startsWith("_") || entree.name.startsWith("[")) continue;
      if (entree.name === "api" || entree.name === "fonts") continue;

      if (entree.name.startsWith("(")) {
        // Groupe de routes : transparent dans l'URL.
        if (await existe(join(repertoire, entree.name, "page.jsx"))) routes.add(prefixe || "");
        await parcourir(join(repertoire, entree.name), prefixe);
        continue;
      }
      const chemin = `${prefixe}/${entree.name}`;
      if (PRIVEES.has(chemin)) continue;
      if (await existe(join(repertoire, entree.name, "page.jsx"))) routes.add(chemin);
    }
  }
  await parcourir(app, "");
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

/* Et l'inverse : une route privée ANNONCÉE au sitemap est une erreur grave. */
const privéesAnnoncees = [...annoncees].filter((r) => PRIVEES.has(r));
if (privéesAnnoncees.length) {
  console.error(`✗ Routes PRIVÉES annoncées au sitemap : ${privéesAnnoncees.join(", ")}`);
  process.exit(1);
}

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
