-- =============================================================================
-- 007 — LE CHEMIN D'AUTHENTIFICATION
-- -----------------------------------------------------------------------------
-- ⚠️ LE PROBLÈME QUE CE PALIER RÉSOUT.
--
-- Le palier 006 a mis `ENABLE` + `FORCE ROW LEVEL SECURITY` sur `utilisateurs`,
-- `identifiants`, `sessions` et `facteurs_mfa`. Or l'authentification doit
-- lire ces tables AVANT de savoir qui est l'acteur : au moment de vérifier un
-- mot de passe, `app.acteur()` vaut NULL et toute politique est fausse. La
-- connexion devenait donc impossible.
--
-- C'est le bon comportement par défaut — refus total plutôt qu'accès total —
-- mais il faut une porte, étroite et nommée.
--
-- ⚠️ `FORCE` EST RETIRÉ SUR CES QUATRE TABLES. VOICI CE QUE ÇA COÛTE.
--
-- `FORCE` applique les politiques même au PROPRIÉTAIRE. Sans lui, le
-- propriétaire les contourne — et c'est exactement ce dont les fonctions
-- ci-dessous ont besoin, puisqu'elles s'exécutent en `SECURITY DEFINER`.
--
-- Le coût réel est limité et mesurable : le propriétaire n'est utilisé QUE
-- par les migrations ; le rôle applicatif, lui, reste soumis aux politiques
-- et ne peut toujours lire que ses propres lignes. Ce qui s'ouvre, ce sont
-- les SIX fonctions ci-dessous, chacune à signature étroite, et le banc de
-- sécurité vérifie qu'il n'en apparaît pas une septième.
-- =============================================================================

