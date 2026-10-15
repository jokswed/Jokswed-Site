/* =============================================================================
   BANC CRM — DOSSIER MANUEL, ÉCHÉANCIER, PLANNING, FICHIERS, CALENDRIER
   -----------------------------------------------------------------------------
   ⚠️ CE BANC SE CONNECTE EN `jokswed_app`, LE RÔLE DE L'APPLICATION.

   Il ne vérifie pas que « le code marche » : il rejoue le scénario métier
   complet — un mariage pris au téléphone, 1 300 € en 3×, un acompte reçu, une
   date déplacée, un prestataire photobooth — et il vérifie à chaque étape ce
   qu'un AUTRE tenant voit, c'est-à-dire rien.

   ⚠️ BASE JETABLE, ET ON VÉRIFIE QU'ELLE EST VIDE.
   La date du scénario est fixe (17 juillet 2027, comme demandé). Elle ne peut
   croiser aucune réservation réelle parce que la base est créée pour ce banc
   et détruite après — mais on l'affirme quand même avant d'écrire, plutôt que
   de le supposer.

   Aucun e-mail n'est envoyé : le drain n'est pas lancé.
   ============================================================================= */
import { createRequire } from "node:module";
import pg from "pg";
const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

import { demarrer, urlMigrateur, urlApplication, baseVierge } from "./pg-dev.mjs";
/* ⚠️ LE MÊME ANALYSEUR DE TYPE QUE LA PRODUCTION.
   `lib/db/client.ts` pose `pg.types.setTypeParser(1082, …)` : une colonne
   `date` reste la chaîne « AAAA-MM-JJ » au lieu de devenir un `Date` à minuit
   LOCAL, qui recule d'un jour une fois reformaté en UTC. Sans cet import, le
   banc comparerait des objets `Date` là où la production compare des chaînes
   — il mesurerait autre chose que ce qui tourne. */
process.env.DATABASE_URL_APP ??= "postgres://inutilise/0";
process.env.DATABASE_URL_AUTH ??= "postgres://inutilise/0";
await import("../lib/db/client.ts");
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

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
const eur = (c) => (c / 100).toFixed(2);

