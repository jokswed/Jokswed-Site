-- =============================================================================
-- 006 — SÉCURITÉ EN BASE : RÔLES, RLS FORCÉ, POLITIQUES
-- -----------------------------------------------------------------------------
-- ⚠️ TROIS FAÇONS DE CONTOURNER UNE POLITIQUE, ET ON LES FERME TOUTES.
--
--   1. un SUPERUTILISATEUR l'ignore          → l'application ne l'est pas ;
--   2. le PROPRIÉTAIRE de la table l'ignore  → `FORCE ROW LEVEL SECURITY` ;
--   3. un rôle avec BYPASSRLS l'ignore       → le rôle applicatif ne l'a pas.
--
-- Le danger réel est le n° 2 : le rôle par défaut d'un projet Neon est celui
-- qui crée les objets, donc leur propriétaire. Si l'application s'y connecte,
-- RLS ne s'applique tout simplement pas — en silence.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LES RÔLES
-- -----------------------------------------------------------------------------
-- Le propriétaire (jokswed_migrateur) exécute les migrations. Sa chaîne de
-- connexion ne doit JAMAIS être celle de l'application.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jokswed_app') THEN
    CREATE ROLE jokswed_app LOGIN PASSWORD 'dev_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jokswed_public') THEN
    CREATE ROLE jokswed_public LOGIN PASSWORD 'dev_public'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO jokswed_app, jokswed_public;

-- -----------------------------------------------------------------------------
-- 2. LE SCHÉMA `app` ET L'IDENTITÉ DE L'ACTEUR
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO jokswed_app, jokswed_public;

-- L'identité est posée par `set_config('app.acteur_id', …, true)` — le `true`
-- signifie LOCAL À LA TRANSACTION. Sans lui, le réglage survivrait sur une
-- connexion mutualisée et donnerait l'identité d'un utilisateur à la requête
-- d'un autre : la fuite la plus silencieuse de tout ce dispositif.
CREATE OR REPLACE FUNCTION app.acteur() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.acteur_id', true), '')::uuid
$$;

-- ⚠️ LA SEULE FONCTION `SECURITY DEFINER` DU SCHÉMA, ET VOICI POURQUOI.
--
-- Elle lit `membres`, qui porte elle-même une politique. Sans SECURITY
-- DEFINER, évaluer la politique de `membres` appellerait cette fonction, qui
-- relirait `membres` : récursion infinie (PostgreSQL lève 42P17).
--
-- Son périmètre est donc le plus étroit possible : elle ne rend QUE des
-- identifiants d'entreprises, jamais une donnée métier. `search_path` est
-- épinglé pour qu'aucun objet homonyme ne puisse la détourner.
-- ⚠️ CETTE FONCTION NE LIT PAS `entreprises`, ET C'EST ESSENTIEL.
--
-- Une première version la joignait, pour écarter les entreprises archivées.
-- Or la politique de `entreprises` est « id IN (SELECT unnest(
-- app.entreprises_de_lacteur())) » : la fonction appelait la politique qui
-- appelait la fonction. Récursion infinie, « stack depth limit exceeded ».
--
-- Le défaut est resté invisible pendant tout le développement parce que le
-- migrateur local est SUPERUTILISATEUR : `SECURITY DEFINER` le fait
-- contourner la RLS, la politique ne s'évalue jamais. Sur un PostgreSQL
-- géré — Neon — aucun rôle client n'est superutilisateur, et la toute
-- première requête échoue.
--
-- L'exclusion des entreprises archivées se fait donc par les DONNÉES : un
-- déclencheur retire les adhésions à l'archivage (voir le palier 050).
CREATE OR REPLACE FUNCTION app.entreprises_de_lacteur() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(m.entreprise_id), '{}'::uuid[])
    FROM membres m
    JOIN utilisateurs u ON u.id = m.utilisateur_id
   WHERE m.utilisateur_id = app.acteur()
     AND m.retire_le IS NULL
     AND u.desactive_le IS NULL
$$;
REVOKE ALL ON FUNCTION app.entreprises_de_lacteur() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.entreprises_de_lacteur() TO jokswed_app;

-- Les mariages atteignables : ceux où l'acteur a un dossier. PAS en SECURITY
-- DEFINER — elle lit `dossiers`, dont la politique n'est pas récursive, et
-- elle doit donc hériter de ce filtrage.
CREATE OR REPLACE FUNCTION app.mariages_de_lacteur() RETURNS SETOF uuid
  LANGUAGE sql STABLE AS $$
  SELECT DISTINCT d.mariage_id FROM dossiers d
   WHERE d.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
