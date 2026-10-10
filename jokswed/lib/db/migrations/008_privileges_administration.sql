-- =============================================================================
-- 008 — L'ÉLÉVATION DE PRIVILÈGES FERMÉE EN BASE
-- -----------------------------------------------------------------------------
-- ⚠️ CE QUI ÉTAIT OUVERT, ET POURQUOI RLS NE POUVAIT PAS LE FERMER.
--
-- Une politique répond à « quelles LIGNES ». Elle ne sait pas répondre à
-- « cet acteur a-t-il le droit de modifier SES PROPRES droits », qui dépend de
-- l'identité de la CIBLE. Résultat : `membres_permissions` étant une table de
-- son entreprise, un membre pouvait s'y accorder n'importe quelle permission
-- en SQL direct. Seul `interdireAutoModification()` s'y opposait — côté
-- serveur, donc hors de portée dès qu'on parle au rôle PostgreSQL.
--
-- ⚠️ ET UN SECOND VECTEUR, PLUS GRAVE, TROUVÉ EN AUDITANT LES EXCEPTIONS.
--
-- `app.auth_creer_session(utilisateur_id, …)` était accordée à `jokswed_app`.
-- Elle crée une session pour N'IMPORTE QUEL identifiant d'utilisateur : la
-- moindre exécution SQL arbitraire sous ce rôle permettait de se forger une
-- session de propriétaire, et tout le cloisonnement tombait d'un coup. Même
-- remarque pour `auth_identifiant`, qui rend l'empreinte de n'importe qui.
--
-- La parade : ces fonctions passent à un rôle DÉDIÉ, `jokswed_auth`, utilisé
-- par le seul chemin de connexion et par aucune requête métier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LE RÔLE D'AUTHENTIFICATION, SÉPARÉ DU RÔLE MÉTIER
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jokswed_auth') THEN
    CREATE ROLE jokswed_auth LOGIN PASSWORD 'dev_auth'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public, app TO jokswed_auth;
-- ⚠️ AUCUN PRIVILÈGE DE TABLE. Ce rôle ne peut RIEN lire directement : il ne
-- dispose que des sept fonctions ci-dessous, et de rien d'autre.

REVOKE EXECUTE ON FUNCTION app.auth_identifiant(citext) FROM jokswed_app;
REVOKE EXECUTE ON FUNCTION app.auth_creer_session(uuid, text, integer, text, text, text, boolean) FROM jokswed_app;
REVOKE EXECUTE ON FUNCTION app.auth_valider_mfa(uuid) FROM jokswed_app;
REVOKE EXECUTE ON FUNCTION app.auth_tentatives_recentes(text, integer) FROM jokswed_app;
REVOKE EXECUTE ON FUNCTION app.auth_journaliser_tentative(text, boolean) FROM jokswed_app;
-- `auth_session` et `auth_revoquer_session` restent accessibles au rôle métier :
-- elles exigent de connaître l'EMPREINTE d'un jeton valide, que seul le
-- porteur du cookie possède. Elles ne permettent pas de forger une session.

GRANT EXECUTE ON FUNCTION app.auth_identifiant(citext) TO jokswed_auth;
GRANT EXECUTE ON FUNCTION app.auth_session(text) TO jokswed_auth;
GRANT EXECUTE ON FUNCTION app.auth_creer_session(uuid, text, integer, text, text, text, boolean) TO jokswed_auth;
GRANT EXECUTE ON FUNCTION app.auth_valider_mfa(uuid) TO jokswed_auth;
GRANT EXECUTE ON FUNCTION app.auth_revoquer_session(text) TO jokswed_auth;
GRANT EXECUTE ON FUNCTION app.auth_tentatives_recentes(text, integer) TO jokswed_auth;
GRANT EXECUTE ON FUNCTION app.auth_journaliser_tentative(text, boolean) TO jokswed_auth;

