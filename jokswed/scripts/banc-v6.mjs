/* =============================================================================
   BANC V6 — FINANCES, COLLABORATEURS, TRANSMISSION VIDÉO
   -----------------------------------------------------------------------------
   ⚠️ CE BANC SE CONNECTE EN `jokswed_app`, LE RÔLE DE L'APPLICATION.

   Deux entreprises, quatre collaborateurs, plusieurs mariages : c'est le seul
   dispositif qui prouve le cloisonnement. Un banc à une seule entreprise ne
   peut pas démontrer qu'une autre ne voit rien — il ne fait que ne rien
   trouver.

   Aucun e-mail n'est envoyé : la clé fournisseur est volontairement invalide
   et le drain n'est pas lancé ici.
   ============================================================================= */
import { createRequire } from "node:module";
import pg from "pg";
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

import { demarrer, urlMigrateur, urlApplication, urlAuth, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const resultats = [];
const v = (nom, ok, detail = "") => {
  resultats.push({ nom, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — ${detail}`}`);
};

const jetons = new Map();

/** Une requête SOUS UNE IDENTITÉ, exactement comme `avecActeur()`. */
async function en(client, acteur, texte, valeurs = []) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.session_jeton',$1,true)", [jetons.get(acteur)]);
    const r = await client.query(texte, valeurs);
    await client.query("COMMIT");
    return r;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}
/** Plusieurs instructions sous la MÊME identité et la même transaction. */
async function transaction(client, acteur, travail) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.session_jeton',$1,true)", [jetons.get(acteur)]);
    const r = await travail((t, val = []) => client.query(t, val));
    await client.query("COMMIT");
    return r;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}
async function refuse(client, acteur, texte, valeurs = []) {
  try { await en(client, acteur, texte, valeurs); return null; }
  catch (e) { return e; }
}
const eur = (c) => (c / 100).toFixed(2);