$$;
GRANT EXECUTE ON FUNCTION app.acteur() TO jokswed_app, jokswed_public;
GRANT EXECUTE ON FUNCTION app.mariages_de_lacteur() TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 3. PRIVILÈGES DE TABLE
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO jokswed_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jokswed_app;

-- Les suppressions ne sont accordées QUE là où elles ont un sens. Aucune sur
-- les tables qui portent une trace : membres, sessions, journal d'audit.
GRANT DELETE ON membres_roles, membres_permissions, roles_permissions,
                 partages_mariage, affectations, facteurs_mfa TO jokswed_app;

-- Le journal d'audit : on y ajoute, on n'y touche plus.
REVOKE UPDATE, DELETE ON journal_audit FROM jokswed_app;

-- -----------------------------------------------------------------------------
-- 4. ACTIVATION — ENABLE *ET* FORCE
-- -----------------------------------------------------------------------------
-- ⚠️ `membres` EST LA SEULE TABLE SANS `FORCE`, ET C'EST DÉLIBÉRÉ.
--
-- `app.entreprises_de_lacteur()` est SECURITY DEFINER : elle s'exécute avec
-- les droits du propriétaire. Avec FORCE, le propriétaire serait lui aussi
-- soumis aux politiques de `membres` — donc la fonction déclencherait la
-- politique qui l'appelle, et on retomberait sur la récursion qu'on voulait
-- éviter. `membres` reste donc en ENABLE seul.
--
-- Ce que cela coûte exactement : le PROPRIÉTAIRE peut lire `membres` sans
-- filtre. Le rôle applicatif, lui, y reste soumis — et c'est lui qui sert les
-- requêtes. Le propriétaire n'est utilisé que par les migrations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'utilisateurs','identifiants','facteurs_mfa','sessions','tentatives_connexion',
    'entreprises','regimes_tva','roles','roles_permissions','membres_roles',
    'membres_permissions','invitations','mariages','contacts','dossiers',
    'partages_mariage','affectations','journal_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  EXECUTE 'ALTER TABLE membres ENABLE ROW LEVEL SECURITY';  -- sans FORCE, cf. ci-dessus
END $$;

-- Tables de référence : lisibles par tous les rôles connectés, non modifiables.
GRANT SELECT ON permissions, taux_tva TO jokswed_app, jokswed_public;
REVOKE INSERT, UPDATE ON permissions, taux_tva FROM jokswed_app;

-- -----------------------------------------------------------------------------
-- 5. LES POLITIQUES
-- -----------------------------------------------------------------------------
-- ⚠️ `IN (SELECT unnest(...))` ET NON `= ANY (...)` DIRECT.
--
-- Deux raisons, l'une de correction et l'autre de performance :
--
--   · `= ANY ((SELECT f()))` fait lire la sous-requête comme un ENSEMBLE DE
--     LIGNES, et PostgreSQL compare alors un uuid à un uuid[] : « operator
--     does not exist: uuid = uuid[] ». La migration échoue à la création.
--   · `IN (SELECT unnest(f()))` est une sous-requête NON CORRÉLÉE : le
--     planificateur l'évalue UNE FOIS par requête (InitPlan) au lieu d'une
--     fois par ligne examinée. Appeler `app.entreprises_de_lacteur()`
--     directement dans la clause la ferait réévaluer à chaque ligne.

-- ── Identité : chacun chez soi ──────────────────────────────────────────────
CREATE POLICY utilisateur_soi ON utilisateurs FOR SELECT
  USING (id = app.acteur()
         OR id IN (SELECT m.utilisateur_id FROM membres m
                    WHERE m.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
                      AND m.retire_le IS NULL));
CREATE POLICY utilisateur_maj_soi ON utilisateurs FOR UPDATE
  USING (id = app.acteur()) WITH CHECK (id = app.acteur());

-- Les secrets, les sessions, le second facteur : le propriétaire, et personne
-- d'autre. Ni un administrateur délégué, ni le propriétaire de l'entreprise.
CREATE POLICY identifiant_proprietaire ON identifiants
  USING (utilisateur_id = app.acteur()) WITH CHECK (utilisateur_id = app.acteur());
CREATE POLICY mfa_proprietaire ON facteurs_mfa
  USING (utilisateur_id = app.acteur()) WITH CHECK (utilisateur_id = app.acteur());
CREATE POLICY session_proprietaire ON sessions
  USING (utilisateur_id = app.acteur()) WITH CHECK (utilisateur_id = app.acteur());

