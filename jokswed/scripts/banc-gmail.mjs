/* =============================================================================
   BANC GMAIL — ENVOYER DEPUIS SA PROPRE BOÎTE
   -----------------------------------------------------------------------------
   ⚠️ AUCUN APPEL À GOOGLE. Ce banc n'a ni identifiants OAuth ni réseau vers
   Google, et il n'en a pas besoin : ce qui peut casser ici, c'est le message
   qu'on compose, la portée qu'on demande, le choix du fournisseur et ce que la
   base accepte de rendre. L'aller-retour avec Google, lui, se vérifie une fois
   à la main, le jour de la connexion.
   ============================================================================= */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import pg from "pg";
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

import { demarrer, urlMigrateur, urlApplication, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";

const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
};

process.env.JOKSWED_CHIFFREMENT_CLE ??= Buffer.alloc(32, 9).toString("base64");

const { composerMime } = await import("../lib/gmail/envoi.ts");
const { PORTEES, gmailConfigure, adresseRetour, urlAutorisation } =
  await import("../lib/gmail/oauth.ts");
const { chiffrer, dechiffrer } = await import("../lib/auth/secrets.ts");

const pgdev = await demarrer();
let mig;
try {
  /* ═══════════ A. LA PORTÉE DEMANDÉE ═══════════ */
  /* ⚠️ C'EST LA DÉCISION LA PLUS COÛTEUSE DU LOT. Une portée de LECTURE
     (`gmail.readonly`, `gmail.modify`) est « restreinte » : Google exige alors
     une évaluation de sécurité tierce, renouvelée chaque année. Ce banc existe
     pour qu'on ne l'ajoute pas par inadvertance. */
  v("A1. une seule portée Gmail est demandée",
    PORTEES.filter((p) => p.includes("gmail")).length === 1,
    PORTEES.join(" "));
  v("A2. ⚠️ et c'est l'ENVOI, jamais la lecture",
    PORTEES.includes("https://www.googleapis.com/auth/gmail.send")
    && !PORTEES.some((p) => /readonly|modify|compose|full|mail\.google\.com/.test(p)));
  v("A3. aucune portée ne permet de supprimer du courrier",
    !PORTEES.some((p) => p.includes("mail.google.com")));

  /* ═══════════ B. L'URL D'AUTORISATION ═══════════ */
  process.env.GOOGLE_CLIENT_ID = "identifiant-de-banc";
  process.env.GOOGLE_CLIENT_SECRET = "secret-de-banc";
  process.env.SITE_URL = "https://jokswed.com";
  v("B1. Google est vu comme configuré quand les deux clés existent",
    gmailConfigure() === true);
  v("B2. l'adresse de retour est absolue et sous /api/admin/gmail",
    adresseRetour() === "https://jokswed.com/api/admin/gmail/callback",
    adresseRetour());
  const url = urlAutorisation("etat-de-banc");
  /* ⚠️ SANS CES DEUX PARAMÈTRES, PAS DE JETON DE RAFRAÎCHISSEMENT, et l'envoi
     s'arrête tout seul une heure après la connexion. */
  v("B3. l'autorisation demande un accès hors ligne", url.includes("access_type=offline"));
  v("B4. …et force le consentement, pour obtenir le renouvellement",
    url.includes("prompt=consent"));
  v("B5. l'état anti-CSRF est transmis", url.includes("state=etat-de-banc"));
  v("B6. le secret client ne part JAMAIS dans l'URL d'autorisation",
    !url.includes("secret-de-banc"));

  /* ═══════════ C. LE MESSAGE COMPOSÉ ═══════════ */
  const mime = composerMime({
    de: { email: "jokswed@gmail.com", nom: "John — JoksWed" },
    pour: { email: "gabriel@exemple.invalid", nom: "Gabriel & Jimmy" },
    repondreA: "rep+abc123@reply.jokswed.com",
    sujet: "Votre mariage du 12 mai — séance engagement",
    texte: "Bonjour Gabriel,\n\nAvec plaisir.\n\nJohn",
    html: "<p>Bonjour Gabriel,</p><p>Avec plaisir.</p>",
    pieces: [{ nom: "devis.pdf", contenu: Buffer.from("%PDF-1.4 faux"), type: "application/pdf" }],
    threadId: "fil-gmail-1",
    inReplyTo: "<ancre@exemple.invalid>",
    references: "<ancre@exemple.invalid>",
  });
  v("C1. l'expéditeur est la boîte connectée", /^From: .*<jokswed@gmail\.com>/m.test(mime));
  v("C2. le destinataire est le client", /^To: .*<gabriel@exemple\.invalid>/m.test(mime));
  /* ⚠️ LE POINT LE PLUS IMPORTANT DU LOT.
     Le `Reply-To` doit pointer l'adresse à jeton, et surtout PAS la boîte
     Gmail : la réception passe par le webhook entrant. Dirigée vers Gmail, la
     réponse sortirait de la plateforme sans jamais y revenir. */
  v("C3. ⚠️ la réponse revient par l'adresse à jeton, pas vers Gmail",
    /^Reply-To: rep\+abc123@reply\.jokswed\.com$/m.test(mime)
    && !/^Reply-To: .*gmail\.com/m.test(mime));
  v("C4. le fil est tenu pour les clients qui ne sont pas sur Gmail",
    /^In-Reply-To: <ancre@exemple\.invalid>$/m.test(mime)
    && /^References: <ancre@exemple\.invalid>$/m.test(mime));
  /* Un en-tête ne porte que de l'ASCII : « séance » brut arrive haché. */
  v("C5. le sujet accentué est encodé selon la RFC 2047",
    /^Subject: =\?UTF-8\?B\?/m.test(mime) && !/^Subject: .*séance/m.test(mime));
  v("C6. le corps existe en texte ET en HTML",
    mime.includes("multipart/alternative")
    && mime.includes('Content-Type: text/plain; charset="UTF-8"')
    && mime.includes('Content-Type: text/html; charset="UTF-8"'));
  v("C7. la pièce jointe est attachée avec son nom et son type",
    mime.includes("multipart/mixed")
    && mime.includes('filename="devis.pdf"')
    && mime.includes("Content-Type: application/pdf"));
  v("C8. les lignes se terminent en CRLF, comme l'exige la RFC 822",
    mime.includes("\r\n") && !/[^\r]\n/.test(mime));

  const nu = composerMime({
    de: { email: "a@b.c" }, pour: { email: "d@e.f" },
    sujet: "Sans rien", texte: "t", html: "<p>t</p>",
  });
  v("C9. sans pièce jointe, pas d'enveloppe mixte inutile",
    !nu.includes("multipart/mixed") && nu.includes("multipart/alternative"));
  v("C10. sans adresse de réponse, pas d'en-tête vide",
    !/^Reply-To:/m.test(nu));

  /* ═══════════ D. CE QUE LA BASE ACCEPTE DE RENDRE ═══════════ */
  const base = await baseVierge("jokswed_gmail");
  await migrer(urlMigrateur(base), { silencieux: true });
  mig = new pg.Client({ connectionString: urlMigrateur(base) });
  await mig.connect();

  const { rows: fn } = await mig.query(`
    SELECT p.proname, pg_get_function_result(p.oid) res
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app' AND p.proname LIKE 'gmail%' ORDER BY 1`);
  v("D1. les sept fonctions Gmail existent", fn.length === 7,
    fn.map((f) => f.proname).join(", "));

  /* ⚠️ L'ÉCRAN DE RÉGLAGES NE DOIT JAMAIS POUVOIR LIRE UN JETON. */
  const etat = fn.find((f) => f.proname === "gmail_etat");
  v("D2. ⚠️ `gmail_etat` ne rend aucun jeton",
    Boolean(etat) && !/jeton/.test(etat.res), etat?.res);

  const { rows: col } = await mig.query(`
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'gmail_comptes' AND column_name LIKE 'jeton%'`);
  v("D3. les jetons sont stockés en binaire, donc chiffrés",
    col.length === 2 && col.every((c) => c.data_type === "bytea"),
    col.map((c) => `${c.column_name}:${c.data_type}`).join(" "));

  const { rows: rls } = await mig.query(
    "SELECT relrowsecurity r FROM pg_class WHERE relname = 'gmail_comptes'");
  v("D4. la table est sous politique de ligne", rls[0]?.r === true);

  /* Le rôle applicatif ne doit pas pouvoir lire les comptes d'un autre. */
  const app = new pg.Client({ connectionString: urlApplication(base) });
  await app.connect();
  const { rows: vide } = await app.query("SELECT count(*)::int n FROM gmail_comptes");
  v("D5. sans session, aucun compte Gmail visible", vide[0].n === 0);
  await app.end();

  /* ⚠️ LE FIL DOIT REMONTER JUSQU'AU DRAIN. `message_pour_envoi` ne rendait
     aucune colonne de threading : le drain lisait `undefined`, et chaque
     réponse ouvrait un fil neuf chez la cliente sans que rien ne le dise. */
  const { rows: mpe } = await mig.query(`
    SELECT pg_get_function_result(p.oid) res FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app' AND p.proname = 'message_pour_envoi'`);
  v("D6. ⚠️ `message_pour_envoi` rend le fil Gmail et les ancres RFC",
    /gmail_thread_id/.test(mpe[0]?.res ?? "")
    && /in_reply_to/.test(mpe[0]?.res ?? "")
    && /references_rfc/.test(mpe[0]?.res ?? ""));

  /* ═══════════ E. CHIFFREMENT ET FUITES ═══════════ */
  const secret = "1//0gRefreshTokenDeBancAbcdef";
  const paquet = chiffrer(secret);
  v("E1. un jeton chiffré ne contient pas son clair",
    !paquet.toString("latin1").includes("RefreshToken"));
  v("E2. …et se déchiffre à l'identique", dechiffrer(paquet) === secret);

  const sources = ["lib/gmail/oauth.ts", "lib/gmail/envoi.ts", "lib/gmail/compte.ts",
    "app/api/admin/gmail/callback/route.js"].map((f) => readFileSync(f, "utf8")).join("\n");
  v("E3. aucun jeton n'est journalisé",
    !/console\.(log|error|warn)\([^)]*jeton/i.test(sources));
  v("E4. le motif d'erreur de Google ne part pas dans l'URL de retour",
    !/gmail=\$\{.*erreur/.test(sources));

  /* ═══════════ F. LE CHOIX DU FOURNISSEUR ═══════════ */
  const drain = readFileSync("lib/demandes/drain.ts", "utf8");
  v("F1. le drain tente Gmail avant Brevo",
    drain.indexOf("compteGmailPourMessage") < drain.indexOf("dernier = await envoyer({"));
  v("F2. …et retombe sur Brevo plutôt que de ne rien envoyer",
    drain.includes("if (gmail) {") && drain.includes("dernier = await envoyer({"));
  v("F3. une autorisation perdue est inscrite, pas avalée",
    drain.includes("app.gmail_panne"));
  v("F4. le fil Gmail est conservé après l'envoi",
    drain.includes("app.gmail_fil_message"));
  const compte = readFileSync("lib/gmail/compte.ts", "utf8");
  v("F5. le jeton est renouvelé avant expiration, pas après",
    compte.includes("MARGE_MS") && compte.includes("expire - Date.now() > MARGE_MS"));
} finally {
  if (mig) await mig.end();
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves Gmail passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc Gmail : tout est vert.");
