/* =============================================================================
   BANC DES ROUTES D'ADMINISTRATION — COMPORTEMENT HTTP RÉEL
   -----------------------------------------------------------------------------
   Le banc de sécurité éprouve la base. Celui-ci éprouve ce qu'un navigateur
   obtient réellement : redirections, cookies, codes de statut, et ce qui
   figure — ou non — dans le HTML servi.

   Base vierge à chaque exécution, serveur Next démarré contre elle.
   ============================================================================= */
import { spawn } from "node:child_process";
import pg from "pg";
import { demarrer, urlMigrateur, urlApplication, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const PORT = 3143;
const BASE = `http://127.0.0.1:${PORT}`;
const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
};

/** Un « navigateur » minimal : garde les cookies, ne suit pas les redirections. */
function navigateur() {
  const boite = new Map();
  return {
    cookies: boite,
    async fetch(chemin, options = {}) {
      const entetes = new Headers(options.headers ?? {});
      if (boite.size) {
        entetes.set("cookie", [...boite].map(([k, val]) => `${k}=${val}`).join("; "));
      }
      entetes.set("origin", BASE);
      const r = await fetch(`${BASE}${chemin}`, { ...options, headers: entetes, redirect: "manual" });
      for (const brut of r.headers.getSetCookie?.() ?? []) {
        const [paire] = brut.split(";");
        const i = paire.indexOf("=");
        const nom = paire.slice(0, i);
        const val = paire.slice(i + 1);
        if (val === "" ) boite.delete(nom); else boite.set(nom, val);
      }
      return r;
    },
  };
}

/* Un POST de formulaire ordinaire : exactement ce que fait un navigateur
   sans JavaScript. Le banc n'a donc rien à savoir des internes de Next. */
async function seConnecter(nav, email, motDePasse, suite = "/admin") {
  return nav.fetch("/api/admin/connexion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, motDePasse, suite }).toString(),
  });
}

const pgdev = await demarrer();
let serveur, fixtures;

