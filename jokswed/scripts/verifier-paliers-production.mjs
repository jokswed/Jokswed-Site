/* =============================================================================
   AVANT D'APPLIQUER UN PALIER EN PRODUCTION — EN LECTURE SEULE
   -----------------------------------------------------------------------------
   ⚠️ UNE MIGRATION QUI ÉCHOUE À MI-CHEMIN N'EST PAS LE RISQUE : `migrer.mjs`
   est transactionnel, un palier qui échoue ne laisse rien derrière lui. Le
   risque, c'est de DÉCOUVRIR l'échec en production, pendant la fenêtre où le
   code neuf est déjà poussé et le schéma encore ancien.

   Ce contrôle liste donc les paliers restants et vérifie d'avance les
   conditions que les nouvelles CONTRAINTES vont valider sur les données
   existantes — les seules choses qu'un banc sur base vierge ne peut pas voir.

   N'ÉCRIT RIEN. N'IMPRIME AUCUN SECRET.
   ============================================================================= */
import fs from "node:fs";
import pg from "pg";

const chemin = `${process.env.HOME}/.config/jokswed/neon-production-owner.url`;
if (!fs.existsSync(chemin)) {
  console.error(`✗ Chaîne de production absente : ${chemin}`);
  process.exit(2);
}
const c = new pg.Client({
  connectionString: fs.readFileSync(chemin, "utf8").trim(),
  ssl: { rejectUnauthorized: true },
});
c.on("error", () => {});
await c.connect();
const q = async (t, v = []) => (await c.query(t, v)).rows;

const [b] = await q("SELECT current_database() d, current_user u");
if (b.d !== "jokswed") {
  console.error(`✗ Base « ${b.d} » au lieu de « jokswed ». Arrêt.`);
  process.exit(2);
}
console.log(`Base « ${b.d} », rôle « ${b.u} »`);

const appliques = (await q("SELECT nom FROM schema_migrations ORDER BY nom")).map((r) => r.nom);
const fichiers = fs.readdirSync("lib/db/migrations").filter((f) => f.endsWith(".sql")).sort();
const restants = fichiers.filter((f) => !appliques.includes(f));
console.log(`${appliques.length} palier(s) appliqué(s), dernier : ${appliques.at(-1) ?? "aucun"}`);
console.log(restants.length === 0 ? "Aucun palier à appliquer."
  : `${restants.length} palier(s) à appliquer :\n  ${restants.join("\n  ")}`);

const [vol] = await q(`SELECT
  (SELECT count(*)::int FROM demandes)     demandes,
  (SELECT count(*)::int FROM mariages)     mariages,
  (SELECT count(*)::int FROM dossiers)     dossiers,
  (SELECT count(*)::int FROM echeances)    echeances,
  (SELECT count(*)::int FROM paiements)    paiements,
  (SELECT count(*)::int FROM documents)    documents,
  (SELECT count(*)::int FROM utilisateurs) utilisateurs,
  (SELECT count(*)::int FROM entreprises)  entreprises`);
console.log("Volumes :", JSON.stringify(vol));

const controles = [];
const ok = (nom, vrai, detail = "") => {
  controles.push({ nom, vrai, detail });
  console.log(`${vrai ? "✓" : "✗"} ${nom}${vrai ? "" : ` — ${detail}`}`);
};

/* Palier 060 : `echeance_rattachee` exige document_id OU demande_id. Une
   échéance existante sans document ferait échouer la validation. */
const [e] = await q("SELECT count(*)::int n FROM echeances WHERE document_id IS NULL");
ok("Aucune échéance orpheline de document (contrainte echeance_rattachee)",
  e.n === 0, `${e.n} ligne(s)`);

/* Palier 060 : la nouvelle liste de statuts est un SUR-ENSEMBLE de l'ancienne,
   mais on le vérifie sur les données plutôt que sur la relecture. */
const [s] = await q(`SELECT count(*)::int n FROM demandes WHERE statut NOT IN
  ('non_lue','a_traiter','attente_client','attente_collaborateur','en_cours_devis',
   'devis_envoye','confirmee','refusee','annulee','close','archivee')`);
ok("Tous les statuts de demande entrent dans la nouvelle liste", s.n === 0, `${s.n} ligne(s)`);

/* Palier 060 : `demande_entreprise_unique (id, entreprise_destinataire_id)` —
   `id` est déjà la clé primaire, donc l'unicité est acquise ; on le confirme. */
const [d] = await q(
  "SELECT count(*)::int n FROM (SELECT id FROM demandes GROUP BY id HAVING count(*) > 1) x");
ok("Aucun doublon d'identifiant de demande", d.n === 0, `${d.n} ligne(s)`);

/* Palier 062 : la fonction remplacée est bien celle qu'on croit. */
const [p] = await q(`SELECT count(*)::int n FROM pg_proc pr
  JOIN pg_namespace ns ON ns.oid = pr.pronamespace
 WHERE ns.nspname = 'app' AND pr.proname = 'push_abonnements_entreprise'`);
ok("L'ancienne fonction de notification est présente et sera remplacée",
  p.n === 1 || restants.length === 0, `${p.n} fonction(s)`);

/* ⚠️ AUCUNE TABLE EN `FORCE` : le palier 056 l'a retiré partout, et les
   fonctions SECURITY DEFINER en dépendent. Un palier qui en remettrait une
   casserait tout l'accès contrôlé en silence. */
const [f] = await q(`SELECT count(*)::int n FROM pg_class k
  JOIN pg_namespace ns ON ns.oid = k.relnamespace
 WHERE ns.nspname = 'public' AND k.relkind = 'r' AND k.relforcerowsecurity`);
ok("Aucune table en FORCE ROW LEVEL SECURITY", f.n === 0, `${f.n} table(s)`);

await c.end();
const echecs = controles.filter((x) => !x.vrai);
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôles avant migration.`);
if (echecs.length > 0) {
  console.error("Ne pas appliquer les paliers tant que ces points ne sont pas réglés.");
  process.exit(1);
}
console.log("Les paliers restants peuvent être appliqués.");
