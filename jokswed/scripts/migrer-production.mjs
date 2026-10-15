/* =============================================================================
   APPLIQUER LES PALIERS RESTANTS À UNE BRANCHE NEON (`production` par défaut)
   -----------------------------------------------------------------------------
   ⚠️ LA CHAÎNE N'EST JAMAIS PASSÉE EN ARGUMENT NI EN VARIABLE D'ENVIRONNEMENT.
   Elle est lue depuis `~/.config/jokswed/neon-production-owner.url`, en droits
   600. Une chaîne de connexion sur une ligne de commande se retrouve dans la
   liste des processus et dans l'historique du shell.

   ⚠️ IL REFUSE TOUTE BASE QUI NE S'APPELLE PAS `jokswed`.
   C'est le garde-fou de `neon-production.mjs`, repris ici : la même commande
   lancée avec la chaîne de Preview ne doit pas migrer la mauvaise base.

   `migrer()` est transactionnel palier par palier : un palier qui échoue ne
   laisse rien derrière lui. Lancer `npm run verifier:paliers-prod` d'abord.
   ============================================================================= */
import fs from "node:fs";
import pg from "pg";
import { migrer } from "./migrer.mjs";

/* ⚠️ `--preview` EXISTE POUR QUE PREVIEW NE RESTE PAS EN ARRIÈRE.
   Une Preview sert à éprouver le code AVANT la production : si son schéma est
   plus vieux, elle n'éprouve rien — elle montre des erreurs qui n'arriveront
   pas, et cache celles qui arriveront. Le défaut reste `production`, pour
   qu'un oubli d'argument ne migre pas la mauvaise base en silence. */
const cible = process.argv[2] === "--preview" ? "preview" : "production";
const chemin = `${process.env.HOME}/.config/jokswed/neon-${cible}-owner.url`;
if (!fs.existsSync(chemin)) {
  console.error(`✗ Chaîne de production absente : ${chemin}`);
  process.exit(2);
}
const url = fs.readFileSync(chemin, "utf8").trim();

/* Contrôle en lecture seule AVANT d'écrire quoi que ce soit. */
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
c.on("error", () => {});
await c.connect();
const { rows: [b] } = await c.query("SELECT current_database() d, current_user u");
await c.end();
if (b.d !== "jokswed") {
  console.error(`✗ Base « ${b.d} » au lieu de « jokswed ». Arrêt avant toute écriture.`);
  process.exit(2);
}
console.log(`Branche ${cible} — base « ${b.d} », rôle « ${b.u} ».\n`);

const r = await migrer(url);
console.log(`\n${r?.appliquees ?? "?"} palier(s) appliqué(s).`);
