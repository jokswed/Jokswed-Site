/* =============================================================================
   VÉRIFIER UN DÉPLOIEMENT (Preview ou production)
   -----------------------------------------------------------------------------
   Contrôles NON DESTRUCTIFS, depuis l'extérieur, sur une URL déployée.
   Rien n'est écrit, aucun e-mail n'est déclenché, aucun compte n'est créé.

   Usage : npm run verifier:prod -- https://jokswed-xxxx.vercel.app
   ============================================================================= */
const base = (process.argv[2] ?? process.env.URL_A_VERIFIER ?? "").replace(/\/+$/, "");
if (!base.startsWith("http")) {
  console.error("Usage : npm run verifier:prod -- https://…");
  process.exit(1);
}

const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
};
const get = (chemin, options = {}) =>
  fetch(`${base}${chemin}`, { redirect: "manual", ...options });

console.log(`Cible : ${base}\n`);

/* ── Site public ── */
for (const [chemin, attendu] of [
  ["/", "JoksWed"], ["/tarifs", "Formule"], ["/faq", "FAQ"],
  ["/contact", "contact"], ["/mentions-legales", "Mentions"],
  ["/confidentialite", "onfidentialit"], ["/portfolio", "ortfolio"],
]) {
  try {
    const r = await get(chemin);
    const t = await r.text();
    v(`Page publique ${chemin}`, r.status === 200 && t.includes(attendu),
      `HTTP ${r.status}`);
  } catch (e) { v(`Page publique ${chemin}`, false, e.message); }
}

const sitemap = await get("/sitemap.xml");
v("sitemap.xml répond", sitemap.status === 200, `HTTP ${sitemap.status}`);
const robots = await get("/robots.txt");
const txtRobots = await robots.text();
v("robots.txt interdit /admin", /Disallow:\s*\/admin/.test(txtRobots), txtRobots.slice(0, 120));

/* ── Administration : fermée ── */
for (const chemin of ["/admin", "/admin/demandes", "/admin/finances", "/admin/saison",
  "/admin/messagerie", "/admin/collaborateurs", "/admin/parametres/compte",
  "/admin/parametres/messagerie", "/admin/entreprise", "/admin/dossiers",
  "/admin/propositions", "/admin/notifications"]) {
  const r = await get(chemin);
  /* ⚠️ UNE REDIRECTION VERS LA CONNEXION EST LA BONNE RÉPONSE.
     Un 200 signifierait qu'une page d'administration s'affiche sans session. */
  const ok = (r.status === 307 || r.status === 302)
    && (r.headers.get("location") ?? "").includes("/admin/connexion");
  v(`${chemin} est fermé sans session`, ok,
    `HTTP ${r.status} → ${r.headers.get("location")}`);
}

const connexion = await get("/admin/connexion");
v("La page de connexion, elle, répond", connexion.status === 200,
  `HTTP ${connexion.status}`);

/* ── Routes sensibles ── */
const drain = await get("/api/cron/drain");
v("Le drain refuse un appel sans secret",
  drain.status === 401 || drain.status === 403 || drain.status === 503,
  `HTTP ${drain.status}`);

const entrant = await fetch(`${base}/api/entrant/brevo/secret-invente`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
v("La réception refuse un secret invalide", entrant.status === 404,
  `HTTP ${entrant.status}`);

const amorcage = await get("/admin/amorcage");
v("⚠️ L'amorçage n'est pas ouvert sans clé",
  amorcage.status === 404, `HTTP ${amorcage.status}`);

const pdfVole = await get("/api/admin/documents/00000000-0000-0000-0000-000000000000/pdf");
/* Une redirection vers la connexion vaut un refus : ce qui compte est
   qu'aucun octet de PDF ne sorte. */
v("Un document ne se télécharge pas sans session",
  [301, 302, 307, 401, 403, 404].includes(pdfVole.status)
    && !(pdfVole.headers.get("content-type") ?? "").includes("pdf"),
  `HTTP ${pdfVole.status}`);

/* ── Formulaire public : on vérifie le REFUS, pas l'envoi ──
   ⚠️ ON NE DÉPOSE PAS DE VRAIE DEMANDE. Elle atterrirait dans le carnet, et
   une demande fictive en production est une demande qu'on finira par
   traiter. On vérifie donc que la route existe et qu'elle refuse une
   soumission sans consentement. */
const contactSansConsentement = await fetch(`${base}/api/contact`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ nom: "Contrôle", email: "controle@exemple.invalid" }),
});
v("Le formulaire refuse une soumission sans consentement",
  [400, 422, 429].includes(contactSansConsentement.status),
  `HTTP ${contactSansConsentement.status}`);

/* ── En-têtes ── */
const racine = await get("/");
const csp = racine.headers.get("content-security-policy");
v("Les en-têtes de sécurité sont posés",
  Boolean(racine.headers.get("x-content-type-options") || csp),
  "aucun en-tête de sécurité");
/* En local on vérifie le reste ; HTTPS n'a de sens que sur un déploiement. */
if (!base.includes("127.0.0.1") && !base.includes("localhost")) {
  v("Le site est servi en HTTPS", base.startsWith("https://"), base);
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles de déploiement.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Déploiement conforme aux contrôles externes.");