try {
  const base = await baseVierge("jokswed_banc_admin");
  await migrer(urlMigrateur(base), { silencieux: true });
  fixtures = await semer(urlMigrateur(base), { silencieux: true });

  serveur = spawn("npx", ["next", "start", "--port", String(PORT)], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SITE_URL: BASE,
      DATABASE_URL_APP: urlApplication(base),
      JOKSWED_CHIFFREMENT_CLE: Buffer.alloc(32, 7).toString("base64"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let journal = "";
  serveur.stdout.on("data", (d) => (journal += d));
  serveur.stderr.on("data", (d) => (journal += d));

  const fin = Date.now() + 40_000;
  let pret = false;
  while (Date.now() < fin && !pret) {
    try {
      const r = await fetch(`${BASE}/admin/connexion`, { signal: AbortSignal.timeout(2000) });
      pret = r.status < 500;
    } catch { await new Promise((r) => setTimeout(r, 400)); }
  }
  if (!pret) { console.error(journal.slice(-2500)); throw new Error("serveur non démarré"); }

  /* ═══════════ 1. AUCUNE ROUTE D'ADMIN SANS COOKIE ═══════════ */
  for (const chemin of ["/admin", "/admin/collaborateurs", "/admin/entreprise"]) {
    const r = await fetch(`${BASE}${chemin}`, { redirect: "manual" });
    const vers = r.headers.get("location") ?? "";
    v(`${chemin} sans session → redirigé vers la connexion`,
      [307, 308, 302].includes(r.status) && vers.includes("/admin/connexion"),
      `HTTP ${r.status} → ${vers || "(aucune redirection)"}`);
  }

  const connexionPublique = await fetch(`${BASE}/admin/connexion`);
  v("La page de connexion, elle, est accessible", connexionPublique.status === 200,
    `HTTP ${connexionPublique.status}`);
  v("L'administration n'est pas indexable",
    (connexionPublique.headers.get("x-robots-tag") ?? "").includes("noindex")
      || (await connexionPublique.clone().text()).includes("noindex"));

  /* ═══════════ 2. UN COOKIE INVENTÉ NE VAUT RIEN ═══════════ */
  const faux = await fetch(`${BASE}/admin`, {
    headers: { cookie: "jokswed_session=jeton-completement-invente" },
    redirect: "manual",
  });
  v("Un jeton de session inventé ne donne aucun accès",
    (faux.headers.get("location") ?? "").includes("/admin/connexion"),
    `HTTP ${faux.status} → ${faux.headers.get("location")}`);

  /* ═══════════ 3. CONNEXION ═══════════ */
  const mauvais = navigateur();
  const rMauvais = await seConnecter(mauvais, "proprietaire@exemple.invalid", "mauvais-mot-de-passe");
  const texteMauvais = rMauvais.headers.get("location") ?? "";
  v("Un mot de passe faux ne pose pas de cookie de session",
    !mauvais.cookies.has("jokswed_session"),
    [...mauvais.cookies.keys()].join(","));

  const inconnu = navigateur();
  const rInconnu = await seConnecter(inconnu, "inexistant@exemple.invalid", "mauvais-mot-de-passe");
  const texteInconnu = rInconnu.headers.get("location") ?? "";
  /* ⚠️ Les deux échecs doivent être INDISTINGUABLES : sinon le formulaire
     devient un oracle qui révèle quelles adresses ont un compte. */
  const motif = (t) => (t.match(/erreur=(\w+)/) ?? [])[1] ?? t.slice(0, 40);
  v("E-mail inconnu et mot de passe faux donnent la MÊME réponse",
    motif(texteMauvais) === motif(texteInconnu),
    `${motif(texteMauvais)} vs ${motif(texteInconnu)}`);

  /* ⚠️ LE NOM DU COOKIE CHANGE SELON L'ENVIRONNEMENT.

     En production il porte le préfixe `__Host-`, qui impose au navigateur
     HTTPS, le chemin racine et l'absence d'attribut Domain : un sous-domaine
     compromis ne peut alors pas le poser. Le banc tourne avec
     NODE_ENV=production, donc c'est ce nom-là qu'il doit attendre.

     Conséquence pratique à connaître : un `next start` en NODE_ENV=production
     servi en HTTP SIMPLE ne permet pas de se connecter depuis un vrai
     navigateur, puisque `Secure` fait rejeter le cookie. En local, on lance
     `npm run dev` (nom sans préfixe) ou on sert en HTTPS. */
  const NOM_SESSION = "__Host-jokswed_session";
  const proprio = navigateur();
  const rProprio = await seConnecter(proprio, "proprietaire@exemple.invalid", fixtures.motDePasse);
  const brutCookie = (rProprio.headers.getSetCookie?.() ?? []).join(" ");
  v("Le propriétaire obtient un cookie de session", proprio.cookies.has(NOM_SESSION),
    [...proprio.cookies.keys()].join(",") || "aucun cookie");
  v("Le cookie est HttpOnly, Secure, SameSite=Lax et préfixé __Host-",
    brutCookie.includes("HttpOnly") && brutCookie.includes("Secure")
      && brutCookie.includes("SameSite=lax") && brutCookie.includes("__Host-"),
    brutCookie.slice(0, 120));
  v("Le jeton de session n'est pas lisible en clair dans la page",
    !(await (await proprio.fetch("/admin")).clone().text())
      .includes(proprio.cookies.get(NOM_SESSION)));

  const tableau = await proprio.fetch("/admin");
  const htmlTableau = await tableau.text();
  v("Le propriétaire accède au tableau de bord",
    tableau.status === 200 && htmlTableau.includes("Tableau de bord"), `HTTP ${tableau.status}`);
  v("Le tableau de bord affiche son entreprise", htmlTableau.includes("JoksWed"));
  v("Il voit ses 2 dossiers", /2[\s\S]{0,400}Dossiers au total/.test(htmlTableau));
  /* ⚠️ LA DATE NE DOIT PAS GLISSER D'UN JOUR.
     Les fixtures posent le 24 juillet 2027 ; `pg` rendait un Date à minuit
     local, reformaté en UTC, ce qui affichait le 23. */
  v("La date du mariage s'affiche sans décalage de fuseau",
    htmlTableau.includes("24 juillet 2027") && !htmlTableau.includes("23 juillet 2027"));

  const collab = await proprio.fetch("/admin/collaborateurs");
  const htmlCollab = await collab.text();
  v("Le propriétaire accède aux collaborateurs",
    collab.status === 200 && htmlCollab.includes("Collaborateurs"), `HTTP ${collab.status}`);
  v("Aucune invitation n'a été envoyée", htmlCollab.includes("Aucune invitation préparée"));

  /* ═══════════ 4. CLOISONNEMENT ENTRE ENTREPRISES, VU DU NAVIGATEUR ═══════════ */
  const video = navigateur();
  await seConnecter(video, "videaste@exemple.invalid", fixtures.motDePasse);
  const tableauVideo = await video.fetch("/admin");
  const htmlVideo = await tableauVideo.text();
  v("Le vidéaste accède à SON administration", tableauVideo.status === 200);
  v("Il voit son entreprise, pas JoksWed",
    htmlVideo.includes("vidéaste partenaire") && !htmlVideo.includes("D-2027-0002"),
    "une référence de JoksWed apparaît");
  v("Aucune référence de dossier JoksWed n'apparaît chez lui",
    !htmlVideo.includes("D-2027-0001") && !htmlVideo.includes("D-2027-0002"));

  /* ═══════════ 5. PERMISSION MANQUANTE ═══════════ */
  const assistant = navigateur();
  await seConnecter(assistant, "assistant@exemple.invalid", fixtures.motDePasse);
  const collabAssistant = await assistant.fetch("/admin/collaborateurs");
  const vers = collabAssistant.headers.get("location") ?? "";
  v("L'assistant, sans `membre.inviter`, est refusé sur /admin/collaborateurs",
    vers.includes("/admin?refus=") || collabAssistant.status === 403,
    `HTTP ${collabAssistant.status} → ${vers}`);

  const tableauAssistant = await assistant.fetch("/admin");
  const htmlAssistant = await tableauAssistant.text();
  v("Le lien « Collaborateurs » ne lui est même pas proposé",
    !htmlAssistant.includes('href="/admin/collaborateurs"'));

  /* ═══════════ 6. RÉVOCATION : EFFET IMMÉDIAT SUR UNE SESSION OUVERTE ═══════════ */
  const verite = new pg.Client({ connectionString: urlMigrateur(base) });
  await verite.connect();
  await verite.query(
    "UPDATE membres SET retire_le = now() WHERE utilisateur_id = $1 AND entreprise_id = $2",
    [fixtures.utilisateurs.assistant, fixtures.entreprises.jokswed]);

  const apresRevoc = await assistant.fetch("/admin");
  const versRevoc = apresRevoc.headers.get("location") ?? "";
  v("Une session OUVERTE perd l'accès dès la révocation du membre",
    versRevoc.includes("/admin/connexion"),
    `HTTP ${apresRevoc.status} → ${versRevoc || "(page servie)"}`);

  /* Et la désactivation du compte coupe la session elle-même. */
  await verite.query("UPDATE utilisateurs SET desactive_le = now() WHERE id = $1",
    [fixtures.utilisateurs.videaste]);
  const apresDesactivation = await video.fetch("/admin");
  v("Un compte désactivé perd sa session ouverte",
    (apresDesactivation.headers.get("location") ?? "").includes("/admin/connexion"),
    `HTTP ${apresDesactivation.status}`);
  await verite.end();

  /* ═══════════ 7. LIMITATION DES TENTATIVES ═══════════ */
  let vu429 = false;
  for (let i = 0; i < 12; i += 1) {
    const n = navigateur();
    const r = await seConnecter(n, "proprietaire@exemple.invalid", `faux-${i}-aaaaaaaa`);
    if ((r.headers.get("location") ?? "").includes("erreur=trop")) { vu429 = true; break; }
  }
  v("Les tentatives répétées finissent par être bloquées", vu429);

  /* ═══════════ 8. AUCUNE FUITE DANS LES JOURNAUX ═══════════ */
  v("Le mot de passe de fixtures n'apparaît pas dans les journaux serveur",
    !journal.includes(fixtures.motDePasse));
  v("Aucune chaîne de connexion complète dans les journaux",
    !journal.includes("jokswed_app:dev_app"));
} finally {
  if (serveur) { serveur.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 600)); serveur.kill("SIGKILL"); }
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves de routes passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc des routes d'administration : tout est vert.");