-- ── Entreprises et membres ──────────────────────────────────────────────────
CREATE POLICY entreprise_membre ON entreprises FOR SELECT
  USING (id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY entreprise_maj ON entreprises FOR UPDATE
  USING (id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY regime_tenant ON regimes_tva
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY membre_tenant ON membres
  USING (utilisateur_id = app.acteur()
         OR entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

-- Les rôles modèles (entreprise_id NULL) sont lisibles par tous : ils servent
-- à amorcer une nouvelle entreprise. Ils ne sont pas modifiables.
CREATE POLICY role_tenant ON roles FOR SELECT
  USING (entreprise_id IS NULL
         OR entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY role_ecriture ON roles FOR INSERT
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY role_maj ON roles FOR UPDATE
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY roles_perm_tenant ON roles_permissions
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
                        AND r.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))));

CREATE POLICY membres_roles_tenant ON membres_roles
  USING (EXISTS (SELECT 1 FROM membres m WHERE m.id = membre_id))
  WITH CHECK (EXISTS (SELECT 1 FROM membres m WHERE m.id = membre_id
                        AND m.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))));

CREATE POLICY membres_perm_tenant ON membres_permissions
  USING (EXISTS (SELECT 1 FROM membres m WHERE m.id = membre_id))
  WITH CHECK (EXISTS (SELECT 1 FROM membres m WHERE m.id = membre_id
                        AND m.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))));

CREATE POLICY invitation_tenant ON invitations
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

-- ── Dossiers : la racine du cloisonnement commercial ────────────────────────
CREATE POLICY dossier_tenant ON dossiers
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY affectation_tenant ON affectations
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

-- ── Mariage partagé : visible dès qu'on y a un dossier ──────────────────────
CREATE POLICY mariage_lecture ON mariages FOR SELECT
  USING (id IN (SELECT app.mariages_de_lacteur()));
CREATE POLICY mariage_ecriture ON mariages FOR INSERT WITH CHECK (true);
-- Seule l'entreprise PILOTE réécrit le mariage. Les autres passent par une
-- demande de modification (V7) — on ne réécrit pas unilatéralement la journée
-- d'un confrère.
CREATE POLICY mariage_maj ON mariages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM dossiers d
                  WHERE d.mariage_id = mariages.id AND d.pilote
                    AND d.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))))
  WITH CHECK (true);

-- Les COORDONNÉES clients sont une catégorie de partage distincte : avoir un
-- dossier sur le mariage ne suffit pas, il faut l'octroi explicite.
CREATE POLICY contact_lecture ON contacts FOR SELECT
  USING (EXISTS (SELECT 1 FROM partages_mariage pm
                  WHERE pm.mariage_id = contacts.mariage_id
                    AND pm.categorie = 'coordonnees_clients'
                    AND pm.retire_le IS NULL
                    AND pm.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))));
CREATE POLICY contact_ecriture ON contacts FOR INSERT WITH CHECK (true);

CREATE POLICY partage_lecture ON partages_mariage FOR SELECT
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
         OR mariage_id IN (SELECT app.mariages_de_lacteur()));
CREATE POLICY partage_ecriture ON partages_mariage FOR INSERT WITH CHECK (true);
CREATE POLICY partage_maj ON partages_mariage FOR UPDATE USING (true) WITH CHECK (true);

-- ── Journal d'audit : on écrit toujours, on lit cloisonné ───────────────────
-- L'insertion reste permise sans condition : sinon une action REFUSÉE ne
-- serait pas traçable, et c'est justement celle qu'on veut voir.
CREATE POLICY audit_ajout ON journal_audit FOR INSERT WITH CHECK (true);
CREATE POLICY audit_lecture ON journal_audit FOR SELECT
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

-- ── Connexion : avant l'authentification, il n'y a pas encore d'acteur ──────
-- Ces deux tables sont lues/écrites par le chemin de connexion, qui s'exécute
-- sans identité. Elles ne contiennent aucune donnée d'entreprise.
CREATE POLICY tentatives_ouvertes ON tentatives_connexion USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 6. INDEX DE POLITIQUE
-- -----------------------------------------------------------------------------
-- Sans eux, chaque politique déclenche un parcours complet de table.
CREATE INDEX IF NOT EXISTS dossiers_politique ON dossiers (entreprise_id);
CREATE INDEX IF NOT EXISTS affectations_politique ON affectations (entreprise_id);
CREATE INDEX IF NOT EXISTS regimes_politique ON regimes_tva (entreprise_id);
CREATE INDEX IF NOT EXISTS invitations_politique ON invitations (entreprise_id);
CREATE INDEX IF NOT EXISTS partages_politique ON partages_mariage (entreprise_id);
