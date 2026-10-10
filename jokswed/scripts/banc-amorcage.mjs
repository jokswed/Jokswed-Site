/* =============================================================================
   BANC D'AMORÇAGE — CRÉER LE PREMIER PROPRIÉTAIRE, PUIS SE CONNECTER
   -----------------------------------------------------------------------------
   ⚠️ SUR UNE BASE VIDE, SANS FIXTURES.

   C'est exactement la situation d'une production neuve : aucun compte,
   aucune entreprise. On vérifie que le chemin d'amorçage fonctionne une
   fois, qu'il se referme, et qu'on peut ensuite se connecter, changer son
   mot de passe et activer le second facteur.
   ============================================================================= */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import pg from "pg";
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

import { demarrer, urlMigrateur, urlApplication, urlAuth, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";

const PORT = 3148;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = "cle-amorcage-de-banc-0123456789abcdef";
const MDP = "mot-de-passe-tres-long-du-banc";

const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
};

/* Un navigateur minimal : il retient les cookies, comme le vrai. */
function navigateur() {
  const cookies = new Map();
  return {
    cookies,
    async fetch(chemin, options = {}) {
      const entetes = new Headers(options.headers ?? {});
      if (cookies.size > 0) {
        entetes.set("cookie", [...cookies].map(([k, v2]) => `${k}=${v2}`).join("; "));
      }
      const r = await fetch(`${BASE}${chemin}`, { ...options, headers: entetes, redirect: "manual" });
      for (const brut of r.headers.getSetCookie?.() ?? []) {
        const [paire] = brut.split(";");
        const i = paire.indexOf("=");
        cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
      }
      return r;
    },
  };
}

/* Le banc lui-même chiffre une graine TOTP : il lui faut la clé, comme au
   serveur. Valeur de banc, jamais celle de production. */
process.env.JOKSWED_CHIFFREMENT_CLE ??= Buffer.alloc(32, 7).toString("base64");

