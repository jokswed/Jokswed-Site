-- =============================================================================
-- 047 — COMPTE PROPRIÉTAIRE : AMORÇAGE, MOT DE PASSE, MFA, SESSIONS
-- -----------------------------------------------------------------------------
-- ⚠️ IL MANQUAIT TOUT LE CHEMIN DE GESTION DE SON PROPRE COMPTE.
--
-- Pire : la connexion redirigeait vers `/admin/second-facteur` quand un
-- facteur TOTP existait, et cette page n'existait pas. Activer le MFA aurait
-- donc enfermé son propriétaire dehors. On ajoute ici les fonctions ; les
-- pages suivent.
--
-- ⚠️ L'AMORÇAGE EST À USAGE UNIQUE, ET IL SE REFERME TOUT SEUL.
-- Créer le premier propriétaire exige un chemin qui ne demande aucune
-- session — sinon l'œuf et la poule. Ce chemin est donc verrouillé trois
-- fois : il faut un secret d'environnement, il faut qu'AUCUN utilisateur
-- n'existe encore, et il s'inscrit au journal. Dès le premier compte créé,
-- la fonction refuse, même avec le bon secret.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.auth_amorcage_possible()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM utilisateurs)
$$;
REVOKE ALL ON FUNCTION app.auth_amorcage_possible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_amorcage_possible() TO jokswed_auth;

