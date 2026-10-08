/* =============================================================================
   BANC DE SÉCURITÉ — RLS ÉPROUVÉ AVEC LE RÔLE RÉELLEMENT UTILISÉ
   -----------------------------------------------------------------------------
   ⚠️ CE BANC SE CONNECTE EN `jokswed_app`, PAS EN PROPRIÉTAIRE.

   C'est tout l'intérêt. Un test lancé avec le rôle propriétaire contournerait
   les politiques (sauf FORCE) et déclarerait « tout va bien » sur une base
   dont l'isolation serait entièrement ouverte. Les connexions ci-dessous sont
   celles de l'application.

   Chaque épreuve part d'une transaction qui pose `app.acteur_id` exactement
   comme `avecActeur()` le fait en production.
   ============================================================================= */
import pg from "pg";
import { demarrer, urlMigrateur, urlApplication, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const resultats = [];
function verifier(nom, condition, detail = "") {
  resultats.push({ nom, ok: Boolean(condition), detail });
  console.log(`${condition ? "✓" : "✗"} ${nom}${condition ? "" : ` — ${detail}`}`);
}

/** Exécute une requête AVEC une identité, comme `avecActeur()` en production. */
async function en(client, acteurId, texte, valeurs = []) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.acteur_id', $1, true)", [acteurId]);
    const r = await client.query(texte, valeurs);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/** Même chose, mais on attend une ERREUR : refus de contrainte ou de politique. */
async function refuse(client, acteurId, texte, valeurs = []) {
  try {
    await en(client, acteurId, texte, valeurs);
    return null;
  } catch (e) {
    return e;
  }
}

const pgdev = await demarrer();
let app, verite;

try {
  /* Base neuve à chaque exécution : voir `baseVierge()`. */
  const base = await baseVierge();
  await migrer(urlMigrateur(base), { silencieux: true });
  const f = await semer(urlMigrateur(base), { silencieux: true });

  app = new pg.Client({ connectionString: urlApplication(base) });
  await app.connect();

  /* ⚠️ UNE SECONDE CONNEXION, EN PROPRIÉTAIRE, POUR CONSTATER LA VÉRITÉ.

     Vérifier une attaque depuis le point de vue de l'attaquant ne prouve pas
     grand-chose : s'il ne voit rien, c'est peut-être qu'il n'a rien écrit —
     ou qu'il a écrit et ne peut pas se relire. Celle-ci sert UNIQUEMENT à
     constater l'état réel de la base après chaque tentative. Jamais à
     exécuter l'attaque. */
  verite = new pg.Client({ connectionString: urlMigrateur(base) });
  await verite.connect();

  const { jokswed, video } = f.entreprises;
  const { proprietaire, videaste, assistant } = f.utilisateurs;

  /* ═══════════ 0. LE RÔLE LUI-MÊME ═══════════ */
  const role = await app.query(`
    SELECT current_user AS u, rolsuper, rolbypassrls, rolcreaterole
      FROM pg_roles WHERE rolname = current_user`);
  verifier("L'application se connecte en jokswed_app", role.rows[0].u === "jokswed_app", role.rows[0].u);
  verifier("Le rôle applicatif n'est pas superutilisateur", role.rows[0].rolsuper === false);
  verifier("Le rôle applicatif n'a PAS BYPASSRLS", role.rows[0].rolbypassrls === false);
  verifier("Le rôle applicatif ne peut pas créer de rôles", role.rows[0].rolcreaterole === false);

  const proprio = await app.query(`
    SELECT count(*)::int n FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND pg_get_userbyid(c.relowner) = current_user`);
  verifier("Le rôle applicatif n'est propriétaire d'AUCUNE table",
    proprio.rows[0].n === 0, `${proprio.rows[0].n} tables lui appartiennent`);

  /* ═══════════ 1. RLS ACTIVÉ PARTOUT ═══════════ */
  const sansRls = await app.query(`
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND NOT c.relrowsecurity
       AND c.relname NOT IN ('schema_migrations','permissions','taux_tva')
     ORDER BY 1`);
  verifier("Toute table métier a RLS activé", sansRls.rowCount === 0,
    sansRls.rows.map((r) => r.relname).join(", "));

  const sansForce = await app.query(`
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND c.relrowsecurity AND NOT c.relforcerowsecurity
     ORDER BY 1`);
  /* Liste blanche EXPLICITE et justifiée : `membres` à cause de la récursion
     de la fonction SECURITY DEFINER, les quatre autres parce que le chemin
     d'authentification doit les lire avant qu'un acteur existe. */
  const forceAttendu = ["facteurs_mfa", "identifiants", "membres", "sessions", "utilisateurs"];
  const horsListe = sansForce.rows.map((r) => r.relname).filter((n) => !forceAttendu.includes(n));
  verifier("Seules les 5 tables justifiées sont sans FORCE", horsListe.length === 0,
    `inattendues : ${horsListe.join(", ")}`);

  const secdef = await app.query(`
    SELECT p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef AND n.nspname IN ('public','app') ORDER BY 1`);
  const secdefAttendues = [
    "auth_creer_session","auth_identifiant","auth_journaliser_tentative","auth_revoquer_session",
    "auth_session","auth_tentatives_recentes","auth_valider_mfa","entreprises_de_lacteur",
  ];
  const secdefInattendues = secdef.rows.map((r) => r.proname).filter((n) => !secdefAttendues.includes(n));
  verifier("Aucune fonction SECURITY DEFINER hors de la liste autorisée",
    secdefInattendues.length === 0, secdefInattendues.join(", "));

  /* ═══════════ 2. SANS IDENTITÉ : REFUS TOTAL ═══════════ */
  await app.query("BEGIN");
  const nu = await app.query("SELECT count(*)::int n FROM dossiers");
  const nuE = await app.query("SELECT count(*)::int n FROM entreprises");
  const nuM = await app.query("SELECT count(*)::int n FROM mariages");
  await app.query("COMMIT");
  verifier("Sans app.acteur_id : 0 dossier", nu.rows[0].n === 0, `${nu.rows[0].n} lignes`);
  verifier("Sans app.acteur_id : 0 entreprise", nuE.rows[0].n === 0, `${nuE.rows[0].n} lignes`);
  verifier("Sans app.acteur_id : 0 mariage", nuM.rows[0].n === 0, `${nuM.rows[0].n} lignes`);

  /* ═══════════ 3. L'IDENTITÉ NE FUIT PAS ENTRE REQUÊTES ═══════════ */
  await en(app, proprietaire, "SELECT 1");
  await app.query("BEGIN");
  const apres = await app.query("SELECT count(*)::int n FROM dossiers");
  const reglage = await app.query("SELECT current_setting('app.acteur_id', true) AS a");
  await app.query("COMMIT");
  verifier("L'identité ne survit pas à la transaction précédente",
    apres.rows[0].n === 0 && !reglage.rows[0].a,
    `${apres.rows[0].n} lignes, réglage = ${reglage.rows[0].a}`);

  /* ═══════════ 4. CHACUN VOIT SON PÉRIMÈTRE ═══════════ */
  const dProprio = await en(app, proprietaire, "SELECT reference FROM dossiers ORDER BY reference");
  verifier("Le propriétaire voit ses 2 dossiers JoksWed", dProprio.rowCount === 2,
    dProprio.rows.map((r) => r.reference).join(", "));

  const dVideo = await en(app, videaste, "SELECT reference FROM dossiers ORDER BY reference");
  verifier("Le vidéaste ne voit QUE son dossier",
    dVideo.rowCount === 1 && dVideo.rows[0].reference === "D-V-0001",
    dVideo.rows.map((r) => r.reference).join(", "));

  /* ═══════════ 5. L'ATTAQUE PAR JOINTURE — LE TEST CENTRAL ═══════════ */
  /* C'est l'objection qui a fait réviser le schéma : passer par le mariage
     partagé pour atteindre les dossiers d'une autre entreprise. */
  const parJointure = await en(app, videaste, `
    SELECT d2.reference
      FROM dossiers d1
      JOIN mariages m  ON m.id = d1.mariage_id
      JOIN dossiers d2 ON d2.mariage_id = m.id
     WHERE d1.entreprise_id = $1`, [video]);
  verifier("La jointure via le mariage partagé ne révèle AUCUN dossier d'autrui",
    parJointure.rows.every((r) => r.reference === "D-V-0001"),
    `a vu : ${parJointure.rows.map((r) => r.reference).join(", ")}`);

  const parSousRequete = await en(app, videaste, `
    SELECT count(*)::int n FROM dossiers
     WHERE mariage_id IN (SELECT mariage_id FROM dossiers WHERE entreprise_id = $1)
       AND entreprise_id <> $1`, [video]);
  verifier("Une sous-requête ne contourne pas davantage la politique",
    parSousRequete.rows[0].n === 0, `${parSousRequete.rows[0].n} lignes`);

  const parId = await en(app, videaste,
    "SELECT count(*)::int n FROM dossiers WHERE id = $1", [f.dossiers.jokswedPrive]);
  verifier("Deviner l'identifiant d'un dossier non attribué ne donne rien",
    parId.rows[0].n === 0, `${parId.rows[0].n} lignes`);

  /* ═══════════ 6. ÉCRITURES CROISÉES ═══════════ */
  /* ⚠️ DEUX FAÇONS DONT UNE POLITIQUE REFUSE, ET ELLES NE SE RESSEMBLENT PAS.

     · `USING` qui ne matche pas  → la ligne est INVISIBLE : 0 ligne affectée,
       en silence, sans erreur ;
     · `WITH CHECK` qui échoue    → la ligne était visible, mais la valeur
       écrite sortirait du périmètre : PostgreSQL LÈVE (42501).

     Ici, le vidéaste voit bien son propre dossier (USING passe) mais tente de
     le faire basculer chez JoksWed : c'est WITH CHECK qui s'y oppose, donc
     une exception. J'attendais 0 ligne ; le comportement réel est plus strict
     que mon attente, et le banc doit le constater tel qu'il est. */
  const deplacement = await refuse(app, videaste,
    "UPDATE dossiers SET entreprise_id = $1 WHERE entreprise_id = $2", [jokswed, video]);
  verifier("Déplacer son dossier vers une autre entreprise lève (WITH CHECK, 42501)",
    deplacement !== null && deplacement.code === "42501",
    deplacement ? `code ${deplacement.code}` : "aucune erreur : le déplacement a réussi");

  const insertionCroisee = await refuse(app, videaste,
    `INSERT INTO dossiers (mariage_id, entreprise_id, reference, prestation)
     VALUES ($1, $2, 'PIRATE-1', 'photo')`, [f.mariages.prive, jokswed]);
  verifier("Créer un dossier au nom d'une autre entreprise est refusé",
    insertionCroisee !== null, "l'insertion a réussi");

  const majFacture = await en(app, videaste,
    "UPDATE dossiers SET statut = 'annule' WHERE entreprise_id = $1", [jokswed]);
  verifier("Modifier un dossier d'autrui n'affecte aucune ligne",
    majFacture.rowCount === 0, `${majFacture.rowCount} lignes`);

  /* ═══════════ 7. LE MARIAGE PARTAGÉ : CE QUI SE VOIT, CE QUI NE SE VOIT PAS ═══════════ */
  const mVideo = await en(app, videaste, "SELECT reference FROM mariages ORDER BY reference");
  verifier("Le vidéaste voit le mariage partagé",
    mVideo.rowCount === 1 && mVideo.rows[0].reference === "MAR-2027-0001",
    mVideo.rows.map((r) => r.reference).join(", "));

  const cVideo = await en(app, videaste, "SELECT count(*)::int n FROM contacts");
  verifier("Sans partage `coordonnees_clients`, il ne voit AUCUN contact",
    cVideo.rows[0].n === 0, `${cVideo.rows[0].n} contacts`);

  const cProprio = await en(app, proprietaire, "SELECT count(*)::int n FROM contacts");
  verifier("Le propriétaire, lui, voit les contacts de ses mariages",
    cProprio.rows[0].n === 2, `${cProprio.rows[0].n} contacts`);

  /* Octroi du partage, puis nouvelle lecture : l'accès doit s'ouvrir. */
  await en(app, proprietaire,
    `INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie)
     VALUES ($1,$2,'coordonnees_clients') ON CONFLICT DO NOTHING`, [f.mariages.partage, video]);
  const cApres = await en(app, videaste, "SELECT count(*)::int n FROM contacts");
  verifier("Une fois le partage accordé, il voit le contact du mariage partagé",
    cApres.rows[0].n === 1, `${cApres.rows[0].n} contacts`);

  /* Et le retrait doit refermer l'accès à la requête suivante. */
  await en(app, proprietaire,
    `UPDATE partages_mariage SET retire_le = now()
      WHERE mariage_id = $1 AND entreprise_id = $2 AND categorie = 'coordonnees_clients'`,
    [f.mariages.partage, video]);
  const cRetire = await en(app, videaste, "SELECT count(*)::int n FROM contacts");
  verifier("Le retrait du partage referme l'accès immédiatement",
    cRetire.rows[0].n === 0, `${cRetire.rows[0].n} contacts`);

  const planningVideo = await en(app, videaste,
    "UPDATE mariages SET ville = 'Détournée' WHERE id = $1", [f.mariages.partage]);
  verifier("Un non-pilote ne réécrit pas le mariage partagé",
    planningVideo.rowCount === 0, `${planningVideo.rowCount} lignes`);

  /* ═══════════ 8. PERMISSIONS : ON NE S'AUTO-PROMEUT PAS ═══════════ */
  const membreVideo = await en(app, videaste,
    "SELECT id FROM membres WHERE utilisateur_id = $1 AND retire_le IS NULL", [videaste]);
  const autoPromo = await refuse(app, videaste,
    `INSERT INTO membres_permissions (membre_id, permission_cle, accorde)
     VALUES ($1, 'finance.consolide.lire', true)`, [membreVideo.rows[0].id]);
  /* La politique l'autorise au niveau SQL (c'est son entreprise) : c'est la
     couche applicative qui l'interdit. Le banc le constate explicitement
     plutôt que de laisser croire que RLS s'en charge. */
  const autoPromoEcrite = await verite.query(
    "SELECT count(*)::int n FROM membres_permissions WHERE membre_id = $1", [membreVideo.rows[0].id]);
  verifier("RLS seul N'EMPÊCHE PAS l'auto-promotion dans sa propre entreprise",
    autoPromo === null && autoPromoEcrite.rows[0].n === 1,
    `erreur=${autoPromo?.code ?? "aucune"}, lignes=${autoPromoEcrite.rows[0].n}`);
  /* ⚠️ CE RÉSULTAT EST ATTENDU, ET C'EST POUR CELA QU'IL EST TESTÉ.
     Une politique répond à « quelles LIGNES » ; elle ne sait pas répondre à
     « cet acteur a-t-il le droit de modifier SES PROPRES droits », qui dépend
     de l'identité de la CIBLE. C'est exigerAcces() qui tranche, côté serveur,
     et le banc des routes le vérifie séparément. Laisser croire que RLS s'en
     charge serait la pire des illusions. */

  /* ⚠️ ICI, L'ABSENCE D'ERREUR N'EST PAS UNE RÉUSSITE DE L'ATTAQUE.

     `INSERT … SELECT` dont le SELECT est vidé par la politique de `membres`
     insère ZÉRO ligne et ne lève RIEN. Une première version de ce banc
     concluait à une faille : elle testait « une erreur a-t-elle été levée »
     au lieu de « une ligne a-t-elle été écrite ». On constate donc désormais
     l'état réel, depuis la connexion propriétaire. */
  const avantPromo = await verite.query(
    `SELECT count(*)::int n FROM membres_permissions mp
       JOIN membres m ON m.id = mp.membre_id WHERE m.entreprise_id = $1`, [jokswed]);
  const promoAutrui = await en(app, videaste,
    `INSERT INTO membres_permissions (membre_id, permission_cle, accorde)
     SELECT m.id, 'finance.lire', true FROM membres m
      WHERE m.entreprise_id = $1 LIMIT 1`, [jokswed]);
  const apresPromo = await verite.query(
    `SELECT count(*)::int n FROM membres_permissions mp
       JOIN membres m ON m.id = mp.membre_id WHERE m.entreprise_id = $1`, [jokswed]);
  verifier("Accorder une permission dans une AUTRE entreprise n'écrit RIEN",
    promoAutrui.rowCount === 0 && apresPromo.rows[0].n === avantPromo.rows[0].n,
    `${promoAutrui.rowCount} ligne(s) insérée(s), ${avantPromo.rows[0].n} → ${apresPromo.rows[0].n}`);

  /* Et avec un identifiant de membre DEVINÉ — le cas où le SELECT ne protège
     plus, parce que l'attaquant fournit directement la clé. */
  const { rows: [cible] } = await verite.query(
    "SELECT id FROM membres WHERE entreprise_id = $1 LIMIT 1", [jokswed]);
  const promoDirecte = await refuse(app, videaste,
    `INSERT INTO membres_permissions (membre_id, permission_cle, accorde)
     VALUES ($1, 'finance.consolide.lire', true)`, [cible.id]);
  const apresDirecte = await verite.query(
    "SELECT count(*)::int n FROM membres_permissions WHERE membre_id = $1", [cible.id]);
  verifier("Même avec l'identifiant de membre deviné, l'écriture est refusée",
    promoDirecte !== null && apresDirecte.rows[0].n === 0,
    promoDirecte ? `reste ${apresDirecte.rows[0].n} ligne(s)` : "aucune erreur levée");

  const permProprio = await en(app, proprietaire,
    "SELECT permission_cle FROM app.permissions_effectives($1) ORDER BY 1", [jokswed]);
  verifier("Le propriétaire a 27 permissions effectives",
    permProprio.rowCount === 27, `${permProprio.rowCount}`);
  verifier("…mais PAS finance.consolide.lire",
    !permProprio.rows.some((r) => r.permission_cle === "finance.consolide.lire"));

  const permAssistant = await en(app, assistant,
    "SELECT permission_cle FROM app.permissions_effectives($1) ORDER BY 1", [jokswed]);
  verifier("L'assistant n'a aucune permission financière",
    !permAssistant.rows.some((r) => r.permission_cle.startsWith("finance.")),
    permAssistant.rows.map((r) => r.permission_cle).join(","));

  /* Un refus individuel l'emporte sur le rôle. */
  const membreAssistant = await en(app, proprietaire,
    "SELECT id FROM membres WHERE utilisateur_id = $1 AND entreprise_id = $2", [assistant, jokswed]);
  await en(app, proprietaire,
    `INSERT INTO membres_permissions (membre_id, permission_cle, accorde, motif)
     VALUES ($1,'dossier.lire',false,'banc') ON CONFLICT (membre_id, permission_cle)
     DO UPDATE SET accorde = false`, [membreAssistant.rows[0].id]);
  const apresRefus = await en(app, assistant,
    "SELECT permission_cle FROM app.permissions_effectives($1)", [jokswed]);
  verifier("Un refus individuel l'emporte sur la permission du rôle",
    !apresRefus.rows.some((r) => r.permission_cle === "dossier.lire"));

  /* ═══════════ 9. SECRETS : CHACUN LES SIENS ═══════════ */
  const secretsAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM identifiants WHERE utilisateur_id <> $1", [videaste]);
  verifier("Personne ne lit l'empreinte de mot de passe d'autrui",
    secretsAutrui.rows[0].n === 0, `${secretsAutrui.rows[0].n} lignes`);

  const sessionsAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM sessions WHERE utilisateur_id <> $1", [videaste]);
  verifier("Personne ne lit les sessions d'autrui", sessionsAutrui.rows[0].n === 0);

  /* ═══════════ 10. RÉVOCATION IMMÉDIATE ═══════════ */
  const avantRevoc = await en(app, assistant, "SELECT count(*)::int n FROM dossiers");
  await en(app, proprietaire,
    "UPDATE membres SET retire_le = now() WHERE utilisateur_id = $1 AND entreprise_id = $2",
    [assistant, jokswed]);
  const apresRevoc = await en(app, assistant, "SELECT count(*)::int n FROM dossiers");
  verifier("Après retrait du membre, il ne voit plus rien — dès la requête suivante",
    avantRevoc.rows[0].n > 0 && apresRevoc.rows[0].n === 0,
    `avant ${avantRevoc.rows[0].n}, après ${apresRevoc.rows[0].n}`);

  const apresRevocEnt = await en(app, assistant, "SELECT count(*)::int n FROM entreprises");
  verifier("…ni aucune entreprise", apresRevocEnt.rows[0].n === 0);

  /* ═══════════ 11. JOURNAL D'AUDIT ═══════════ */
  await en(app, videaste,
    `INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
     VALUES ($1,$2,'banc.essai','dossier','x')`, [videaste, video]);
  const auditAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM journal_audit WHERE entreprise_id = $1", [jokswed]);
  verifier("Le journal d'autrui n'est pas lisible", auditAutrui.rows[0].n === 0);

  const majAudit = await refuse(app, videaste,
    "UPDATE journal_audit SET action = 'falsifiee' WHERE entreprise_id = $1", [video]);
  verifier("Une ligne d'audit ne peut pas être réécrite", majAudit !== null, "UPDATE accepté");
  const supprAudit = await refuse(app, videaste, "DELETE FROM journal_audit");
  verifier("Une ligne d'audit ne peut pas être supprimée", supprAudit !== null, "DELETE accepté");

  /* ═══════════ 12. AFFECTATIONS ═══════════ */
  const affectationCroisee = await refuse(app, proprietaire,
    `INSERT INTO affectations (dossier_id, entreprise_id, utilisateur_id, mission)
     VALUES ($1, $2, $3, 'second opérateur')`,
    [f.dossiers.jokswedPrive, jokswed, videaste]);
  verifier("On ne peut pas affecter quelqu'un qui n'est pas membre de l'entreprise",
    affectationCroisee !== null, "affectation acceptée");
} finally {
  if (app) await app.end();
  if (verite) await verite.end();
  await pgdev.stop();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} épreuves de sécurité passées.`);
if (echecs.length) {
  console.error("\nÉchecs :");
  for (const e of echecs) console.error(`   ✗ ${e.nom}${e.detail ? ` — ${e.detail}` : ""}`);
  process.exit(1);
}
console.log("Banc de sécurité : tout est vert.");