ALTER TABLE utilisateurs  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identifiants  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE facteurs_mfa  NO FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 1. VÉRIFICATION D'UN MOT DE PASSE
-- -----------------------------------------------------------------------------
-- Rend l'empreinte, jamais un secret en clair. C'est la capacité
-- d'authentification elle-même : toute application qui vérifie un mot de passe
-- doit pouvoir lire l'empreinte correspondante. Elle est ici nommée et bornée
-- plutôt que diffuse.
CREATE OR REPLACE FUNCTION app.auth_identifiant(p_email citext)
RETURNS TABLE (utilisateur_id uuid, secret_hache text, desactive boolean, mfa_requise boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id,
         i.secret_hache,
         (u.desactive_le IS NOT NULL),
         EXISTS (SELECT 1 FROM facteurs_mfa f
                  WHERE f.utilisateur_id = u.id AND f.confirme_le IS NOT NULL)
    FROM utilisateurs u
    JOIN identifiants i ON i.utilisateur_id = u.id AND i.type = 'mot_de_passe'
   WHERE u.email = p_email
$$;

-- -----------------------------------------------------------------------------
-- 2. SESSIONS
-- -----------------------------------------------------------------------------
-- Résolue par l'EMPREINTE du jeton. Le jeton en clair ne quitte jamais le
-- cookie, et n'est jamais écrit en base.
CREATE OR REPLACE FUNCTION app.auth_session(p_jeton_hache text)
RETURNS TABLE (session_id uuid, utilisateur_id uuid, mfa_validee boolean, expire_le timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions s
     SET dernier_acces_le = now()
   WHERE s.jeton_hache = p_jeton_hache
     AND s.revoquee_le IS NULL
     AND s.expire_le > now()
     -- Un compte désactivé perd ses sessions À LA REQUÊTE SUIVANTE, sans
     -- attendre leur expiration. C'est ce qui rend la révocation immédiate.
     AND EXISTS (SELECT 1 FROM utilisateurs u
                  WHERE u.id = s.utilisateur_id AND u.desactive_le IS NULL)
  RETURNING s.id, s.utilisateur_id, s.mfa_validee, s.expire_le
$$;

CREATE OR REPLACE FUNCTION app.auth_creer_session(
  p_utilisateur_id uuid, p_jeton_hache text, p_jours integer,
  p_appareil text, p_user_agent text, p_ip text, p_mfa_validee boolean)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, appareil,
                        user_agent, ip_tronquee, mfa_validee)
  VALUES (p_utilisateur_id, p_jeton_hache, now() + make_interval(days => p_jours),
          p_appareil, p_user_agent, p_ip, p_mfa_validee)
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION app.auth_valider_mfa(p_session_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET mfa_validee = true WHERE id = p_session_id
$$;

CREATE OR REPLACE FUNCTION app.auth_revoquer_session(p_jeton_hache text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET revoquee_le = now()
   WHERE jeton_hache = p_jeton_hache AND revoquee_le IS NULL
$$;

-- -----------------------------------------------------------------------------
-- 3. LIMITATION DE DÉBIT DES CONNEXIONS — EN BASE, PAS EN MÉMOIRE
-- -----------------------------------------------------------------------------
-- Contrairement au garde-fou de la V1, celle-ci est partagée par toutes les
-- instances : un attaquant réparti sur plusieurs fonctions serverless est
-- compté une seule fois.
CREATE OR REPLACE FUNCTION app.auth_tentatives_recentes(p_cle text, p_minutes integer)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH purge AS (
    DELETE FROM tentatives_connexion
     WHERE horodatage < now() - interval '1 day' RETURNING 1
  )
  SELECT count(*)::integer FROM tentatives_connexion
   WHERE cle = p_cle AND NOT reussie
     AND horodatage > now() - make_interval(mins => p_minutes)
$$;

CREATE OR REPLACE FUNCTION app.auth_journaliser_tentative(p_cle text, p_reussie boolean)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO tentatives_connexion (cle, reussie) VALUES (p_cle, p_reussie)
$$;

-- -----------------------------------------------------------------------------
-- 4. PRIVILÈGES : ces fonctions, et rien d'autre
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.auth_identifiant(citext) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_creer_session(uuid, text, integer, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_valider_mfa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_revoquer_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_tentatives_recentes(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_journaliser_tentative(text, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.auth_identifiant(citext) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.auth_session(text) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.auth_creer_session(uuid, text, integer, text, text, text, boolean) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.auth_valider_mfa(uuid) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.auth_revoquer_session(text) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.auth_tentatives_recentes(text, integer) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.auth_journaliser_tentative(text, boolean) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 5. PERMISSIONS EFFECTIVES
-- -----------------------------------------------------------------------------
-- rôles ∪ accords individuels − refus individuels. UN REFUS L'EMPORTE.
-- Non `SECURITY DEFINER` : elle lit `membres` et `roles` à travers les
-- politiques de l'acteur, et c'est voulu.
CREATE OR REPLACE FUNCTION app.permissions_effectives(p_entreprise_id uuid)
RETURNS TABLE (permission_cle text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH mon_membre AS (
    SELECT m.id FROM membres m
     WHERE m.utilisateur_id = app.acteur()
       AND m.entreprise_id = p_entreprise_id
       AND m.retire_le IS NULL
  ),
  par_role AS (
    SELECT rp.permission_cle FROM mon_membre mm
      JOIN membres_roles mr ON mr.membre_id = mm.id
      JOIN roles_permissions rp ON rp.role_id = mr.role_id
  ),
  accordees AS (
    SELECT mp.permission_cle FROM mon_membre mm
      JOIN membres_permissions mp ON mp.membre_id = mm.id AND mp.accorde
  ),
  refusees AS (
    SELECT mp.permission_cle FROM mon_membre mm
      JOIN membres_permissions mp ON mp.membre_id = mm.id AND NOT mp.accorde
  )
  SELECT p FROM (
    SELECT permission_cle AS p FROM par_role
    UNION SELECT permission_cle FROM accordees
  ) t
  WHERE p NOT IN (SELECT permission_cle FROM refusees)
$$;
GRANT EXECUTE ON FUNCTION app.permissions_effectives(uuid) TO jokswed_app;
