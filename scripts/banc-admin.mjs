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
import { demarrer, urlMigrateur, urlApplication, urlAuth, baseVierge } from "./pg-dev.mjs";
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
      DATABASE_URL_AUTH: urlAuth(base),
      JOKSWED_CHIFFREMENT_CLE: Buffer.alloc(32, 7).toString("base64"),
      /* ⚠️ FOURNISSEUR SIMULÉ : aucun message réel ne peut partir, même si une
         clé Brevo traînait dans l'environnement. */
      EMAIL_FOURNISSEUR: "simule",
      CRON_SECRET: "banc-cron-secret-0123456789",
      SITE_URL: BASE,
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

  /* ═══════════ 9. V4 — PARCOURS COMPLET D'UNE DEMANDE ═══════════ */
  const soumettre = (corps, cle) =>
    fetch(`${BASE}/api/contact`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cle ? { "idempotency-key": cle } : {}),
      },
      body: JSON.stringify(corps),
    });

  const demandeClient = {
    noms: "Couple & Essai",
    email: "couple@exemple.invalid",
    telephone: "06 11 22 33 44",
    date: "2028-06-17",
    lieu: "Château d'Essai",
    message: "Nous aimerions un reportage complet, et peut-être une vidéo.",
    formule: "formule-3",
    supplements: ["videaste", "seance-engagement", "album-supplementaire"],
    consentement: true,
    consentementPartenaire: true,
  };

  const envoi = await soumettre(demandeClient, "banc-v4-parcours");
  const corpsEnvoi = await envoi.json().catch(() => ({}));
  v("Le formulaire public enregistre la demande (200)",
    envoi.status === 200 && corpsEnvoi.ok === true, `HTTP ${envoi.status}`);
  v("Une référence DEM-AAAA-NNNN est rendue",
    /^DEM-\d{4}-\d{4}$/.test(corpsEnvoi.reference ?? ""), corpsEnvoi.reference);

  /* La demande existe-t-elle VRAIMENT en base ? On le constate depuis la
     connexion propriétaire, pas depuis la réponse HTTP. */
  const verite2 = new pg.Client({ connectionString: urlMigrateur(base) });
  await verite2.connect();
  const enBase = await verite2.query(
    "SELECT * FROM demandes WHERE reference = $1", [corpsEnvoi.reference]);
  v("La demande est réellement persistée en base", enBase.rowCount === 1);
  v("Les coordonnées sont enregistrées",
    enBase.rows[0]?.contact_email === "couple@exemple.invalid"
      && enBase.rows[0]?.contact_telephone === "06 11 22 33 44");
  /* ⚠️ On interroge la date EN TEXTE. Le client `pg` de ce banc n'a pas le
     parseur d'OID 1082 que pose lib/db/client.ts : il rendrait un `Date` à
     minuit local, et l'assertion jugerait le fuseau du banc, pas la valeur
     stockée. */
  const dateTexte = await verite2.query(
    "SELECT to_char(date_mariage,'YYYY-MM-DD') d FROM demandes WHERE id = $1",
    [enBase.rows[0].id]);
  v("La date du mariage est stockée sans décalage",
    dateTexte.rows[0].d === "2028-06-17", dateTexte.rows[0].d);
  v("La vidéo demandée est enregistrée", enBase.rows[0]?.video_demandee === true);
  v("L'instantané du catalogue est conservé",
    typeof enBase.rows[0]?.instantane === "object"
      && Array.isArray(enBase.rows[0].instantane.lignes)
      && enBase.rows[0].instantane.lignes.length >= 3);

  const lignes = await verite2.query(
    "SELECT * FROM demande_lignes WHERE demande_id = $1 ORDER BY ordre", [enBase.rows[0].id]);
  const incluse = lignes.rows.find((l) => l.cle === "seance-engagement");
  v("La séance engagement, incluse dans la Formule 3, est marquée `inclus`",
    incluse?.compatibilite === "inclus", incluse?.compatibilite);
  v("…et son prix est NUL, pas zéro — elle ne sera jamais facturée",
    incluse?.prix_cents === null, String(incluse?.prix_cents));
  const formuleLigne = lignes.rows.find((l) => l.type === "formule");
  v("Le prix de la formule est figé en centimes",
    formuleLigne?.prix_cents === 160000, String(formuleLigne?.prix_cents));

  const cons = await verite2.query(
    "SELECT finalite, accorde, texte_version FROM consentements WHERE demande_id = $1",
    [enBase.rows[0].id]);
  v("Les deux consentements sont enregistrés séparément", cons.rowCount === 2);
  v("Le texte exact soumis est conservé",
    cons.rows.every((c) => (c.texte_version ?? "").length > 20));

  /* ── La collaboration vidéo est ENREGISTRÉE mais NON TRANSMISE ── */
  const prop = await verite2.query(
    "SELECT * FROM propositions WHERE demande_id = $1", [enBase.rows[0].id]);
  v("Une proposition vidéo est créée automatiquement", prop.rowCount === 1);
  v("⚠️ Elle n'est PAS transmise : envoyee_le est nul",
    prop.rows[0]?.envoyee_le === null && prop.rows[0]?.statut === "preparee",
    `statut=${prop.rows[0]?.statut}, envoyee_le=${prop.rows[0]?.envoyee_le}`);

  /* ── L'événement naît avec la demande, et la notification en découle ── */
  const ev = await verite2.query(
    "SELECT * FROM evenements WHERE cle_idempotence = $1",
    [`demande.recue:${enBase.rows[0].id}`]);
  v("Un événement a été écrit dans la même transaction", ev.rowCount === 1);
  v("L'événement a été traité par le drain", ev.rows[0]?.traite_le !== null);

  const notifs = await verite2.query(
    "SELECT * FROM notifications WHERE cle_idempotence = $1",
    [`demande.recue:${enBase.rows[0].id}`]);
  v("Une notification interne est posée", notifs.rowCount >= 1);
  v("La notification ne contient ni nom, ni date, ni montant",
    notifs.rows.every((n) =>
      !`${n.titre} ${n.corps ?? ""}`.includes("Couple")
      && !`${n.titre} ${n.corps ?? ""}`.includes("2028")
      && !`${n.titre} ${n.corps ?? ""}`.includes("600")),
    JSON.stringify(notifs.rows.map((n) => `${n.titre} / ${n.corps}`)));

  /* ── Idempotence : même clé, une seule demande ── */
  const rejeu = await soumettre(demandeClient, "banc-v4-parcours");
  const corpsRejeu = await rejeu.json().catch(() => ({}));
  const compte = await verite2.query(
    "SELECT count(*)::int n FROM demandes WHERE cle_idempotence = 'banc-v4-parcours'");
  v("Une soumission répétée ne crée pas de seconde demande",
    compte.rows[0].n === 1 && corpsRejeu.rejeu === true,
    `${compte.rows[0].n} demande(s), rejeu=${corpsRejeu.rejeu}`);
  const notifsApres = await verite2.query(
    "SELECT count(*)::int n FROM notifications WHERE cle_idempotence = $1",
    [`demande.recue:${enBase.rows[0].id}`]);
  v("…ni de notification en double",
    notifsApres.rows[0].n === notifs.rowCount, `${notifsApres.rows[0].n}`);

  /* ── La demande apparaît dans l'administration ── */
  const liste = await proprio.fetch("/admin/demandes");
  const htmlListe = await liste.text();
  v("La demande apparaît dans /admin/demandes",
    liste.status === 200 && htmlListe.includes(corpsEnvoi.reference), `HTTP ${liste.status}`);
  v("Le nom du couple est visible dans la liste", htmlListe.includes("Couple &amp; Essai")
    || htmlListe.includes("Couple & Essai"));

  const fiche = await proprio.fetch(`/admin/demandes/${enBase.rows[0].id}`);
  const htmlFiche = await fiche.text();
  v("La fiche complète s'ouvre", fiche.status === 200, `HTTP ${fiche.status}`);
  v("La fiche montre l'e-mail et le téléphone",
    htmlFiche.includes("couple@exemple.invalid") && htmlFiche.includes("06 11 22 33 44"));
  v("La fiche montre la formule et son prix figé",
    htmlFiche.includes("Formule 3") && htmlFiche.replace(/[  ]/g, " ").includes("1 600 €"));
  v("La fiche signale la séance engagement comme incluse et non facturée",
    htmlFiche.includes("Incluse dans la formule"));
  v("La fiche signale que rien n'a été transmis au vidéaste",
    htmlFiche.includes("Préparée — non transmise")
      || htmlFiche.includes("Pr&#x27;éparée") || htmlFiche.includes("non transmise"));
  v("Aucun bouton de devis/contrat n'est présenté comme opérationnel",
    !/Générer (le |un )?(devis|contrat|facture)/i.test(htmlFiche));

  /* ── Cloisonnement : le vidéaste ne doit PAS voir cette demande ──
     ⚠️ Son compte a été DÉSACTIVÉ par l'épreuve n° 6. Le laisser ainsi ferait
     échouer les contrôles qui suivent pour une raison étrangère à ce qu'ils
     vérifient : on obtiendrait une redirection de connexion, pas un refus
     d'accès. On le réactive et on rouvre une session. */
  await verite2.query("UPDATE utilisateurs SET desactive_le = NULL WHERE id = $1",
    [fixtures.utilisateurs.videaste]);
  /* ⚠️ ET ON PURGE LES TENTATIVES DE CONNEXION.
     L'épreuve n° 7 en a volontairement accumulé douze depuis la même IP pour
     déclencher le blocage. Sans purge, la reconnexion ci-dessous est refusée
     pour « trop de tentatives » — et les contrôles de cloisonnement qui
     suivent échoueraient sur une redirection de connexion, pas sur un refus
     d'accès. Un banc doit échouer pour la bonne raison. */
  await verite2.query("DELETE FROM tentatives_connexion");

  const video2 = navigateur();
  await seConnecter(video2, "videaste@exemple.invalid", fixtures.motDePasse);
  v("Le vidéaste peut rouvrir une session après réactivation",
    video2.cookies.has(NOM_SESSION), [...video2.cookies.keys()].join(",") || "aucun cookie");

  const listeVideo = await video2.fetch("/admin/demandes");
  const htmlVideo2 = await listeVideo.text();
  /* ⚠️ ON VÉRIFIE D'ABORD LE STATUT.
     Sans cela, une redirection (0 octet de contenu) satisferait les deux
     assertions suivantes : le test passerait À VIDE, en prouvant seulement
     que le vidéaste n'a rien vu du tout. */
  v("Le vidéaste accède bien à SA liste de demandes",
    listeVideo.status === 200, `HTTP ${listeVideo.status}`);
  v("Le vidéaste ne voit pas la demande de JoksWed dans sa liste",
    !htmlVideo2.includes(corpsEnvoi.reference) && !htmlVideo2.includes("couple@exemple.invalid"));

  const ficheVolee = await video2.fetch(`/admin/demandes/${enBase.rows[0].id}`);
  v("Le vidéaste attaquant l'URL directe de la fiche obtient un 404",
    ficheVolee.status === 404, `HTTP ${ficheVolee.status}`);

  /* ── Droits d'écriture : l'assistant ne peut pas modifier ── */
  const ficheAssistant = await assistant.fetch(`/admin/demandes/${enBase.rows[0].id}`);
  if (ficheAssistant.status === 200) {
    const htmlA = await ficheAssistant.text();
    v("L'assistant voit la fiche mais sans formulaire de modification",
      !htmlA.includes('name="statut"') && !htmlA.includes('name="complements"'));
  } else {
    v("L'assistant voit la fiche mais sans formulaire de modification",
      [302, 303, 307].includes(ficheAssistant.status),
      `HTTP ${ficheAssistant.status}`);
  }

  /* ── Une demande sans consentement obligatoire est refusée AVANT la base ── */
  const avantRefus = await verite2.query("SELECT count(*)::int n FROM demandes");
  const sansConsentement2 = await soumettre(
    { ...demandeClient, consentement: false }, "banc-v4-sans-consentement");
  const apresRefus2 = await verite2.query("SELECT count(*)::int n FROM demandes");
  v("Sans consentement : 422 et AUCUNE écriture en base",
    sansConsentement2.status === 422 && apresRefus2.rows[0].n === avantRefus.rows[0].n,
    `HTTP ${sansConsentement2.status}, ${avantRefus.rows[0].n} → ${apresRefus2.rows[0].n}`);


  /* ═══════════ 10. V4.1 — E-MAILS, FILE PÉRIODIQUE, LIMITE PERSISTANTE ═══════════ */

  /* ── Les envois sont journalisés, avec leur statut ──
     ⚠️ `envois_email` EST EN `FORCE ROW LEVEL SECURITY`.
     Même la connexion propriétaire n'y lit rien sans identité — c'est
     précisément ce qu'on veut. Le banc pose donc une vraie session, comme le
     ferait l'application, au lieu de contourner la politique. Lire la vérité
     ne doit pas demander de désactiver la protection qu'on éprouve. */
  await verite2.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,'banc-admin-lecture', now() + interval '1 day', true)
     ON CONFLICT (jeton_hache) DO NOTHING`, [fixtures.utilisateurs.proprietaire]);

  const lireAvecIdentite = async (texte, valeurs = []) => {
    await verite2.query("BEGIN");
    try {
      await verite2.query("SELECT set_config('app.session_jeton','banc-admin-lecture', true)");
      const r = await verite2.query(texte, valeurs);
      await verite2.query("COMMIT");
      return r;
    } catch (e) { await verite2.query("ROLLBACK"); throw e; }
  };

  const envois = await lireAvecIdentite(
    `SELECT gabarit, destinataire, statut, fournisseur, sujet
       FROM envois_email WHERE demande_id = $1 ORDER BY gabarit`,
    [enBase.rows[0].id]);
  v("Un accusé de réception est journalisé pour le couple",
    envois.rows.some((e) => e.gabarit === "accuse_reception"
      && e.destinataire === "couple@exemple.invalid"),
    JSON.stringify(envois.rows.map((e) => `${e.gabarit}/${e.destinataire}/${e.statut}`)));
  v("Une alerte est journalisée pour l'équipe",
    envois.rows.some((e) => e.gabarit === "alerte_administrateur"));
  v("Les envois passent par le fournisseur SIMULÉ, jamais Brevo",
    envois.rows.every((e) => e.fournisseur === "simule"),
    envois.rows.map((e) => e.fournisseur).join(","));
  v("Aucun message n'a été adressé au vidéaste",
    !envois.rows.some((e) => e.destinataire === "videaste@exemple.invalid"));

  /* ── Le contenu : l'accusé ne promet pas une réservation ── */
  const { accuseReception, alerteAdministrateur } = await import("../lib/email/gabarits.ts");
  const accuse = accuseReception({
    prenoms: "Couple & Essai", reference: "DEM-TEST-0001",
    dateMariage: "17 juin 2028", formule: "Formule 3",
  });
  v("L'accusé de réception ne promet PAS une réservation",
    /n'est pas encore réservée/.test(accuse.html) && /pas encore réservée/.test(accuse.texte));
  v("L'accusé porte une version texte complète",
    accuse.texte.includes("DEM-TEST-0001") && accuse.texte.length > 200);
  v("L'accusé reprend l'identité JoksWed", accuse.html.includes("Joks<em>Wed</em>"));

  const alerte = alerteAdministrateur({
    reference: "DEM-TEST-0001", ville: "Dangu", dateMariage: "17 juin 2028",
    videoDemandee: true, lien: `${BASE}/admin/demandes/x`,
  });
  v("L'alerte administrateur ne contient AUCUNE coordonnée client",
    !alerte.html.includes("@") || !/couple@|mariageramos|@exemple\.invalid/.test(alerte.html),
    "une adresse client y figure");
  v("L'alerte renvoie vers l'espace authentifié",
    alerte.html.includes("/admin/demandes/"));

  /* ── Brevo en panne : la demande survit, l'envoi est repris ── */
  const avantPanne = await verite2.query("SELECT count(*)::int n FROM demandes");
  /* On remet l'événement en file et on simule une panne du fournisseur. */
  await verite2.query("UPDATE evenements SET traite_le = NULL, disponible_le = now()");
  const cronPanne = await fetch(`${BASE}/api/cron/drain`, {
    headers: { authorization: "Bearer banc-cron-secret-0123456789",
               "x-simuler-panne": "1" },
  });
  v("L'endpoint périodique répond à un appel autorisé", cronPanne.status === 200,
    `HTTP ${cronPanne.status}`);

  const apresPanne = await verite2.query("SELECT count(*)::int n FROM demandes");
  v("Une panne d'envoi ne fait disparaître AUCUNE demande",
    apresPanne.rows[0].n === avantPanne.rows[0].n,
    `${avantPanne.rows[0].n} → ${apresPanne.rows[0].n}`);

  /* ── L'endpoint périodique est protégé ── */
  const cronNu = await fetch(`${BASE}/api/cron/drain`);
  v("L'endpoint périodique refuse un appel sans secret", cronNu.status === 401,
    `HTTP ${cronNu.status}`);
  const cronFaux = await fetch(`${BASE}/api/cron/drain`, {
    headers: { authorization: "Bearer mauvais-secret-0123456789" } });
  v("…et un secret erroné", cronFaux.status === 401, `HTTP ${cronFaux.status}`);

  /* ── Concurrence : deux drains simultanés ne se marchent pas dessus ── */
  await verite2.query("UPDATE evenements SET traite_le = NULL, disponible_le = now()");
  const [a, b] = await Promise.all([
    fetch(`${BASE}/api/cron/drain`, { headers: { authorization: "Bearer banc-cron-secret-0123456789" } }),
    fetch(`${BASE}/api/cron/drain`, { headers: { authorization: "Bearer banc-cron-secret-0123456789" } }),
  ]);
  const [ja, jb] = [await a.json(), await b.json()];
  v("Deux drains concurrents : l'un travaille, l'autre renonce",
    (ja.verrouille === true) !== (jb.verrouille === true)
      || (ja.pris === 0 || jb.pris === 0),
    `A: pris=${ja.pris} verrouille=${ja.verrouille} · B: pris=${jb.pris} verrouille=${jb.verrouille}`);

  /* ⚠️ ON GROUPE PAR DESTINATAIRE *ET* PAR CLÉ.
     L'unicité porte sur le couple : deux membres différents reçoivent
     légitimement la même notification pour la même demande. Grouper sur la
     seule clé comptait cela comme un doublon — le banc accusait le code
     d'une faute qu'il ne commettait pas. */
  const doublons = await verite2.query(
    `SELECT destinataire_id, cle_idempotence, count(*)::int n FROM notifications
      GROUP BY destinataire_id, cle_idempotence HAVING count(*) > 1`);
  v("Aucune notification en double après plusieurs passages",
    doublons.rowCount === 0, `${doublons.rowCount} clé(s) dupliquée(s)`);

  /* ── Historique des tentatives et relance ── */
  const tentatives = await verite2.query(
    "SELECT max(tentatives)::int n FROM evenements WHERE traite_le IS NOT NULL");
  v("Le nombre de tentatives est historisé", tentatives.rows[0].n >= 1,
    `${tentatives.rows[0].n}`);

  /* ── Limitation de débit persistante ── */
  const limiteBase = await verite2.query("SELECT count(*)::int n FROM limites_debit");
  v("La limitation de débit vit en base, plus en mémoire",
    limiteBase.rows[0].n > 0, `${limiteBase.rows[0].n} compteur(s)`);

  /* Même adresse e-mail, quatre envois : le quatrième est refusé. */
  let refuseEmail = false;
  for (let i = 0; i < 5; i += 1) {
    const r = await soumettre(
      { ...demandeClient, email: "insistant@exemple.invalid", message: `essai ${i}` },
      `banc-limite-email-${i}`);
    if (r.status === 429) { refuseEmail = true; break; }
  }
  v("Trop de demandes depuis la MÊME adresse e-mail → 429", refuseEmail);

  /* ⚠️ Et le point qui compte : une AUTRE adresse derrière la même IP passe
     encore. Sans cela, un opérateur mobile entier serait bloqué. */
  const autreClient = await soumettre(
    { ...demandeClient, email: "autre.couple@exemple.invalid", message: "autre couple" },
    "banc-limite-autre-email");
  v("…mais une AUTRE adresse derrière la même IP passe encore",
    autreClient.status === 200, `HTTP ${autreClient.status}`);

  /* ── Aucune donnée personnelle dans les journaux ── */
  v("Les journaux ne contiennent pas l'adresse du couple",
    !journal.includes("couple@exemple.invalid"));
  v("Les journaux ne contiennent pas le message du client",
    !journal.includes("Nous aimerions un reportage complet"));

  await verite2.end();
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
