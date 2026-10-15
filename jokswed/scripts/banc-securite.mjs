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
import { demarrer, urlMigrateur, urlApplication, urlAuth, baseVierge } from "./pg-dev.mjs";
import { migrer } from "./migrer.mjs";
import { semer } from "./semer.mjs";

const resultats = [];
function verifier(nom, condition, detail = "") {
  resultats.push({ nom, ok: Boolean(condition), detail });
  console.log(`${condition ? "✓" : "✗"} ${nom}${condition ? "" : ` — ${detail}`}`);
}

/* ⚠️ L'IDENTITÉ N'EST PLUS UN IDENTIFIANT POSÉ, MAIS UNE SESSION PROUVÉE.

   Depuis le palier 013, `app.acteur()` résout l'empreinte d'un jeton de
   session au lieu de croire un `utilisateur_id` sur parole. Le banc crée donc
   de vraies sessions pour ses personnages, et pose leur empreinte — comme le
   fait `avecActeur()` en production.

   Ce tableau fait le lien entre les identifiants utilisés dans les épreuves
   et l'empreinte correspondante. */
const jetons = new Map();

/** Exécute une requête AVEC une identité, comme `avecActeur()` en production. */
async function en(client, acteurId, texte, valeurs = []) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.session_jeton', $1, true)",
      [jetons.get(acteurId) ?? acteurId]);
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

  /* Sessions de banc : créées par le propriétaire, car le rôle applicatif n'a
     plus le droit d'écrire dans `sessions` (palier 013). */
  for (const [nom, uid] of Object.entries(f.utilisateurs)) {
    const empreinte = `banc-session-${nom}`;
    await verite.query(
      `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
       VALUES ($1,$2, now() + interval '1 day', true)`, [uid, empreinte]);
    jetons.set(uid, empreinte);
  }

  const { jokswed, video } = f.entreprises;
  const { proprietaire, videaste, assistant, photographe } = f.utilisateurs;

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
       -- Catalogues de référence, identiques pour toutes les entreprises et
       -- sans la moindre donnée personnelle : les cloisonner n'aurait rien à
       -- cloisonner. types_notification rejoint permissions pour la même
       -- raison : c'est la liste des types possibles, pas des notifications.
       AND c.relname NOT IN ('schema_migrations','permissions','taux_tva',
                             'types_notification')
     ORDER BY 1`);
  verifier("Toute table métier a RLS activé", sansRls.rowCount === 0,
    sansRls.rows.map((r) => r.relname).join(", "));

  /* ⚠️ CE BANC VÉRIFIAIT L'INVARIANT INVERSE — VOIR LE PALIER 056.
     Il exigeait `FORCE ROW LEVEL SECURITY` partout sauf sur cinq tables. Mais
     `FORCE` ne contraint que le PROPRIÉTAIRE des tables, `jokswed_migrateur`,
     qui possède aussi toutes les fonctions `SECURITY DEFINER` de l'accès
     contrôlé : il les soumettait aux politiques qu'elles arbitrent. En local
     le migrateur est superutilisateur, l'assertion passait sans rien prouver ;
     sur Neon le dépôt public échouait.

     L'invariant qui porte réellement la garantie est celui-ci : les rôles
     applicatifs ne possèdent AUCUNE table, donc la RLS leur est opposée en
     toutes circonstances. C'est lui qu'on vérifie désormais. */
  const force = await app.query(`
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity
     ORDER BY 1`);
  verifier("Aucune table n'est en FORCE (incompatible avec SECURITY DEFINER)",
    force.rowCount === 0, force.rows.map((r) => r.relname).join(", "));

  const possedees = await app.query(`
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND pg_get_userbyid(c.relowner) IN ('jokswed_app','jokswed_public','jokswed_auth')
     ORDER BY 1`);
  verifier("⚠️ Les rôles applicatifs ne possèdent aucune table : la RLS leur est opposable",
    possedees.rowCount === 0, possedees.rows.map((r) => r.relname).join(", "));

  const secdef = await app.query(`
    SELECT p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef AND n.nspname IN ('public','app') ORDER BY 1`);
  /* ⚠️ LISTE BLANCHE EXPLICITE DES FONCTIONS À PRIVILÈGES.
     Chaque entrée est une capacité accordée au-delà des politiques : elle doit
     être justifiée en commentaire dans sa migration. Le banc échoue si une
     nouvelle apparaît sans être inscrite ici — c'est la seule façon de ne pas
     laisser la surface grandir en silence. */
  const secdefAttendues = [
    "auth_creer_session","auth_identifiant","auth_journaliser_tentative","auth_revoquer_session",
    "auth_session","auth_tentatives_recentes","auth_valider_mfa","entreprises_de_lacteur",
    "admin_affecter","admin_creer_invitation","admin_definir_permission","admin_definir_roles",
    "admin_maj_entreprise","admin_revoquer_membre","exiger","permissions_de",
    "permissions_effectives",
    /* V4 — dépôt public et file d'événements. `deposer_demande` est la seule
       écriture PUBLIQUE du schéma : le formulaire n'a pas d'acteur, donc
       aucune politique ne peut l'autoriser. Son périmètre est éprouvé plus
       bas — elle ne sait que déposer une demande. Les cinq autres servent le
       drain, qui tourne lui aussi sans acteur. */
    "deposer_demande","evenements_a_traiter","evenement_traite","evenement_echoue",
    "notifier","membres_avec",
    /* V4.1 — `acteur()` est passée en SECURITY DEFINER au palier 013 : elle
       lit `sessions`, dont la politique l'appelle elle-même. Sans cela,
       récursion. Son périmètre est le plus étroit du schéma : elle ne rend
       qu'un uuid, et seulement si une session valide le prouve. */
    "acteur",
    /* V4.1 — limitation de débit, journal d'envoi, verrou du drain, et la
       relecture minimale d'une demande par le drain (qui n'a pas d'acteur). */
    "limiter","journaliser_envoi","relancer_envoi","verrou_drain","demande_pour_envoi",
    /* V5 — garde d'émission, numérotation atomique, passage au définitif. */
    "verdict_emission","numero_suivant","emettre_document","sceller_document",
    /* V5 — paiements. `situation_financiere` est la seule qui lit plusieurs
       tables ; elle ne rend que des TOTAUX, jamais une ligne de détail, et
       l'appelant doit déjà connaître l'identifiant de la demande. */
    "situation_financiere","enregistrer_paiement","confirmer_paiement",
    /* V6 — paiements : modification avant confirmation, abandon d'une saisie
       erronée. Toutes deux exigent `finance.saisir_paiement` et refusent de
       toucher un mouvement confirmé. */
    "modifier_paiement","annuler_paiement",
    /* V6 — agrégats financiers. `_finances_par_demande` CALCULE sans
       contrôler, et n'est accordée à AUCUN rôle : seules les fonctions du
       schéma `app` l'atteignent, après avoir vérifié `finance.lire`. */
    "_finances_par_demande","finances_par_demande","finances_resume",
    "finances_mensuelles",
    /* V6 — carnet. `saison_mariages` exige `dossier.lire` et dégrade les
       colonnes financières à zéro sans `finance.lire`. */
    "confirmer_demande","saison_mariages",
    /* V6 — collaborateurs. Suspension, envoi et révocation d'invitation
       exigent une permission ET refusent de s'appliquer à soi-même. */
    "admin_suspendre_membre","admin_envoyer_invitation","admin_revoquer_invitation",
    "invitation_pour_envoi","invitation_jeton_efface",
    /* V6 — chemin d'activation, réservé à `jokswed_auth` : il crée un
       utilisateur et une adhésion, ce que le rôle métier ne doit pas pouvoir
       faire. Vérifié plus bas par une épreuve dédiée. */
    "auth_invitation","auth_accepter_invitation",
    /* V6 — collaboration. `propositions_recues` est la plus sensible : c'est
       elle qui décide que les coordonnées du couple ne sortent qu'après
       acceptation ET partage explicite. */
    "proposer_prestation","transmettre_proposition","repondre_proposition",
    "propositions_recues","partager_coordonnees","proposition_pour_envoi",
    /* V6 — la RAISON COMMERCIALE d'un partenaire, et rien d'autre. La
       politique de `entreprises` ne rend que les siennes ; sans ces deux
       fonctions, la fiche perdait silencieusement ses propositions. Elles
       n'exposent ni e-mail, ni SIRET, ni adresse, ni aucun montant. */
    "partenaires_disponibles","propositions_emises",
    /* V6 — notifications. `notifier` doit lire les permissions du
       DESTINATAIRE, qui n'est pas l'acteur courant. */
    "notification_voulue","mes_notifications",
    /* V6.1 — enveloppe de `permissions_de` utilisée PAR LES POLITIQUES
       elles-mêmes : elle doit voir `membres` sans être filtrée par la
       politique qu'elle sert à évaluer. */
    "acteur_porte",
    /* V6 — le commercial d'un collaborateur, ancré à SON dossier.
       `contexte_dossier` et `mes_dossiers` décident que les coordonnées du
       couple ne sortent qu'après partage explicite ; `_encours_entreprise`
       calcule sans contrôler et n'est accordée à aucun rôle. */
    "mes_dossiers","contexte_dossier","situation_devis",
    "enregistrer_paiement_dossier","_encours_entreprise",
    /* V6 — parrainage. Elle CRÉE une entreprise et une adhésion : c'est la
       plus dangereuse du lot, et c'est pourquoi elle exige `membre.inviter`
       sur une entreprise dont l'appelant est DÉJÀ membre, et n'accorde au
       parrain qu'inviter et révoquer. */
    "creer_entreprise_partenaire",
    /* V6.1 — transmission automatique. `transmettre_propositions_auto` est
       appelée par le DRAIN, qui n'a pas d'acteur : elle ne s'appuie donc sur
       aucune permission d'appelant et ne prend qu'un identifiant de demande.
       Ses propres conditions (destinataire opérationnel, consentement du
       couple) sont vérifiées en base. */
    "destinataire_operationnel","transmettre_propositions_auto",
    "propositions_en_attente",
    /* V6.1 — garde-fous du parrainage. `quitter_entreprise` ne fait que
       RÉDUIRE les droits de l'appelant : c'est la seule action qu'on
       s'applique légitimement à soi-même. */
    "entreprise_en_amorcage","quitter_entreprise",
    /* V7 — messagerie. `conversations_de_lacteur` sert les POLITIQUES
       elles-mêmes : elle doit lire `conversation_participants` sans être
       filtrée par la politique qu'elle évalue. Les autres contrôlent la
       participation ET la permission à l'entrée, et refusent par exception
       plutôt que de rendre une liste vide. */
    "conversations_de_lacteur","ouvrir_conversation","ajouter_participant",
    "composer_message","joindre_document","archiver_conversation","marquer_lue",
    "mes_conversations","fil_conversation","variables_conversation",
    "installer_modeles",
    /* V7 — réception. `recevoir_message` et `message_pour_envoi` sont
       appelées par le webhook et le drain, qui n'ont AUCUN acteur : la RLS
       leur rendrait zéro ligne et l'opération serait sautée en silence.
       Elles portent leurs propres garde-fous — jeton de conversation,
       expéditeur participant, nature de la conversation. */
    "recevoir_message","joindre_piece_entrante","message_pour_envoi","message_envoye",
    /* V7 — nommer un co-participant sans voir son entreprise. Même raison
       qu'au palier 029 : la politique de `entreprises` ne rend que les
       siennes, et seule la raison commerciale est exposée. */
    "participants_conversation","partenaires_invitables",
    /* Mise en service — identités d'envoi, conversation d'un collaborateur
       depuis SON dossier, transmission manuelle avec choix du partage. */
    "identite_envoi","ouvrir_conversation_dossier","transmettre_a_partenaire",
    /* V8 (stabilisation) — compte propriétaire. `auth_amorcer_proprietaire`
       crée un compte SANS session : elle est réservée à `jokswed_auth`, et
       refuse dès qu'un utilisateur existe. Les autres s'appuient sur
       `app.acteur()` et n'agissent que sur l'appelant lui-même. */
    "auth_amorcage_possible","auth_amorcer_proprietaire","auth_mfa_de_session",
    "changer_mot_de_passe","mfa_preparer","mfa_en_attente","mfa_confirmer",
    "mfa_retirer","mes_sessions","revoquer_mes_sessions","mes_connexions",
    /* V5 — contrôle différé de complétude d'un document émis. En SECURITY
       INVOKER, une ligne cachée par la RLS ferait sauter le contrôle en
       silence. La fonction ne rend rien et n'écrit rien : elle lève, ou pas. */
    "documents_emis_complets",
    /* V8 — suivi public d'une demande et notifications push. Relues avant
       inscription ici, et non ajoutées pour faire taire le banc :

       · `demande_suivi_public` sert la page `/suivi/[id]`, qui n'a aucun
         acteur : la RLS lui rendrait zéro ligne. Elle est STABLE, son
         `search_path` est figé, elle est retirée à PUBLIC et accordée au seul
         rôle métier, elle n'écrit rien et ne prend qu'un identifiant de
         demande. L'identifiant seul ne suffit pas : la page exige en plus un
         jeton signé (`verifierSuiviDemande`) avant de l'appeler.

       · Le chemin de notification n'a pas davantage d'acteur. Sa fonction
         s'appelle désormais `push_abonnements_evenement` : le palier 062 a
         remplacé le paramètre « entreprise » par l'identifiant de
         l'événement, ce qui a fermé la limite documentée ici auparavant. */
    "demande_suivi_public",
    /* Palier 062 — l'événement est devenu la capacité.
       `push_abonnements_evenement` ne prend plus une entreprise mais
       l'identifiant de l'événement en cours de traitement, dont elle déduit
       l'entreprise. `evenements` étant retirée au rôle métier, le seul moyen
       d'obtenir un tel identifiant est `evenements_a_traiter()` — la porte du
       drain. Il n'existe plus de chemin par lequel le rôle métier désigne les
       abonnements d'une AUTRE entreprise. Un banc le vérifie plus bas. */
    "push_abonnements_evenement",
    /* CRM (paliers 060-061) — un dossier saisi à la main, modifié, chiffré,
       planifié. Chacune vérifie sa permission en PREMIÈRE ligne par
       `app.exiger`, et `SECURITY DEFINER` n'est là que pour ce que le rôle
       métier ne doit PAS pouvoir faire seul : avancer la série de références
       (`demande_series` lui est retirée), écrire le mariage du pilote,
       supprimer un paiement déclaré.

       · `planning_du_dossier`, `fichiers_du_dossier`, `fichier_du_dossier`
         servent l'espace d'un collaborateur : elles exigent `dossier.lire`
         SUR SON entreprise, puis un partage explicite du mariage. Aucune
         colonne financière n'en sort.
       · `calendrier_entreprise` n'a pas d'acteur — un flux iCalendar est lu
         par Apple Calendar, pas par une session. Son seul argument est
         l'EMPREINTE d'un jeton indevinable, et elle ne rend aucun montant. */
    "creer_demande_manuelle","maj_demande","definir_echeancier",
    "definir_statut_demande","enregistrer_paiement_echeance",
    "confirmer_paiement_et_dossier","supprimer_demande",
    "planning_du_dossier","fichiers_du_dossier","fichier_du_dossier",
    "reordonner_etape",
    "definir_jeton_calendrier","calendrier_entreprise",
    /* Mise en service — PRÉDICATS D'AMORÇAGE, appelés par les POLITIQUES
       elles-mêmes. Ils doivent compter des lignes de `membres` et de
       `membres_roles` sans être filtrés par la politique qu'ils servent à
       évaluer. Chacun ne rend qu'un booléen, et chacun est AUTO-REFERMANT :
       il devient faux dès que l'entreprise a un membre actif
       (`entreprise_sans_membre`), dès qu'un rôle y est attribué
       (`entreprise_sans_role`), ou dès que la base compte un second membre
       (`base_un_seul_membre`). C'est ce qui autorise la création du tout
       premier compte sans jamais ouvrir une porte ensuite. */
    "entreprise_sans_membre","entreprise_sans_role","base_un_seul_membre",
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

  /* ═══════════ 8. PERMISSIONS ═══════════ */
  /* ⚠️ CE BLOC A ÉTÉ RE-POINTÉ AU PALIER 008.
     Il constatait auparavant que RLS N'EMPÊCHAIT PAS l'auto-promotion, et que
     seule la couche applicative s'y opposait. Depuis le retrait des
     privilèges d'écriture et l'ajout de `app.exiger()`, c'est la base qui
     refuse. Laisser l'ancienne assertion aurait signifié qu'un banc vert
     décrivait un comportement qui n'existe plus. */

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

  /* Un refus individuel l'emporte sur le rôle — posé par le chemin légitime. */
  const membreAssistant = await verite.query(
    "SELECT id FROM membres WHERE utilisateur_id = $1 AND entreprise_id = $2 AND retire_le IS NULL",
    [assistant, jokswed]);
  await en(app, proprietaire,
    "SELECT app.admin_definir_permission($1,'dossier.lire',false,'banc')",
    [membreAssistant.rows[0].id]);
  const apresRefus = await en(app, assistant,
    "SELECT permission_cle FROM app.permissions_effectives($1)", [jokswed]);
  verifier("Un refus individuel l'emporte sur la permission du rôle",
    !apresRefus.rows.some((r) => r.permission_cle === "dossier.lire"));

  /* ⚠️ ET IL RETIRE AUSSI L'ACCÈS AUX LIGNES, PAS SEULEMENT LE VERBE.
     Avant le palier 034, les politiques ne regardaient que l'appartenance à
     l'entreprise : un membre dont on venait de retirer `dossier.lire`
     continuait de lire `dossiers` par une requête SQL directe. L'interface
     le lui refusait ; la base, non. */
  const dossiersApresRefus = await en(app, assistant,
    "SELECT count(*)::int n FROM dossiers");
  verifier("…et le refus coupe aussi l'accès SQL aux dossiers",
    dossiersApresRefus.rows[0].n === 0, `${dossiersApresRefus.rows[0].n} ligne(s)`);
  const demandesApresRefus = await en(app, assistant,
    "SELECT count(*)::int n FROM demandes");
  verifier("…et aux demandes", demandesApresRefus.rows[0].n === 0);

  /* ═══════════ 9. SECRETS : CHACUN LES SIENS ═══════════ */
  const secretsAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM identifiants WHERE utilisateur_id <> $1", [videaste]);
  verifier("Personne ne lit l'empreinte de mot de passe d'autrui",
    secretsAutrui.rows[0].n === 0, `${secretsAutrui.rows[0].n} lignes`);

  const sessionsAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM sessions WHERE utilisateur_id <> $1", [videaste]);
  verifier("Personne ne lit les sessions d'autrui", sessionsAutrui.rows[0].n === 0);

  /* ═══════════ 9 bis. COMPTE PROPRIÉTAIRE ═══════════ */
  /* ⚠️ L'AMORÇAGE DOIT ÊTRE DÉFINITIVEMENT FERMÉ.
     La base a des comptes : la fonction doit refuser, quel que soit
     l'appelant et quel que soit le secret d'environnement. */
  const amorcagePossible = await verite.query("SELECT app.auth_amorcage_possible() AS x");
  verifier("L'amorçage est fermé dès qu'un compte existe",
    amorcagePossible.rows[0].x === false);
  let refusAmorcage = "aucune erreur";
  const authAmorcage = new pg.Client({ connectionString: urlAuth(base) });
  authAmorcage.on("error", () => {});
  await authAmorcage.connect();
  try {
    await authAmorcage.query(
      "SELECT app.auth_amorcer_proprietaire($1::citext,$2,$3,$4,$5,$6)",
      ["pirate@exemple.invalid", "P", "I", "empreinte", "pirate", "Pirate"]);
  } catch (e) { refusAmorcage = e.message; }
  await authAmorcage.end();
  verifier("…et la fonction refuse même avec le bon chemin",
    /existent déjà/.test(refusAmorcage), refusAmorcage);

  /* ⚠️ LE RÔLE MÉTIER NE PEUT PAS AMORCER. */
  let refusAppAmorcage = "aucune erreur";
  try {
    await app.query("SELECT app.auth_amorcer_proprietaire($1::citext,$2,$3,$4,$5,$6)",
      ["x@exemple.invalid", "X", "Y", "e", "x", "X"]);
  } catch (e) { refusAppAmorcage = e.message; }
  verifier("Le rôle métier n'a pas accès au chemin d'amorçage",
    /permission/i.test(refusAppAmorcage), refusAppAmorcage);

  /* Mot de passe, MFA, sessions : chacun les siens, et rien d'autre. */
  const mesSessions = await en(app, videaste, "SELECT * FROM app.mes_sessions()");
  verifier("Chacun ne voit que SES sessions",
    mesSessions.rows.length >= 1
      && (await verite.query(
          "SELECT utilisateur_id FROM sessions WHERE id = $1", [mesSessions.rows[0].id]))
         .rows[0].utilisateur_id === videaste,
    `${mesSessions.rows.length}`);

  const sessionsAvant = await verite.query(
    "SELECT count(*)::int n FROM sessions WHERE utilisateur_id = $1 AND revoquee_le IS NULL",
    [videaste]);
  await verite.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,'banc-autre-appareil', now() + interval '1 day', true)`, [videaste]);
  await en(app, videaste, "SELECT app.revoquer_mes_sessions(true)");
  const resteCourante = await en(app, videaste, "SELECT * FROM app.mes_sessions()");
  verifier("⚠️ « Déconnecter partout » garde la session COURANTE",
    resteCourante.rows.length === 1 && resteCourante.rows[0].courante === true,
    `${resteCourante.rows.length} session(s), avant ${sessionsAvant.rows[0].n}`);

  /* ⚠️ ON NE RÉVOQUE PAS LES SESSIONS D'AUTRUI. */
  const sessionsProprio = await verite.query(
    "SELECT count(*)::int n FROM sessions WHERE utilisateur_id = $1 AND revoquee_le IS NULL",
    [proprietaire]);
  verifier("…et celles des autres ne bougent pas", sessionsProprio.rows[0].n >= 1);

  /* ═══════════ 10. RÉVOCATION IMMÉDIATE ═══════════ */
  /* ⚠️ RE-POINTÉ AU PALIER 034. On vient de retirer `dossier.lire` à
     l'assistant : il voit déjà zéro dossier, et ce test passerait À VIDE, en
     prouvant seulement qu'on a bien cassé quelque chose avant. On lui rend
     donc son droit, pour que la révocation soit la SEULE cause du passage à
     zéro. (On ne prend pas le photographe : il sert de cible stable à un
     contrôle positif plus bas.) */
  await en(app, proprietaire,
    "SELECT app.admin_definir_permission($1,'dossier.lire',true,'banc : on rend le droit')",
    [membreAssistant.rows[0].id]);
  const avantRevoc = await en(app, assistant, "SELECT count(*)::int n FROM dossiers");
  /* Re-pointé au palier 008 : l'UPDATE direct n'est plus permis au rôle
     applicatif, la révocation passe par la fonction qui vérifie la
     permission et pose la trace d'audit. */
  await en(app, proprietaire, "SELECT app.admin_revoquer_membre($1)",
    [membreAssistant.rows[0].id]);
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

  /* ═══════════ 13. ÉLÉVATION DE PRIVILÈGES — FERMÉE EN BASE (palier 008) ═══════════ */
  /* Toutes ces tentatives sont faites en SQL DIRECT avec le rôle de
     l'application, sans passer par une seule ligne du code serveur. */
  const monMembre = await en(app, videaste,
    "SELECT id FROM membres WHERE utilisateur_id = $1 AND retire_le IS NULL", [videaste]);
  const monMembreId = monMembre.rows[0].id;

  const ecritureDirecte = await refuse(app, videaste,
    `INSERT INTO membres_permissions (membre_id, permission_cle, accorde)
     VALUES ($1,'finance.consolide.lire',true)`, [monMembreId]);
  verifier("Écrire dans membres_permissions est refusé au rôle applicatif",
    ecritureDirecte !== null && ecritureDirecte.code === "42501",
    ecritureDirecte ? `code ${ecritureDirecte.code}` : "l'écriture a réussi");

  const viaFonction = await refuse(app, videaste,
    "SELECT app.admin_definir_permission($1,'finance.consolide.lire',true)", [monMembreId]);
  const resteSansPerm = await verite.query(
    "SELECT count(*)::int n FROM membres_permissions WHERE membre_id = $1", [monMembreId]);
  verifier("La fonction d'administration refuse qu'on se vise soi-même",
    viaFonction !== null && resteSansPerm.rows[0].n === 0,
    viaFonction ? `reste ${resteSansPerm.rows[0].n} ligne(s)` : "aucune erreur levée");

  const rolesDirect = await refuse(app, videaste,
    "DELETE FROM membres_roles WHERE membre_id = $1", [monMembreId]);
  verifier("Modifier ses propres rôles en SQL direct est refusé",
    rolesDirect !== null && rolesDirect.code === "42501",
    rolesDirect ? `code ${rolesDirect.code}` : "le DELETE a réussi");

  const rolesFonction = await refuse(app, videaste,
    "SELECT app.admin_definir_roles($1, ARRAY[]::uuid[])", [monMembreId]);
  verifier("Se retirer ou se donner un rôle via la fonction est refusé",
    rolesFonction !== null, "aucune erreur levée");

  const changerEntreprise = await refuse(app, videaste,
    "UPDATE membres SET entreprise_id = $1 WHERE id = $2", [jokswed, monMembreId]);
  verifier("Changer son entreprise d'appartenance est refusé",
    changerEntreprise !== null && changerEntreprise.code === "42501",
    changerEntreprise ? `code ${changerEntreprise.code}` : "l'UPDATE a réussi");

  const sAjouter = await refuse(app, videaste,
    "INSERT INTO membres (entreprise_id, utilisateur_id) VALUES ($1,$2)", [jokswed, videaste]);
  verifier("S'ajouter comme membre d'une autre entreprise est refusé",
    sAjouter !== null && sAjouter.code === "42501",
    sAjouter ? `code ${sAjouter.code}` : "l'INSERT a réussi");

  const forgerRole = await refuse(app, videaste,
    `INSERT INTO roles_permissions (role_id, permission_cle)
     SELECT id, 'finance.consolide.lire' FROM roles WHERE entreprise_id = $1 LIMIT 1`, [video]);
  verifier("Enrichir un rôle existant de permissions est refusé",
    forgerRole !== null && forgerRole.code === "42501",
    forgerRole ? `code ${forgerRole.code}` : "l'INSERT a réussi");

  const sAffecter = await refuse(app, videaste,
    `INSERT INTO affectations (dossier_id, entreprise_id, utilisateur_id, mission)
     VALUES ($1,$2,$3,'intrusion')`, [f.dossiers.jokswedPrive, jokswed, videaste]);
  verifier("S'affecter à un dossier d'autrui est refusé",
    sAffecter !== null && sAffecter.code === "42501",
    sAffecter ? `code ${sAffecter.code}` : "l'INSERT a réussi");

  const inviterSansDroit = await refuse(app, assistant,
    "SELECT app.admin_creer_invitation($1,'intrus@exemple.invalid',null,null,'x',ARRAY[]::uuid[],7)",
    [jokswed]);
  verifier("Inviter sans la permission `membre.inviter` est refusé",
    inviterSansDroit !== null, "l'invitation a été créée");

  const renommer = await refuse(app, assistant,
    "UPDATE entreprises SET nom_commercial = 'Détournée' WHERE id = $1", [jokswed]);
  verifier("Modifier les réglages de l'entreprise en SQL direct est refusé",
    renommer !== null && renommer.code === "42501",
    renommer ? `code ${renommer.code}` : "l'UPDATE a réussi");

  /* Et le chemin légitime doit, lui, fonctionner. Une protection qui bloque
     aussi l'usage normal n'est pas une protection, c'est une panne. */
  /* On vise le photographe, membre stable : l'assistant a été révoqué plus
     haut, et une cible révoquée ferait échouer ce contrôle positif pour une
     raison étrangère à ce qu'il vérifie. */
  const membreAssistant2 = await verite.query(
    "SELECT id FROM membres WHERE utilisateur_id = $1 AND entreprise_id = $2 AND retire_le IS NULL",
    [photographe, jokswed]);
  const legitime = await refuse(app, proprietaire,
    "SELECT app.admin_definir_permission($1,'finance.lire',true,'banc')",
    [membreAssistant2.rows[0].id]);
  const posee = await verite.query(
    "SELECT accorde FROM membres_permissions WHERE membre_id = $1 AND permission_cle = 'finance.lire'",
    [membreAssistant2.rows[0].id]);
  verifier("Le propriétaire PEUT accorder une permission à un autre membre",
    legitime === null && posee.rows[0]?.accorde === true,
    legitime ? `erreur ${legitime.code}` : "aucune ligne posée");

  const traceLaissee = await verite.query(
    "SELECT count(*)::int n FROM journal_audit WHERE action = 'permission.definie'");
  verifier("L'octroi laisse une trace d'audit", traceLaissee.rows[0].n >= 1);

  /* ═══════════ 14. LE CONTOURNEMENT DU PROPRIÉTAIRE N'OUVRE RIEN ═══════════ */
  /* Depuis le palier 056, plus aucune table n'est en `FORCE` : le
     propriétaire des tables les lit donc toutes sans politique. C'est voulu,
     et sans effet sur l'application — elle n'est PAS propriétaire. Cette
     section le prouve table par table, sur celles où la tentation serait la
     plus forte : identité, secrets, sessions, adhésions. */
  for (const [table, colonne] of [
    ["utilisateurs", "id"], ["identifiants", "utilisateur_id"],
    ["sessions", "utilisateur_id"], ["facteurs_mfa", "utilisateur_id"],
  ]) {
    const r = await en(app, videaste,
      `SELECT count(*)::int n FROM ${table} WHERE ${colonne} = $1`, [proprietaire]);
    verifier(`Le rôle applicatif reste filtré sur « ${table} » : les lignes d'autrui restent invisibles`,
      r.rows[0].n === 0, `${r.rows[0].n} ligne(s)`);
  }
  const membresAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM membres WHERE entreprise_id = $1", [jokswed]);
  verifier("Le rôle applicatif reste filtré sur « membres » : les adhésions d'autrui restent invisibles",
    membresAutrui.rows[0].n === 0, `${membresAutrui.rows[0].n} ligne(s)`);

  /* ═══════════ 15. LE RÔLE MÉTIER NE PEUT PLUS FORGER DE SESSION ═══════════ */
  const forger = await refuse(app, videaste,
    "SELECT app.auth_creer_session($1,'empreinte-forgee',7,null,null,null,true)",
    [proprietaire]);
  verifier("Forger une session avec le rôle métier est refusé (palier 008)",
    forger !== null && forger.code === "42501",
    forger ? `code ${forger.code}` : "UNE SESSION A ÉTÉ CRÉÉE");

  const lireEmpreinte = await refuse(app, videaste,
    "SELECT * FROM app.auth_identifiant($1)", ["proprietaire@exemple.invalid"]);
  verifier("Lire l'empreinte d'un mot de passe avec le rôle métier est refusé",
    lireEmpreinte !== null && lireEmpreinte.code === "42501",
    lireEmpreinte ? `code ${lireEmpreinte.code}` : "L'EMPREINTE A ÉTÉ RENDUE");

  /* Le rôle d'authentification, lui, n'a aucun accès aux tables métier. */
  const auth = new pg.Client({ connectionString: urlAuth(base) });
  await auth.connect();
  try {
    let bloque = null;
    try { await auth.query("SELECT count(*) FROM dossiers"); }
    catch (e) { bloque = e; }
    verifier("Le rôle d'authentification ne peut lire AUCUNE table métier",
      bloque !== null && bloque.code === "42501",
      bloque ? `code ${bloque.code}` : "la lecture a réussi");
  } finally { await auth.end(); }

  /* ═══════════ 16. V4 — LE DÉPÔT PUBLIC NE SAIT QUE DÉPOSER ═══════════ */
  /* `app.deposer_demande` est accordée au rôle métier et s'exécute sans
     acteur : c'est la seule écriture publique. On vérifie qu'elle ne sert à
     rien d'autre, et que la demande déposée reste cloisonnée. */
  const avantDepot = await verite.query("SELECT count(*)::int n FROM demandes");
  const depot = await en(app, videaste, `SELECT * FROM app.deposer_demande($1::jsonb)`, [
    JSON.stringify({
      cle_idempotence: "banc-securite-depot",
      entreprise_slug: "jokswed",
      contact_nom: "Essai Sécurité",
      contact_email: "securite@exemple.invalid",
      message: "dépôt par le banc",
      lignes: [], consentements: [],
    }),
  ]);
  const apresDepot = await verite.query("SELECT count(*)::int n FROM demandes");
  verifier("Le dépôt public fonctionne sans acteur authentifié",
    depot.rows[0].rejeu === false && apresDepot.rows[0].n === avantDepot.rows[0].n + 1);

  /* ⚠️ LE POINT QUI COMPTE : la demande a été déposée POUR JoksWed, par le
     vidéaste. Il ne doit pas la voir pour autant. */
  const depotVisible = await en(app, videaste,
    "SELECT count(*)::int n FROM demandes WHERE id = $1", [depot.rows[0].demande_id]);
  verifier("Déposer une demande pour une autre entreprise ne la rend pas visible",
    depotVisible.rows[0].n === 0, `${depotVisible.rows[0].n} ligne(s)`);

  const depotProprio = await en(app, proprietaire,
    "SELECT count(*)::int n FROM demandes WHERE id = $1", [depot.rows[0].demande_id]);
  verifier("…alors que le destinataire légitime la voit",
    depotProprio.rows[0].n === 1, `${depotProprio.rows[0].n} ligne(s)`);

  /* Rejeu : la même clé rend la demande existante, sans en créer une seconde. */
  const rejeuDepot = await en(app, videaste, `SELECT * FROM app.deposer_demande($1::jsonb)`, [
    JSON.stringify({
      cle_idempotence: "banc-securite-depot", entreprise_slug: "jokswed",
      contact_nom: "Essai Sécurité", contact_email: "securite@exemple.invalid",
      message: "second envoi", lignes: [], consentements: [],
    }),
  ]);
  const apresRejeu = await verite.query("SELECT count(*)::int n FROM demandes");
  verifier("Un rejeu de clé d'idempotence ne crée pas de seconde demande",
    rejeuDepot.rows[0].rejeu === true && apresRejeu.rows[0].n === apresDepot.rows[0].n);

  /* Écriture directe dans les tables de la file : interdite. */
  const ecrireEvenement = await refuse(app, videaste,
    `INSERT INTO evenements (type, charge_utile, cle_idempotence)
     VALUES ('faux', '{}'::jsonb, 'banc-faux')`);
  verifier("Écrire directement dans la file d'événements est refusé",
    ecrireEvenement !== null && ecrireEvenement.code === "42501",
    ecrireEvenement ? `code ${ecrireEvenement.code}` : "l'INSERT a réussi");

  /* Les notifications appartiennent à leur destinataire, pas à l'entreprise. */
  const notifAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM notifications WHERE destinataire_id <> $1", [videaste]);
  verifier("Les notifications d'autrui sont invisibles",
    notifAutrui.rows[0].n === 0, `${notifAutrui.rows[0].n} ligne(s)`);

  /* Les notes internes restent dans leur entreprise. */
  await en(app, proprietaire,
    `INSERT INTO notes_internes (entreprise_id, demande_id, auteur_id, corps)
     VALUES ($1,$2,$3,'note confidentielle du banc')`,
    [jokswed, depot.rows[0].demande_id, proprietaire]);
  const notesAutrui = await en(app, videaste, "SELECT count(*)::int n FROM notes_internes");
  verifier("Les notes internes d'une autre entreprise sont invisibles",
    notesAutrui.rows[0].n === 0, `${notesAutrui.rows[0].n} ligne(s)`);

  /* La proposition est visible des DEUX parties, et d'elles seules. */
  const propJokswed = await en(app, proprietaire, "SELECT count(*)::int n FROM propositions");
  const propVideo = await en(app, videaste, "SELECT count(*)::int n FROM propositions");
  verifier("Une proposition est visible de l'émetteur comme du destinataire",
    propJokswed.rows[0].n === propVideo.rows[0].n,
    `émetteur ${propJokswed.rows[0].n}, destinataire ${propVideo.rows[0].n}`);

  /* ═══════════ 17. USURPATION D'IDENTITÉ — LE TEST QUI A MOTIVÉ LE PALIER 013 ═══════════ */
  /* ⚠️ CETTE FAILLE A EXISTÉ, ET ELLE ÉTAIT TOTALE.

     Les paramètres personnalisés PostgreSQL (`app.*`) sont réglables par TOUT
     rôle — `GRANT SET ON PARAMETER` ne couvre que les paramètres système.
     Tant que `app.acteur_id` portait un identifiant d'utilisateur, ceci
     suffisait à lire l'intégralité de la base :

       SELECT set_config('app.acteur_id', '<uuid du propriétaire>', true);

     Vérifié avec le rôle applicatif réel : deux dossiers rendus. Depuis le
     palier 013, l'identité se DÉDUIT d'une session, elle ne se déclare plus. */

  await app.query("BEGIN");
  await app.query("SELECT set_config('app.acteur_id', $1, true)", [proprietaire]);
  const ancienneFaille = await app.query("SELECT count(*)::int n FROM dossiers");
  await app.query("COMMIT");
  verifier("Poser `app.acteur_id` n'a plus aucun effet",
    ancienneFaille.rows[0].n === 0, `${ancienneFaille.rows[0].n} dossier(s) rendus`);

  await app.query("BEGIN");
  await app.query("SELECT set_config('app.session_jeton', $1, true)", ["jeton-invente"]);
  const jetonInvente = await app.query("SELECT count(*)::int n FROM dossiers");
  const acteurInvente = await app.query("SELECT app.acteur() a");
  await app.query("COMMIT");
  verifier("Un jeton de session inventé ne résout aucun acteur",
    acteurInvente.rows[0].a === null && jetonInvente.rows[0].n === 0,
    `acteur=${acteurInvente.rows[0].a}, ${jetonInvente.rows[0].n} dossier(s)`);

  /* L'empreinte d'autrui n'est pas lisible : c'est ce qui rend l'usurpation
     impossible, et pas seulement improbable. */
  const empreinteAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM sessions WHERE utilisateur_id = $1", [proprietaire]);
  verifier("L'empreinte de session d'autrui n'est pas lisible",
    empreinteAutrui.rows[0].n === 0, `${empreinteAutrui.rows[0].n} ligne(s)`);

  /* Et il ne peut pas s'en fabriquer une. */
  const forgerSession = await refuse(app, videaste,
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,'empreinte-forgee', now() + interval '1 day', true)`, [proprietaire]);
  verifier("Insérer une session pour autrui est refusé",
    forgerSession !== null && forgerSession.code === "42501",
    forgerSession ? `code ${forgerSession.code}` : "L'INSERTION A RÉUSSI");

  const detournerSession = await refuse(app, videaste,
    "UPDATE sessions SET utilisateur_id = $1", [proprietaire]);
  verifier("Détourner une session existante est refusé",
    detournerSession !== null && detournerSession.code === "42501",
    detournerSession ? `code ${detournerSession.code}` : "L'UPDATE A RÉUSSI");

  /* Une session révoquée perd l'accès au niveau des POLITIQUES, pas seulement
     dans le code serveur. */
  await verite.query(
    "UPDATE sessions SET revoquee_le = now() WHERE jeton_hache = 'banc-session-photographe'");
  const apresRevocSession = await en(app, photographe, "SELECT count(*)::int n FROM dossiers");
  verifier("Une session révoquée ne résout plus d'acteur, en base",
    apresRevocSession.rows[0].n === 0, `${apresRevocSession.rows[0].n} dossier(s)`);

  /* Un second facteur non validé n'ouvre rien non plus. */
  await verite.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,'banc-session-sans-mfa', now() + interval '1 day', false)`, [proprietaire]);
  await app.query("BEGIN");
  await app.query("SELECT set_config('app.session_jeton','banc-session-sans-mfa', true)");
  const sansMfa = await app.query("SELECT count(*)::int n FROM dossiers");
  await app.query("COMMIT");
  verifier("Une session dont le second facteur n'est pas validé n'ouvre rien",
    sansMfa.rows[0].n === 0, `${sansMfa.rows[0].n} dossier(s)`);

  /* Une session expirée non plus. */
  /* ⚠️ `cree_le` doit précéder `expire_le` : la contrainte `expiration_future`
     refuse une session née après sa propre expiration. On date donc la
     création dans le passé, comme une vraie session qui a vieilli. */
  await verite.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, cree_le, expire_le, mfa_validee)
     VALUES ($1,'banc-session-expiree', now() - interval '2 hours',
             now() - interval '1 hour', true)`, [proprietaire]);
  await app.query("BEGIN");
  await app.query("SELECT set_config('app.session_jeton','banc-session-expiree', true)");
  const expiree = await app.query("SELECT count(*)::int n FROM dossiers");
  await app.query("COMMIT");
  verifier("Une session expirée n'ouvre rien",
    expiree.rows[0].n === 0, `${expiree.rows[0].n} dossier(s)`);

  /* ═══════════ 18. V5 — PAIEMENTS ET CLOISONNEMENT DES DOCUMENTS ═══════════ */
  const docAutrui = await en(app, videaste,
    "SELECT count(*)::int n FROM documents WHERE entreprise_id = $1", [jokswed]);
  verifier("Les documents d'une autre entreprise sont invisibles",
    docAutrui.rows[0].n === 0, `${docAutrui.rows[0].n} document(s)`);

  const paiementAutrui = await refuse(app, videaste,
    `INSERT INTO paiements (entreprise_id, montant_cents, moyen)
     VALUES ($1, 10000, 'virement')`, [jokswed]);
  verifier("Enregistrer un paiement pour une autre entreprise est refusé",
    paiementAutrui !== null, "l'insertion a réussi");

  const serieAutrui = await refuse(app, videaste,
    "SELECT app.numero_suivant($1,'facture',false)", [jokswed]);
  verifier("Puiser dans la série de numérotation d'autrui est refusé",
    serieAutrui !== null, "un numéro a été attribué");

  /* ⚠️ CHAQUE ENTREPRISE A SA PROPRE SÉRIE, ET ELLES NE SE CROISENT PAS. */
  const n1 = await en(app, proprietaire,
    "SELECT app.numero_suivant($1,'facture',false) AS n", [jokswed]);
  const n2 = await en(app, videaste,
    "SELECT app.numero_suivant($1,'facture',false) AS n", [video]);
  verifier("Deux entreprises démarrent chacune à 0001",
    n1.rows[0].n.endsWith("-0001") && n2.rows[0].n.endsWith("-0001"),
    `${n1.rows[0].n} / ${n2.rows[0].n}`);
  const n3 = await en(app, proprietaire,
    "SELECT app.numero_suivant($1,'facture',false) AS n", [jokswed]);
  verifier("…et la série de l'une n'avance pas celle de l'autre",
    n3.rows[0].n.endsWith("-0002"), n3.rows[0].n);
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
