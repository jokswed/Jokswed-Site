-- =============================================================================
-- 025 — COLLABORATEURS : SUSPENSION, INVITATION ENVOYÉE, ACTIVATION
-- -----------------------------------------------------------------------------
-- Jusqu'ici une invitation se CRÉAIT mais ne partait jamais, et il n'existait
-- qu'un geste définitif : la révocation. Un collaborateur saisonnier se
-- suspend entre deux saisons ; le révoquer puis le réinviter ferait perdre
-- son historique d'affectations.
-- =============================================================================

-- --- 1. Suspension : un état réversible, distinct de la révocation ----------
ALTER TABLE membres
  ADD COLUMN suspendu_le   timestamptz,
  ADD COLUMN suspendu_par  uuid REFERENCES utilisateurs(id),
  ADD COLUMN motif_suspension text;

-- ⚠️ LA SUSPENSION DOIT COUPER L'ACCÈS IMMÉDIATEMENT, SANS DÉCONNEXION.
-- `entreprises_de_lacteur()` est la racine de toutes les politiques RLS : un
-- membre suspendu n'y figure plus, donc ses sessions ouvertes ne voient plus
-- rien dès la requête suivante. C'est le même mécanisme que la révocation.
CREATE OR REPLACE FUNCTION app.entreprises_de_lacteur() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
  -- ⚠️ PAS DE JOINTURE SUR `entreprises` : sa politique appelle cette
  -- fonction, et la récursion est infinie dès que le rôle qui l'exécute
  -- n'est pas superutilisateur — c'est-à-dire partout sauf en local. Les
  -- entreprises archivées sont écartées par les données (palier 050).
  SELECT coalesce(array_agg(m.entreprise_id), '{}'::uuid[])
    FROM membres m
    JOIN utilisateurs u ON u.id = m.utilisateur_id
   WHERE m.utilisateur_id = app.acteur()
     AND m.retire_le IS NULL
     AND m.suspendu_le IS NULL
     AND u.desactive_le IS NULL
$$;
REVOKE ALL ON FUNCTION app.entreprises_de_lacteur() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.entreprises_de_lacteur() TO jokswed_app;

