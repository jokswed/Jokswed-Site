-- =============================================================================
-- 027 — ENVOYER UNE INVITATION SANS JAMAIS STOCKER SON JETON EN CLAIR
-- -----------------------------------------------------------------------------
-- ⚠️ LE PROBLÈME, POSÉ HONNÊTEMENT.
--
-- Le lien d'invitation EST le secret : seule son empreinte est conservée, de
-- sorte qu'une fuite de la base ne permette d'usurper aucun accès. Mais
-- l'envoi se fait depuis le drain, plus tard, dans une autre transaction —
-- et à ce moment-là le jeton en clair n'existe plus nulle part.
--
-- Trois issues possibles :
--   1. envoyer l'e-mail dans la transaction de création — une panne du
--      fournisseur annulerait l'invitation, ou pire, un envoi partirait pour
--      une transaction finalement annulée ;
--   2. mettre le jeton en clair dans la charge utile de l'événement — c'est
--      le stocker en clair, avec en prime la rétention des événements ;
--   3. le CHIFFRER au repos, le déchiffrer une seule fois au moment de
--      l'envoi, puis l'effacer.
--
-- On retient la troisième. La clé vit dans l'environnement, jamais en base :
-- un export SQL seul ne rend aucun jeton exploitable. Et dès l'envoi fait,
-- `jeton_chiffre` repasse à NULL — l'invitation redevient une simple
-- empreinte. Renvoyer le lien exige alors d'en régénérer un.
-- =============================================================================

ALTER TABLE invitations ADD COLUMN jeton_chiffre bytea;

-- ⚠️ ON SUPPRIME L'ANCIENNE SIGNATURE AVANT DE CRÉER LA NOUVELLE.
-- Ajouter un paramètre à défaut ne remplace pas la fonction : il en crée une
-- SURCHARGE. Les deux coexistent, et un appel avec des littéraux non typés
-- devient ambigu — « function … is not unique ». Le banc V6 l'a attrapé.
DROP FUNCTION IF EXISTS app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer);

CREATE OR REPLACE FUNCTION app.admin_creer_invitation(
  p_entreprise uuid, p_email citext, p_prenom text, p_nom text,
  p_jeton_hache text, p_roles uuid[], p_jours integer,
  p_jeton_chiffre bytea DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_id uuid;
BEGIN
  v_acteur := app.exiger(p_entreprise, 'membre.inviter');

  -- Les rôles proposés doivent appartenir à CETTE entreprise : sinon inviter
  -- quelqu'un deviendrait un moyen de lui coller le rôle d'une autre.
  IF EXISTS (SELECT 1 FROM unnest(p_roles) r
              WHERE r NOT IN (SELECT id FROM roles WHERE entreprise_id = p_entreprise)) THEN
    RAISE EXCEPTION 'rôle étranger à cette entreprise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO invitations (entreprise_id, email, prenom, nom, jeton_hache,
                           jeton_chiffre, roles, cree_par, expire_le)
  VALUES (p_entreprise, p_email, p_prenom, p_nom, p_jeton_hache,
          p_jeton_chiffre, coalesce(p_roles, '{}'), v_acteur,
          now() + make_interval(days => greatest(1, least(coalesce(p_jours, 7), 30))))
  RETURNING id INTO v_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_entreprise, 'invitation.creee', 'invitation', v_id::text,
          jsonb_build_object('email', p_email));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer, bytea) TO jokswed_app;

-- Le type de retour change (le jeton chiffré s'y ajoute) : PostgreSQL refuse
-- un CREATE OR REPLACE dans ce cas, il faut supprimer puis recréer.
DROP FUNCTION IF EXISTS app.invitation_pour_envoi(uuid);

-- Ce que le drain lit pour composer l'e-mail : l'adresse, le prénom, le nom
-- de l'entreprise, l'échéance — et le jeton chiffré. Rien d'autre.
CREATE OR REPLACE FUNCTION app.invitation_pour_envoi(p_invitation_id uuid)
RETURNS TABLE (email citext, prenom text, entreprise text,
               expire_le timestamptz, jeton_chiffre bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.email, i.prenom, e.nom_commercial, i.expire_le, i.jeton_chiffre
    FROM invitations i JOIN entreprises e ON e.id = i.entreprise_id
   WHERE i.id = p_invitation_id
     AND i.utilisee_le IS NULL AND i.revoquee_le IS NULL AND i.expire_le > now()
$$;
REVOKE ALL ON FUNCTION app.invitation_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_pour_envoi(uuid) TO jokswed_app;

/* Après l'envoi : on efface le jeton chiffré. L'invitation redevient une
   empreinte, et plus rien ne permet de reconstituer le lien. */
CREATE OR REPLACE FUNCTION app.invitation_jeton_efface(p_invitation_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE invitations SET jeton_chiffre = NULL WHERE id = p_invitation_id
$$;
REVOKE ALL ON FUNCTION app.invitation_jeton_efface(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_jeton_efface(uuid) TO jokswed_app;