const pgdev = await demarrer();
let app, verite;
try {
  const base = await baseVierge("jokswed_crm");
  await migrer(urlMigrateur(base), { silencieux: true });
  const f = await semer(urlMigrateur(base), { silencieux: true });

  app    = new pg.Client({ connectionString: urlApplication(base) });
  verite = new pg.Client({ connectionString: urlMigrateur(base) });
  for (const c of [app, verite]) { c.on("error", () => {}); await c.connect(); }

  const JK = f.entreprises.jokswed;
  const VD = f.entreprises.video;
  for (const [nom, id] of Object.entries(f.utilisateurs)) {
    const jeton = `crm-${nom}`;
    await verite.query(
      `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
       VALUES ($1,$2, now() + interval '1 day', true)`, [id, jeton]);
    jetons.set(id, jeton);
  }
  const PROPRIO = f.utilisateurs.proprietaire;
  const VIDEASTE = f.utilisateurs.videaste;

  const JOUR = "2027-07-17";
  const { rows: [libre] } = await verite.query(
    "SELECT count(*)::int n FROM demandes WHERE date_mariage = $1", [JOUR]);
  v("La journée du scénario est vide avant d'écrire", libre.n === 0, `${libre.n} demande(s)`);

  /* ═══════════════════════════════════════════════════════════════════════
     1. CRÉER UN DOSSIER MANUEL
     ═══════════════════════════════════════════════════════════════════════ */
  const champs = {
    contact_nom: "Marie Test", contact_nom_2: "Jean Test",
    contact_email: "marie.jean@exemple.invalid", contact_telephone: "06 00 00 00 01",
    contact_adresse: "1 rue du Banc, 27720 Dangu",
    date_mariage: JOUR, heure_debut: "10:00", heure_fin: "23:30",
    lieu_mairie: "Mairie de Dangu", lieu_ceremonie: "Église de Dangu",
    lieu_reception: "Domaine du Banc", lieu: "Domaine du Banc",
    ville: "Dangu", departement: "27", invites_estimes: "120",
    formule_nom: "Prestation sur mesure",
    prix_total_cents: "130000", nombre_echeances: "3",
    photobooth_360: true,
    cle_idempotence: "banc-crm-dossier-1",
  };
  const { rows: [cree] } = await en(app, PROPRIO,
    "SELECT * FROM app.creer_demande_manuelle($1,$2::jsonb)", [JK, JSON.stringify(champs)]);
  const D1 = cree.demande_id;
  v("Un dossier manuel est créé", Boolean(D1) && /^DEM-\d{4}-\d{4}$/.test(cree.reference),
    cree.reference);

  const { rows: [fiche] } = await en(app, PROPRIO,
    "SELECT * FROM demandes WHERE id = $1", [D1]);
  v("Il porte l'origine « manuel »", fiche.origine === "manuel", fiche.origine);
  v("Les deux personnes du couple sont enregistrées",
    fiche.contact_nom === "Marie Test" && fiche.contact_nom_2 === "Jean Test");
  v("Les horaires et les trois lieux sont enregistrés",
    String(fiche.heure_debut).startsWith("10:00") && fiche.lieu_mairie === "Mairie de Dangu"
      && fiche.lieu_ceremonie === "Église de Dangu" && fiche.lieu_reception === "Domaine du Banc");
  v("L'option Photobooth 360 est attachée au dossier", fiche.photobooth_360 === true);
  /* ⚠️ AUCUN TARIF PHOTOBOOTH N'A ÉTÉ DONNÉ : la colonne reste vide, et
     l'affichage dit « sur devis ». Un prix inventé ici serait parti sur un
     devis. */
  v("Aucun tarif Photobooth n'est inventé", fiche.photobooth_prix_cents === null,
    String(fiche.photobooth_prix_cents));
  v("Le dossier n'est PAS confirmé sans acompte reçu",
    fiche.mariage_id === null && fiche.statut === "a_traiter", fiche.statut);

  /* ⚠️ CRÉER N'ENVOIE RIEN. Un mariage pris au téléphone ne doit pas
     déclencher d'accusé de réception : le couple vient de raccrocher. */
  const { rows: [file] } = await verite.query(
    "SELECT count(*)::int n FROM evenements WHERE charge_utile->>'demande_id' = $1", [D1]);
  v("Créer un dossier manuel ne met aucun e-mail en file", file.n === 0, `${file.n} évènement(s)`);

  /* Idempotence : un double envoi de formulaire ne dédouble pas le mariage. */
  const { rows: [rejeu] } = await en(app, PROPRIO,
    "SELECT * FROM app.creer_demande_manuelle($1,$2::jsonb)", [JK, JSON.stringify(champs)]);
  v("Un rejeu de la même clé ne crée pas un second dossier", rejeu.demande_id === D1);

  /* ═══════════════════════════════════════════════════════════════════════
     2. L'ÉCHÉANCIER : 1 300 € EN 3×
     ═══════════════════════════════════════════════════════════════════════ */
  const lire = async () => (await en(app, PROPRIO,
    "SELECT * FROM app.echeancier_demande($1)", [D1])).rows;
  let ech = await lire();
  v("Trois échéances sont créées", ech.length === 3, `${ech.length}`);
  v("1 300 € en 3× donnent 433,33 / 433,33 / 433,34",
    ech.map((e) => e.montant_cents).join("/") === "43333/43333/43334",
    ech.map((e) => eur(e.montant_cents)).join(" / "));
  v("La somme des échéances fait exactement le total",
    ech.reduce((t, e) => t + e.montant_cents, 0) === 130000);
  v("Les natures sont acompte / intermédiaire / solde",
    ech.map((e) => e.nature).join("/") === "acompte/intermediaire/solde",
    ech.map((e) => e.nature).join("/"));
  v("Chaque échéance part « à recevoir »",
    ech.every((e) => e.etat === "a_recevoir"));

  /* 1× et 2×, sur un autre dossier pour ne pas perturber le scénario. */
  const { rows: [autre] } = await en(app, PROPRIO,
    "SELECT * FROM app.creer_demande_manuelle($1,$2::jsonb)",
    [JK, JSON.stringify({ contact_nom: "Test 1x2x", date_mariage: "2027-08-21",
                          cle_idempotence: "banc-crm-dossier-2" })]);
  const D2 = autre.demande_id;
  await en(app, PROPRIO, "SELECT app.definir_echeancier($1,100001,1)", [D2]);
  let e2 = (await en(app, PROPRIO, "SELECT * FROM app.echeancier_demande($1)", [D2])).rows;
  v("En 1×, une seule échéance porte tout",
    e2.length === 1 && e2[0].montant_cents === 100001 && e2[0].nature === "unique");
  await en(app, PROPRIO, "SELECT app.definir_echeancier($1,100001,2)", [D2]);
  e2 = (await en(app, PROPRIO, "SELECT * FROM app.echeancier_demande($1)", [D2])).rows;
  v("En 2×, le centime impair va sur la dernière",
    e2.map((x) => x.montant_cents).join("/") === "50000/50001",
    e2.map((x) => x.montant_cents).join("/"));
  const trop = await refuse(app, PROPRIO, "SELECT app.definir_echeancier($1,2,3)", [D2]);
  v("Un total trop faible pour trois échéances est refusé",
    trop !== null && /insuffisant/.test(trop.message), trop?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     3. LE PAIEMENT : DÉCLARÉ, PUIS CONFIRMÉ
     ═══════════════════════════════════════════════════════════════════════ */
  const situation = async (d = D1) => (await en(app, PROPRIO,
    "SELECT * FROM app.situation_financiere($1)", [d])).rows[0];

  let s = await situation();
  v("Le total vient du prix convenu, sans devis émis",
    s.total_prestation_cents === 130000, String(s.total_prestation_cents));
  v("Rien n'est payé au départ", s.encaisse_cents === 0 && s.reste_du_cents === 130000);

  const { rows: [p1] } = await en(app, PROPRIO,
    "SELECT app.enregistrer_paiement_echeance($1,$2,$3,$4,$5,$6,$7,$8) AS id",
    [D1, ech[0].echeance_id, 43333, "virement", "acompte", "VIR-001", JOUR, "crm-p1"]);
  v("Un paiement manuel est enregistré", Boolean(p1.id));

  s = await situation();
  v("⚠️ Un paiement DÉCLARÉ n'entre dans aucun total",
    s.encaisse_cents === 0 && s.reste_du_cents === 130000, `encaissé ${eur(s.encaisse_cents)}`);
  ech = await lire();
  v("L'échéance passe à « déclaré », pas à « reçu »", ech[0].etat === "declare", ech[0].etat);

  /* ⚠️ CONFIRMER L'ACOMPTE CONFIRME LE DOSSIER, DANS LA MÊME TRANSACTION. */
  const { rows: [conf] } = await en(app, PROPRIO,
    "SELECT * FROM app.confirmer_paiement_et_dossier($1)", [p1.id]);
  v("Confirmer le paiement réussit", conf.confirme === true, conf.motif ?? "");
  v("…et inscrit le mariage au carnet", Boolean(conf.mariage_id), conf.motif ?? "sans mariage");

  s = await situation();
  v("Payé : 433,33 €", s.encaisse_cents === 43333, eur(s.encaisse_cents));
  v("Reste : 866,67 €", s.reste_du_cents === 86667, eur(s.reste_du_cents));
  ech = await lire();
  v("La première échéance est « reçue », les deux autres « à recevoir »",
    ech.map((e) => e.etat).join("/") === "recu/a_recevoir/a_recevoir",
    ech.map((e) => e.etat).join("/"));

  const { rows: [apres] } = await en(app, PROPRIO,
    "SELECT * FROM demandes WHERE id = $1", [D1]);
  v("Le dossier est confirmé", apres.statut === "confirmee", apres.statut);
  const MARIAGE = apres.mariage_id;
  const DOSSIER = apres.dossier_id;
  v("Un mariage ET un dossier existent derrière la confirmation",
    Boolean(MARIAGE) && Boolean(DOSSIER));

  /* Pas de doublon : reconfirmer ne dédouble ni le mariage ni le dossier. */
  await en(app, PROPRIO, "SELECT app.confirmer_demande($1)", [D1]);
  const { rows: [compte] } = await verite.query(
    `SELECT (SELECT count(*)::int FROM mariages WHERE id = $1) m,
            (SELECT count(*)::int FROM dossiers WHERE mariage_id = $1) d`, [MARIAGE]);
  v("Confirmer deux fois ne crée pas un second mariage ni un second dossier",
    compte.m === 1 && compte.d === 1, `${compte.m} mariage / ${compte.d} dossier`);

  /* ⚠️ UN ENCAISSEMENT NE SE RECALCULE JAMAIS. */
  await en(app, PROPRIO, "SELECT app.definir_echeancier($1,150000,3)", [D1]);
  ech = await lire();
  v("Changer le prix ne touche pas l'échéance déjà encaissée",
    ech[0].montant_cents === 43333, String(ech[0].montant_cents));
  v("Seul le restant est réparti à nouveau",
    ech[1].montant_cents + ech[2].montant_cents === 150000 - 43333,
    ech.map((e) => e.montant_cents).join("/"));
  v("La somme des trois fait toujours le nouveau total",
    ech.reduce((t, e) => t + e.montant_cents, 0) === 150000);

  const sousEau = await refuse(app, PROPRIO, "SELECT app.definir_echeancier($1,40000,3)", [D1]);
  v("Un prix inférieur à ce qui est encaissé est refusé",
    sousEau !== null && /encaissé/.test(sousEau.message), sousEau?.message);

  /* On revient à 1 300 € pour la suite du scénario. */
  await en(app, PROPRIO, "SELECT app.definir_echeancier($1,130000,3)", [D1]);

  /* ⚠️ ON N'ENCAISSE PAS PLUS QUE DÛ. */
  const { rows: [pTrop] } = await en(app, PROPRIO,
    "SELECT app.enregistrer_paiement_echeance($1,NULL,$2,$3,$4,NULL,$5,$6) AS id",
    [D1, 200000, "virement", "partiel", JOUR, "crm-trop"]);
  const depassement = await refuse(app, PROPRIO,
    "SELECT * FROM app.confirmer_paiement_et_dossier($1)", [pTrop.id]);
  v("Encaisser plus que le total de la prestation est refusé",
    depassement !== null && /supérieur au total/.test(depassement.message),
    depassement?.message);

  /* Une échéance d'un AUTRE dossier ne se rattache pas à celui-ci. */
  const etrangere = await refuse(app, PROPRIO,
    "SELECT app.enregistrer_paiement_echeance($1,$2,$3,$4,$5,NULL,$6,$7)",
    [D1, e2[0].echeance_id, 1000, "virement", "partiel", JOUR, "crm-etrangere"]);
  v("Rattacher l'échéance d'un autre dossier est refusé",
    etrangere !== null && /étrangère/.test(etrangere.message), etrangere?.message);

  /* ═══════════════════════════════════════════════════════════════════════
     4. L'ORDRE DU TABLEAU DE BORD
     ═══════════════════════════════════════════════════════════════════════ */
  /* Deux mariages LE MÊME JOUR, et un sans date : c'est là que l'ordre doit
     être déterministe, pas seulement « à peu près croissant ». */
  for (const [cle, date] of [["ex-a", "2027-09-04"], ["ex-b", "2027-09-04"], ["ex-c", null]]) {
    await en(app, PROPRIO, "SELECT * FROM app.creer_demande_manuelle($1,$2::jsonb)",
      [JK, JSON.stringify({ contact_nom: `Tri ${cle}`, date_mariage: date,
                            cle_idempotence: `banc-crm-tri-${cle}` })]);
  }
  const ordre = async () => (await en(app, PROPRIO,
    `SELECT d.reference, d.date_mariage
       FROM demandes d
      WHERE d.entreprise_destinataire_id = $1
      ORDER BY (d.date_mariage IS NULL),
               (d.date_mariage < current_date),
               CASE WHEN d.date_mariage >= current_date THEN d.date_mariage END ASC,
               CASE WHEN d.date_mariage <  current_date THEN d.date_mariage END DESC,
               d.reference`, [JK])).rows;
  const liste = await ordre();
  const avecDate = liste.filter((r) => r.date_mariage);
  v("Le tri n'est pas celui de la réception : les dates sont croissantes",
    avecDate.every((r, i) => i === 0 || r.date_mariage >= avecDate[i - 1].date_mariage),
    avecDate.map((r) => r.date_mariage).join(" "));
  v("Les mariages sans date passent en dernier",
    liste.slice(avecDate.length).every((r) => r.date_mariage === null));
  const memeJour = liste.filter((r) => r.date_mariage === "2027-09-04");
  v("À date égale, l'ordre est déterministe (référence croissante)",
    memeJour.length === 2 && memeJour[0].reference < memeJour[1].reference,
    memeJour.map((r) => r.reference).join(" "));
  /* Deux lectures de suite rendent EXACTEMENT la même suite : sans tie-break,
     PostgreSQL est libre de choisir un autre plan et un autre ordre. */
  const liste2 = await ordre();
  v("Deux lectures rendent la même suite",
    JSON.stringify(liste) === JSON.stringify(liste2));

  /* ═══════════════════════════════════════════════════════════════════════
     5. LE PLANNING
     ═══════════════════════════════════════════════════════════════════════ */
  for (const [h, titre, lieu] of [
    ["10:00", "Préparatifs", "Domaine du Banc"],
    ["12:00", "Mairie", "Mairie de Dangu"],
    ["14:00", "Église", "Église de Dangu"],
  ]) {
    await en(app, PROPRIO,
      `INSERT INTO etapes_planning (demande_id, entreprise_id, ordre, heure, titre, lieu)
       SELECT $1,$2,
              coalesce((SELECT max(ordre) FROM etapes_planning WHERE demande_id = $1),0)+1,
              $3,$4,$5`, [D1, JK, h, titre, lieu]);
  }
  const { rows: etapes } = await en(app, PROPRIO,
    "SELECT * FROM etapes_planning WHERE demande_id = $1 ORDER BY ordre", [D1]);
  v("Le planning compte trois étapes ordonnées",
    etapes.length === 3 && etapes.map((e) => e.ordre).join("") === "123",
    etapes.map((e) => e.ordre).join(""));

  /* ⚠️ RÉORDONNER EST UN ÉCHANGE, ET LA CONTRAINTE D'UNICITÉ TIENT.
     C'est le geste qui levait une violation de contrainte — donc une 500 sur
     la fiche — quand le rang visé était déjà occupé. */
  const rangs = async () => (await en(app, PROPRIO,
    "SELECT ordre, titre FROM etapes_planning WHERE demande_id = $1 ORDER BY ordre",
    [D1])).rows;
  const avantEchange = await rangs();
  await en(app, PROPRIO, "SELECT app.reordonner_etape($1,$2)", [etapes[2].id, 1]);
  const apresEchange = await rangs();
  v("Déplacer une étape sur un rang occupé échange les deux",
    apresEchange[0].titre === avantEchange[2].titre
      && apresEchange[2].titre === avantEchange[0].titre,
    apresEchange.map((e) => `${e.ordre}:${e.titre}`).join(" "));
  v("…et les rangs restent 1, 2, 3 sans trou ni doublon",
    apresEchange.map((e) => e.ordre).join("") === "123",
    apresEchange.map((e) => e.ordre).join(","));
  const rangNul = await refuse(app, PROPRIO,
    "SELECT app.reordonner_etape($1,0)", [etapes[0].id]);
  v("Un rang nul ou négatif est refusé", rangNul !== null, "accepté");
  /* ⚠️ ET PAS DEPUIS UNE AUTRE ENTREPRISE. */
  const rangVole = await refuse(app, VIDEASTE,
    "SELECT app.reordonner_etape($1,2)", [etapes[0].id]);
  v("⚠️ Réordonner le planning d'autrui est refusé", rangVole !== null, "accepté");
  /* On remet l'ordre d'origine pour la suite du scénario. */
  await en(app, PROPRIO, "SELECT app.reordonner_etape($1,$2)", [etapes[2].id, 3]);

  /* ⚠️ UN AUTRE TENANT N'ÉCRIT PAS DANS MON PLANNING, MÊME EN FORGEANT. */
  const intrus = await refuse(app, VIDEASTE,
    `INSERT INTO etapes_planning (demande_id, entreprise_id, ordre, titre)
     VALUES ($1,$2,99,'Intrusion')`, [D1, VD]);
  v("⚠️ Insérer une étape sur la demande d'autrui est refusé", intrus !== null,
    "insertion acceptée");
  const { rows: vuIntrus } = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM etapes_planning", []);
  v("⚠️ Le planning de JoksWed est invisible du vidéaste", vuIntrus[0].n === 0,
    `${vuIntrus[0].n} étape(s)`);

  /* ═══════════════════════════════════════════════════════════════════════
     6. LES FICHIERS
     ═══════════════════════════════════════════════════════════════════════ */
  const pdf = Buffer.from("%PDF-1.4 banc\n");
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const { rows: [fPlan] } = await en(app, PROPRIO,
    `INSERT INTO fichiers_dossier (demande_id, entreprise_id, categorie, nom,
                                   type_mime, taille_octets, contenu, partage, depose_par)
     VALUES ($1,$2,'planning','planning.pdf','application/pdf',$3,$4,true,$5)
     RETURNING id`, [D1, JK, pdf.length, pdf, PROPRIO]);
  const { rows: [fInspi] } = await en(app, PROPRIO,
    `INSERT INTO fichiers_dossier (demande_id, entreprise_id, categorie, nom,
                                   type_mime, taille_octets, contenu, partage, depose_par)
     VALUES ($1,$2,'inspirations','inspiration.jpg','image/jpeg',$3,$4,false,$5)
     RETURNING id`, [D1, JK, jpg.length, jpg, PROPRIO]);
  v("planning.pdf et inspiration.jpg sont déposés",
    Boolean(fPlan.id) && Boolean(fInspi.id));

  const mauvaisType = await refuse(app, PROPRIO,
    `INSERT INTO fichiers_dossier (demande_id, entreprise_id, categorie, nom,
                                   type_mime, taille_octets, contenu)
     VALUES ($1,$2,'autre','piege.html','text/html',5,'\\x3c68313e')`, [D1, JK]);
  v("⚠️ Un type MIME hors liste blanche est refusé EN BASE", mauvaisType !== null,
    "dépôt accepté");
  const tropGros = await refuse(app, PROPRIO,
    `INSERT INTO fichiers_dossier (demande_id, entreprise_id, categorie, nom,
                                   type_mime, taille_octets, contenu)
     VALUES ($1,$2,'autre','gros.pdf','application/pdf',$3,$4)`,
    [D1, JK, 9 * 1024 * 1024, pdf]);
  v("⚠️ Un fichier au-delà de 8 Mio est refusé EN BASE", tropGros !== null,
    "dépôt accepté");

  /* ⚠️ L'IDOR, FERMÉ PAR LE SCHÉMA ET PAS SEULEMENT PAR LA POLITIQUE.
     Insérer un fichier portant SON entreprise mais MA demande doit échouer :
     c'est la clé étrangère composite (demande_id, entreprise_id) qui le
     refuse, avant toute politique. */
  const idor = await refuse(app, VIDEASTE,
    `INSERT INTO fichiers_dossier (demande_id, entreprise_id, categorie, nom,
                                   type_mime, taille_octets, contenu)
     VALUES ($1,$2,'autre','vol.pdf','application/pdf',5,$3)`, [D1, VD, pdf]);
  v("⚠️ Rattacher un fichier à la demande d'autrui est refusé", idor !== null,
    "insertion acceptée");
  const { rows: [vuF] } = await en(app, VIDEASTE,
    "SELECT count(*)::int n FROM fichiers_dossier", []);
  v("⚠️ Les fichiers de JoksWed sont invisibles du vidéaste", vuF.n === 0, `${vuF.n}`);

  /* ═══════════════════════════════════════════════════════════════════════
     7. LE PRESTATAIRE PHOTOBOOTH
     ═══════════════════════════════════════════════════════════════════════ */
  const { rows: [pb] } = await en(app, PROPRIO,
    "SELECT app.creer_entreprise_partenaire($1,$2,$3,$4::citext,$5) AS id",
    [JK, "photobooth-banc", "Photobooth du Banc", "photobooth@exemple.invalid", "photobooth"]);
  const PB = pb.id;
  v("Un prestataire photobooth est créé avec son métier", Boolean(PB));
  const { rows: [svc] } = await verite.query(
    "SELECT service_partenaire FROM entreprises WHERE id = $1", [PB]);
  v("Le métier est enregistré sur sa structure", svc.service_partenaire === "photobooth",
    String(svc.service_partenaire));

  /* ⚠️ ON NE TRANSMET QU'UN DOSSIER CONFIRMÉ. D1 l'est ; D2 ne l'est pas. */
  await en(app, PROPRIO, "SELECT app.transmettre_a_partenaire($1,$2,$3,$4,$5::text[])",
    [D1, PB, "autre", "Photobooth 360 le 17 juillet",
     ["planning", "lieux", "documents_partages"]]);
  const { rows: propos } = await en(app, PROPRIO,
    "SELECT * FROM app.propositions_emises($1)", [D1]);
  v("La proposition photobooth est émise", propos.some((x) => x.prestation === "autre"));

  /* ⚠️ C'EST LE PRESTATAIRE QUI ACCEPTE, PAS MOI.
     Accepter à sa place produirait un dossier qu'il n'a jamais accepté — et
     masquerait le fait que la fonction vérifie bien l'identité du
     destinataire. On ouvre donc SA session, et on répond sous elle.

     ⚠️ Le second paramètre est un BOOLÉEN (`p_acceptee`), pas un statut :
     passer la chaîne « acceptee » lève « invalid input syntax for type
     boolean ». */
  /* ⚠️ LE SEUL MEMBRE CRÉÉ PAR LE PARRAINAGE, C'EST MOI — avec le rôle
     `parrain`, qui ne porte que deux permissions. Le vrai prestataire arrive
     par invitation. Le banc pose donc SON compte directement, avec le rôle
     modèle « Vidéaste collaborateur » : ses dossiers, ses documents, ses
     finances, et rien d'autre. C'est ce rôle-là qu'on veut éprouver. */
  const { rows: [comptePb] } = await verite.query(
    `INSERT INTO utilisateurs (email, prenom, nom)
     VALUES ('photobooth.banc@exemple.invalid','Photobooth','Banc') RETURNING id`);
  const PBU = comptePb.id;
  const { rows: [membrePb] } = await verite.query(
    `INSERT INTO membres (entreprise_id, utilisateur_id) VALUES ($1,$2) RETURNING id`,
    [PB, PBU]);
  await verite.query(
    `INSERT INTO membres_roles (membre_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.entreprise_id = $2 AND r.cle = 'videaste'`,
    [membrePb.id, PB]);
  jetons.set(PBU, "crm-photobooth");
  await verite.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,'crm-photobooth', now() + interval '1 day', true)`, [PBU]);

  const proposition = propos.find((x) => x.prestation === "autre");
  await en(app, PBU, "SELECT app.repondre_proposition($1,true,NULL)", [proposition.id]);
  const { rows: dossiersPb } = await verite.query(
    "SELECT id, mariage_id FROM dossiers WHERE entreprise_id = $1", [PB]);
  v("Le prestataire a son propre dossier sur CE mariage",
    dossiersPb.length === 1 && dossiersPb[0].mariage_id === MARIAGE,
    `${dossiersPb.length} dossier(s)`);

  /* ═══════════════════════════════════════════════════════════════════════
     8. CE QUE LE PRESTATAIRE VOIT — ET CE QU'IL NE VOIT PAS
     ═══════════════════════════════════════════════════════════════════════ */
  const { rows: sesDossiers } = await en(app, PBU,
    "SELECT * FROM app.mes_dossiers($1)", [PB]);
  v("⚠️ Il voit le dossier auquel il est assigné", sesDossiers.length === 1,
    `${sesDossiers.length}`);
  v("⚠️ …et AUCUN autre mariage", sesDossiers.every((d) => d.mariage_id === MARIAGE));
  const { rows: [autresDemandes] } = await en(app, PBU,
    "SELECT count(*)::int n FROM demandes", []);
  v("⚠️ Les demandes de JoksWed lui sont invisibles", autresDemandes.n === 0,
    `${autresDemandes.n}`);
  const { rows: [sesPaiements] } = await en(app, PBU,
    "SELECT count(*)::int n FROM paiements", []);
  v("⚠️ Aucun paiement de JoksWed ne lui est visible", sesPaiements.n === 0,
    `${sesPaiements.n}`);
  /* `mes_dossiers` rend des colonnes financières : elles doivent être les
     SIENNES (aucun devis, donc zéro), jamais les miennes. */
  v("⚠️ Il ne voit pas mes montants",
    sesDossiers.every((d) => (d.total_cents ?? 0) === 0 && (d.encaisse_cents ?? 0) === 0),
    JSON.stringify(sesDossiers.map((d) => d.total_cents)));

  const { rows: sonPlanning } = await en(app, PBU,
    "SELECT * FROM app.planning_du_dossier($1)", [dossiersPb[0].id]);
  v("⚠️ Il voit le planning, parce qu'on le lui a partagé", sonPlanning.length === 3,
    `${sonPlanning.length} étape(s)`);
  const { rows: sesFichiers } = await en(app, PBU,
    "SELECT * FROM app.fichiers_du_dossier($1)", [dossiersPb[0].id]);
  v("⚠️ Il voit le fichier PARTAGÉ, et lui seul",
    sesFichiers.length === 1 && sesFichiers[0].nom === "planning.pdf",
    sesFichiers.map((x) => x.nom).join(","));
  const { rows: volContenu } = await en(app, PBU,
    "SELECT * FROM app.fichier_du_dossier($1,$2)", [fInspi.id, dossiersPb[0].id]);
  v("⚠️ Le contenu d'un fichier NON partagé lui est refusé", volContenu.length === 0,
    `${volContenu.length} ligne(s)`);

  /* ⚠️ UN AUTRE PRESTATAIRE N'OUVRE PAS CE DOSSIER DU TOUT.
     `app.exiger` lève « non membre de cette entreprise » : un refus explicite
     plutôt qu'une liste vide, parce qu'ici l'appelant n'a aucune raison
     légitime de nommer ce dossier. La page, elle, ne lui en propose jamais
     l'identifiant. */
  const volPlanning = await refuse(app, VIDEASTE,
    "SELECT * FROM app.planning_du_dossier($1)", [dossiersPb[0].id]);
  v("⚠️ Le planning d'un dossier qui n'est pas le sien est refusé",
    volPlanning !== null && /non membre/.test(volPlanning.message), volPlanning?.message);
  const volFichiers = await refuse(app, VIDEASTE,
    "SELECT * FROM app.fichiers_du_dossier($1)", [dossiersPb[0].id]);
  v("⚠️ Les fichiers d'un dossier qui n'est pas le sien sont refusés",
    volFichiers !== null, "lecture acceptée");

  /* ⚠️ ON RETIRE LE PARTAGE : il doit cesser de voir. */
  await en(app, PROPRIO, `UPDATE partages_mariage SET retire_le = now()
     WHERE mariage_id = $1 AND entreprise_id = $2 AND categorie = 'planning'`, [MARIAGE, PB]);
  const { rows: apresRetrait } = await en(app, PBU,
    "SELECT * FROM app.planning_du_dossier($1)", [dossiersPb[0].id]);
  v("⚠️ Retirer le partage referme le planning", apresRetrait.length === 0,
    `${apresRetrait.length}`);

  /* ═══════════════════════════════════════════════════════════════════════
     9. LE FLUX iCALENDAR
     ═══════════════════════════════════════════════════════════════════════ */
  const { construireIcs, echapper, plier } = await import("../lib/calendrier/ics.js");
  const { hacherJeton } = await import("../lib/auth/secrets.ts");
  const JETON = "banc-crm-calendrier-0123456789";
  await en(app, PROPRIO, "SELECT app.definir_jeton_calendrier($1,$2,NULL)",
    [JK, hacherJeton(JETON)]);

  const flux = async () => (await verite.query(
    "SELECT * FROM app.calendrier_entreprise($1)", [hacherJeton(JETON)])).rows;
  let evs = await flux();
  v("Le flux ne contient que les mariages au carnet",
    evs.length === 1 && evs[0].demande_id === D1, `${evs.length} évènement(s)`);
  v("Le couple y figure", evs[0].couple === "Marie Test & Jean Test", evs[0].couple);
  v("Le planning résumé y figure", /Préparatifs/.test(evs[0].planning ?? ""));

  let ics = construireIcs(evs, { nom: "Banc", maintenant: Date.UTC(2026, 9, 15) });
  const uid1 = ics.match(/UID:(.+)\r\n/)[1];
  const seq1 = Number(ics.match(/SEQUENCE:(\d+)/)[1]);
  v("Le fichier est un VCALENDAR valide, en CRLF",
    ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  v("Il déclare son fuseau Europe/Paris", ics.includes("TZID:Europe/Paris"));
  v("Un seul VEVENT", (ics.match(/BEGIN:VEVENT/g) ?? []).length === 1);
  v("L'évènement est confirmé", ics.includes("STATUS:CONFIRMED"));
  /* ⚠️ AUCUN MONTANT DANS UN CALENDRIER. Il se synchronise sur un téléphone
     et s'affiche sur un écran verrouillé. */
  v("⚠️ Aucun montant ne figure dans le flux",
    !/1 ?300|130000|433,3|433\.3/.test(ics));

  /* On déplace le mariage. L'UID doit être LE MÊME, et la SEQUENCE monter.
     ⚠️ UNE SECONDE D'ATTENTE, VOLONTAIRE.
     `SEQUENCE` et `LAST-MODIFIED` ont une précision d'une seconde : sans
     cette pause, les deux versions porteraient le même numéro et le banc
     « passerait » sans rien démontrer. */
  await new Promise((r) => setTimeout(r, 1100));
  await en(app, PROPRIO, "SELECT app.maj_demande($1,$2::jsonb)",
    [D1, JSON.stringify({ date_mariage: "2027-07-24" })]);
  const { rows: [mariageApres] } = await verite.query(
    "SELECT date_mariage FROM mariages WHERE id = $1", [MARIAGE]);
  v("⚠️ La modification de date atteint AUSSI le mariage",
    mariageApres.date_mariage === "2027-07-24", String(mariageApres.date_mariage));

  evs = await flux();
  ics = construireIcs(evs, { nom: "Banc", maintenant: Date.UTC(2026, 9, 15) });
  const uid2 = ics.match(/UID:(.+)\r\n/)[1];
  v("⚠️ L'UID est STABLE après un déplacement de date", uid1 === uid2, `${uid1} → ${uid2}`);
  v("…et il n'y a toujours qu'un seul évènement",
    (ics.match(/BEGIN:VEVENT/g) ?? []).length === 1);
  v("La nouvelle date est dans le flux", ics.includes("20270724T100000"));
  v("La SEQUENCE a augmenté", Number(ics.match(/SEQUENCE:(\d+)/)[1]) > seq1);

  /* Aucun second dossier n'a été créé au passage. */
  const { rows: [doublons] } = await verite.query(
    "SELECT count(*)::int n FROM dossiers WHERE mariage_id = $1", [MARIAGE]);
  v("⚠️ Déplacer la date ne crée pas un second dossier", doublons.n === 2,
    `${doublons.n} dossier(s) — attendu 2 : JoksWed et le photobooth`);

  /* Annulation : l'évènement reste, barré. */
  await en(app, PROPRIO, "SELECT app.definir_statut_demande($1,'annulee')", [D1]);
  evs = await flux();
  ics = construireIcs(evs, { nom: "Banc", maintenant: Date.UTC(2026, 9, 15) });
  v("⚠️ Une annulation sort en STATUS:CANCELLED, pas en silence",
    ics.includes("STATUS:CANCELLED") && /SUMMARY:ANNULÉ/.test(ics));
  v("L'UID d'une annulation reste le même", ics.match(/UID:(.+)\r\n/)[1] === uid1);

  /* Échappement et pliage : RFC 5545 §3.1 et §3.3.11. */
  v("Les caractères réservés sont échappés",
    echapper("Château d'Arc, Pavillon; 1\\2\nsuite")
      === "Château d'Arc\\, Pavillon\; 1\\\\2\\nsuite",
    echapper("a,b;c"));
  const longue = `DESCRIPTION:${"é".repeat(80)}`;
  const pliee = plier(longue);
  v("⚠️ Le pliage compte les OCTETS, et ne coupe pas un caractère en deux",
    pliee.split("\r\n ").every((l) => Buffer.from(l, "utf8").length <= 75)
      && pliee.replace(/\r\n /g, "") === longue,
    pliee.split("\r\n ").map((l) => Buffer.from(l, "utf8").length).join(","));

  /* Un jeton inconnu ne rend rien. */
  const { rows: faux } = await verite.query(
    "SELECT * FROM app.calendrier_entreprise($1)", [hacherJeton("jeton-invente-xxxxxxxxxx")]);
  v("⚠️ Un jeton inventé ne rend aucun mariage", faux.length === 0, `${faux.length}`);
  /* Révoquer coupe le flux. */
  await en(app, PROPRIO, "SELECT app.definir_jeton_calendrier($1,NULL,NULL)", [JK]);
  v("⚠️ Révoquer le jeton ferme le flux", (await flux()).length === 0);

  /* ═══════════════════════════════════════════════════════════════════════
     10. NOTIFICATIONS : L'ÉVÈNEMENT EST LA CAPACITÉ
     ═══════════════════════════════════════════════════════════════════════ */
  const { rows: [ancienne] } = await verite.query(
    `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'app' AND p.proname = 'push_abonnements_entreprise'`);
  v("⚠️ L'ancienne porte, qui laissait choisir l'entreprise, n'existe plus",
    ancienne.n === 0, `${ancienne.n} fonction(s)`);

  /* Un abonnement push pour le propriétaire, et un évènement en attente. */
  await en(app, PROPRIO,
    `INSERT INTO push_abonnements (utilisateur_id, endpoint, p256dh, auth)
     VALUES ($1,'https://exemple.invalid/push/1','p','a')`, [PROPRIO]);
  const { rows: [evt] } = await verite.query(
    `INSERT INTO evenements (type, charge_utile, cle_idempotence, tentatives)
     VALUES ('demande.recue', jsonb_build_object('entreprise_id', $1::text,
             'demande_id', $2::text, 'reference', 'DEM-TEST'),
             'banc-crm-evt-1', 1)
     RETURNING id`, [JK, D1]);
  const { rows: abos } = await en(app, PROPRIO,
    "SELECT * FROM app.push_abonnements_evenement($1)", [evt.id]);
  v("Le drain retrouve les abonnements par l'évènement qu'il traite",
    abos.length === 1, `${abos.length}`);

  const { rows: [evtTraite] } = await verite.query(
    `INSERT INTO evenements (type, charge_utile, cle_idempotence, tentatives, traite_le)
     VALUES ('demande.recue', jsonb_build_object('entreprise_id', $1::text),
             'banc-crm-evt-2', 1, now())
     RETURNING id`, [JK]);
  v("⚠️ Un évènement DÉJÀ TRAITÉ ne rend aucun abonnement",
    (await en(app, PROPRIO,
      "SELECT * FROM app.push_abonnements_evenement($1)", [evtTraite.id])).rows.length === 0);
  const { rows: [evtNonPris] } = await verite.query(
    `INSERT INTO evenements (type, charge_utile, cle_idempotence, tentatives)
     VALUES ('demande.recue', jsonb_build_object('entreprise_id', $1::text),
             'banc-crm-evt-3', 0)
     RETURNING id`, [JK]);
  v("⚠️ Un évènement NON RÉCLAMÉ ne rend aucun abonnement",
    (await en(app, PROPRIO,
      "SELECT * FROM app.push_abonnements_evenement($1)", [evtNonPris.id])).rows.length === 0);
  v("⚠️ Un identifiant d'évènement inventé ne rend rien",
    (await en(app, PROPRIO, "SELECT * FROM app.push_abonnements_evenement($1)",
      ["00000000-0000-0000-0000-000000000000"])).rows.length === 0);
  /* ⚠️ ET LE RÔLE MÉTIER NE PEUT PAS DÉSIGNER UNE AUTRE ENTREPRISE.
     Il n'existe plus de paramètre « entreprise » : la seule entrée est un
     évènement, et `evenements` lui est retirée. */
  const sansTable = await refuse(app, VIDEASTE, "SELECT count(*) FROM evenements", []);
  v("⚠️ La table des évènements reste inaccessible au rôle métier",
    sansTable !== null, "lecture acceptée");

  /* ═══════════════════════════════════════════════════════════════════════
     11. SUPPRESSION
     ═══════════════════════════════════════════════════════════════════════ */
  const refusSuppression = await refuse(app, PROPRIO,
    "SELECT app.supprimer_demande($1)", [D1]);
  v("⚠️ Un dossier avec un encaissement confirmé ne se supprime pas",
    refusSuppression !== null && /encaissement/.test(refusSuppression.message),
    refusSuppression?.message);

  /* D2 n'a ni encaissement confirmé ni document émis : il part. */
  const { rows: [ref2] } = await en(app, PROPRIO,
    "SELECT app.supprimer_demande($1) AS reference", [D2]);
  v("Un dossier sans trace comptable se supprime", Boolean(ref2.reference), ref2.reference);
  const { rows: [orphelins] } = await verite.query(
    `SELECT (SELECT count(*)::int FROM echeances WHERE demande_id = $1) e,
            (SELECT count(*)::int FROM paiements WHERE demande_id = $1) p,
            (SELECT count(*)::int FROM etapes_planning WHERE demande_id = $1) pl,
            (SELECT count(*)::int FROM fichiers_dossier WHERE demande_id = $1) f`, [D2]);
  v("⚠️ Aucune échéance, aucun paiement, aucune étape, aucun fichier orphelin",
    orphelins.e === 0 && orphelins.p === 0 && orphelins.pl === 0 && orphelins.f === 0,
    JSON.stringify(orphelins));

  /* ═══════════════════════════════════════════════════════════════════════
     12. LE DÉPÔT PUBLIC PORTE L'OPTION PHOTOBOOTH
     ═══════════════════════════════════════════════════════════════════════ */
  process.env.DATABASE_URL_APP = urlMigrateur(base);
  const { deposerDemande } = await import("../lib/demandes/depot.ts");
  const { formules, supplements } = await import("../content/offres.ts");
  const pbCatalogue = supplements.find((x) => x.cle === "photobooth-360");
  v("Photobooth 360 est au catalogue public", Boolean(pbCatalogue));
  v("⚠️ …en « sur devis », sans tarif inventé",
    pbCatalogue.typeTarif === "sur_devis" && pbCatalogue.prixCents === null,
    `${pbCatalogue.typeTarif} / ${pbCatalogue.prixCents}`);
  /* ⚠️ ET SANS EXÉCUTANT PARTENAIRE : sinon cocher l'option transmettrait le
     prospect au prestataire avant toute confirmation. */
  v("⚠️ Cocher Photobooth ne transmet rien automatiquement",
    pbCatalogue.executantPartenaire === null, String(pbCatalogue.executantPartenaire));

  const depot = await deposerDemande({
    cleIdempotence: "banc-crm-depot-public",
    contactNom: "Public Photobooth", contactEmail: "public.pb@exemple.invalid",
    dateMariage: "2028-05-20", lieu: "Domaine public",
    formuleCle: formules[0].cle, supplementsCles: ["photobooth-360"],
    message: "Banc CRM.", consentementDemande: true, consentementPartenaire: false,
    ipTronquee: "203.0.113.0/24",
  });
  const { rows: [publique] } = await verite.query(
    "SELECT photobooth_360, origine FROM demandes WHERE id = $1", [depot.demandeId]);
  v("Une demande du site enregistre le OUI Photobooth",
    publique.photobooth_360 === true && publique.origine === "formulaire_public");
  v("⚠️ Aucune proposition n'est préparée pour le photobooth",
    (await verite.query(
      `SELECT count(*)::int n FROM propositions WHERE demande_id = $1`,
      [depot.demandeId])).rows[0].n === 0);
} finally {
  for (const c of [app, verite]) { try { await c?.end(); } catch { /* déjà fermé */ } }
  try {
    const { fermerPool } = await import("../lib/db/client.ts");
    await fermerPool();
  } catch { /* le pool n'a jamais été ouvert */ }
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves CRM passées.`);
if (echecs.length > 0) {
  console.log("\nÉchecs :");
  for (const e of echecs) console.log(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc CRM : tout est vert.");
