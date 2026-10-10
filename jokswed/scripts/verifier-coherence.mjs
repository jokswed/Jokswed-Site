/* =============================================================================
   BANC — COHÉRENCE ÉDITORIALE ET ABSENCE DE RÉFÉRENCES MORTES
   -----------------------------------------------------------------------------
   Il attrape exactement les défauts relevés à l'audit, et il échouera si l'un
   d'eux réapparaît :

     1. le délai « 15 à 20 jours », contredisant le devis et le contrat ;
     2. « plusieurs centaines » de photos là où 800 minimum sont engagées ;
     3. un lien ou une URL vers /mariages, route inexistante ;
     4. une image référencée dans le contenu mais absente de public/ ;
     5. un prix écrit en dur dans une page au lieu de venir de content/offres.ts.
   ============================================================================= */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = new URL("..", import.meta.url).pathname;
const echecs = [];

/**
 * Retire commentaires et littéraux de documentation avant analyse.
 *
 * ⚠️ SANS CELA, LE BANC SE DÉCLENCHE SUR SA PROPRE DOCUMENTATION.
 *
 * Les commentaires du code CITENT volontairement les formulations fautives
 * (« 15 à 20 jours », `onboarding@resend.dev`, `/images/hero.jpg`) pour
 * expliquer ce qui a été corrigé et pourquoi. Un banc qui échoue là-dessus
 * pousse à effacer l'explication plutôt qu'à garder le code juste — exactement
 * l'inverse de ce qu'on veut.
 */
function sansCommentaires(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")       // blocs /* … */ et /** … */
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1"); // lignes //, sans casser les URL http://
}

async function fichiers(dossier, exts, acc = []) {
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", ".git", "public"].includes(e.name)) continue;
      await fichiers(chemin, exts, acc);
    } else if (exts.includes(extname(e.name))) acc.push(chemin);
  }
  return acc;
}

const sources = await fichiers(RACINE, [".js", ".jsx", ".ts", ".tsx", ".mjs"]);

/* --- 1 à 3 : formulations et liens interdits ------------------------------- */
const interdits = [
  { motif: /15 à 20 jours/, quoi: "délai « 15 à 20 jours » (le devis et l'article 7 du contrat disent 13 à 15)" },
  { motif: /plusieurs centaines de photographies/, quoi: "« plusieurs centaines » (l'engagement est un minimum de 800)" },
  { motif: /href=["'`]\/mariages/, quoi: "lien vers /mariages (route inexistante)" },
  { motif: /onboarding@resend\.dev/, quoi: "expéditeur de repli sur un domaine tiers" },
];

for (const fichier of sources) {
  if (fichier.includes("/scripts/")) continue;
  const contenu = sansCommentaires(await readFile(fichier, "utf8"));
  for (const { motif, quoi } of interdits) {
    if (motif.test(contenu)) {
      echecs.push(`${fichier.replace(RACINE, "")} : ${quoi}`);
    }
  }
}

/* --- 4 : toute image référencée doit exister ------------------------------- */
const refs = new Set();
for (const fichier of sources) {
  const contenu = sansCommentaires(await readFile(fichier, "utf8"));
  for (const m of contenu.matchAll(/["'`](\/images\/[^"'`]+\.(?:jpg|jpeg|png|webp|avif))["'`]/g)) {
    refs.add(m[1]);
  }
}
for (const ref of refs) {
  try {
    await stat(join(RACINE, "public", ref));
  } catch {
    echecs.push(`image référencée mais absente de public/ : ${ref}`);
  }
}

/* --- 5 : aucun prix en dur hors du catalogue ------------------------------- */
for (const fichier of sources) {
  if (fichier.includes("content/offres.ts") || fichier.includes("/scripts/")) continue;
  const contenu = sansCommentaires(await readFile(fichier, "utf8"));
  for (const m of contenu.matchAll(/(?<![\w.])1\s?[0-6]00\s?€/g)) {
    echecs.push(`${fichier.replace(RACINE, "")} : prix en dur « ${m[0]} » — doit venir de content/offres.ts`);
  }
}

if (echecs.length) {
  console.error("✗ Incohérences :");
  for (const e of echecs) console.error(`   · ${e}`);
  process.exit(1);
}
console.log(`✓ Cohérence éditoriale — ${refs.size} images vérifiées, aucune formulation contradictoire, aucun lien mort, aucun prix en dur.`);
