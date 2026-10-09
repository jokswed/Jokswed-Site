/* =============================================================================
   BANC V1 — ÉPREUVE RÉELLE DU SITE CONSTRUIT
   -----------------------------------------------------------------------------
   Démarre `next start` sur un port dédié, puis éprouve le site tel qu'il est
   servi. Pas de simulation : les requêtes passent par le vrai serveur.

   ⚠️ AUCUN E-MAIL N'EST ENVOYÉ, ET AUCUNE BASE N'EST JOIGNABLE.
      Depuis la V4, la route n'envoie plus d'e-mail : elle écrit en base. Ce
      banc tourne volontairement sans base, pour éprouver le site public seul
      et vérifier qu'il REFUSE une demande qu'il ne peut pas enregistrer,
      plutôt que de prétendre l'avoir reçue.

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
    /* ⚠️ AUCUNE CHAÎNE DE BASE N'EST FOURNIE, ET C'EST LE SUJET DU §8.
       Ce banc éprouve le site public SEUL. Le parcours avec base est couvert
       par `npm run test:admin`. */
    /* Le banc enchaîne une quinzaine d'envois depuis une seule adresse : avec
       la limite de production (5), tout ce qui suit le premier test de
       validation recevrait un 429 sans rapport avec ce qu'il vérifie.
       La limitation elle-même reste éprouvée, à cette valeur-ci. */
    CONTACT_LIMITE: "12",
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

  /* ───────────── 8. Validation complète → tentative d'ENREGISTREMENT ─────────────
     ⚠️ CE BLOC A ÉTÉ RE-POINTÉ EN V4.

     Il vérifiait auparavant qu'une soumission valide atteignait le fournisseur
     d'e-mail (502 avec une clé invalide). La route n'envoie plus d'e-mail :
     elle écrit en base, et la notification part d'une file d'événements.

     Ce banc tourne SANS base de données — c'est voulu : il éprouve le site
     public isolément. La bonne assertion devient donc « sans base joignable,
     le site REFUSE la demande au lieu de prétendre l'avoir reçue ». Un faux
     accusé de réception est le pire des échecs : le couple croit sa demande
     partie, et elle n'existe nulle part.

     Le parcours complet avec base est éprouvé par `npm run test:admin`. */
  const jusquAuBout = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { ...ORIGINE, "Idempotency-Key": "banc-idempotence-1" },
    body: JSON.stringify(demandeValide),
  });
  const corpsBout = await jusquAuBout.json().catch(() => ({}));
  verifier(
    "Sans base joignable, une soumission valide est REFUSÉE (503)",
    jusquAuBout.status === 503,
    `HTTP ${jusquAuBout.status}`,
  );
  verifier(
    "…et le site ne prétend PAS avoir reçu la demande",
    corpsBout.ok === false && /n'a pas pu être enregistrée/.test(corpsBout.message ?? ""),
    JSON.stringify(corpsBout).slice(0, 120),
  );
  verifier(
    "La réponse d'erreur ne divulgue ni fournisseur ni détail technique",
    !JSON.stringify(corpsBout).toLowerCase().includes("resend") &&
      !JSON.stringify(corpsBout).toLowerCase().includes("postgres") &&
      !JSON.stringify(corpsBout).toLowerCase().includes("database"),
  );

  /* ⚠️ CES TROIS ENVOIS PASSENT AVANT LE TEST DE LIMITATION DE DÉBIT.

     Le limiteur compte par IP tronquée, et tout le banc sort de 127.0.0.1 :
     une fois le quota saturé par le test du 429, tout envoi suivant reçoit un
     429 — ce qui faisait échouer ces trois-là pour une raison qui n'avait
     rien à voir avec ce qu'ils vérifient. L'ordre fait partie du banc. */
  /* ── Suppléments : la règle anti-double-facturation, côté SERVEUR ──
     On envoie la Formule 3 AVEC la séance engagement, qu'elle comprend déjà.
     La route doit l'accepter sans la compter comme une ligne vendue. */
  const avecIncluse = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { ...ORIGINE, "Idempotency-Key": "banc-v2-incluse" },
    body: JSON.stringify({
      ...demandeValide,
      formule: "formule-3",
      supplements: ["seance-engagement", "videaste"],
    }),
  });
  verifier(
    "Formule 3 + séance engagement : la validation est franchie (503 = base absente)",
    avecIncluse.status === 503,
    `HTTP ${avecIncluse.status}`,
  );

  /* Une clé inventée ne doit ni passer, ni faire tomber la route. */
  const cleInventee = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { ...ORIGINE, "Idempotency-Key": "banc-v2-inventee" },
    body: JSON.stringify({
      ...demandeValide,
      formule: "formule-1",
      supplements: ["supplement-qui-nexiste-pas", "../../etc/passwd"],
    }),
  });
  verifier(
    "Une clé de supplément inventée est ignorée sans erreur 500",
    cleInventee.status === 503,
    `HTTP ${cleInventee.status}`,
  );

  /* Une formule inventée ne doit pas se retrouver dans l'e-mail. */
  const formuleInventee = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { ...ORIGINE, "Idempotency-Key": "banc-v2-formule" },
    body: JSON.stringify({ ...demandeValide, formule: "<script>alert(1)</script>" }),
  });
  verifier(
    "Une formule inventée est ignorée sans erreur 500",
    formuleInventee.status === 503,
    `HTTP ${formuleInventee.status}`,
  );


  /* ───────────── 9. Limitation de débit ───────────── */
  let vu429 = false;
  for (let i = 0; i < 20; i += 1) {
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
  verifier("Soumissions répétées → 429 (limite configurée : 12)", vu429);

  /* ───────────── 10. Les journaux ne contiennent aucune donnée personnelle ───────────── */
  verifier(
    "Les journaux serveur ne contiennent pas l'adresse soumise",
    !journalServeur.includes("banc@exemple.invalid") ||
      !journalServeur.includes("Ceci est une soumission de banc"),
    "une donnée personnelle apparaît dans les journaux",
  );
  verifier(
    "Les journaux serveur ne contiennent pas de détail d'infrastructure",
    !journalServeur.includes("postgres://") && !journalServeur.includes("jokswed_app"),
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

  /* ═════════════════════════ V2 — PAGE D'ACCUEIL ═════════════════════════ */
  const home = await (await fetch(BASE)).text();
  const normal = (s) => s.replace(/[   ]/g, " ");

  /* La bande : la série doit être présente DEUX FOIS, pas trois.
     C'est la condition arithmétique du raccord invisible (translation
     de -50 % = une série entière). */
  const occurrences = (motif) => (home.match(motif) ?? []).length;
  verifier(
    "La bande duplique la série exactement une fois",
    occurrences(/class="bande__photo"/g) === 24,
    `${occurrences(/class="bande__photo"/g)} photos rendues (12 × 2 attendues)`,
  );
  verifier("La bande est rendue côté serveur", home.includes("bande__piste"));

  /* Les trois formules, sur l'accueil, avec leur prix TTC. */
  verifier(
    "Les trois formules sont sur l'accueil",
    ["1 000", "1 300", "1 600"].every((p) => normal(home).includes(p)),
  );
  verifier(
    "Chaque formule porte un bouton de sélection",
    occurrences(/Choisir cette formule/g) === 3,
    `${occurrences(/Choisir cette formule/g)} boutons`,
  );
  verifier("Le bouton d'appel à l'action demandé est présent",
    home.includes("Vérifier ma date et faire une demande"));
  verifier("Le formulaire est sur l'accueil", home.includes('id="demande"'));
  verifier("La FAQ est sur l'accueil", home.includes('id="faq"'));

  /* Le vidéaste : son texte, et surtout PAS ses coordonnées. */
  verifier(
    "Le nouveau texte du vidéaste est publié",
    home.includes("films de mariage de 3 à 5 minutes"),
  );
  verifier("La carte vidéaste est rendue", home.includes("Ajouter un vidéaste à mon mariage"));
  verifier(
    "Les coordonnées du vidéaste ne sont PAS publiées",
    !home.includes("cretinoiry") && !normal(home).includes("07 60 10 26 29"),
  );
  verifier(
    "L'aperçu vidéo absent est signalé, pas simulé",
    home.includes("videaste__attente") && !home.includes("<video"),
  );

  /* Données structurées des offres. */
  verifier(
    "Les trois formules sont balisées en Offer",
    (home.match(/"@type":"Offer"/g) ?? []).length === 3,
  );

  /* Les anciennes pages continuent de fonctionner : non-régression. */
  for (const chemin of ["/tarifs", "/faq", "/portfolio", "/a-propos", "/contact"]) {
    const r = await fetch(`${BASE}${chemin}`);
    verifier(`Non-régression : ${chemin} répond 200`, r.status === 200, `HTTP ${r.status}`);
  }
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