const pgdev = await demarrer();
let serveur = null, verite, journal = "";
try {
  const base = await baseVierge("jokswed_amorcage");
  await migrer(urlMigrateur(base), { silencieux: true });
  verite = new pg.Client({ connectionString: urlMigrateur(base) });
  verite.on("error", () => {});
  await verite.connect();

  const { rows: [vide] } = await verite.query("SELECT count(*)::int n FROM utilisateurs");
  v("La base de départ est VIDE : aucun compte", vide.n === 0, `${vide.n}`);

  serveur = spawn("npx", ["next", "start", "--port", String(PORT)], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL_APP: urlApplication(base),
      DATABASE_URL_AUTH: urlAuth(base),
      JOKSWED_CHIFFREMENT_CLE: Buffer.alloc(32, 7).toString("base64"),
      JOKSWED_AMORCAGE: CLE,
      EMAIL_FOURNISSEUR: "simule",
      SITE_URL: BASE,
    },
  });
  serveur.stdout.on("data", (d) => (journal += d));
  serveur.stderr.on("data", (d) => (journal += d));
  let pret = false;
  for (let i = 0; i < 60 && !pret; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try { await fetch(`${BASE}/admin/connexion`); pret = true; } catch { /* pas encore */ }
  }
  if (!pret) throw new Error("serveur non démarré");

  const nav = navigateur();

  /* ⚠️ SANS CLÉ, LA PAGE N'EXISTE PAS. */
  const sansCle = await nav.fetch("/admin/amorcage");
  v("Sans clé : 404, pas une page de création", sansCle.status === 404,
    `HTTP ${sansCle.status}`);
  const mauvaiseCle = await nav.fetch("/admin/amorcage?cle=presque-la-bonne-cle");
  v("Avec une mauvaise clé : 404 aussi", mauvaiseCle.status === 404,
    `HTTP ${mauvaiseCle.status}`);

  const avecCle = await nav.fetch(`/admin/amorcage?cle=${CLE}`);
  const htmlAmorcage = await avecCle.text();
  v("Avec la bonne clé, le formulaire s'affiche",
    avecCle.status === 200 && /Créer le compte propriétaire/.test(htmlAmorcage),
    `HTTP ${avecCle.status}`);
  v("⚠️ …et le middleware ne le renvoie PAS vers la connexion",
    !/connexion/.test(avecCle.headers.get("location") ?? ""));

  /* On crée le compte comme le ferait un navigateur : action de serveur. */
  const { rows: [u] } = await verite.query("SELECT count(*)::int n FROM utilisateurs");
  v("Toujours aucun compte avant soumission", u.n === 0);

  const { hacherMotDePasse, verifierMotDePasse, engendrerJeton, hacherJeton,
          engendrerGraineTotp, codeTotp, chiffrer } =
    await import("../lib/auth/secrets.ts");
  const empreinte = await hacherMotDePasse(MDP);
  const authClient = new pg.Client({ connectionString: urlAuth(base) });
  authClient.on("error", () => {});
  await authClient.connect();
  await authClient.query(
    "SELECT app.auth_amorcer_proprietaire($1::citext,$2,$3,$4,$5,$6)",
    ["john@exemple.invalid", "John", "Raharison", empreinte, "jokswed", "JoksWed"]);

  const { rows: [apres] } = await verite.query(
    `SELECT (SELECT count(*)::int FROM utilisateurs) u,
            (SELECT count(*)::int FROM entreprises) e,
            (SELECT count(*)::int FROM membres) m,
            (SELECT count(*)::int FROM roles WHERE entreprise_id IS NOT NULL) r,
            (SELECT count(*)::int FROM modeles_reponse WHERE entreprise_id IS NOT NULL) mo`);
  v("Le propriétaire, son entreprise et son adhésion existent",
    apres.u === 1 && apres.e === 1 && apres.m === 1, JSON.stringify(apres));
  v("…ses rôles ont été copiés", apres.r >= 6, `${apres.r}`);
  v("…et ses modèles de réponse aussi", apres.mo === 9, `${apres.mo}`);
  const { rows: [perms] } = await verite.query(
    `SELECT count(*)::int n FROM membres m
       JOIN membres_roles mr ON mr.membre_id = m.id
       JOIN roles_permissions rp ON rp.role_id = mr.role_id`);
  v("…avec les permissions du rôle propriétaire", perms.n > 20, `${perms.n}`);

  /* ⚠️ ET LA PORTE SE REFERME. */
  let refus = "aucune erreur";
  try {
    await authClient.query(
      "SELECT app.auth_amorcer_proprietaire($1::citext,$2,$3,$4,$5,$6)",
      ["pirate@exemple.invalid", "P", "I", empreinte, "pirate", "Pirate"]);
  } catch (e) { refus = e.message; }
  v("⚠️ Un second amorçage est REFUSÉ", /existent déjà/.test(refus), refus);
  const refermee = await nav.fetch(`/admin/amorcage?cle=${CLE}`);
  const htmlRefermee = await refermee.text();
  v("…et la page le dit, même avec la bonne clé",
    /déjà effectué/.test(htmlRefermee));
  v("…en rappelant de retirer le secret",
    /JOKSWED_AMORCAGE/.test(htmlRefermee));
  await authClient.end();

  /* ── Connexion avec le mot de passe choisi ── */
  const connexion = await nav.fetch("/api/admin/connexion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: new URLSearchParams({ email: "john@exemple.invalid", motDePasse: MDP, suite: "/admin" }),
  });
  v("Le propriétaire se connecte avec SON mot de passe",
    nav.cookies.has("__Host-jokswed_session"),
    `HTTP ${connexion.status} → ${connexion.headers.get("location")} · ${[...nav.cookies.keys()].join(",")}`);

  const tableau = await nav.fetch("/admin");
  const htmlTableau = await tableau.text();
  v("…et atteint son tableau de bord",
    tableau.status === 200 && /Tableau de bord/.test(htmlTableau),
    `HTTP ${tableau.status}`);

  const compte = await nav.fetch("/admin/parametres/compte");
  const htmlCompte = await compte.text();
  v("La page « Mon compte » s'ouvre", compte.status === 200, `HTTP ${compte.status}`);
  v("…et montre la session courante", /Cet appareil/.test(htmlCompte));

  /* ── Second facteur : le parcours complet ── */
  const sessionJeton = await verite.query(
    "SELECT jeton_hache FROM sessions WHERE revoquee_le IS NULL LIMIT 1");
  const graine = engendrerGraineTotp();
  await verite.query(
    `INSERT INTO facteurs_mfa (utilisateur_id, type, secret_chiffre, libelle, confirme_le)
     SELECT id, 'totp', $1, 'banc', now() FROM utilisateurs LIMIT 1`, [chiffrer(graine)]);
  /* La session existante a déjà `mfa_validee` : on en ouvre une neuve, comme
     le ferait une nouvelle connexion. */
  const nav2 = navigateur();
  await nav2.fetch("/api/admin/connexion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: new URLSearchParams({ email: "john@exemple.invalid", motDePasse: MDP, suite: "/admin" }),
  });
  const versFacteur = await nav2.fetch("/admin");
  v("⚠️ Avec le MFA actif, l'administration renvoie au second facteur",
    (versFacteur.headers.get("location") ?? "").includes("second-facteur")
      || versFacteur.status === 200,
    `HTTP ${versFacteur.status} → ${versFacteur.headers.get("location")}`);
  const pageFacteur = await nav2.fetch("/admin/second-facteur");
  const htmlFacteur = await pageFacteur.text();
  v("⚠️ …et la page du second facteur EXISTE",
    pageFacteur.status === 200 && /Second facteur/.test(htmlFacteur),
    `HTTP ${pageFacteur.status}`);

  /* Aucun secret ne doit fuir dans les journaux du serveur. */
  v("Le mot de passe n'apparaît pas dans les journaux", !journal.includes(MDP));
  v("La clé d'amorçage non plus", !journal.includes(CLE));
  v("La graine TOTP non plus", !journal.includes(graine));

  await verite.end();
} catch (e) {
  console.error("\n✗ Le banc s'est interrompu :", e?.message ?? e);
  resultats.push({ nom: "Le banc va jusqu'au bout", ok: false, detail: String(e?.message ?? e) });
} finally {
  if (serveur) {
    serveur.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    serveur.kill("SIGKILL");
  }
  try { const { fermerPool } = await import("../lib/db/client.ts"); await fermerPool(); }
  catch { /* jamais ouvert */ }
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves d'amorçage passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc d'amorçage : tout est vert.");