-- -----------------------------------------------------------------------------
-- 2. LES TABLES DE DROITS DEVIENNENT INACCESSIBLES EN ÉCRITURE
-- -----------------------------------------------------------------------------
-- La lecture reste permise (l'administration doit afficher les rôles) ; toute
-- écriture passe désormais par les fonctions du §3, qui vérifient d'abord.
REVOKE INSERT, UPDATE, DELETE ON
  membres, membres_roles, membres_permissions,
  roles, roles_permissions, affectations, invitations
FROM jokswed_app;
REVOKE UPDATE ON entreprises FROM jokswed_app;

-- -----------------------------------------------------------------------------
-- 3. LES OPÉRATIONS D'ADMINISTRATION, SOUS CONDITIONS VÉRIFIÉES EN BASE
-- -----------------------------------------------------------------------------
-- ⚠️ CES FONCTIONS NE PEUVENT PAS S'APPUYER SUR RLS.
--
-- Elles s'exécutent en `SECURITY DEFINER`, donc avec les droits du
-- propriétaire, qui contourne les politiques des tables en `ENABLE` seul.
-- Calculer les permissions via `app.permissions_effectives()` y donnerait un
-- résultat FAUX — la fonction verrait toutes les adhésions, pas celles de
-- l'acteur. Chaque vérification filtre donc explicitement sur `app.acteur()`.

/* Permissions d'un acteur DONNÉ, sans dépendre d'une politique. */
CREATE OR REPLACE FUNCTION app.permissions_de(p_acteur uuid, p_entreprise uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH mon_membre AS (
    SELECT m.id FROM membres m
     WHERE m.utilisateur_id = p_acteur
       AND m.entreprise_id = p_entreprise
       AND m.retire_le IS NULL
  ),
  accordees AS (
    SELECT rp.permission_cle FROM mon_membre mm
      JOIN membres_roles mr ON mr.membre_id = mm.id
      JOIN roles_permissions rp ON rp.role_id = mr.role_id
    UNION
    SELECT mp.permission_cle FROM mon_membre mm
      JOIN membres_permissions mp ON mp.membre_id = mm.id AND mp.accorde
  )
  SELECT coalesce(array_agg(permission_cle), '{}')
    FROM accordees
   WHERE permission_cle NOT IN (
     SELECT mp.permission_cle FROM mon_membre mm
       JOIN membres_permissions mp ON mp.membre_id = mm.id AND NOT mp.accorde
   )
$$;

/* Garde commune : acteur actif, membre de l'entreprise, permission présente,
   et — quand une cible est désignée — interdiction de se viser soi-même. */
CREATE OR REPLACE FUNCTION app.exiger(
  p_entreprise uuid, p_permission text, p_cible_utilisateur uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE acteur uuid := app.acteur();
BEGIN
  IF acteur IS NULL THEN
    RAISE EXCEPTION 'aucune identité posée' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                  WHERE u.id = acteur AND u.desactive_le IS NULL) THEN
    RAISE EXCEPTION 'compte désactivé' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM membres m
                  WHERE m.utilisateur_id = acteur AND m.entreprise_id = p_entreprise
                    AND m.retire_le IS NULL) THEN
    RAISE EXCEPTION 'non membre de cette entreprise' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (p_permission = ANY (app.permissions_de(acteur, p_entreprise))) THEN
    RAISE EXCEPTION 'permission manquante : %', p_permission
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- ⚠️ LA RÈGLE QUE RLS NE SAIT PAS PORTER.
  -- Sans elle, « gérer les rôles » devient « s'accorder tous les droits ».
  IF p_cible_utilisateur IS NOT NULL AND p_cible_utilisateur = acteur THEN
    RAISE EXCEPTION 'on ne modifie pas ses propres droits'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN acteur;
END $$;

/* ─── Permissions individuelles ─── */
CREATE OR REPLACE FUNCTION app.admin_definir_permission(
  p_membre_id uuid, p_permission text, p_accorde boolean, p_motif text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cible RECORD; acteur uuid;
BEGIN
  SELECT m.entreprise_id, m.utilisateur_id INTO cible
    FROM membres m WHERE m.id = p_membre_id AND m.retire_le IS NULL;
  IF cible IS NULL THEN
    RAISE EXCEPTION 'membre introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  acteur := app.exiger(cible.entreprise_id, 'role.gerer', cible.utilisateur_id);

  INSERT INTO membres_permissions (membre_id, permission_cle, accorde, motif)
  VALUES (p_membre_id, p_permission, p_accorde, p_motif)
  ON CONFLICT (membre_id, permission_cle)
    DO UPDATE SET accorde = EXCLUDED.accorde, motif = EXCLUDED.motif;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (acteur, cible.entreprise_id, 'permission.definie', 'membre',
          p_membre_id::text, jsonb_build_object('permission', p_permission,
                                                'accorde', p_accorde));
END $$;

/* ─── Rôles d'un membre ─── */
CREATE OR REPLACE FUNCTION app.admin_definir_roles(p_membre_id uuid, p_roles uuid[])
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cible RECORD; acteur uuid;
BEGIN
  SELECT m.entreprise_id, m.utilisateur_id INTO cible
    FROM membres m WHERE m.id = p_membre_id AND m.retire_le IS NULL;
  IF cible IS NULL THEN
    RAISE EXCEPTION 'membre introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  acteur := app.exiger(cible.entreprise_id, 'role.gerer', cible.utilisateur_id);

  -- Un rôle d'une AUTRE entreprise n'est pas attribuable ici.
  IF EXISTS (SELECT 1 FROM unnest(p_roles) r(id)
              LEFT JOIN roles ro ON ro.id = r.id
             WHERE ro.id IS NULL OR ro.entreprise_id IS DISTINCT FROM cible.entreprise_id) THEN
    RAISE EXCEPTION 'rôle hors de cette entreprise' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM membres_roles WHERE membre_id = p_membre_id;
  INSERT INTO membres_roles (membre_id, role_id) SELECT p_membre_id, id FROM unnest(p_roles) AS t(id);

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id, apres)
  VALUES (acteur, cible.entreprise_id, 'roles.definis', 'membre', p_membre_id::text,
          jsonb_build_object('roles', p_roles));
END $$;

/* ─── Révocation d'un membre ─── */
CREATE OR REPLACE FUNCTION app.admin_revoquer_membre(p_membre_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cible RECORD; acteur uuid;
BEGIN
  SELECT m.entreprise_id, m.utilisateur_id INTO cible
    FROM membres m WHERE m.id = p_membre_id AND m.retire_le IS NULL;
  IF cible IS NULL THEN RETURN; END IF;
  acteur := app.exiger(cible.entreprise_id, 'membre.revoquer', cible.utilisateur_id);

  UPDATE membres SET retire_le = now(), retire_par = acteur WHERE id = p_membre_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (acteur, cible.entreprise_id, 'membre.revoque', 'utilisateur',
          cible.utilisateur_id::text);
END $$;

/* ─── Invitations ─── */
CREATE OR REPLACE FUNCTION app.admin_creer_invitation(
  p_entreprise_id uuid, p_email citext, p_prenom text, p_nom text,
  p_jeton_hache text, p_roles uuid[], p_jours integer)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE acteur uuid; nouvelle uuid;
BEGIN
  acteur := app.exiger(p_entreprise_id, 'membre.inviter');
  IF EXISTS (SELECT 1 FROM unnest(p_roles) r(id)
              LEFT JOIN roles ro ON ro.id = r.id
             WHERE ro.id IS NULL OR ro.entreprise_id IS DISTINCT FROM p_entreprise_id) THEN
    RAISE EXCEPTION 'rôle hors de cette entreprise' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO invitations (entreprise_id, email, prenom, nom, jeton_hache, roles,
                           cree_par, expire_le)
  VALUES (p_entreprise_id, p_email, p_prenom, p_nom, p_jeton_hache, p_roles,
          acteur, now() + make_interval(days => p_jours))
  ON CONFLICT (entreprise_id, email) WHERE utilisee_le IS NULL AND revoquee_le IS NULL
    DO NOTHING
  RETURNING id INTO nouvelle;

  IF nouvelle IS NOT NULL THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id, apres)
    VALUES (acteur, p_entreprise_id, 'invitation.preparee', 'invitation', nouvelle::text,
            jsonb_build_object('email', p_email));
  END IF;
  RETURN nouvelle;
END $$;

/* ─── Affectations à un dossier ─── */
CREATE OR REPLACE FUNCTION app.admin_affecter(
  p_dossier_id uuid, p_utilisateur_id uuid, p_mission text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ent uuid; acteur uuid; nouvelle uuid;
BEGIN
  SELECT d.entreprise_id INTO ent FROM dossiers d WHERE d.id = p_dossier_id;
  IF ent IS NULL THEN
    RAISE EXCEPTION 'dossier introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  /* Pas de garde « soi-même » ici : s'affecter à un dossier de SON entreprise
     n'élève aucun droit — l'affectation ne confère pas de permission. */
  acteur := app.exiger(ent, 'dossier.affecter');

  INSERT INTO affectations (dossier_id, entreprise_id, utilisateur_id, mission)
  VALUES (p_dossier_id, ent, p_utilisateur_id, p_mission) RETURNING id INTO nouvelle;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id, apres)
  VALUES (acteur, ent, 'affectation.creee', 'dossier', p_dossier_id::text,
          jsonb_build_object('utilisateur', p_utilisateur_id, 'mission', p_mission));
  RETURN nouvelle;
END $$;

/* ─── Réglages d'entreprise ─── */
CREATE OR REPLACE FUNCTION app.admin_maj_entreprise(p_entreprise_id uuid, p_champs jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE acteur uuid;
BEGIN
  acteur := app.exiger(p_entreprise_id, 'entreprise.reglages');
  UPDATE entreprises SET
    nom_commercial = coalesce(p_champs->>'nom_commercial', nom_commercial),
    raison_sociale = coalesce(p_champs->>'raison_sociale', raison_sociale),
    siret          = coalesce(p_champs->>'siret', siret),
    code_ape       = coalesce(p_champs->>'code_ape', code_ape),
    adresse_ligne1 = coalesce(p_champs->>'adresse_ligne1', adresse_ligne1),
    code_postal    = coalesce(p_champs->>'code_postal', code_postal),
    ville          = coalesce(p_champs->>'ville', ville),
    email          = coalesce((p_champs->>'email')::citext, email),
    telephone      = coalesce(p_champs->>'telephone', telephone),
    mediateur_nom  = coalesce(p_champs->>'mediateur_nom', mediateur_nom),
    mediateur_url  = coalesce(p_champs->>'mediateur_url', mediateur_url)
  WHERE id = p_entreprise_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id, apres)
  VALUES (acteur, p_entreprise_id, 'entreprise.modifiee', 'entreprise',
          p_entreprise_id::text, p_champs);
END $$;

-- -----------------------------------------------------------------------------
-- 4. PRIVILÈGES SUR CES FONCTIONS
-- -----------------------------------------------------------------------------
-- `permissions_de` et `exiger` sont INTERNES : les exposer permettrait de les
-- appeler avec un acteur arbitraire.
REVOKE ALL ON FUNCTION app.permissions_de(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.exiger(uuid, text, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.admin_definir_permission(uuid, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_definir_roles(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_revoquer_membre(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_affecter(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_maj_entreprise(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.admin_definir_permission(uuid, text, boolean, text) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.admin_definir_roles(uuid, uuid[]) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.admin_revoquer_membre(uuid) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.admin_affecter(uuid, uuid, text) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.admin_maj_entreprise(uuid, jsonb) TO jokswed_app;

-- `permissions_effectives` s'appuie désormais sur `permissions_de`, pour ne
-- plus dépendre d'une politique dont la portée change selon l'appelant.
CREATE OR REPLACE FUNCTION app.permissions_effectives(p_entreprise_id uuid)
RETURNS TABLE (permission_cle text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT unnest(app.permissions_de(app.acteur(), p_entreprise_id))
$$;
