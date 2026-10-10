/* =============================================================================
   BANC V7 — MESSAGERIE
   -----------------------------------------------------------------------------
   ⚠️ LA RÉCEPTION EST ÉPROUVÉE DE BOUT EN BOUT, AVEC UN VRAI SERVEUR.

   On lance Next, on compose un message depuis l'administration, on le fait
   partir par le drain (fournisseur SIMULÉ), on lit l'adresse de réponse
   dans le `Reply-To` du message qui SERAIT parti, et on rejoue une charge
   utile Brevo sur le vrai endpoint HTTP. La réponse doit réapparaître dans
   la conversation.

   Ce que ce banc NE prouve pas, et ne prétend pas prouver : qu'un e-mail
   arrive réellement chez Gmail, ni que les MX de Brevo pointent vers nous.
   Cela dépend d'un DNS et d'un compte fournisseur, pas du code.

   Aucun e-mail réel ne part : `EMAIL_FOURNISSEUR=simule`.
   ============================================================================= */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import pg from "pg";
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

import { demarrer, urlMigrateur, urlApplication, urlAuth, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const PORT = 3147;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET_ENTRANT = "secret-entrant-de-banc-0123456789";
const DOMAINE_REPONSE = "reply.jokswed.test";

const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
};

const jetons = new Map();
async function en(client, acteur, texte, valeurs = []) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.session_jeton',$1,true)", [jetons.get(acteur)]);
    const r = await client.query(texte, valeurs);
    await client.query("COMMIT");
    return r;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}
async function refuse(client, acteur, texte, valeurs = []) {
  try { await en(client, acteur, texte, valeurs); return null; }
  catch (e) { return e; }
}

