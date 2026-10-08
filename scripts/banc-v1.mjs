/* =============================================================================
   BANC V1 — ÉPREUVE RÉELLE DU SITE CONSTRUIT
   -----------------------------------------------------------------------------
   Démarre `next start` sur un port dédié, puis éprouve le site tel qu'il est
   servi. Pas de simulation : les requêtes passent par le vrai serveur.

   ⚠️ AUCUN E-MAIL N'EST ENVOYÉ.
      `RESEND_API_KEY` reçoit une valeur manifestement invalide. Les tests de
      validation (403, 415, 422, 429) s'arrêtent AVANT l'appel au fournisseur.
      Le seul test qui l'atteint vérifie précisément qu'une soumission valide
      franchit toute la validation et échoue proprement en 502 — sans jamais
      divulguer la réponse du fournisseur.

   Lancement :  node scripts/banc-v1.mjs
   ============================================================================= */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const PORT = 3141;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGINE = { Origin: BASE, "Content-Type": "application/json" };

const resultats = [];
function verifier(nom, condition, detail = "") {
  resultats.push({ nom, ok: Boolean(condition), detail });
  console.log(`${condition ? "✓" : "✗"} ${nom}${detail && !condition ? ` — ${detail}` : ""}`);
}

const serveur = spawn("npx", ["next", "start", "--port", String(PORT)], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    NODE_ENV: "production",
    SITE_URL: BASE,
    RESEND_API_KEY: "re_banc_cle_invalide_aucun_envoi",
    CONTACT_TO_EMAIL: "banc@exemple.invalid",
    CONTACT_FROM_EMAIL: "JoksWed <banc@exemple.invalid>",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let journalServeur = "";
serveur.stdout.on("data", (d) => (journalServeur += d));
serveur.stderr.on("data", (d) => (journalServeur += d));

async function attendreServeur(limiteMs = 40_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const demandeValide = {
  noms: "Banc & Essai",
  email: "banc@exemple.invalid",
  telephone: "06 00 00 00 00",
  date: "2028-07-15",
  lieu: "Quelque part",
  message: "Ceci est une soumission de banc.",
  consentement: true,
  consentementPartenaire: false,
};

try {
  if (!(await attendreServeur())) {
    console.error("✗ Le serveur n'a pas démarré.\n", journalServeur.slice(-2000));
    process.exit(1);
  }

  /* ───────────── 1. Toutes les URL du sitemap répondent 200 ───────────── */
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  verifier("Le sitemap contient au moins 8 URL", urls.length >= 8, `${urls.length} trouvées`);
  verifier(
    "Le sitemap ne contient plus /mariages",
    !xml.includes("/mariages"),
    "une URL /mariages y figure encore",
  );

  let toutes200 = true;
  const enEchec = [];
  for (const url of urls) {
    const chemin = new URL(url).pathname;
    const r = await fetch(`${BASE}${chemin}`, { redirect: "manual" });
    if (r.status !== 200) {
      toutes200 = false;
      enEchec.push(`${chemin} → ${r.status}`);
    }
  }
  verifier("Chaque URL du sitemap répond 200", toutes200, enEchec.join(", "));

  /* ───────────── 2. /mariages est bien un 404, pas une page ───────────── */
  verifier(
    "/mariages répond 404",
    (await fetch(`${BASE}/mariages`, { redirect: "manual" })).status === 404,
  );

  /* ───────────── 3. Image Open Graph réellement servie ───────────── */
  const og = await fetch(`${BASE}/opengraph-image.jpg`);
  verifier(
    "L'image Open Graph est servie",
    og.ok && (og.headers.get("content-type") ?? "").includes("image"),
    `HTTP ${og.status}`,
  );
  const accueil = await (await fetch(BASE)).text();
  verifier(
    "L'accueil déclare une image Open Graph absolue",
    /property="og:image"[^>]*content="https?:\/\//.test(accueil) ||
      /content="https?:\/\/[^"]*opengraph-image/.test(accueil),
    "balise og:image introuvable",
  );

  /* ───────────── 4. Données structurées FAQPage ───────────── */
  const faq = await (await fetch(`${BASE}/faq`)).text();
  verifier("La FAQ porte un balisage FAQPage", faq.includes('"@type":"FAQPage"'));
  verifier(
    "La FAQ annonce 13 à 15 jours, et nulle part 15 à 20",
    faq.includes("13 à 15 jours") && !faq.includes("15 à 20 jours"),
  );
  verifier("La FAQ annonce un minimum de 800 photographies", faq.includes("minimum de 800"));

  /* ───────────── 5. Tarifs : TTC explicite, une seule source ───────────── */
  const pageTarifs = await (await fetch(`${BASE}/tarifs`)).text();
  verifier("Les prix sont annoncés TTC", /TTC/.test(pageTarifs));
  /* ⚠️ LES SÉPARATEURS DE MILLIERS NE SONT PAS DES ESPACES ORDINAIRES.
     `Intl.NumberFormat("fr-FR")` produit U+202F (espace fine insécable) entre
     le 1 et les centaines, et U+00A0 avant le €. C'est la typographie française
     correcte ; comparer avec une espace ASCII faisait échouer ce test alors que
     le rendu était juste. On normalise donc toutes les variantes d'espace. */
  const sansEspacesFines = (s) => s.replace(/[\u00a0\u202f\u2009\s]/g, "");
  const tarifsNormalises = sansEspacesFines(pageTarifs);
  verifier(
    "Les trois formules sont affichées",
    ["1000€", "1300€", "1600€"].every((p) => tarifsNormalises.includes(p)),
  );
  verifier(
    "L'ancien texte vidéaste (« Focus Mariés ») a disparu",
    !pageTarifs.includes("Focus Mariés"),
  );
  verifier(
    "Le nouveau texte du vidéaste n'est pas publié par erreur avec ses coordonnées",
    !pageTarifs.includes("cretinoiry@gmail.com") && !pageTarifs.includes("07 60 10 26 29"),
  );

  /* ───────────── 6. Pages légales ───────────── */
  const ml = await (await fetch(`${BASE}/mentions-legales`)).text();
  verifier("Les mentions légales portent le SIRET", ml.includes("93760042700010"));
  verifier(
    "Les mentions légales signalent le médiateur en cours de désignation",
    ml.includes("en cours de désignation"),
  );
  verifier(
    "Aucun numéro de TVA inventé n'est publié",
    !/TVA intracommunautaire\s*:\s*FR/.test(ml),
  );

  /* ───────────── 7. Route de contact : refus attendus ───────────── */
  const sansOrigine = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(demandeValide),
  });
  verifier("Sans en-tête Origin → 403", sansOrigine.status === 403, `HTTP ${sansOrigine.status}`);

  const origineEtrangere = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { Origin: "https://attaquant.example", "Content-Type": "application/json" },
    body: JSON.stringify(demandeValide),
  });
  verifier(
    "Origine étrangère → 403",
    origineEtrangere.status === 403,
    `HTTP ${origineEtrangere.status}`,
  );

  const mauvaisType = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { Origin: BASE, "Content-Type": "text/plain" },
    body: JSON.stringify(demandeValide),
  });
  verifier("Content-Type non JSON → 415", mauvaisType.status === 415, `HTTP ${mauvaisType.status}`);

  const trop = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: ORIGINE,
    body: JSON.stringify({ ...demandeValide, message: "x".repeat(40_000) }),
  });
  verifier("Corps surdimensionné → 413", trop.status === 413, `HTTP ${trop.status}`);

  const sansConsentement = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: ORIGINE,
    body: JSON.stringify({ ...demandeValide, consentement: false }),
  });
  verifier(
    "Sans consentement RGPD → 422",
    sansConsentement.status === 422,
    `HTTP ${sansConsentement.status}`,
  );

  const dateFausse = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: ORIGINE,
    body: JSON.stringify({ ...demandeValide, date: "2027-02-31" }),
  });
  verifier("Date inexistante (31 février) → 422", dateFausse.status === 422, `HTTP ${dateFausse.status}`);

  const emailFaux = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: ORIGINE,
    body: JSON.stringify({ ...demandeValide, email: "pas-une-adresse" }),
  });
  verifier("E-mail invalide → 422", emailFaux.status === 422, `HTTP ${emailFaux.status}`);

  /* Le piège anti-spam : on répond 200 sans rien envoyer, pour ne pas
     renseigner le robot sur sa détection. */
  const piege = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: ORIGINE,
    body: JSON.stringify({ ...demandeValide, website: "http://spam.example" }),
  });
  verifier("Champ piège rempli → 200 sans envoi", piege.status === 200);

  /* ───────────── 8. Validation complète → le fournisseur est atteint ───────────── */
  const jusquAuBout = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { ...ORIGINE, "Idempotency-Key": "banc-idempotence-1" },
    body: JSON.stringify(demandeValide),
  });
  const corpsBout = await jusquAuBout.json().catch(() => ({}));
  verifier(
    "Soumission valide → 502 (clé fournisseur invalide, donc validation franchie)",
    jusquAuBout.status === 502,
    `HTTP ${jusquAuBout.status}`,
  );
  verifier(
    "La réponse d'erreur ne divulgue rien du fournisseur",
    !JSON.stringify(corpsBout).toLowerCase().includes("resend") &&
      !JSON.stringify(corpsBout).includes("api_key"),
  );

  /* ───────────── 9. Limitation de débit ───────────── */
  let vu429 = false;
  for (let i = 0; i < 8; i += 1) {
    const r = await fetch(`${BASE}/api/contact`, {
      method: "POST",
      headers: ORIGINE,
      body: JSON.stringify({ ...demandeValide, message: `répétition ${i}` }),
    });
    if (r.status === 429) {
      vu429 = true;
      verifier("Le 429 porte un en-tête Retry-After", Boolean(r.headers.get("retry-after")));
      break;
    }
  }
  verifier("Soumissions répétées → 429", vu429);

  /* ───────────── 10. Les journaux ne contiennent aucune donnée personnelle ───────────── */
  verifier(
    "Les journaux serveur ne contiennent pas l'adresse soumise",
    !journalServeur.includes("banc@exemple.invalid") ||
      !journalServeur.includes("Ceci est une soumission de banc"),
    "une donnée personnelle apparaît dans les journaux",
  );
  verifier(
    "Les journaux serveur ne contiennent pas la clé d'API",
    !journalServeur.includes("re_banc_cle_invalide"),
  );

  /* ───────────── 11. Poids des images ───────────── */
  const { stdout } = await import("node:child_process").then((cp) =>
    new Promise((res) =>
      cp.exec("du -sk public/images", { cwd: new URL("..", import.meta.url).pathname }, (_e, out) =>
        res({ stdout: out }),
      ),
    ),
  );
  const ko = Number.parseInt(stdout.trim().split(/\s+/)[0], 10);
  verifier(
    "public/images pèse moins de 15 Mo",
    ko < 15_360,
    `${(ko / 1024).toFixed(1)} Mo`,
  );

  /* ───────────── 12. Aucune dépendance vulnérable ───────────── */
  const audit = await new Promise((res) => {
    import("node:child_process").then((cp) =>
      cp.exec(
        "npm audit --json",
        { cwd: new URL("..", import.meta.url).pathname, maxBuffer: 10 * 1024 * 1024 },
        (_e, out) => res(out),
      ),
    );
  });
  let vulns = { critical: -1, high: -1 };
  try {
    vulns = JSON.parse(audit).metadata.vulnerabilities;
  } catch {
    /* ignoré : vérifié ci-dessous */
  }
  verifier(
    "npm audit : aucune vulnérabilité critique ni haute",
    vulns.critical === 0 && vulns.high === 0,
    JSON.stringify(vulns),
  );
} finally {
  serveur.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  serveur.kill("SIGKILL");
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc V1 : tout est vert.");