CREATE OR REPLACE FUNCTION app.auth_amorcer_proprietaire(
  p_email citext, p_prenom text, p_nom text, p_secret_hache text,
  p_entreprise_slug text, p_entreprise_nom text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_u uuid; v_e uuid; v_m uuid; v_r uuid;
BEGIN
  -- ⚠️ LA CONDITION EST « AUCUN UTILISATEUR », PAS « AUCUN PROPRIÉTAIRE ».
  -- Une base qui a déjà le moindre compte n'est plus en amorçage : laisser
  -- la porte ouverte permettrait de s'ajouter en propriétaire d'une
  -- plateforme en service.
  IF EXISTS (SELECT 1 FROM utilisateurs) THEN
    RAISE EXCEPTION 'amorçage impossible : des comptes existent déjà'
      USING ERRCODE = 'restrict_violation';
  END IF;

  INSERT INTO utilisateurs (email, prenom, nom, email_verifie_le)
  VALUES (p_email, p_prenom, p_nom, now()) RETURNING id INTO v_u;
  INSERT INTO identifiants (utilisateur_id, type, secret_hache)
  VALUES (v_u, 'mot_de_passe', p_secret_hache);

  INSERT INTO entreprises (slug, nom_commercial, email)
  VALUES (p_entreprise_slug, p_entreprise_nom, p_email)
  ON CONFLICT (slug) DO UPDATE SET maj_le = now()
  RETURNING id INTO v_e;

  INSERT INTO roles (entreprise_id, cle, libelle, description, systeme)
  SELECT v_e, cle, libelle, description, true FROM roles WHERE entreprise_id IS NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO roles_permissions (role_id, permission_cle)
  SELECT r2.id, rp.permission_cle
    FROM roles r1
    JOIN roles_permissions rp ON rp.role_id = r1.id
    JOIN roles r2 ON r2.cle = r1.cle AND r2.entreprise_id = v_e
   WHERE r1.entreprise_id IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO membres (entreprise_id, utilisateur_id) VALUES (v_e, v_u)
  RETURNING id INTO v_m;
  SELECT id INTO v_r FROM roles WHERE entreprise_id = v_e AND cle = 'proprietaire';
  INSERT INTO membres_roles (membre_id, role_id) VALUES (v_m, v_r);

  INSERT INTO journal_audit (acteur_id, acteur_type, entreprise_id, action,
                             ressource_type, ressource_id, apres)
  VALUES (v_u, 'systeme', v_e, 'amorcage.proprietaire', 'utilisateur', v_u::text,
          jsonb_build_object('email', p_email, 'entreprise', p_entreprise_slug));
  RETURN v_u;
END $$;
REVOKE ALL ON FUNCTION app.auth_amorcer_proprietaire(citext, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_amorcer_proprietaire(citext, text, text, text, text, text) TO jokswed_auth;

-- --- Changer son mot de passe ------------------------------------------------
-- ⚠️ L'ANCIEN MOT DE PASSE EST VÉRIFIÉ PAR L'APPLICATION, PAS ICI.
-- La comparaison scrypt se fait en JavaScript ; cette fonction ne pose la
-- nouvelle empreinte qu'après. Elle exige donc une session valide — et c'est
-- `app.acteur()` qui la prouve, pas un identifiant passé en paramètre.
CREATE OR REPLACE FUNCTION app.changer_mot_de_passe(p_secret_hache text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN
    RAISE EXCEPTION 'aucune identité' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO identifiants (utilisateur_id, type, secret_hache)
  VALUES (v_acteur, 'mot_de_passe', p_secret_hache)
  ON CONFLICT (utilisateur_id) WHERE type = 'mot_de_passe'
    DO UPDATE SET secret_hache = EXCLUDED.secret_hache, dernier_usage_le = NULL;

  INSERT INTO journal_audit (acteur_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, 'mot_de_passe.change', 'utilisateur', v_acteur::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.changer_mot_de_passe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.changer_mot_de_passe(text) TO jokswed_app;

-- --- Second facteur -----------------------------------------------------------
CREATE OR REPLACE FUNCTION app.mfa_preparer(p_secret_chiffre bytea, p_libelle text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_id uuid;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN
    RAISE EXCEPTION 'aucune identité' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Un facteur non confirmé en attente est remplacé : on ne laisse pas
  -- traîner des graines orphelines.
  DELETE FROM facteurs_mfa WHERE utilisateur_id = v_acteur AND confirme_le IS NULL;
  INSERT INTO facteurs_mfa (utilisateur_id, type, secret_chiffre, libelle)
  VALUES (v_acteur, 'totp', p_secret_chiffre, p_libelle) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.mfa_preparer(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mfa_preparer(bytea, text) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.mfa_en_attente()
RETURNS TABLE (id uuid, secret_chiffre bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.secret_chiffre FROM facteurs_mfa f
   WHERE f.utilisateur_id = app.acteur() AND f.confirme_le IS NULL
   ORDER BY f.cree_le DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.mfa_en_attente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mfa_en_attente() TO jokswed_app;

/* ⚠️ CONFIRMER LE FACTEUR VALIDE AUSSI LA SESSION COURANTE.
   Sans cela, activer le MFA déconnecterait immédiatement celui qui vient de
   l'activer : sa session n'a pas franchi de second facteur, et la requête
   suivante la renverrait à l'étape TOTP — avec un facteur qu'il vient tout
   juste de confirmer. */
CREATE OR REPLACE FUNCTION app.mfa_confirmer(p_facteur uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN RETURN false; END IF;
  UPDATE facteurs_mfa SET confirme_le = now()
   WHERE id = p_facteur AND utilisateur_id = v_acteur AND confirme_le IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE sessions SET mfa_validee = true
   WHERE jeton_hache = current_setting('app.session_jeton', true);
  INSERT INTO journal_audit (acteur_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, 'mfa.active', 'utilisateur', v_acteur::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.mfa_confirmer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mfa_confirmer(uuid) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.mfa_retirer()
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN RETURN false; END IF;
  DELETE FROM facteurs_mfa WHERE utilisateur_id = v_acteur;
  INSERT INTO journal_audit (acteur_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, 'mfa.retire', 'utilisateur', v_acteur::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.mfa_retirer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mfa_retirer() TO jokswed_app;

/* Le secret chiffré du facteur CONFIRMÉ, pour vérifier un code à l'étape du
   second facteur. Appelée par `jokswed_auth` : à ce moment, la session
   existe mais n'a franchi aucun second facteur, donc `app.acteur()` rend
   NULL et aucune politique ne rendrait quoi que ce soit. */
CREATE OR REPLACE FUNCTION app.auth_mfa_de_session(p_jeton_hache text)
RETURNS TABLE (session_id uuid, utilisateur_id uuid, secret_chiffre bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.utilisateur_id, f.secret_chiffre
    FROM sessions s
    JOIN facteurs_mfa f ON f.utilisateur_id = s.utilisateur_id
                       AND f.confirme_le IS NOT NULL
    JOIN utilisateurs u ON u.id = s.utilisateur_id
   WHERE s.jeton_hache = p_jeton_hache
     AND s.revoquee_le IS NULL AND s.expire_le > now()
     AND u.desactive_le IS NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.auth_mfa_de_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_mfa_de_session(text) TO jokswed_auth;

-- --- Sessions et connexions récentes ------------------------------------------
CREATE OR REPLACE FUNCTION app.mes_sessions()
RETURNS TABLE (id uuid, user_agent text, ip_tronquee text, mfa_validee boolean,
               cree_le timestamptz, dernier_acces_le timestamptz,
               expire_le timestamptz, courante boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.user_agent, s.ip_tronquee, s.mfa_validee, s.cree_le,
         s.dernier_acces_le, s.expire_le,
         s.jeton_hache = current_setting('app.session_jeton', true)
    FROM sessions s
   WHERE s.utilisateur_id = app.acteur()
     AND s.revoquee_le IS NULL AND s.expire_le > now()
   ORDER BY s.dernier_acces_le DESC
$$;
REVOKE ALL ON FUNCTION app.mes_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mes_sessions() TO jokswed_app;

/* ⚠️ ON NE RÉVOQUE QUE LES SIENNES, ET JAMAIS CELLE EN COURS PAR MÉGARDE.
   « Déconnecter partout » garde la session courante : se déconnecter soi-même
   au milieu d'un réglage de sécurité est le meilleur moyen de ne pas finir
   ce qu'on avait commencé. Le bouton « Se déconnecter » reste à part. */
CREATE OR REPLACE FUNCTION app.revoquer_mes_sessions(p_sauf_courante boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_n integer;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN RETURN 0; END IF;
  WITH coupe AS (
    UPDATE sessions SET revoquee_le = now(), revoquee_par = v_acteur
     WHERE utilisateur_id = v_acteur AND revoquee_le IS NULL
       AND (NOT p_sauf_courante
            OR jeton_hache IS DISTINCT FROM current_setting('app.session_jeton', true))
    RETURNING 1)
  SELECT count(*)::integer INTO v_n FROM coupe;
  INSERT INTO journal_audit (acteur_id, action, ressource_type, ressource_id, apres)
  VALUES (v_acteur, 'sessions.revoquees', 'utilisateur', v_acteur::text,
          jsonb_build_object('nombre', v_n));
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION app.revoquer_mes_sessions(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.revoquer_mes_sessions(boolean) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.mes_connexions(p_limite integer DEFAULT 20)
RETURNS TABLE (action text, horodatage timestamptz, ip_tronquee text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT j.action, j.horodatage, j.ip_tronquee
    FROM journal_audit j
   WHERE j.acteur_id = app.acteur()
     AND j.action IN ('session.ouverte','mot_de_passe.change','mfa.active',
                      'mfa.retire','sessions.revoquees')
   ORDER BY j.horodatage DESC
   LIMIT greatest(1, least(coalesce(p_limite, 20), 100))
$$;
REVOKE ALL ON FUNCTION app.mes_connexions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mes_connexions(integer) TO jokswed_app;