const pgdev = await demarrer();
let app, auth, verite;
try {
  const base = await baseVierge("jokswed_v6");
  await migrer(urlMigrateur(base), { silencieux: true });
  const f = await semer(urlMigrateur(base), { silencieux: true });

  app    = new pg.Client({ connectionString: urlApplication(base) });
  auth   = new pg.Client({ connectionString: urlAuth(base) });
  verite = new pg.Client({ connectionString: urlMigrateur(base) });
  for (const c of [app, auth, verite]) { c.on("error", () => {}); await c.connect(); }

  const JK = f.entreprises.jokswed;
  const VD = f.entreprises.video;

  /* Des sessions réelles : l'identité se PROUVE, elle ne se déclare pas. */
  for (const [nom, id] of Object.entries(f.utilisateurs)) {
    const jeton = `v6-${nom}`;
    await verite.query(
      `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
       VALUES ($1,$2, now() + interval '1 day', true)`, [id, jeton]);
    jetons.set(id, jeton);
  }
  const PROPRIO = f.utilisateurs.proprietaire;
  const VIDEASTE = f.utilisateurs.videaste;
  const ASSISTANT = f.utilisateurs.assistant;
  const PHOTOGRAPHE = f.utilisateurs.photographe;

  /* ═══════════════════════════════════════════════════════════════════════
     1. TROIS MARIAGES, DÉPOSÉS PAR LA VRAIE CHAÎNE
     ═══════════════════════════════════════════════════════════════════════ */
  process.env.DATABASE_URL_APP = urlMigrateur(base);
  process.env.JOKSWED_CHIFFREMENT_CLE ??= Buffer.alloc(32, 7).toString("base64");
  const { deposerDemande } = await import("../lib/demandes/depot.ts");
  const gen = await import("../lib/documents/generer.ts");
  const { rendrePdf } = gen;
  const { createHash } = await import("node:crypto");

  const annee = new Date().getFullYear() + 2;
  const mariages = [
    { cle: "juin",      nom: "Alix & Dominique FICTIF", date: `${annee}-06-13`,
      email: "alix.dominique@exemple.invalid", formule: 1, video: true },
    { cle: "juillet",   nom: "Sacha & Camille FICTIF",  date: `${annee}-07-18`,
      email: "sacha.camille@exemple.invalid",  formule: 2, video: false },
    { cle: "septembre", nom: "Noa & Charlie FICTIF",    date: `${annee}-09-05`,
      email: "noa.charlie@exemple.invalid",    formule: 3, video: true },
  ];
  const { formules } = await import("../content/offres.ts");
  const deposees = {};
  for (const m of mariages) {
    const r = await deposerDemande({
      cleIdempotence: `banc-v6-depot-${m.cle}`,
      contactNom: m.nom, contactEmail: m.email, contactTelephone: "06 00 00 00 00",
      dateMariage: m.date, lieu: `Domaine ${m.cle}, 77300 Fontainebleau`,
      formuleCle: formules[m.formule - 1].cle,
      /* La vidéo n'est pas un drapeau : c'est le supplément « videaste »,
         dont l'exécutant est un partenaire. C'est lui qui déclenche la
         proposition de collaboration. */
      supplementsCles: m.video ? ["videaste"] : [],
      message: "Banc V6.",
      consentementDemande: true,
      consentementPartenaire: m.video,
      ipTronquee: "203.0.113.0/24",
    });
    deposees[m.cle] = r.demandeId;
  }
  v("Trois demandes déposées par la chaîne publique",
    Object.keys(deposees).length === 3);

  /* Confirmation : la demande devient un mariage + un dossier. */
  for (const cle of Object.keys(deposees)) {
    await en(app, PROPRIO, "SELECT app.confirmer_demande($1)", [deposees[cle]]);
  }
  const apresConf = await verite.query(
    "SELECT count(*)::int n FROM mariages WHERE reference LIKE 'DEM-%'");
  v("Confirmer une demande crée son mariage", apresConf.rows[0].n === 3,
    `${apresConf.rows[0].n} mariage(s)`);
  const dossiersJk = await verite.query(
    "SELECT count(*)::int n FROM dossiers WHERE entreprise_id = $1 AND pilote", [JK]);
  v("…et le dossier pilote de JoksWed", dossiersJk.rows[0].n >= 3);

  /* ⚠️ CONFIRMER DEUX FOIS NE DOIT PAS DÉDOUBLER LE CARNET. */
  await en(app, PROPRIO, "SELECT app.confirmer_demande($1)", [deposees.juin]);
  const apresDouble = await verite.query(
    "SELECT count(*)::int n FROM mariages WHERE reference LIKE 'DEM-%'");
  v("Confirmer deux fois ne crée pas deux mariages", apresDouble.rows[0].n === 3,
    `${apresDouble.rows[0].n}`);

  /* ═══════════════════════════════════════════════════════════════════════
     2. DOCUMENTS ET PAIEMENTS
     ═══════════════════════════════════════════════════════════════════════ */
  /* Mentions légales complètes, sinon rien ne devient définitif. */
  await verite.query(
    `INSERT INTO regimes_tva (entreprise_id, regime, mention_legale, debut_le)
     SELECT e, 'franchise_base','TVA non applicable, article 293 B du CGI', current_date
       FROM unnest(ARRAY[$1::uuid,$2::uuid]) e`, [JK, VD]);
  await verite.query(
    `UPDATE entreprises SET mediateur_nom = 'Médiateur d''essai',
            mediateur_url = 'https://exemple.invalid' WHERE id = ANY($1::uuid[])`, [[JK, VD]]);

  const emettre = (client, acteur, documentId) => transaction(client, acteur, async (q) => {
    const e = await q("SELECT * FROM app.emettre_document($1)", [documentId]);
    if (!e.rows[0].emis) throw new Error(`émission refusée : ${e.rows[0].motifs}`);
    const d = await q("SELECT instantane FROM documents WHERE id = $1", [documentId]);
    const { pdf } = rendrePdf(d.rows[0].instantane, false);
    await q("SELECT app.sceller_document($1,$2)",
      [documentId, createHash("sha256").update(pdf).digest("hex")]);
    return e.rows[0];
  });

  /* ── Le cas EXACT du cahier des charges ──
     1 300 € contractualisés, facture d'acompte de 433,33 € NON réglée. */
  const devisJuillet = await transaction(app, PROPRIO, (q) =>
    gen.genererDevisDepuisDemande(q, deposees.juillet, JK, PROPRIO));
  await emettre(app, PROPRIO, devisJuillet.documentId);
  const factJuillet = await transaction(app, PROPRIO, (q) =>
    gen.genererFactureDepuisDevis(q, devisJuillet.documentId, "acompte", JK, PROPRIO));
  await emettre(app, PROPRIO, factJuillet.documentId);

  const situation = await en(app, PROPRIO,
    "SELECT * FROM app.situation_financiere($1)", [deposees.juillet]);
  const s = situation.rows[0];
  v("Contractualisé : 1 300,00 €", s.total_prestation_cents === 130000, eur(s.total_prestation_cents));
  v("Facturé : 433,33 €", s.facture_cents === 43333, eur(s.facture_cents));
  v("Encaissé : 0,00 €", s.encaisse_cents === 0, eur(s.encaisse_cents));
  v("⚠️ Le restant contractualisé reste 1 300,00 €, PAS 866,67 €",
    s.reste_du_cents === 130000, eur(s.reste_du_cents));

  const parDemande = await en(app, PROPRIO,
    "SELECT * FROM app.finances_par_demande($1)", [JK]);
  const ligneJuillet = parDemande.rows.find((r) => r.demande_id === deposees.juillet);
  /* ⚠️ RE-POINTÉ EN V6.1 : « contractualisé » s'est scindé.
     Un devis ÉMIS est une proposition ; seul un devis accepté, un contrat ou
     une réservation engage. Ici la demande est confirmée (palier 4). */
  v("La vue par mariage distingue facturé et engagé",
    ligneJuillet.engage_cents === 130000 && ligneJuillet.facture_cents === 43333,
    JSON.stringify(ligneJuillet));
  v("…et un devis simplement émis ne compte pas comme engagé",
    ligneJuillet.niveau === 4 && ligneJuillet.propose_cents === 0,
    `niveau ${ligneJuillet.niveau}, proposé ${ligneJuillet.propose_cents}`);

  /* ── Les cinq natures de paiement ── */
  const saisir = (acteur, demande, montant, moyen, type, cle, motif = null) =>
    en(app, acteur,
      "SELECT app.enregistrer_paiement($1,$2,$3,$4,$5,$6,$7,$8,NULL) AS id",
      [demande, montant, moyen, type, null, null, cle, motif]);

  const pAcompte = (await saisir(PROPRIO, deposees.juillet, 43333, "virement", "acompte", "v6-ac")).rows[0].id;
  v("Un paiement naît DÉCLARÉ, pas encaissé",
    (await verite.query("SELECT statut FROM paiements WHERE id=$1", [pAcompte])).rows[0].statut === "declare");

  const sAvant = (await en(app, PROPRIO, "SELECT * FROM app.situation_financiere($1)", [deposees.juillet])).rows[0];
  v("Une saisie non confirmée n'encaisse rien", sAvant.encaisse_cents === 0, eur(sAvant.encaisse_cents));

  /* Modification AVANT confirmation : autorisée, et tracée. */
  await en(app, PROPRIO, "SELECT app.modifier_paiement($1,$2,$3,$4,$5,$6)",
    [pAcompte, 43333, "cheque", "acompte", "CHQ-001", null]);
  v("Une saisie non confirmée se corrige",
    (await verite.query("SELECT moyen FROM paiements WHERE id=$1", [pAcompte])).rows[0].moyen === "cheque");
  v("…et la correction est au journal",
    (await verite.query("SELECT count(*)::int n FROM journal_audit WHERE action='paiement.modifie'")).rows[0].n === 1);

  await en(app, PROPRIO, "SELECT app.confirmer_paiement($1)", [pAcompte]);
  const sApres = (await en(app, PROPRIO, "SELECT * FROM app.situation_financiere($1)", [deposees.juillet])).rows[0];
  v("Confirmé : encaissé 433,33 €", sApres.encaisse_cents === 43333, eur(sApres.encaisse_cents));
  v("…et le reste dû tombe à 866,67 €", sApres.reste_du_cents === 86667, eur(sApres.reste_du_cents));
  v("…tandis que le FACTURÉ ne bouge pas", sApres.facture_cents === 43333, eur(sApres.facture_cents));

  /* ⚠️ UN PAIEMENT CONFIRMÉ NE SE RÉÉCRIT PAS. */
  const eMod = await refuse(app, PROPRIO, "SELECT app.modifier_paiement($1,$2,$3,$4,$5,$6)",
    [pAcompte, 99999, "carte", "acompte", null, null]);
  v("Un paiement confirmé ne se modifie plus", !!eMod && /ne se modifie|confirmé/.test(eMod.message), eMod?.message);
  const eSup = await refuse(verite, PROPRIO, "DELETE FROM paiements WHERE id = $1", [pAcompte]);
  v("…ni ne se supprime, même par le propriétaire de la base",
    !!eSup && /suppression interdite/.test(eSup.message), eSup?.message);

  /* Versement, solde, partiel. */
  await en(app, PROPRIO, "SELECT app.confirmer_paiement(app.enregistrer_paiement($1,$2,$3,$4,NULL,NULL,$5,NULL,NULL))",
    [deposees.juillet, 43333, "virement", "versement", "v6-v2"]);
  await en(app, PROPRIO, "SELECT app.confirmer_paiement(app.enregistrer_paiement($1,$2,$3,$4,NULL,NULL,$5,NULL,NULL))",
    [deposees.juillet, 43334, "virement", "solde", "v6-solde"]);
  const sSolde = (await en(app, PROPRIO, "SELECT * FROM app.situation_financiere($1)", [deposees.juillet])).rows[0];
  v("433,33 + 433,33 + 433,34 = 1 300,00 € encaissés",
    sSolde.encaisse_cents === 130000 && sSolde.reste_du_cents === 0, eur(sSolde.encaisse_cents));

  /* ⚠️ ON N'ENCAISSE PAS PLUS QUE DÛ. */
  const eTrop = await refuse(app, PROPRIO,
    "SELECT app.confirmer_paiement(app.enregistrer_paiement($1,$2,$3,$4,NULL,NULL,$5,NULL,NULL))",
    [deposees.juillet, 10000, "especes", "partiel", "v6-trop"]);
  v("Un encaissement au-delà du total est REFUSÉ",
    !!eTrop && /supérieur au total/.test(eTrop.message), eTrop?.message);

  /* ⚠️ MÊME CLÉ D'IDEMPOTENCE : AUCUN DOUBLE COMPTAGE. */
  await saisir(PROPRIO, deposees.juin, 20000, "virement", "acompte", "v6-dbl");
  await saisir(PROPRIO, deposees.juin, 20000, "virement", "acompte", "v6-dbl");
  const nbDbl = await verite.query(
    "SELECT count(*)::int n FROM paiements WHERE cle_idempotence = 'v6-dbl'");
  v("Deux saisies de même clé ne font qu'un paiement", nbDbl.rows[0].n === 1, `${nbDbl.rows[0].n}`);

  /* Régularisation : on corrige par un mouvement, pas par une gomme. */
  const pRemb = (await en(app, PROPRIO,
    "SELECT app.enregistrer_paiement($1,$2,$3,$4,NULL,NULL,$5,$6,$7) AS id",
    [deposees.juillet, 10000, "virement", "remboursement", "v6-remb",
     "Geste commercial après report", pAcompte])).rows[0].id;
  await en(app, PROPRIO, "SELECT app.confirmer_paiement($1)", [pRemb]);
  const sRemb = (await en(app, PROPRIO, "SELECT * FROM app.situation_financiere($1)", [deposees.juillet])).rows[0];
  v("Un remboursement SE SOUSTRAIT des encaissements",
    sRemb.encaisse_cents === 120000, eur(sRemb.encaisse_cents));
  v("…et le paiement d'origine reste intact au journal",
    (await verite.query("SELECT statut FROM paiements WHERE id=$1", [pAcompte])).rows[0].statut === "confirme");
  v("…en désignant l'opération qu'il corrige",
    (await verite.query("SELECT corrige_id FROM paiements WHERE id=$1", [pRemb])).rows[0].corrige_id === pAcompte);

  const eRembTrop = await refuse(app, PROPRIO,
    "SELECT app.confirmer_paiement(app.enregistrer_paiement($1,$2,$3,$4,NULL,NULL,$5,$6,NULL))",
    [deposees.juin, 500000, "virement", "remboursement", "v6-rtrop", "essai"]);
  v("On ne rembourse pas plus qu'on n'a reçu",
    !!eRembTrop && /supérieur aux encaissements/.test(eRembTrop.message), eRembTrop?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     3. TABLEAU DE BORD
     ═══════════════════════════════════════════════════════════════════════ */
  const resume = (await en(app, PROPRIO,
    `SELECT * FROM app.finances_resume($1, date_trunc('year', current_date)::date,
                                          (date_trunc('year', current_date) + interval '1 year')::date)`,
    [JK])).rows[0];
  v("Le résumé sépare encaissé et facturé",
    resume.encaisse_cents === 120000 && resume.facture_cents === 43333,
    JSON.stringify(resume));
  v("Les acomptes sont comptés à part", resume.acomptes_cents === 43333, eur(resume.acomptes_cents));
  v("Les soldes aussi", resume.soldes_cents === 43334, eur(resume.soldes_cents));
  v("Les remboursements aussi", resume.rembourse_cents === 10000, eur(resume.rembourse_cents));
  v("Les mariages réservés sont dénombrés et valorisés",
    resume.reserves_nb === 3, `${resume.reserves_nb}`);

  const mensuel = await en(app, PROPRIO,
    `SELECT * FROM app.finances_mensuelles($1, date_trunc('year', current_date)::date,
                                              (date_trunc('year', current_date) + interval '1 year')::date)`,
    [JK]);
  v("La série mensuelle couvre douze mois", mensuel.rows.length === 12, `${mensuel.rows.length}`);
  const totalMensuel = mensuel.rows.reduce((t, r) => t + r.encaisse_cents, 0);
  v("La somme des mois égale l'encaissé de l'année",
    totalMensuel === resume.encaisse_cents, `${totalMensuel} vs ${resume.encaisse_cents}`);

  /* ═══════════════════════════════════════════════════════════════════════
     4. SAISON DES MARIAGES
     ═══════════════════════════════════════════════════════════════════════ */
  const saison = await en(app, PROPRIO,
    "SELECT * FROM app.saison_mariages($1,$2,$3)",
    [JK, `${annee}-01-01`, `${annee + 1}-01-01`]);
  v("La saison liste les trois mariages", saison.rows.length === 3, `${saison.rows.length}`);
  v("…triés par date",
    saison.rows.map((r) => r.date_mariage).join(",") ===
      [...saison.rows].map((r) => r.date_mariage).sort().join(","));
  const juin = saison.rows.find((r) => r.date_mariage.startsWith(`${annee}-06`));
  v("Chaque ligne porte date, lieu, formule et montants",
    !!juin.contact_nom && !!juin.lieu && !!juin.formule_nom && juin.total_cents > 0,
    JSON.stringify(juin));
  /* ⚠️ UN MONTANT SANS DEVIS N'EST PAS UN MONTANT CONTRACTUALISÉ.
     Juin n'a pas de devis : on montre le prix de la formule demandée, et la
     ligne le DIT. Juillet, lui, a un devis émis. */
  v("…en distinguant le prix annoncé du prix contractualisé",
    juin.total_contractualise === false
      && saison.rows.find((r) => r.demande_id === deposees.juillet).total_contractualise === true,
    `juin=${juin.total_contractualise}`);
  const saisonJuillet = await en(app, PROPRIO,
    "SELECT * FROM app.saison_mariages($1,$2,$3)",
    [JK, `${annee}-07-01`, `${annee}-08-01`]);
  v("La période est configurable", saisonJuillet.rows.length === 1, `${saisonJuillet.rows.length}`);

  /* ⚠️ L'ASSISTANT VOIT LA SAISON, PAS LES MONTANTS. */
  const saisonAssistant = await en(app, ASSISTANT,
    "SELECT * FROM app.saison_mariages($1,$2,$3)",
    [JK, `${annee}-01-01`, `${annee + 1}-01-01`]);
  v("L'assistant voit la saison", saisonAssistant.rows.length === 3);
  /* ⚠️ RE-POINTÉ EN V6.1 : zéro était une AFFIRMATION, et elle était fausse.
     « 0 € » laisse croire que le mariage ne rapporte rien. On rend NULL, que
     l'interface affiche « — », et la valeur ne quitte pas PostgreSQL. */
  v("…mais aucun montant ne lui est transmis",
    saisonAssistant.rows.every((r) =>
      r.total_cents === null && r.encaisse_cents === null
        && r.solde_restant_cents === null && r.montants_masques === true),
    JSON.stringify(saisonAssistant.rows.map((r) => r.total_cents)));
  const eFinAssistant = await refuse(app, ASSISTANT,
    "SELECT * FROM app.finances_resume($1,current_date,current_date)", [JK]);
  v("…et le tableau financier lui est refusé",
    !!eFinAssistant && /permission|refus/i.test(eFinAssistant.message), eFinAssistant?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     5. CLOISONNEMENT ENTRE ENTREPRISES
     ═══════════════════════════════════════════════════════════════════════ */
  const eFinVideaste = await refuse(app, VIDEASTE,
    "SELECT * FROM app.finances_resume($1,current_date,current_date)", [JK]);
  v("⚠️ Le vidéaste ne lit PAS les finances de JoksWed",
    !!eFinVideaste && /non membre|permission|refus/i.test(eFinVideaste.message),
    eFinVideaste?.message);
  const eParDemande = await refuse(app, VIDEASTE,
    "SELECT * FROM app.finances_par_demande($1)", [JK]);
  v("…ni le détail par mariage", !!eParDemande, eParDemande?.message);
  const eSaison = await refuse(app, VIDEASTE,
    "SELECT * FROM app.saison_mariages($1,$2,$3)", [JK, `${annee}-01-01`, `${annee + 1}-01-01`]);
  v("…ni la saison de JoksWed", !!eSaison, eSaison?.message);

  const sesFinances = await en(app, VIDEASTE,
    `SELECT * FROM app.finances_resume($1, date_trunc('year', current_date)::date,
                                          (date_trunc('year', current_date) + interval '1 year')::date)`, [VD]);
  v("Le vidéaste lit SES propres finances, à zéro",
    sesFinances.rows[0].encaisse_cents === 0, JSON.stringify(sesFinances.rows[0]));

  /* ⚠️ FACTURER AU NOM D'UNE AUTRE ENTREPRISE. */
  const eFacture = await refuse(app, VIDEASTE,
    "SELECT app.numero_suivant($1,'facture',true)", [JK]);
  v("Le vidéaste ne peut pas entamer la série comptable de JoksWed",
    !!eFacture, eFacture?.message);
  const ePaiement = await refuse(app, VIDEASTE,
    "SELECT app.enregistrer_paiement($1,1000,'virement','acompte',NULL,NULL,'v6-vol',NULL,NULL)",
    [deposees.juillet]);
  v("…ni enregistrer un paiement sur un dossier de JoksWed", !!ePaiement, ePaiement?.message);

  /* ⚠️ RÉGULARISATION QUI TRAVERSERAIT LES ENTREPRISES. */
  const eCorrige = await refuse(app, VIDEASTE,
    "SELECT app.enregistrer_paiement($1,100,'virement','remboursement',NULL,NULL,'v6-x',$2,$3)",
    [deposees.juillet, "essai", pAcompte]);
  v("…ni rattacher une régularisation à un paiement d'autrui", !!eCorrige, eCorrige?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     6. COLLABORATEURS : INVITER, ACTIVER, SUSPENDRE, RÉVOQUER
     ═══════════════════════════════════════════════════════════════════════ */
  const { engendrerJeton, hacherJeton } = await import("../lib/auth/secrets.ts");
  const { rows: [roleVideaste] } = await verite.query(
    "SELECT id FROM roles WHERE entreprise_id = $1 AND cle = 'videaste'", [JK]);

  const jetonInv = engendrerJeton();
  const invitation = await en(app, PROPRIO,
    "SELECT app.admin_creer_invitation($1,$2,$3,$4,$5,ARRAY[$6]::uuid[],$7) AS id",
    [JK, "collaborateur.v6@exemple.invalid", "Collab", "Essai",
     hacherJeton(jetonInv), roleVideaste.id, 7]);
  const invId = invitation.rows[0].id;
  v("Une invitation se crée", !!invId);
  v("⚠️ Rien n'est envoyé à sa création",
    (await verite.query("SELECT envoyee_le FROM invitations WHERE id=$1", [invId])).rows[0].envoyee_le === null);
  v("Le jeton en clair n'est PAS stocké",
    (await verite.query("SELECT count(*)::int n FROM invitations WHERE jeton_hache = $1", [jetonInv])).rows[0].n === 0);

  await en(app, PROPRIO, "SELECT app.admin_envoyer_invitation($1)", [invId]);
  v("L'envoi marque l'invitation et met un événement en file",
    (await verite.query("SELECT envoyee_le FROM invitations WHERE id=$1", [invId])).rows[0].envoyee_le !== null
    && (await verite.query("SELECT count(*)::int n FROM evenements WHERE type='invitation.envoyer'")).rows[0].n === 1);
  v("⚠️ …mais AUCUN e-mail n'est parti du banc",
    (await verite.query("SELECT count(*)::int n FROM envois_email WHERE gabarit='invitation'")).rows[0].n === 0);

  /* Activation par l'invité, sous le rôle d'authentification. */
  const lecture = await auth.query("SELECT * FROM app.auth_invitation($1)", [hacherJeton(jetonInv)]);
  v("Le jeton ouvre l'invitation", lecture.rows.length === 1 && lecture.rows[0].entreprise_id === JK);
  const eAppInvitation = await (async () => {
    try { await app.query("SELECT * FROM app.auth_invitation($1)", [hacherJeton(jetonInv)]); return null; }
    catch (e) { return e; }
  })();
  v("⚠️ Le rôle MÉTIER ne peut pas lire une invitation par jeton",
    !!eAppInvitation && /permission/i.test(eAppInvitation.message), eAppInvitation?.message);

  const nouvelUtilisateur = await auth.query(
    "SELECT app.auth_accepter_invitation($1,$2,$3,$4) AS id",
    [hacherJeton(jetonInv), "empreinte-scrypt-essai", "Collab", "Essai"]);
  const COLLAB = nouvelUtilisateur.rows[0].id;
  v("L'invité crée son accès sans qu'on lui transmette de mot de passe", !!COLLAB);
  v("…son secret vit dans `identifiants`",
    (await verite.query("SELECT count(*)::int n FROM identifiants WHERE utilisateur_id=$1", [COLLAB])).rows[0].n === 1);
  v("…il est membre, avec le rôle prévu",
    (await verite.query(
      `SELECT count(*)::int n FROM membres m JOIN membres_roles mr ON mr.membre_id = m.id
        WHERE m.utilisateur_id=$1 AND m.entreprise_id=$2 AND mr.role_id=$3`,
      [COLLAB, JK, roleVideaste.id])).rows[0].n === 1);
  v("…et l'invitation est consommée",
    (await verite.query("SELECT utilisee_le FROM invitations WHERE id=$1", [invId])).rows[0].utilisee_le !== null);

  /* ⚠️ UN JETON NE SERT QU'UNE FOIS. */
  const eRejeu = await (async () => {
    try { await auth.query("SELECT app.auth_accepter_invitation($1,$2,$3,$4)",
      [hacherJeton(jetonInv), "autre", "X", "Y"]); return null; } catch (e) { return e; }
  })();
  v("Un jeton d'invitation ne se rejoue pas",
    !!eRejeu && /invalide|expirée/.test(eRejeu.message), eRejeu?.message);

  /* Suspension : l'accès tombe immédiatement, session ouverte comprise. */
  const jetonCollab = "v6-collab";
  await verite.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,$2, now() + interval '1 day', true)`, [COLLAB, jetonCollab]);
  jetons.set(COLLAB, jetonCollab);
  const avantSusp = await en(app, COLLAB, "SELECT app.entreprises_de_lacteur() AS e");
  v("Le nouveau collaborateur voit son entreprise", avantSusp.rows[0].e.includes(JK));

  const { rows: [membreCollab] } = await verite.query(
    "SELECT id FROM membres WHERE utilisateur_id=$1 AND entreprise_id=$2", [COLLAB, JK]);
  await en(app, PROPRIO, "SELECT app.admin_suspendre_membre($1,true,$2)",
    [membreCollab.id, "Hors saison"]);
  const pendantSusp = await en(app, COLLAB, "SELECT app.entreprises_de_lacteur() AS e");
  v("⚠️ Suspendu : sa session OUVERTE ne voit plus rien",
    !pendantSusp.rows[0].e.includes(JK), JSON.stringify(pendantSusp.rows[0].e));
  const eSuspDoc = await refuse(app, COLLAB, "SELECT * FROM app.permissions_effectives($1)", [JK]);
  const permsSusp = eSuspDoc ? [] : (await en(app, COLLAB,
    "SELECT * FROM app.permissions_effectives($1)", [JK])).rows;
  v("…et il n'a plus aucune permission", permsSusp.length === 0, `${permsSusp.length}`);

  await en(app, PROPRIO, "SELECT app.admin_suspendre_membre($1,false,NULL)", [membreCollab.id]);
  const apresSusp = await en(app, COLLAB, "SELECT app.entreprises_de_lacteur() AS e");
  v("La réactivation lui rend son accès", apresSusp.rows[0].e.includes(JK));

  /* ⚠️ ON NE SE SUSPEND PAS SOI-MÊME. */
  const { rows: [membrePropri] } = await verite.query(
    "SELECT id FROM membres WHERE utilisateur_id=$1 AND entreprise_id=$2", [PROPRIO, JK]);
  const eAuto = await refuse(app, PROPRIO, "SELECT app.admin_suspendre_membre($1,true,NULL)",
    [membrePropri.id]);
  v("Nul ne se suspend lui-même", !!eAuto, eAuto?.message);

  /* ⚠️ ON NE S'ACCORDE PAS DE PERMISSION. */
  const eEscalade = await refuse(app, COLLAB,
    "INSERT INTO membres_permissions (membre_id, permission_cle, accorde) VALUES ($1,'role.gerer',true)",
    [membreCollab.id]);
  v("Un collaborateur ne s'accorde pas `role.gerer`", !!eEscalade, eEscalade?.message);
  const eEscalade2 = await refuse(app, COLLAB,
    "SELECT app.admin_definir_permission($1,'finance.consolide.lire',true,'essai')",
    [membreCollab.id]);
  v("…ni par la fonction d'administration", !!eEscalade2, eEscalade2?.message);

  /* Révocation. */
  await en(app, PROPRIO, "SELECT app.admin_revoquer_membre($1)", [membreCollab.id]);
  const apresRevoc = await en(app, COLLAB, "SELECT app.entreprises_de_lacteur() AS e");
  v("La révocation coupe l'accès immédiatement", !apresRevoc.rows[0].e.includes(JK));
  v("…et l'adhésion reste dans l'historique",
    (await verite.query("SELECT retire_le FROM membres WHERE id=$1", [membreCollab.id])).rows[0].retire_le !== null);

  /* ═══════════════════════════════════════════════════════════════════════
     7. TRANSMISSION DES DEMANDES VIDÉO
     ═══════════════════════════════════════════════════════════════════════ */
  const propAuto = await verite.query(
    `SELECT * FROM propositions WHERE demande_id = $1`, [deposees.juin]);
  v("Le formulaire a créé la proposition vidéo", propAuto.rows.length === 1,
    JSON.stringify(propAuto.rows.map((p) => p.statut)));
  v("…préparée, mais PAS transmise", propAuto.rows[0].envoyee_le === null);

  const vuAvant = await en(app, VIDEASTE, "SELECT * FROM app.propositions_recues($1)", [VD]);
  v("⚠️ Tant qu'elle n'est pas transmise, le vidéaste ne la voit pas",
    vuAvant.rows.length === 0, `${vuAvant.rows.length}`);

  /* La proposition automatique vise l'entreprise destinataire configurée.
     On vérifie d'abord qu'elle pointe bien le vidéaste partenaire. */
  v("La proposition vise l'entreprise du vidéaste",
    propAuto.rows[0].entreprise_destinataire_id === VD,
    propAuto.rows[0].entreprise_destinataire_id);

  await en(app, PROPRIO, "SELECT app.transmettre_proposition($1)", [propAuto.rows[0].id]);
  const vuApres = await en(app, VIDEASTE, "SELECT * FROM app.propositions_recues($1)", [VD]);
  v("Transmise : elle apparaît chez le vidéaste", vuApres.rows.length === 1);
  v("⚠️ …sans AUCUNE coordonnée du couple",
    vuApres.rows[0].contact_nom === null && vuApres.rows[0].contact_email === null
      && vuApres.rows[0].contact_telephone === null
      && vuApres.rows[0].coordonnees_partagees === false,
    JSON.stringify(vuApres.rows[0]));
  v("…mais avec la date et le lieu, de quoi décider",
    !!vuApres.rows[0].date_mariage && !!vuApres.rows[0].lieu);
  v("Une notification interne est créée pour lui",
    (await verite.query(
      "SELECT count(*)::int n FROM notifications WHERE destinataire_id=$1 AND type='collaboration.proposee'",
      [VIDEASTE])).rows[0].n === 1);

  await en(app, VIDEASTE, "SELECT app.repondre_proposition($1,true,$2)",
    [propAuto.rows[0].id, "Disponible, avec plaisir."]);
  v("Le vidéaste accepte",
    (await verite.query("SELECT statut FROM propositions WHERE id=$1", [propAuto.rows[0].id])).rows[0].statut === "acceptee");
  const dossierVideo = await verite.query(
    "SELECT * FROM dossiers WHERE entreprise_id=$1 AND prestation='video' AND reference LIKE 'DEM-%'", [VD]);
  v("…ce qui crée SON dossier, chez lui, avec SA référence",
    dossierVideo.rows.length === 1 && dossierVideo.rows[0].reference.endsWith("-V"),
    JSON.stringify(dossierVideo.rows.map((d) => d.reference)));
  v("…non pilote : le mariage reste piloté par JoksWed",
    dossierVideo.rows[0].pilote === false);
  v("Le partage opérationnel est posé (planning, lieux)",
    (await verite.query(
      "SELECT count(*)::int n FROM partages_mariage WHERE entreprise_id=$1 AND categorie IN ('planning','lieux')",
      [VD])).rows[0].n >= 2);
  v("⚠️ …mais PAS les coordonnées du couple",
    (await verite.query(
      `SELECT count(*)::int n FROM partages_mariage
        WHERE entreprise_id=$1 AND categorie='coordonnees_clients' AND retire_le IS NULL`,
      [VD])).rows[0].n === 0);
  v("JoksWed est notifié de la réponse",
    (await verite.query(
      "SELECT count(*)::int n FROM notifications WHERE destinataire_id=$1 AND type='collaboration.repondue'",
      [PROPRIO])).rows[0].n === 1);

  /* Partage explicite des coordonnées, après acceptation. */
  await en(app, PROPRIO, "SELECT app.partager_coordonnees($1,$2,true)", [deposees.juin, VD]);
  const vuPartage = await en(app, VIDEASTE, "SELECT * FROM app.propositions_recues($1)", [VD]);
  v("Après partage explicite, le vidéaste voit les coordonnées",
    vuPartage.rows[0].coordonnees_partagees === true && !!vuPartage.rows[0].contact_email);
  await en(app, PROPRIO, "SELECT app.partager_coordonnees($1,$2,false)", [deposees.juin, VD]);
  const vuRetire = await en(app, VIDEASTE, "SELECT * FROM app.propositions_recues($1)", [VD]);
  v("…et le retrait du partage les reprend",
    vuRetire.rows[0].contact_email === null);

  /* Transmission MANUELLE : le client n'avait pas demandé de vidéo. */
  const propManuelle = await en(app, PROPRIO,
    "SELECT app.proposer_prestation($1,$2,'video',$3) AS id",
    [deposees.juillet, VD, "Le couple nous le demande finalement."]);
  v("Une proposition manuelle se crée", !!propManuelle.rows[0].id);
  v("…marquée comme telle",
    (await verite.query("SELECT origine FROM propositions WHERE id=$1",
      [propManuelle.rows[0].id])).rows[0].origine === "manuelle");
  const eSoi = await refuse(app, PROPRIO,
    "SELECT app.proposer_prestation($1,$2,'video',NULL)", [deposees.septembre, JK]);
  v("On ne se propose pas une prestation à soi-même", !!eSoi, eSoi?.message);

  /* Le vidéaste ne répond qu'à CE qui lui est adressé. */
  const propSeptembre = await verite.query(
    "SELECT id FROM propositions WHERE demande_id=$1", [deposees.septembre]);
  await verite.query("UPDATE propositions SET entreprise_destinataire_id=$1 WHERE id=$2",
    [VD, propSeptembre.rows[0].id]);
  const eRepondreAutrui = await refuse(app, PROPRIO,
    "SELECT app.repondre_proposition($1,true,NULL)", [propSeptembre.rows[0].id]);
  v("⚠️ JoksWed ne répond pas à la place du vidéaste", !!eRepondreAutrui, eRepondreAutrui?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     8. NOTIFICATIONS : PERMISSION ET PRÉFÉRENCE
     ═══════════════════════════════════════════════════════════════════════ */
  await en(app, PROPRIO, "SELECT app.notifier($1,$2,'echeance.proche','Essai',NULL,'/admin','v6-ech')",
    [ASSISTANT, JK]);
  v("⚠️ Une notification financière n'atteint pas qui ne voit pas les finances",
    (await verite.query(
      "SELECT count(*)::int n FROM notifications WHERE destinataire_id=$1 AND type='echeance.proche'",
      [ASSISTANT])).rows[0].n === 0);
  await en(app, PROPRIO, "SELECT app.notifier($1,$2,'echeance.proche','Essai',NULL,'/admin','v6-ech2')",
    [PROPRIO, JK]);
  v("…mais bien le propriétaire",
    (await verite.query(
      "SELECT count(*)::int n FROM notifications WHERE destinataire_id=$1 AND type='echeance.proche'",
      [PROPRIO])).rows[0].n === 1);

  await en(app, PROPRIO,
    `INSERT INTO preferences_notification (utilisateur_id, type, en_app, par_email)
     VALUES ($1,'dossier.modifie',false,false)`, [PROPRIO]);
  await en(app, PROPRIO, "SELECT app.notifier($1,$2,'dossier.modifie','Essai',NULL,'/admin','v6-dm')",
    [PROPRIO, JK]);
  v("Une préférence individuelle éteint bien la notification",
    (await verite.query(
      "SELECT count(*)::int n FROM notifications WHERE destinataire_id=$1 AND type='dossier.modifie'",
      [PROPRIO])).rows[0].n === 0);

  const ePrefAutrui = await refuse(app, PROPRIO,
    `INSERT INTO preferences_notification (utilisateur_id, type, en_app) VALUES ($1,'demande.recue',false)`,
    [ASSISTANT]);
  v("⚠️ Nul ne règle les notifications d'autrui", !!ePrefAutrui, ePrefAutrui?.message);

  const mesNotifs = await en(app, PROPRIO, "SELECT * FROM app.mes_notifications(50)");
  v("Chacun relit SES notifications", mesNotifs.rows.length > 0);
  const notifsVideaste = await en(app, VIDEASTE, "SELECT * FROM app.mes_notifications(50)");
  v("…et uniquement les siennes",
    notifsVideaste.rows.every((n) => n.type !== "echeance.proche"),
    JSON.stringify(notifsVideaste.rows.map((n) => n.type)));

  /* ═══════════════════════════════════════════════════════════════════════
     6 bis. PARRAINER UNE ENTREPRISE PARTENAIRE
     -----------------------------------------------------------------------
     Une entreprise neuve n'a aucun membre, donc personne pour y créer
     l'invitation qui amènera le premier. Le parrain résout l'œuf et la
     poule — et son rôle doit rester minuscule.
     ═══════════════════════════════════════════════════════════════════════ */
  const partenaire = (await en(app, PROPRIO,
    "SELECT app.creer_entreprise_partenaire($1,$2,$3,$4::citext) AS id",
    [JK, "partenaire-banc", "Partenaire du banc", "partenaire@exemple.invalid"]))
    .rows[0].id;
  v("Le propriétaire crée une entreprise partenaire", !!partenaire);
  const permsParrain = (await en(app, PROPRIO,
    "SELECT permission_cle FROM app.permissions_effectives($1)", [partenaire]))
    .rows.map((r) => r.permission_cle).sort();
  v("⚠️ Il n'y est que PARRAIN : inviter et révoquer, rien d'autre",
    permsParrain.join(",") === "membre.inviter,membre.revoquer",
    permsParrain.join(","));
  const eFinParrain = await refuse(app, PROPRIO,
    "SELECT * FROM app.finances_resume($1,current_date,current_date)", [partenaire]);
  v("…il ne voit AUCUNE finance de son partenaire", !!eFinParrain, eFinParrain?.message);
  const eDossiersParrain = await refuse(app, PROPRIO,
    "SELECT * FROM app.mes_dossiers($1)", [partenaire]);
  v("…ni aucun de ses dossiers", !!eDossiersParrain, eDossiersParrain?.message);

  /* ⚠️ ON NE SE CRÉE PAS UNE ENTREPRISE DEPUIS NULLE PART. */
  const eSansDroit = await refuse(app, ASSISTANT,
    "SELECT app.creer_entreprise_partenaire($1,$2,$3,$4::citext)",
    [JK, "pirate", "Pirate", "pirate@exemple.invalid"]);
  v("⚠️ Sans `membre.inviter`, on ne crée aucune entreprise",
    !!eSansDroit, eSansDroit?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     6 ter. LE PARRAIN, AU MICROSCOPE (V6.1)
     -----------------------------------------------------------------------
     Il est membre de l'entreprise du partenaire : le cloisonnement par
     entreprise ne le gêne donc en rien. Tout ce qui le retient, ce sont les
     politiques RESTRICTIVES par permission du palier 034.
     ═══════════════════════════════════════════════════════════════════════ */
  /* Il faut des lignes à voir pour que « il ne voit rien » veuille dire
     quelque chose : on pose un document et un paiement chez le partenaire. */
  await verite.query(
    `INSERT INTO documents (entreprise_id, type, statut, total_ht_cents,
                            total_tva_cents, total_ttc_cents, instantane)
     VALUES ($1,'devis','brouillon',50000,0,50000,'{}'::jsonb)`, [partenaire]);
  const { rows: [dossierPart] } = await verite.query(
    `INSERT INTO dossiers (mariage_id, entreprise_id, reference, prestation)
     SELECT m.id, $1, 'PART-0001', 'video' FROM mariages m LIMIT 1 RETURNING id`,
    [partenaire]);
  await verite.query(
    `INSERT INTO paiements (entreprise_id, dossier_id, montant_cents, moyen, statut,
                            confirme_par, confirme_le)
     VALUES ($1,$2,50000,'virement','confirme',$3, now())`,
    [partenaire, dossierPart.id, PROPRIO]);
  await verite.query(
    `INSERT INTO regimes_tva (entreprise_id, regime, mention_legale, debut_le)
     VALUES ($1,'franchise_base','Mention du partenaire', current_date)`, [partenaire]);

  const vuParrain = await en(app, PROPRIO, `
    SELECT (SELECT count(*)::int FROM documents  WHERE entreprise_id = $1) AS docs,
           (SELECT count(*)::int FROM paiements  WHERE entreprise_id = $1) AS pay,
           (SELECT count(*)::int FROM dossiers   WHERE entreprise_id = $1) AS dos,
           (SELECT count(*)::int FROM echeances  WHERE entreprise_id = $1) AS ech`,
    [partenaire]);
  v("⚠️ Le parrain ne lit AUCUN document du partenaire, même en SQL direct",
    vuParrain.rows[0].docs === 0, `${vuParrain.rows[0].docs} ligne(s)`);
  v("⚠️ …aucun paiement", vuParrain.rows[0].pay === 0, `${vuParrain.rows[0].pay}`);
  v("⚠️ …aucun dossier", vuParrain.rows[0].dos === 0, `${vuParrain.rows[0].dos}`);
  v("⚠️ …aucune échéance", vuParrain.rows[0].ech === 0, `${vuParrain.rows[0].ech}`);

  /* Et le partenaire, lui, les voit bien : une protection qui aveugle aussi
     le légitime est une panne, pas une protection. */
  const jetonPart = "v6-partenaire";
  const { rows: [uPart] } = await verite.query(
    `INSERT INTO utilisateurs (email, prenom, nom) VALUES ('chef.part@exemple.invalid','Chef','Part')
     RETURNING id`);
  const { rows: [mPart] } = await verite.query(
    `INSERT INTO membres (entreprise_id, utilisateur_id) VALUES ($1,$2) RETURNING id`,
    [partenaire, uPart.id]);
  await verite.query(
    `INSERT INTO membres_roles (membre_id, role_id)
     SELECT $1, id FROM roles WHERE entreprise_id = $2 AND cle = 'proprietaire'`,
    [mPart.id, partenaire]);
  await verite.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,$2, now() + interval '1 day', true)`, [uPart.id, jetonPart]);
  jetons.set(uPart.id, jetonPart);
  const vuChef = await en(app, uPart.id,
    "SELECT count(*)::int n FROM documents WHERE entreprise_id = $1", [partenaire]);
  v("…alors que le propriétaire du partenaire les voit",
    vuChef.rows[0].n === 1, `${vuChef.rows[0].n}`);

  /* Les informations fiscales : lecture oui, écriture non. */
  const eFiscal = await refuse(app, PROPRIO,
    `INSERT INTO regimes_tva (entreprise_id, regime, mention_legale, debut_le)
     VALUES ($1,'assujetti','Détourné', current_date)`, [partenaire]);
  v("⚠️ Le parrain ne modifie pas les informations fiscales du partenaire",
    !!eFiscal, eFiscal?.message);
  const eReglages = await refuse(app, PROPRIO,
    "SELECT app.admin_maj_entreprise($1,$2::jsonb)",
    [partenaire, JSON.stringify({ siret: "99999999999999" })]);
  v("…ni ses réglages", !!eReglages, eReglages?.message);
  const eRenommer = await refuse(app, PROPRIO,
    "UPDATE entreprises SET nom_commercial = 'Détournée' WHERE id = $1", [partenaire]);
  v("…ni son nom, en SQL direct", !!eRenommer, eRenommer?.message);

  /* ⚠️ ON N'INVITE PAS PLUS HAUT QUE SOI — SAUF POUR AMORCER. */
  const { rows: [roleProprioPart] } = await verite.query(
    "SELECT id FROM roles WHERE entreprise_id = $1 AND cle = 'proprietaire'", [partenaire]);
  const eInviteHaut = await refuse(app, PROPRIO,
    "SELECT app.admin_creer_invitation($1,$2::citext,NULL,NULL,$3,ARRAY[$4]::uuid[],7,NULL)",
    [partenaire, "complice@exemple.invalid", hacherJeton(engendrerJeton()),
     roleProprioPart.id]);
  v("⚠️ Le parrain ne peut plus inviter un compte plus puissant que lui",
    !!eInviteHaut && /conférerait des permissions/.test(eInviteHaut.message),
    eInviteHaut?.message);
  v("…parce que l'entreprise n'est plus en amorçage",
    (await verite.query("SELECT app.entreprise_en_amorcage($1) AS x", [partenaire]))
      .rows[0].x === false);

  /* L'amorçage, lui, reste possible : c'est sa raison d'être. */
  const neuve = (await en(app, PROPRIO,
    "SELECT app.creer_entreprise_partenaire($1,$2,$3,$4::citext) AS id",
    [JK, "partenaire-neuf", "Partenaire neuf", "neuf@exemple.invalid"])).rows[0].id;
  const { rows: [roleNeuf] } = await verite.query(
    "SELECT id FROM roles WHERE entreprise_id = $1 AND cle = 'proprietaire'", [neuve]);
  const amorcage = await en(app, PROPRIO,
    "SELECT app.admin_creer_invitation($1,$2::citext,NULL,NULL,$3,ARRAY[$4]::uuid[],7,NULL) AS id",
    [neuve, "chef.neuf@exemple.invalid", hacherJeton(engendrerJeton()), roleNeuf.id]);
  v("…mais l'amorçage d'une entreprise neuve reste permis",
    !!amorcage.rows[0].id);

  /* Rendre son tablier. */
  await en(app, PROPRIO, "SELECT app.quitter_entreprise($1)", [partenaire]);
  const apresDepart = await en(app, PROPRIO, "SELECT app.entreprises_de_lacteur() AS e");
  v("Le parrain peut se retirer une fois l'entreprise autonome",
    !apresDepart.rows[0].e.includes(partenaire));
  const eDernier = await refuse(app, PROPRIO, "SELECT app.quitter_entreprise($1)", [JK]);
  v("⚠️ …mais pas s'il est le dernier à pouvoir administrer",
    !!eDernier && /dernier/.test(eDernier.message), eDernier?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     6 quater. TRANSMISSION AUTOMATIQUE (V6.1)
     ═══════════════════════════════════════════════════════════════════════ */
  v("Le vidéaste partenaire est opérationnel",
    (await verite.query("SELECT app.destinataire_operationnel($1) AS x", [VD])).rows[0].x === true);
  v("⚠️ Une entreprise sans membre ne l'est pas",
    (await verite.query("SELECT app.destinataire_operationnel($1) AS x", [neuve])).rows[0].x === false);

  /* ═══════════════════════════════════════════════════════════════════════
     7 bis. LE VIDÉASTE FACTURE SA PROPRE PRESTATION
     -----------------------------------------------------------------------
     ⚠️ SON DOSSIER, SA NUMÉROTATION, SES MONTANTS.
     Le mariage est commun ; le commercial ne l'est jamais. On vérifie que
     sa série comptable est INDÉPENDANTE de celle de JoksWed, et que ses
     encaissements n'entrent dans aucun total de JoksWed.
     ═══════════════════════════════════════════════════════════════════════ */
  const sonDossier = dossierVideo.rows[0].id;
  const sonDevis = await transaction(app, VIDEASTE, (q) =>
    gen.genererDevisDepuisDossier(q, sonDossier, VD, VIDEASTE, {
      lignes: [
        { libelle: "Film de mariage, 10 h de présence", prixCents: 180000 },
        { libelle: "Teaser 1 minute", prixCents: 20000 },
      ],
      nombreEcheances: 2,
    }));
  v("Le vidéaste prépare SON devis depuis SON dossier", !!sonDevis.documentId);
  const sonDoc = (await verite.query(
    "SELECT * FROM documents WHERE id = $1", [sonDevis.documentId])).rows[0];
  v("…ancré au dossier, pas à une demande",
    sonDoc.dossier_id === sonDossier && sonDoc.demande_id === null);
  v("…à SON montant", sonDoc.total_ttc_cents === 200000, `${sonDoc.total_ttc_cents}`);
  v("…avec SON identité de prestataire",
    sonDoc.instantane.prestataire.nomCommercial !== "JoksWed",
    sonDoc.instantane.prestataire.nomCommercial);

  /* ⚠️ SANS PARTAGE, PAS DE NOM DE COUPLE SUR SON DEVIS. */
  v("⚠️ Sans partage, son devis ne nomme pas le couple",
    !/Alix|Dominique/.test(JSON.stringify(sonDoc.instantane.client)),
    JSON.stringify(sonDoc.instantane.client));

  /* ⚠️ SES DOCUMENTS N'ONT RIEN D'AUTOMATIQUE : SON ENTREPRISE DOIT ÊTRE
     CONFIGURÉE. Tant que son SIRET et son adresse manquent, la garde refuse
     — avec SES motifs à lui, pas ceux de JoksWed. */
  const refusVideo = await en(app, VIDEASTE,
    "SELECT * FROM app.emettre_document($1)", [sonDevis.documentId]);
  v("⚠️ Tant que SON entreprise est incomplète, l'émission est refusée",
    refusVideo.rows[0].emis === false
      && refusVideo.rows[0].motifs.some((m) => /SIRET/.test(m)),
    JSON.stringify(refusVideo.rows[0].motifs));

  await en(app, VIDEASTE, `SELECT app.admin_maj_entreprise($1,$2::jsonb)`,
    [VD, JSON.stringify({
      raison_sociale: "Vidéaste partenaire", siret: "12345678901234",
      code_ape: "5911C", adresse_ligne1: "1 rue d'Essai",
      code_postal: "95100", ville: "Argenteuil", telephone: "06 00 00 00 00",
    })]);

  await emettre(app, VIDEASTE, sonDevis.documentId);
  const sonNumero = (await verite.query(
    "SELECT numero FROM documents WHERE id=$1", [sonDevis.documentId])).rows[0].numero;
  v("Son devis obtient SON numéro", /^TEST-DEV-\d{4}-0001$/.test(sonNumero ?? ""), sonNumero);
  const numeroJk = (await verite.query(
    "SELECT numero FROM documents WHERE id=$1", [devisJuillet.documentId])).rows[0].numero;
  v("⚠️ Les deux séries comptables sont INDÉPENDANTES",
    sonNumero === numeroJk,
    `${sonNumero} vs ${numeroJk} — chaque entreprise a sa propre série`);

  /* Contrat et facture dérivés de SON devis. */
  const sonContrat = await transaction(app, VIDEASTE, (q) =>
    gen.genererContratDepuisDevis(q, sonDevis.documentId, VD, VIDEASTE));
  v("Il prépare son contrat depuis son devis", !!sonContrat.documentId);
  v("…ancré au même dossier",
    (await verite.query("SELECT dossier_id FROM documents WHERE id=$1",
      [sonContrat.documentId])).rows[0].dossier_id === sonDossier);
  const saFacture = await transaction(app, VIDEASTE, (q) =>
    gen.genererFactureDepuisDevis(q, sonDevis.documentId, "acompte", VD, VIDEASTE));
  await emettre(app, VIDEASTE, saFacture.documentId);
  v("…et sa facture d'acompte, à 1 000,00 €",
    (await verite.query("SELECT total_ttc_cents FROM documents WHERE id=$1",
      [saFacture.documentId])).rows[0].total_ttc_cents === 100000);

  /* Ses paiements, sur son dossier. */
  await en(app, VIDEASTE,
    `SELECT app.confirmer_paiement(
       app.enregistrer_paiement_dossier($1,$2,'virement','acompte',NULL,NULL,$3,NULL))`,
    [sonDossier, 100000, "v6-video-ac"]);
  const saSituation = (await en(app, VIDEASTE,
    "SELECT * FROM app.situation_devis($1)", [sonDevis.documentId])).rows[0];
  v("Sa situation : 2 000 € contractualisés, 1 000 € encaissés",
    saSituation.total_prestation_cents === 200000 && saSituation.encaisse_cents === 100000,
    JSON.stringify(saSituation));

  /* ⚠️ RIEN DE TOUT CELA N'ENTRE DANS LES COMPTES DE JOKSWED. */
  const resumeJkApres = (await en(app, PROPRIO,
    `SELECT * FROM app.finances_resume($1, date_trunc('year', current_date)::date,
                                          (date_trunc('year', current_date) + interval '1 year')::date)`,
    [JK])).rows[0];
  v("⚠️ Les 1 000 € du vidéaste n'apparaissent PAS chez JoksWed",
    resumeJkApres.encaisse_cents === resume.encaisse_cents,
    `${resumeJkApres.encaisse_cents} vs ${resume.encaisse_cents}`);
  const sesFinancesApres = (await en(app, VIDEASTE,
    `SELECT * FROM app.finances_resume($1, date_trunc('year', current_date)::date,
                                          (date_trunc('year', current_date) + interval '1 year')::date)`,
    [VD])).rows[0];
  /* ⚠️ ASSERTION CORRIGÉE : ses 1 000 € SONT chez lui, c'est le but.
     Ce qui doit être vrai, c'est que SES chiffres ne sont QUE les siens. */
  v("…et chez lui, il ne voit QUE ses propres chiffres",
    sesFinancesApres.encaisse_cents === 100000
      && sesFinancesApres.engage_cents === 200000
      && sesFinancesApres.encaisse_cents !== resumeJkApres.encaisse_cents,
    JSON.stringify(sesFinancesApres));
  v("…et ses encours de DOSSIER sont bien comptés",
    sesFinancesApres.attendu_cents === 100000,
    `attendu ${sesFinancesApres.attendu_cents}`);

  /* Son écran de dossiers ne montre que les siens. */
  const sesDossiers = await en(app, VIDEASTE, "SELECT * FROM app.mes_dossiers($1)", [VD]);
  v("Il voit SES dossiers", sesDossiers.rows.length >= 1);
  /* ⚠️ UN BROUILLON N'EST PAS UN MONTANT DÛ.
     Son devis est émis ici, donc il compte. Un dossier sans devis émis doit
     afficher zéro, pas le montant d'un brouillon. */
  const sansDevisEmis = sesDossiers.rows.filter((d) => d.devis_statut !== "emis");
  v("Un dossier sans devis émis n'affiche aucun montant dû",
    sansDevisEmis.every((d) => d.total_cents === 0 && d.reste_du_cents === 0),
    JSON.stringify(sansDevisEmis.map((d) => [d.reference, d.devis_statut, d.total_cents])));
  /* ⚠️ ON VÉRIFIE LE PROPRIÉTAIRE, PAS LA FORME DE LA RÉFÉRENCE.
     Une première version testait un suffixe « -V » : les fixtures en portent
     d'autres, et le banc échouait sans que rien ne soit cassé. Un invariant
     doit porter sur ce qui compte — ici, l'entreprise à qui le dossier
     appartient. */
  const proprietairesDossiers = await verite.query(
    "SELECT DISTINCT entreprise_id FROM dossiers WHERE id = ANY($1::uuid[])",
    [sesDossiers.rows.map((d) => d.dossier_id)]);
  v("…et aucun dossier de JoksWed",
    proprietairesDossiers.rows.every((r) => r.entreprise_id === VD),
    proprietairesDossiers.rows.map((r) => r.entreprise_id).join(", "));
  const eDossiersAutrui = await refuse(app, VIDEASTE, "SELECT * FROM app.mes_dossiers($1)", [JK]);
  v("⚠️ …et il ne peut pas demander ceux de JoksWed", !!eDossiersAutrui, eDossiersAutrui?.message);

  /* ⚠️ UN MOUVEMENT DOIT S'ANCRER QUELQUE PART, ET À UNE SEULE CHOSE. */
  const eDeuxAncrages = await refuse(verite, PROPRIO,
    `INSERT INTO paiements (entreprise_id, demande_id, dossier_id, montant_cents, moyen)
     VALUES ($1,$2,$3,1000,'virement')`, [JK, deposees.juillet, sonDossier]);
  v("Un paiement ne peut pas pendre à la fois à une demande et à un dossier",
    !!eDeuxAncrages, eDeuxAncrages?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     8 bis. LE DRAIN : CE QUI PARTIRAIT RÉELLEMENT
     -----------------------------------------------------------------------
     ⚠️ ON N'ENVOIE RIEN. Le fournisseur est le SIMULATEUR : on inspecte ce
     qui SERAIT parti, destinataire par destinataire, pour vérifier qu'aucune
     coordonnée de client ne s'y glisse et que le lien d'invitation est bien
     à usage unique.
     ═══════════════════════════════════════════════════════════════════════ */
  process.env.EMAIL_FOURNISSEUR = "simule";
  process.env.SITE_URL = "https://exemple.invalid";
  process.env.DATABASE_URL_APP = urlMigrateur(base);
  const { boiteDeTest, viderBoiteDeTest } = await import("../lib/email/fournisseur.ts");
  const { drainer } = await import("../lib/demandes/drain.ts");

  /* Une seconde invitation, puisque la première a déjà été consommée. */
  const jetonInv2 = engendrerJeton();
  const { chiffrer } = await import("../lib/auth/secrets.ts");
  const inv2 = (await en(app, PROPRIO,
    "SELECT app.admin_creer_invitation($1,$2,$3,$4,$5,ARRAY[$6]::uuid[],$7,$8) AS id",
    [JK, "second.collab@exemple.invalid", "Second", "Essai",
     hacherJeton(jetonInv2), roleVideaste.id, 7, chiffrer(jetonInv2)])).rows[0].id;
  await en(app, PROPRIO, "SELECT app.admin_envoyer_invitation($1)", [inv2]);

  viderBoiteDeTest();
  const bilan = await drainer(50);
  v("Le drain traite les événements en attente", bilan.traites > 0,
    JSON.stringify(bilan));

  const boite = boiteDeTest();
  const mailInvitation = boite.find((m) => m.destinataire === "second.collab@exemple.invalid");
  v("Un e-mail d'invitation est composé", !!mailInvitation,
    boite.map((m) => m.destinataire).join(", "));
  v("…et porte le lien d'activation, pas un mot de passe",
    mailInvitation?.texte.includes(`/admin/invitation/${jetonInv2}`)
      && !/mot de passe\s*:/i.test(mailInvitation?.texte ?? ""),
    (mailInvitation?.texte ?? "").slice(0, 160));
  v("⚠️ Le jeton chiffré est EFFACÉ après l'envoi",
    (await verite.query("SELECT jeton_chiffre FROM invitations WHERE id=$1", [inv2]))
      .rows[0].jeton_chiffre === null);

  const mailProposition = boite.find((m) => m.destinataire === "videaste@exemple.invalid");
  v("Un e-mail de proposition est composé pour le vidéaste", !!mailProposition,
    boite.map((m) => m.destinataire).join(", "));
  v("⚠️ …sans AUCUNE coordonnée de couple",
    !!mailProposition
      && !/alix\.dominique|Alix|Dominique/i.test(mailProposition.texte)
      && !/06 00 00 00 00/.test(mailProposition.texte),
    (mailProposition?.texte ?? "").slice(0, 200));
  v("…ni aucun montant",
    !!mailProposition && !/€/.test(mailProposition.texte));

  /* ⚠️ ASSERTION CORRIGÉE : LE DRAIN ÉCRIT BIEN AUX COUPLES.
     C'est l'accusé de réception de la V4, et c'est voulu. Ce qui doit être
     vrai, c'est qu'aucun couple ne reçoive quoi que ce soit d'un AUTRE
     dossier — un gabarit mal paramétré enverrait les trois à chacun. */
  const auxCouples = boite.filter((m) => /@exemple\.invalid/.test(m.destinataire)
    && mariages.some((x) => x.email === m.destinataire));
  v("Chaque couple reçoit exactement un accusé", auxCouples.length === 3,
    `${auxCouples.length}`);
  v("⚠️ …et aucun ne porte le nom d'un autre couple",
    auxCouples.every((m) => {
      const sien = mariages.find((x) => x.email === m.destinataire);
      return mariages
        .filter((x) => x !== sien)
        .every((autre) => !m.texte.includes(autre.nom.split(" ")[0]));
    }),
    auxCouples.map((m) => m.destinataire).join(", "));

  /* ⚠️ « AUCUN DOUBLON » N'EST PAS « AUCUN ENVOI ».
     Le drain d'un `demande.recue` peut CRÉER un événement de transmission :
     le passage suivant le traitera, et c'est un premier envoi, pas un
     doublon. L'invariant qui compte est l'unicité des clés d'idempotence
     dans `envois_email` — une première version comparait la boîte à vide et
     échouait sur un envoi parfaitement légitime. */
  viderBoiteDeTest();
  await drainer(50);
  await drainer(50);
  const doublons = await verite.query(
    `SELECT cle_idempotence, count(*)::int n FROM envois_email
      WHERE cle_idempotence IS NOT NULL
      GROUP BY cle_idempotence HAVING count(*) > 1`);
  v("Aucun envoi n'est journalisé deux fois sous la même clé",
    doublons.rows.length === 0,
    doublons.rows.map((r) => `${r.cle_idempotence}×${r.n}`).join(", "));
  const restants = await verite.query(
    "SELECT count(*)::int n FROM evenements WHERE traite_le IS NULL");
  v("…et la file finit par se vider", restants.rows[0].n === 0, `${restants.rows[0].n}`);

  /* ═══════════════════════════════════════════════════════════════════════
     9. COHÉRENCE DES CALCULS
     ═══════════════════════════════════════════════════════════════════════ */
  const toutes = await en(app, PROPRIO, "SELECT * FROM app.finances_par_demande($1)", [JK]);
  const sommeEncaisse = toutes.rows.reduce((t, r) => t + r.encaisse_cents, 0);
  v("La somme par mariage égale le total de l'entreprise",
    sommeEncaisse === resume.encaisse_cents, `${sommeEncaisse} vs ${resume.encaisse_cents}`);
  v("Aucun montant n'est fractionnaire",
    toutes.rows.every((r) => Number.isInteger(r.encaisse_cents) && Number.isInteger(r.facture_cents)));
  const saisonFin = await en(app, PROPRIO, "SELECT * FROM app.saison_mariages($1,$2,$3)",
    [JK, `${annee}-01-01`, `${annee + 1}-01-01`]);
  const ligneSaison = saisonFin.rows.find((r) => r.demande_id === deposees.juillet);
  const ligneFin = toutes.rows.find((r) => r.demande_id === deposees.juillet);
  v("⚠️ Saison et finances affichent le MÊME chiffre",
    ligneSaison.encaisse_cents === ligneFin.encaisse_cents,
    `${ligneSaison.encaisse_cents} vs ${ligneFin.encaisse_cents}`);

  for (const c of [app, auth, verite]) await c.end();
} catch (e) {
  console.error("\n✗ Le banc s'est interrompu :", e?.message ?? e);
  resultats.push({ nom: "Le banc va jusqu'au bout", ok: false, detail: String(e?.message ?? e) });
} finally {
  /* ⚠️ FERMER LE POOL AVANT D'ARRÊTER POSTGRES.
     `deposerDemande` passe par le pool partagé de l'application. Laissé
     ouvert, il émet un « error » non géré quand le serveur s'arrête — et ce
     cri masque le bilan du banc. */
  try {
    const { fermerPool } = await import("../lib/db/client.ts");
    await fermerPool();
  } catch { /* le pool n'a jamais été ouvert */ }
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves V6 passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc V6 : tout est vert.");