const pgdev = await demarrer();
let app, verite, serveur = null, journal = "";
try {
  const base = await baseVierge("jokswed_v7");
  await migrer(urlMigrateur(base), { silencieux: true });
  const f = await semer(urlMigrateur(base), { silencieux: true });

  app = new pg.Client({ connectionString: urlApplication(base) });
  verite = new pg.Client({ connectionString: urlMigrateur(base) });
  for (const c of [app, verite]) { c.on("error", () => {}); await c.connect(); }

  const JK = f.entreprises.jokswed;
  const VD = f.entreprises.video;
  for (const [nom, id] of Object.entries(f.utilisateurs)) {
    const jeton = `v7-${nom}`;
    await verite.query(
      `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
       VALUES ($1,$2, now() + interval '1 day', true)`, [id, jeton]);
    jetons.set(id, jeton);
  }
  const PROPRIO = f.utilisateurs.proprietaire;
  const VIDEASTE = f.utilisateurs.videaste;
  const ASSISTANT = f.utilisateurs.assistant;

  process.env.DATABASE_URL_APP = urlMigrateur(base);
  process.env.JOKSWED_PARTENAIRE_VIDEO_SLUG = "videaste-partenaire";
  process.env.JOKSWED_CHIFFREMENT_CLE ??= Buffer.alloc(32, 7).toString("base64");
  process.env.JOKSWED_DOMAINE_REPONSE = DOMAINE_REPONSE;
  process.env.EMAIL_FOURNISSEUR = "simule";
  process.env.SITE_URL = BASE_URL;

  const { deposerDemande } = await import("../lib/demandes/depot.ts");
  const { formules } = await import("../content/offres.ts");
  const { engendrerJetonConversation, adresseReponse } =
    await import("../lib/messagerie/adresses.ts");
  const { boiteDeTest, viderBoiteDeTest } = await import("../lib/email/fournisseur.ts");
  const { drainer } = await import("../lib/demandes/drain.ts");

  const annee = new Date().getFullYear() + 2;
  const depot = await deposerDemande({
    cleIdempotence: "banc-v7-depot-principal",
    contactNom: "Alix & Dominique FICTIF",
    contactEmail: "alix.dominique@exemple.invalid",
    contactTelephone: "06 00 00 00 00",
    dateMariage: `${annee}-06-13`,
    lieu: "Domaine des Essais, 77300 Fontainebleau",
    formuleCle: formules[1].cle, supplementsCles: ["videaste"],
    message: "Banc V7.", consentementDemande: true, consentementPartenaire: true,
    ipTronquee: "203.0.113.0/24",
  });
  await en(app, PROPRIO, "SELECT app.confirmer_demande($1)", [depot.demandeId]);

  /* ═══════════ 1. CRÉATION D'UNE CONVERSATION ═══════════ */
  const jetonConv = engendrerJetonConversation();
  const conv = (await en(app, PROPRIO,
    "SELECT app.ouvrir_conversation($1,'client',$2,$3,$4,NULL,$5::citext,$6) AS id",
    [JK, "Votre mariage du 13 juin", jetonConv, depot.demandeId,
     "alix.dominique@exemple.invalid", "Alix & Dominique"])).rows[0].id;
  v("Une conversation client s'ouvre", !!conv);
  v("…avec le couple en participant",
    (await verite.query(
      `SELECT count(*)::int n FROM conversation_participants
        WHERE conversation_id = $1 AND role = 'client'`, [conv])).rows[0].n === 1);
  v("…et un jeton de réponse de 128 bits", jetonConv.length >= 20);

  const eClientSansAdresse = await refuse(app, PROPRIO,
    "SELECT app.ouvrir_conversation($1,'client',$2,$3,NULL,NULL,NULL,NULL)",
    [JK, "Sans client", engendrerJetonConversation()]);
  v("Une conversation client sans client est refusée", !!eClientSansAdresse);

  /* ═══════════ 2. ENVOI D'UN MESSAGE ═══════════ */
  await verite.query(
    `INSERT INTO identites_messagerie (entreprise_id, adresse, nom_affiche, methode, statut)
     VALUES ($1,'contact@jokswed.test','JoksWed','brevo_partage','active')`, [JK]);

  const msg1 = (await en(app, PROPRIO,
    "SELECT app.composer_message($1,'sortant',$2,$3,$4,$5,$6::citext,$7) AS id",
    [conv, "Bonjour, je vous confirme ma disponibilité.", null,
     "Votre mariage du 13 juin", "v7-m1", "contact@jokswed.test", "JoksWed"])).rows[0].id;
  v("Un message sortant se compose", !!msg1);
  v("…en attente d'envoi, pas déjà envoyé",
    (await verite.query("SELECT statut FROM messages WHERE id=$1", [msg1])).rows[0].statut
      === "en_attente");
  v("…et un événement d'envoi est en file",
    (await verite.query(
      "SELECT count(*)::int n FROM evenements WHERE type='message.envoyer'")).rows[0].n === 1);

  const eIdentiteVolee = await refuse(app, PROPRIO,
    "SELECT app.composer_message($1,'sortant',$2,NULL,NULL,$3,$4::citext,NULL)",
    [conv, "Usurpation.", "v7-vol", "yvann@autre.test"]);
  v("⚠️ On n'écrit pas depuis une identité qu'on ne possède pas",
    !!eIdentiteVolee && /identité d'expédition non autorisée/.test(eIdentiteVolee.message),
    eIdentiteVolee?.message);

  viderBoiteDeTest();
  const bilan1 = await drainer(50);
  v("Le drain fait partir le message", bilan1.envoyes > 0, JSON.stringify(bilan1));
  const sorti = boiteDeTest().find((m) => m.destinataire === "alix.dominique@exemple.invalid"
    && /disponibilité/.test(m.texte));
  v("…au couple, avec le bon corps", !!sorti,
    boiteDeTest().map((m) => m.destinataire).join(", "));
  v("⚠️ …et un Reply-To qui porte le jeton de la conversation",
    sorti?.repondreA === adresseReponse(jetonConv), sorti?.repondreA);
  v("…depuis l'identité choisie", sorti?.expediteurEmail === "contact@jokswed.test");
  v("Le message passe à « envoyé »",
    (await verite.query("SELECT statut FROM messages WHERE id=$1", [msg1])).rows[0].statut
      === "envoye");

  /* ═══════════ 3 et 4. RÉCEPTION D'UNE RÉPONSE, SUR LE VRAI ENDPOINT ═══════════ */
  await new Promise((r) => setTimeout(r, 200));
  serveur = spawn("npx", ["next", "start", "--port", String(PORT)], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL_APP: urlApplication(base),
      DATABASE_URL_AUTH: urlAuth(base),
      JOKSWED_DOMAINE_REPONSE: DOMAINE_REPONSE,
      JOKSWED_WEBHOOK_ENTRANT: SECRET_ENTRANT,
      EMAIL_FOURNISSEUR: "simule",
      SITE_URL: BASE_URL,
    },
  });
  serveur.stdout.on("data", (d) => (journal += d));
  serveur.stderr.on("data", (d) => (journal += d));
  let pret = false;
  for (let i = 0; i < 60 && !pret; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try { await fetch(`${BASE_URL}/admin/connexion`); pret = true; } catch { /* pas encore */ }
  }
  if (!pret) throw new Error("serveur non démarré");

  const chargeBrevo = (surcharge = {}) => ({
    items: [{
      Uuid: ["banc-v7"],
      MessageId: surcharge.MessageId ?? "<reponse-1@client.test>",
      InReplyTo: "<envoi-1@jokswed.test>",
      From: { Address: surcharge.From ?? "alix.dominique@exemple.invalid", Name: "Alix" },
      To: [{ Address: surcharge.To ?? adresseReponse(jetonConv), Name: null }],
      Recipients: [{ Address: surcharge.To ?? adresseReponse(jetonConv) }],
      Subject: "Re: Votre mariage du 13 juin",
      RawTextBody: "Parfait !\n\n> Bonjour, je vous confirme ma disponibilité.",
      ExtractedMarkdownMessage: surcharge.corps ?? "Parfait, on réserve !",
      Headers: { "Delivered-To": surcharge.To ?? adresseReponse(jetonConv) },
      Attachments: [],
      ...surcharge.item,
    }],
  });

  const poster = (charge, secret = SECRET_ENTRANT) =>
    fetch(`${BASE_URL}/api/entrant/brevo/${secret}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(charge),
    });

  /* ⚠️ LE SECRET D'ABORD : un endpoint de réception ouvert est une boîte
     aux lettres publique branchée sur la base. */
  const sansSecret = await poster(chargeBrevo(), "mauvais-secret");
  v("⚠️ Un secret erroné rend 404, pas 401", sansSecret.status === 404,
    `HTTP ${sansSecret.status}`);
  v("…et rien n'a été écrit",
    (await verite.query("SELECT count(*)::int n FROM messages WHERE sens='entrant'"))
      .rows[0].n === 0);

  const recue = await poster(chargeBrevo());
  const bilanRecue = await recue.json();
  v("La réponse du client est acceptée", recue.status === 200 && bilanRecue.rattaches === 1,
    JSON.stringify(bilanRecue));
  const entrants = await verite.query(
    "SELECT * FROM messages WHERE conversation_id=$1 AND sens='entrant'", [conv]);
  v("⚠️ …et réapparaît dans LA BONNE conversation", entrants.rows.length === 1,
    `${entrants.rows.length}`);
  v("…avec la réponse seule, pas la citation recopiée",
    entrants.rows[0].corps_texte === "Parfait, on réserve !",
    entrants.rows[0].corps_texte);

  /* ═══════════ 5. NOTIFICATION ═══════════ */
  v("Une notification interne est créée",
    (await verite.query(
      "SELECT count(*)::int n FROM notifications WHERE destinataire_id=$1 AND type='message.recu'",
      [PROPRIO])).rows[0].n === 1);
  const nonLus = await en(app, PROPRIO, "SELECT * FROM app.mes_conversations($1)", [JK]);
  v("…et le message compte comme non lu",
    nonLus.rows[0].non_lus >= 1, `${nonLus.rows[0].non_lus}`);
  await en(app, PROPRIO, "SELECT app.marquer_lue($1)", [conv]);
  const apresLecture = await en(app, PROPRIO, "SELECT * FROM app.mes_conversations($1)", [JK]);
  v("…jusqu'à ce qu'on la lise", apresLecture.rows[0].non_lus === 0);

  /* ═══════════ 10. AUCUN DOUBLON ═══════════ */
  const rejeu = await poster(chargeBrevo());
  const bilanRejeu = await rejeu.json();
  v("⚠️ Un webhook rejoué ne crée pas un second message",
    bilanRejeu.doublons === 1 && bilanRejeu.rattaches === 0, JSON.stringify(bilanRejeu));
  v("…la conversation garde un seul entrant",
    (await verite.query(
      "SELECT count(*)::int n FROM messages WHERE conversation_id=$1 AND sens='entrant'",
      [conv])).rows[0].n === 1);

  /* ═══════════ RATTACHEMENTS REFUSÉS ═══════════ */
  const inconnu = await (await poster(chargeBrevo({
    MessageId: "<inconnu@client.test>", To: `rep+jetoninventexyz123@${DOMAINE_REPONSE}`,
  }))).json();
  v("⚠️ Un jeton inconnu part en quarantaine, pas « au plus probable »",
    inconnu.quarantaine === 1 && inconnu.rattaches === 0, JSON.stringify(inconnu));

  const sansJeton = await (await poster(chargeBrevo({
    MessageId: "<sansjeton@client.test>", To: "contact@jokswed.test",
  }))).json();
  v("…comme un message sans jeton du tout", sansJeton.quarantaine === 1,
    JSON.stringify(sansJeton));

  /* ⚠️ CONNAÎTRE L'ADRESSE DE RÉPONSE NE SUFFIT PAS. */
  const tiers = await (await poster(chargeBrevo({
    MessageId: "<tiers@ailleurs.test>", From: "curieux@ailleurs.test",
  }))).json();
  v("⚠️ Un tiers non participant ne peut pas écrire dans le fil",
    tiers.quarantaine === 1 && tiers.rattaches === 0, JSON.stringify(tiers));
  v("…et le motif est enregistré",
    /non participant/.test((await verite.query(
      "SELECT motif FROM messages_orphelins WHERE message_id_rfc='<tiers@ailleurs.test>'"))
      .rows[0]?.motif ?? ""));

  /* ═══════════ 6. CONVERSATION COMMUNE AVEC UN COLLABORATEUR ═══════════ */
  await en(app, PROPRIO, "SELECT app.ajouter_participant($1,'prestataire',$2,NULL,NULL)",
    [conv, VD]);
  const vuVideaste = await en(app, VIDEASTE, "SELECT * FROM app.mes_conversations($1)", [VD]);
  v("Ajouté, le vidéaste voit la conversation commune",
    vuVideaste.rows.length === 1, `${vuVideaste.rows.length}`);
  const filVideaste = await en(app, VIDEASTE, "SELECT * FROM app.fil_conversation($1)", [conv]);
  v("…et son fil", filVideaste.rows.length >= 2, `${filVideaste.rows.length}`);
  const msgVideaste = (await en(app, VIDEASTE,
    "SELECT app.composer_message($1,'interne',$2,NULL,NULL,$3,NULL,NULL) AS id",
    [conv, "Je suis dispo ce jour-là.", "v7-vid"])).rows[0].id;
  v("…et peut y écrire une note interne", !!msgVideaste);

  /* ═══════════ 7. REFUS D'ACCÈS ═══════════ */
  const convPrivee = (await en(app, PROPRIO,
    "SELECT app.ouvrir_conversation($1,'interne',$2,$3,NULL,NULL,NULL,NULL) AS id",
    [JK, "Entre nous", engendrerJetonConversation()])).rows[0].id;
  const vuInterdite = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM conversations WHERE id = $1", [convPrivee]);
  v("⚠️ Le vidéaste ne voit pas une conversation à laquelle il ne participe pas",
    vuInterdite.rows[0].n === 0, `${vuInterdite.rows[0].n}`);
  const filInterdit = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM app.fil_conversation($1)", [convPrivee]);
  v("…ni son fil, même avec l'identifiant exact", filInterdit.rows[0].n === 0);
  const eEcrire = await refuse(app, VIDEASTE,
    "SELECT app.composer_message($1,'interne',$2,NULL,NULL,$3,NULL,NULL)",
    [convPrivee, "Intrusion.", "v7-intrus"]);
  v("…ni y écrire", !!eEcrire, eEcrire?.message);
  const eAjout = await refuse(app, VIDEASTE,
    "SELECT app.ajouter_participant($1,'prestataire',$2,NULL,NULL)", [convPrivee, VD]);
  v("⚠️ …ni s'y ajouter lui-même", !!eAjout, eAjout?.message);

  /* ⚠️ L'ASSISTANT N'A PAS `message.envoyer`. */
  const eAssistant = await refuse(app, ASSISTANT,
    "SELECT app.composer_message($1,'interne',$2,NULL,NULL,$3,NULL,NULL)",
    [conv, "Essai.", "v7-ass"]);
  v("Sans `message.envoyer`, on ne compose pas", !!eAssistant, eAssistant?.message);

  /* ⚠️ UNE NOTE INTERNE NE PEUT PAS DEVENIR UN E-MAIL. */
  const eSortantInterne = await refuse(app, PROPRIO,
    "SELECT app.composer_message($1,'sortant',$2,NULL,NULL,$3,NULL,NULL)",
    [convPrivee, "Fuite.", "v7-fuite"]);
  v("⚠️ Pas de message sortant dans une conversation interne",
    !!eSortantInterne && /aucun client/.test(eSortantInterne.message),
    eSortantInterne?.message);
  const eClientInterne = await refuse(app, PROPRIO,
    "SELECT app.ajouter_participant($1,'client',NULL,$2::citext,$3)",
    [convPrivee, "couple@exemple.invalid", "Couple"]);
  v("⚠️ …et on n'y ajoute pas de client",
    !!eClientInterne && /on n'y ajoute pas de client/.test(eClientInterne.message),
    eClientInterne?.message);
  const eContrainte = await refuse(verite, PROPRIO,
    `INSERT INTO messages (conversation_id, sens, corps_texte, statut)
     VALUES ($1,'interne','Fuite directe','en_attente')`, [convPrivee]);
  v("⚠️ …et même en SQL direct, un interne ne prend pas de statut d'envoi",
    !!eContrainte && /interne_ne_part_jamais/.test(eContrainte.message),
    eContrainte?.message);
  const entrantInterne = await (await poster(chargeBrevo({
    MessageId: "<versinterne@client.test>",
    To: `rep+${(await verite.query("SELECT jeton_reponse FROM conversations WHERE id=$1",
      [convPrivee])).rows[0].jeton_reponse}@${DOMAINE_REPONSE}`,
  }))).json();
  v("⚠️ …et une conversation interne ne reçoit rien de l'extérieur",
    entrantInterne.quarantaine === 1, JSON.stringify(entrantInterne));

  /* ═══════════ 8. PIÈCES JOINTES ═══════════ */
  const gen = await import("../lib/documents/generer.ts");
  const { createHash } = await import("node:crypto");
  await verite.query(
    `INSERT INTO regimes_tva (entreprise_id, regime, mention_legale, debut_le)
     VALUES ($1,'franchise_base','TVA non applicable, article 293 B du CGI', current_date)`, [JK]);
  await verite.query(
    `UPDATE entreprises SET mediateur_nom='Médiateur', mediateur_url='https://exemple.invalid'
      WHERE id=$1`, [JK]);
  const devis = await (async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.session_jeton',$1,true)", [jetons.get(PROPRIO)]);
    const r = await gen.genererDevisDepuisDemande(
      (t, val = []) => app.query(t, val), depot.demandeId, JK, PROPRIO);
    await app.query(
      `DELETE FROM document_lignes WHERE document_id = $1
        AND prix_unitaire_cents = 0 AND origine_type = 'supplement'`, [r.documentId]);
    await app.query("COMMIT");
    return r;
  })();

  const msgBrouillon = (await en(app, PROPRIO,
    "SELECT app.composer_message($1,'sortant',$2,NULL,NULL,$3,$4::citext,NULL) AS id",
    [conv, "Voici votre devis.", "v7-pj", "contact@jokswed.test"])).rows[0].id;
  const eBrouillon = await refuse(app, PROPRIO, "SELECT app.joindre_document($1,$2)",
    [msgBrouillon, devis.documentId]);
  v("⚠️ Un document BROUILLON ne peut pas être joint à un envoi client",
    !!eBrouillon && /brouillon/.test(eBrouillon.message), eBrouillon?.message);

  await (async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.session_jeton',$1,true)", [jetons.get(PROPRIO)]);
    const e = await app.query("SELECT * FROM app.emettre_document($1)", [devis.documentId]);
    if (!e.rows[0].emis) throw new Error(e.rows[0].motifs.join(", "));
    const d = await app.query("SELECT instantane FROM documents WHERE id=$1", [devis.documentId]);
    const { pdf } = gen.rendrePdf(d.rows[0].instantane, false);
    await app.query("SELECT app.sceller_document($1,$2)",
      [devis.documentId, createHash("sha256").update(pdf).digest("hex")]);
    await app.query("COMMIT");
  })();

  const piece = await en(app, PROPRIO, "SELECT app.joindre_document($1,$2) AS id",
    [msgBrouillon, devis.documentId]);
  v("…mais un document ÉMIS se joint", !!piece.rows[0].id);

  const eAutrui = await refuse(app, VIDEASTE, "SELECT app.joindre_document($1,$2)",
    [msgVideaste, devis.documentId]);
  v("⚠️ …et jamais le document d'une autre entreprise", !!eAutrui, eAutrui?.message);

  viderBoiteDeTest();
  await drainer(50);
  const avecPiece = boiteDeTest().find((m) => /devis/i.test(m.texte));
  v("Le document part en pièce jointe, régénéré depuis l'instantané",
    (avecPiece?.pieces?.length ?? 0) === 1
      && avecPiece.pieces[0].contenu.subarray(0, 5).toString() === "%PDF-",
    JSON.stringify(avecPiece?.pieces?.map((p) => p.nom)));

  /* Pièce entrante : stockée en base, servie en privé. */
  const msgAvecPJ = (await verite.query(
    "SELECT id FROM messages WHERE conversation_id=$1 AND sens='entrant' LIMIT 1", [conv]))
    .rows[0].id;
  await verite.query("SELECT app.joindre_piece_entrante($1,$2,$3,$4)",
    [msgAvecPJ, "planning.pdf", "application/pdf", Buffer.from("%PDF-1.4 faux")]);
  const pjVisible = await en(app, PROPRIO,
    "SELECT count(*)::int n FROM pieces_jointes WHERE message_id=$1", [msgAvecPJ]);
  v("Une pièce reçue est visible du participant", pjVisible.rows[0].n === 1);
  /* ⚠️ ASSERTION CORRIGÉE : l'assistant est membre de JoksWed, qui PARTICIPE
     à cette conversation — il la voit donc légitimement. Pour éprouver
     l'invisibilité, il faut quelqu'un hors de la conversation : le vidéaste
     face à une conversation interne de JoksWed. */
  const msgPrive = (await en(app, PROPRIO,
    "SELECT app.composer_message($1,'interne',$2,NULL,NULL,$3,NULL,NULL) AS id",
    [convPrivee, "Note avec pièce.", "v7-prive-pj"])).rows[0].id;
  await verite.query("SELECT app.joindre_piece_entrante($1,$2,$3,$4)",
    [msgPrive, "prive.pdf", "application/pdf", Buffer.from("%PDF-1.4 prive")]);
  const pjInterdite = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM pieces_jointes WHERE message_id=$1", [msgPrive]);
  v("⚠️ …et invisible de qui ne participe pas à la conversation",
    pjInterdite.rows[0].n === 0, `${pjInterdite.rows[0].n}`);
  const pjSienne = await en(app, PROPRIO,
    "SELECT count(*)::int n FROM pieces_jointes WHERE message_id=$1", [msgPrive]);
  v("…alors que le participant la voit", pjSienne.rows[0].n === 1);

  /* ═══════════ 9. PANNE DU FOURNISSEUR ═══════════ */
  const msgPanne = (await en(app, PROPRIO,
    "SELECT app.composer_message($1,'sortant',$2,NULL,NULL,$3,$4::citext,NULL) AS id",
    [conv, "Message pendant la panne.", "v7-panne", "contact@jokswed.test"])).rows[0].id;
  process.env.EMAIL_SIMULE_ECHEC = "1";
  viderBoiteDeTest();
  const bilanPanne = await drainer(50);
  delete process.env.EMAIL_SIMULE_ECHEC;
  v("Une panne du fournisseur est comptée comme un échec", bilanPanne.echoues > 0,
    JSON.stringify(bilanPanne));
  v("⚠️ …le message n'est PAS perdu",
    (await verite.query("SELECT statut FROM messages WHERE id=$1", [msgPanne])).rows[0].statut
      === "echoue");
  v("…et l'événement revient pour une nouvelle tentative",
    (await verite.query(
      "SELECT count(*)::int n FROM evenements WHERE type='message.envoyer' AND traite_le IS NULL"))
      .rows[0].n >= 1);

  await verite.query("UPDATE evenements SET disponible_le = now() WHERE traite_le IS NULL");
  viderBoiteDeTest();
  await drainer(50);
  v("La reprise le fait partir", boiteDeTest().length > 0,
    boiteDeTest().map((m) => m.destinataire).join(", "));
  v("…sans doublon de journal",
    (await verite.query(
      `SELECT count(*)::int n FROM (
         SELECT cle_idempotence FROM envois_email WHERE cle_idempotence IS NOT NULL
          GROUP BY cle_idempotence HAVING count(*) > 1) x`)).rows[0].n === 0);

  /* ═══════════ MODÈLES ═══════════ */
  const modeles = await en(app, PROPRIO,
    "SELECT count(*)::int n FROM modeles_reponse WHERE entreprise_id = $1", [JK]);
  v("Les neuf modèles de réponse sont installés", modeles.rows[0].n === 9,
    `${modeles.rows[0].n}`);
  const vars = await en(app, PROPRIO, "SELECT app.variables_conversation($1) AS v", [conv]);
  v("Les variables du dossier sont disponibles",
    !!vars.rows[0].v.date_mariage && !!vars.rows[0].v.prenom_client,
    JSON.stringify(vars.rows[0].v));

  const { substituer, tableDeSubstitution } = await import("../lib/messagerie/modeles.ts");
  const table = tableDeSubstitution(vars.rows[0].v);
  const rendu = substituer(
    "Bonjour {{prenom_client}}, le {{date_mariage}} — {{inconnue}}", table);
  v("Une variable connue est remplacée", /Bonjour Alix/.test(rendu.texte), rendu.texte);
  v("⚠️ …et une variable inconnue reste VISIBLE, pas effacée",
    rendu.texte.includes("{{inconnue}}") && rendu.manquantes.includes("inconnue"),
    rendu.texte);

  /* ═══════════════════════════════════════════════════════════════════════
     LE PARCOURS COMPLET D'YVANN, DE BOUT EN BOUT
     -----------------------------------------------------------------------
     Les neuf étapes demandées : la demande arrive, une proposition est
     créée, il la voit, il est notifié, il accepte, il accède au dossier, il
     écrit au couple, la réponse revient au bon endroit, et rien d'autre ne
     lui est accessible.
     ═══════════════════════════════════════════════════════════════════════ */
  /* Son entreprise se configure comme la vraie : identité d'envoi avec une
     adresse de réponse qui EXISTE (son Gmail), et un régime fiscal. */
  await verite.query(
    `INSERT INTO identites_messagerie
       (entreprise_id, adresse, nom_affiche, methode, statut, reponse_vers, signature)
     VALUES ($1,'contact@jokswed.com','Yvann Cretinoir — Vidéaste','brevo_partage',
             'active','yvann@exemple.invalid','Yvann Cretinoir — Vidéaste')`, [VD]);

  /* 1. Une demande vidéo arrive. */
  const depotYvann = await deposerDemande({
    cleIdempotence: "banc-v7-parcours-yvann",
    contactNom: "Camille & Noé FICTIF", contactEmail: "camille.noe@exemple.invalid",
    contactTelephone: "06 11 22 33 44", dateMariage: `${annee}-09-19`,
    lieu: "Château d'Essai, 27720 Dangu",
    formuleCle: formules[2].cle, supplementsCles: ["videaste"],
    message: "Photo et vidéo.", consentementDemande: true, consentementPartenaire: true,
    ipTronquee: "203.0.113.0/24",
  });
  await en(app, PROPRIO, "SELECT app.confirmer_demande($1)", [depotYvann.demandeId]);
  const vuJohn = await en(app, PROPRIO,
    "SELECT count(*)::int n FROM demandes WHERE id = $1", [depotYvann.demandeId]);
  v("1. La demande vidéo arrive dans l'administration de John", vuJohn.rows[0].n === 1);

  /* 2. Une proposition est créée pour le vidéaste. */
  const propYvann = await verite.query(
    "SELECT * FROM propositions WHERE demande_id = $1", [depotYvann.demandeId]);
  v("2. Une proposition est créée pour le vidéaste",
    propYvann.rows.length === 1 && propYvann.rows[0].entreprise_destinataire_id === VD);

  /* 3 et 4. Le drain la transmet et la notifie — e-mail compris. */
  viderBoiteDeTest();
  await drainer(50);
  await drainer(50);
  const vuYvann = await en(app, VIDEASTE, "SELECT * FROM app.propositions_recues($1)", [VD]);
  const sienne = vuYvann.rows.find((p) => p.demande_id === depotYvann.demandeId);
  v("3. Son administration affiche la proposition", !!sienne,
    `${vuYvann.rows.length} proposition(s)`);
  v("⚠️ …avec la date, le lieu et la prestation, et RIEN d'autre",
    !!sienne && !!sienne.date_mariage && !!sienne.lieu && sienne.prestation === "video"
      && sienne.contact_nom === null && sienne.contact_email === null,
    JSON.stringify(sienne));
  const notifYvann = await verite.query(
    `SELECT count(*)::int n FROM notifications
      WHERE destinataire_id = $1 AND type = 'collaboration.proposee'`, [VIDEASTE]);
  v("4. Une notification interne lui est préparée", notifYvann.rows[0].n >= 1);
  const mailYvann = boiteDeTest().find((m) => m.destinataire === "videaste@exemple.invalid");
  v("…et un e-mail lui est composé", !!mailYvann,
    boiteDeTest().map((m) => m.destinataire).join(", "));
  v("⚠️ …sans aucune coordonnée du couple",
    !!mailYvann && !/camille|No[ée]|06 11 22 33 44/i.test(mailYvann.texte),
    (mailYvann?.texte ?? "").slice(0, 150));
  v("…et avec un lien vers son administration",
    !!mailYvann && /\/admin\/propositions/.test(mailYvann.texte));
  v("…et une adresse de réponse qui EXISTE",
    !!mailYvann && mailYvann.repondreA === "jokswed@gmail.com", mailYvann?.repondreA);

  /* 5. Il accepte. */
  await en(app, VIDEASTE, "SELECT app.repondre_proposition($1,true,$2)",
    [sienne.id, "Disponible."]);
  v("5. Il accepte la proposition",
    (await verite.query("SELECT statut FROM propositions WHERE id=$1", [sienne.id]))
      .rows[0].statut === "acceptee");

  /* 6. Il accède au dossier — et pas aux coordonnées, pas encore. */
  const sesDossiersYvann = await en(app, VIDEASTE, "SELECT * FROM app.mes_dossiers($1)", [VD]);
  const sonDossierYvann = sesDossiersYvann.rows.find(
    (d) => d.date_mariage === `${annee}-09-19`);
  v("6. Le dossier apparaît dans son administration", !!sonDossierYvann);
  v("⚠️ …sans les coordonnées du couple tant qu'elles ne sont pas partagées",
    !!sonDossierYvann && sonDossierYvann.coordonnees_partagees === false
      && sonDossierYvann.contact_email === null);
  const eEcrireSansPartage = await refuse(app, VIDEASTE,
    "SELECT app.ouvrir_conversation_dossier($1,$2,$3)",
    [sonDossierYvann.dossier_id, "Essai", "jetonessaiyvann0001"]);
  v("⚠️ …et il ne peut pas encore écrire au couple",
    !!eEcrireSansPartage && /partagé/.test(eEcrireSansPartage.message),
    eEcrireSansPartage?.message);

  /* John partage les coordonnées, explicitement. */
  await en(app, PROPRIO, "SELECT app.partager_coordonnees($1,$2,true)",
    [depotYvann.demandeId, VD]);

  /* 7. Il écrit au couple, depuis SA messagerie. */
  const convYvann = (await en(app, VIDEASTE,
    "SELECT app.ouvrir_conversation_dossier($1,$2,$3) AS id",
    [sonDossierYvann.dossier_id, "Votre film de mariage", "jetonyvann00000000001"]))
    .rows[0].id;
  v("7. Il ouvre une conversation avec le couple", !!convYvann);
  const rappel = await en(app, VIDEASTE,
    "SELECT app.ouvrir_conversation_dossier($1,$2,$3) AS id",
    [sonDossierYvann.dossier_id, "Encore", "jetonyvann00000000002"]);
  v("…et un second clic ne crée pas une deuxième conversation",
    rappel.rows[0].id === convYvann);

  const eCompose = await refuse(app, VIDEASTE,
    "SELECT app.composer_message($1,'sortant',$2,NULL,NULL,$3,$4::citext,$5)",
    [convYvann, "Bonjour, ravi de filmer votre mariage.", "yvann-1",
     "contact@jokswed.com", "Yvann Cretinoir — Vidéaste"]);
  v("…et compose son message", !eCompose, eCompose?.message);
  viderBoiteDeTest();
  await drainer(50);
  const mailClient = boiteDeTest().find((m) => m.destinataire === "camille.noe@exemple.invalid");
  v("…et son message part au couple", !!mailClient,
    boiteDeTest().map((m) => m.destinataire).join(", "));
  v("⚠️ …signé de SON nom, pas de celui de John",
    !!mailClient && /Yvann Cretinoir/.test(mailClient.texte)
      && !/John/.test(mailClient.texte), (mailClient?.texte ?? "").slice(-80));
  v("…depuis l'expéditeur vérifié unique",
    mailClient?.expediteurEmail === "contact@jokswed.com", mailClient?.expediteurEmail);
  const jetonYvann = (await verite.query(
    "SELECT jeton_reponse FROM conversations WHERE id=$1", [convYvann])).rows[0].jeton_reponse;
  v("⚠️ …avec un Reply-To qui revient DANS la conversation, pas vers Gmail",
    mailClient?.repondreA === adresseReponse(jetonYvann)
      && !/gmail/.test(mailClient?.repondreA ?? ""), mailClient?.repondreA);

  /* 8. La réponse du couple revient dans SA conversation. */
  const reponseCouple = await (await poster({
    items: [{
      MessageId: "<reponse-couple-yvann@client.test>",
      From: { Address: "camille.noe@exemple.invalid", Name: "Camille" },
      To: [{ Address: adresseReponse(jetonYvann) }],
      Recipients: [{ Address: adresseReponse(jetonYvann) }],
      Subject: "Re: Votre film de mariage",
      ExtractedMarkdownMessage: "Avec plaisir, à très vite !",
      Headers: { "Delivered-To": adresseReponse(jetonYvann) },
      Attachments: [],
    }],
  })).json();
  v("8. La réponse du couple est acceptée", reponseCouple.rattaches === 1,
    JSON.stringify(reponseCouple));
  const filYvann = await en(app, VIDEASTE, "SELECT * FROM app.fil_conversation($1)", [convYvann]);
  v("⚠️ …et arrive dans LA conversation d'Yvann",
    filYvann.rows.some((m) => m.sens === "entrant" && /à très vite/i.test(m.corps_texte)),
    filYvann.rows.map((m) => m.sens).join(","));
  const filJohnChezYvann = await en(app, PROPRIO,
    "SELECT count(*)::int n FROM app.fil_conversation($1)", [convYvann]);
  v("⚠️ …et John, qui n'y participe pas, n'en voit rien",
    filJohnChezYvann.rows[0].n === 0, `${filJohnChezYvann.rows[0].n}`);

  /* La notification du message reçu ne va qu'aux participants. */
  const notifMsgYvann = await verite.query(
    `SELECT count(*)::int n FROM notifications
      WHERE destinataire_id = $1 AND type = 'message.recu'`, [VIDEASTE]);
  v("…Yvann est notifié de la réponse", notifMsgYvann.rows[0].n >= 1);
  const notifMsgJohn = await verite.query(
    `SELECT count(*)::int n FROM notifications
      WHERE destinataire_id = $1 AND type = 'message.recu'
        AND lien = '/admin/messagerie/' || $2`, [PROPRIO, convYvann]);
  v("⚠️ …et John ne l'est pas, pour une conversation qui ne le concerne pas",
    notifMsgJohn.rows[0].n === 0);

  /* 9. Rien d'autre ne lui est accessible. */
  const autresDemandes = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM demandes");
  v("9. ⚠️ Il ne voit AUCUNE demande de JoksWed", autresDemandes.rows[0].n === 0,
    `${autresDemandes.rows[0].n}`);
  /* ⚠️ ASSERTION PRÉCISÉE : il PARTICIPE à une conversation ouverte par
     JoksWed (la commune, plus haut). Ce qui doit être vrai, c'est qu'il ne
     voit QUE celles où il participe — pas qu'il n'en voit aucune. */
  const convJkVues = await en(app, VIDEASTE,
    "SELECT id FROM conversations WHERE entreprise_id = $1", [JK]);
  const convJkTotal = await verite.query(
    "SELECT count(*)::int n FROM conversations WHERE entreprise_id = $1", [JK]);
  const participe = await verite.query(
    `SELECT count(*)::int n FROM conversation_participants
      WHERE entreprise_id = $1 AND retire_le IS NULL
        AND conversation_id = ANY($2::uuid[])`,
    [VD, convJkVues.rows.map((r) => r.id)]);
  v("⚠️ …et des conversations de JoksWed, il ne voit QUE celles où il participe",
    convJkVues.rows.length < convJkTotal.rows[0].n
      && participe.rows[0].n === convJkVues.rows.length,
    `${convJkVues.rows.length} vue(s) sur ${convJkTotal.rows[0].n}, ${participe.rows[0].n} participation(s)`);
  const autresDocs = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM documents WHERE entreprise_id = $1", [JK]);
  v("⚠️ …ni ses documents", autresDocs.rows[0].n === 0);
  const autresPaiements = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM paiements WHERE entreprise_id = $1", [JK]);
  v("⚠️ …ni ses paiements", autresPaiements.rows[0].n === 0);

  /* ⚠️ UNE NOTIFICATION ADRESSÉE À YVANN NE DOIT PAS CRÉER DE CONVERSATION.
     S'il répond à un e-mail de notification, cette réponse arrive sur la
     boîte de réponse — pas sur l'endpoint entrant — et ne peut donc ni
     ouvrir un fil, ni boucler. On le vérifie en rejouant une réponse à
     l'adresse de repli : elle part en quarantaine. */
  const convAvant = await verite.query("SELECT count(*)::int n FROM conversations");
  const bouclePossible = await (await poster({
    items: [{
      MessageId: "<reponse-a-notification@gmail.test>",
      From: { Address: "videaste@exemple.invalid", Name: "Yvann" },
      To: [{ Address: "jokswed@gmail.com" }],
      Recipients: [{ Address: "jokswed@gmail.com" }],
      Subject: "Re: Nouvelle proposition",
      ExtractedMarkdownMessage: "Ok pour moi",
      Headers: {}, Attachments: [],
    }],
  })).json();
  const convApres = await verite.query("SELECT count(*)::int n FROM conversations");
  v("⚠️ Répondre à une notification ne crée aucune conversation",
    bouclePossible.quarantaine === 1 && convApres.rows[0].n === convAvant.rows[0].n,
    JSON.stringify(bouclePossible));

  /* ═══════════ CLOISONNEMENT PAR URL ═══════════ */
  const eConvAutrui = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM app.mes_conversations($1)", [JK]).catch(() => null);
  v("⚠️ Le vidéaste ne liste pas les conversations de JoksWed",
    eConvAutrui === null, "il a obtenu une réponse");

  for (const c of [app, verite]) await c.end();
} catch (e) {
  console.error("\n✗ Le banc s'est interrompu :", e?.message ?? e);
  resultats.push({ nom: "Le banc va jusqu'au bout", ok: false, detail: String(e?.message ?? e) });
} finally {
  if (serveur) {
    serveur.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    serveur.kill("SIGKILL");
  }
  try {
    const { fermerPool } = await import("../lib/db/client.ts");
    await fermerPool();
  } catch { /* jamais ouvert */ }
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves V7 passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc V7 : tout est vert.");