-- …et la même chose côté verbes : un suspendu n'a plus aucune permission.
CREATE OR REPLACE FUNCTION app.permissions_de(p_acteur uuid, p_entreprise uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH mon_membre AS (
    SELECT m.id FROM membres m
     WHERE m.utilisateur_id = p_acteur
       AND m.entreprise_id = p_entreprise
       AND m.retire_le IS NULL
       AND m.suspendu_le IS NULL
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
REVOKE ALL ON FUNCTION app.permissions_de(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.admin_suspendre_membre(
  p_membre_id uuid, p_suspendre boolean, p_motif text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_m RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_m FROM membres WHERE id = p_membre_id;
  IF v_m IS NULL OR v_m.retire_le IS NOT NULL THEN RETURN false; END IF;
  -- `app.exiger(..., cible)` refuse déjà qu'on s'applique la mesure à
  -- soi-même : suspendre son propre compte n'a aucun sens, et débloquer le
  -- sien en aurait trop.
  v_acteur := app.exiger(v_m.entreprise_id, 'membre.revoquer', v_m.utilisateur_id);

  UPDATE membres
     SET suspendu_le = CASE WHEN p_suspendre THEN now() ELSE NULL END,
         suspendu_par = CASE WHEN p_suspendre THEN v_acteur ELSE NULL END,
         motif_suspension = CASE WHEN p_suspendre THEN p_motif ELSE NULL END
   WHERE id = p_membre_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_m.entreprise_id,
          CASE WHEN p_suspendre THEN 'membre.suspendu' ELSE 'membre.reactive' END,
          'membre', p_membre_id::text,
          jsonb_build_object('motif', p_motif));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.admin_suspendre_membre(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_suspendre_membre(uuid, boolean, text) TO jokswed_app;

-- --- 2. Envoyer une invitation ----------------------------------------------
-- ⚠️ LA FONCTION N'ENVOIE RIEN ELLE-MÊME.
-- Elle marque l'invitation « à envoyer » et dépose un ÉVÉNEMENT. L'e-mail
-- part depuis le drain, hors de la transaction : une panne du fournisseur ne
-- peut donc pas annuler l'invitation, et une transaction annulée ne peut pas
-- laisser partir un e-mail.
CREATE OR REPLACE FUNCTION app.admin_envoyer_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_i RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_i FROM invitations WHERE id = p_invitation_id;
  IF v_i IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_i.entreprise_id, 'membre.inviter');

  IF v_i.utilisee_le IS NOT NULL THEN
    RAISE EXCEPTION 'invitation déjà utilisée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_i.revoquee_le IS NOT NULL THEN
    RAISE EXCEPTION 'invitation révoquée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_i.expire_le <= now() THEN
    RAISE EXCEPTION 'invitation expirée' USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE invitations SET envoyee_le = now() WHERE id = p_invitation_id;

  INSERT INTO evenements (type, charge_utile, cle_idempotence)
  VALUES ('invitation.envoyer',
          jsonb_build_object('invitation_id', p_invitation_id,
                             'entreprise_id', v_i.entreprise_id),
          'invitation.envoyer:' || p_invitation_id::text || ':'
            || extract(epoch FROM now())::bigint::text)
  ON CONFLICT (cle_idempotence) DO NOTHING;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, v_i.entreprise_id, 'invitation.envoyee', 'invitation',
          p_invitation_id::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.admin_envoyer_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_envoyer_invitation(uuid) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.admin_revoquer_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_i RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_i FROM invitations WHERE id = p_invitation_id;
  IF v_i IS NULL OR v_i.utilisee_le IS NOT NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_i.entreprise_id, 'membre.inviter');
  UPDATE invitations SET revoquee_le = now() WHERE id = p_invitation_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, v_i.entreprise_id, 'invitation.revoquee', 'invitation',
          p_invitation_id::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.admin_revoquer_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_revoquer_invitation(uuid) TO jokswed_app;

-- Le drain a besoin de l'adresse et de l'entreprise, et de RIEN d'autre :
-- ni des rôles attribués, ni de qui a invité.
CREATE OR REPLACE FUNCTION app.invitation_pour_envoi(p_invitation_id uuid)
RETURNS TABLE (email citext, prenom text, entreprise text, expire_le timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.email, i.prenom, e.nom_commercial, i.expire_le
    FROM invitations i JOIN entreprises e ON e.id = i.entreprise_id
   WHERE i.id = p_invitation_id
     AND i.utilisee_le IS NULL AND i.revoquee_le IS NULL AND i.expire_le > now()
$$;
REVOKE ALL ON FUNCTION app.invitation_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_pour_envoi(uuid) TO jokswed_app;

-- --- 3. Activation du compte par l'invité ------------------------------------
-- ⚠️ CE CHEMIN APPARTIENT À `jokswed_auth`, PAS AU RÔLE MÉTIER.
-- Il crée un utilisateur et une adhésion : si `jokswed_app` pouvait l'appeler,
-- une requête SQL arbitraire sous le rôle applicatif s'ajouterait à n'importe
-- quelle entreprise. Le rôle d'authentification n'a aucun privilège de table
-- et ne sert qu'à ces quelques fonctions.
CREATE OR REPLACE FUNCTION app.auth_invitation(p_jeton_hache text)
RETURNS TABLE (id uuid, email citext, prenom text, nom text,
               entreprise_id uuid, entreprise text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.email, i.prenom, i.nom, i.entreprise_id, e.nom_commercial
    FROM invitations i JOIN entreprises e ON e.id = i.entreprise_id
   WHERE i.jeton_hache = p_jeton_hache
     AND i.utilisee_le IS NULL AND i.revoquee_le IS NULL AND i.expire_le > now()
$$;
REVOKE ALL ON FUNCTION app.auth_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_invitation(text) TO jokswed_auth;

CREATE OR REPLACE FUNCTION app.auth_accepter_invitation(
  p_jeton_hache text, p_mot_de_passe_hache text, p_prenom text, p_nom text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_i RECORD; v_u uuid; v_membre uuid; v_role uuid;
BEGIN
  SELECT * INTO v_i FROM invitations
   WHERE jeton_hache = p_jeton_hache
     AND utilisee_le IS NULL AND revoquee_le IS NULL AND expire_le > now()
   FOR UPDATE;
  IF v_i IS NULL THEN
    RAISE EXCEPTION 'invitation invalide ou expirée' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Un compte peut déjà exister : un vidéaste invité par deux entreprises
  -- garde UNE identité. On ne réécrit alors ni son mot de passe ni son nom.
  SELECT id INTO v_u FROM utilisateurs WHERE email = v_i.email;
  IF v_u IS NULL THEN
    INSERT INTO utilisateurs (email, prenom, nom, email_verifie_le)
    VALUES (v_i.email,
            coalesce(nullif(p_prenom, ''), v_i.prenom, split_part(v_i.email::text, '@', 1)),
            coalesce(nullif(p_nom, ''), v_i.nom, ''), now())
    RETURNING id INTO v_u;
    -- Le secret vit dans `identifiants`, jamais sur la fiche utilisateur :
    -- une table qu'on affiche ne doit pas porter d'empreinte de mot de passe.
    INSERT INTO identifiants (utilisateur_id, type, secret_hache)
    VALUES (v_u, 'mot_de_passe', p_mot_de_passe_hache);
  ELSIF NOT EXISTS (SELECT 1 FROM identifiants
                     WHERE utilisateur_id = v_u AND type = 'mot_de_passe') THEN
    INSERT INTO identifiants (utilisateur_id, type, secret_hache)
    VALUES (v_u, 'mot_de_passe', p_mot_de_passe_hache);
  END IF;
  -- ⚠️ ON NE RÉÉCRIT PAS LE MOT DE PASSE D'UN COMPTE EXISTANT.
  -- Sinon, inviter une adresse déjà connue deviendrait une prise de contrôle :
  -- il suffirait d'inviter quelqu'un pour lui choisir son mot de passe.

  INSERT INTO membres (entreprise_id, utilisateur_id, ajoute_par)
  VALUES (v_i.entreprise_id, v_u, v_i.cree_par)
  ON CONFLICT (entreprise_id, utilisateur_id) WHERE retire_le IS NULL
    DO NOTHING
  RETURNING id INTO v_membre;
  IF v_membre IS NULL THEN
    SELECT id INTO v_membre FROM membres
     WHERE entreprise_id = v_i.entreprise_id AND utilisateur_id = v_u
       AND retire_le IS NULL;
  END IF;

  FOREACH v_role IN ARRAY v_i.roles LOOP
    INSERT INTO membres_roles (membre_id, role_id) VALUES (v_membre, v_role)
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE invitations SET utilisee_le = now(), utilisee_par = v_u WHERE id = v_i.id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_u, v_i.entreprise_id, 'invitation.acceptee', 'membre', v_membre::text,
          jsonb_build_object('invitation_id', v_i.id));
  RETURN v_u;
END $$;
REVOKE ALL ON FUNCTION app.auth_accepter_invitation(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_accepter_invitation(text, text, text, text) TO jokswed_auth;
