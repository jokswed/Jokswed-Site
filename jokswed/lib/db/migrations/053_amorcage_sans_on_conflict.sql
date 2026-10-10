-- =============================================================================
-- 053 — `ON CONFLICT DO UPDATE` ENTRAÎNE LES POLITIQUES D'UPDATE
-- -----------------------------------------------------------------------------
-- ⚠️ L'AMORÇAGE ÉCHOUAIT MÊME AVEC `WITH CHECK (true)` SUR L'INSERT.
--
-- `INSERT … ON CONFLICT (slug) DO UPDATE` n'est pas un simple INSERT :
-- PostgreSQL applique aussi les politiques d'UPDATE de la table. Or
-- `entreprises` en a une restrictive depuis le palier 034, qui exige
-- `entreprise.reglages` — une permission que personne ne détient encore au
-- moment où l'on crée la première entreprise.
--
-- On retire donc la clause : l'amorçage ne s'exécute que sur une base sans
-- aucun compte, il n'y a rien à mettre à jour. Un SELECT préalable suffit
-- pour l'idempotence du parrainage.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.auth_amorcer_proprietaire(
  p_email citext, p_prenom text, p_nom text, p_secret_hache text,
  p_entreprise_slug text, p_entreprise_nom text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_u uuid; v_e uuid; v_m uuid; v_r uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM utilisateurs) THEN
    RAISE EXCEPTION 'amorçage impossible : des comptes existent déjà'
      USING ERRCODE = 'restrict_violation';
  END IF;

  INSERT INTO utilisateurs (email, prenom, nom, email_verifie_le)
  VALUES (p_email, p_prenom, p_nom, now()) RETURNING id INTO v_u;
  INSERT INTO identifiants (utilisateur_id, type, secret_hache)
  VALUES (v_u, 'mot_de_passe', p_secret_hache);

  SELECT id INTO v_e FROM entreprises WHERE slug = p_entreprise_slug;
  IF v_e IS NULL THEN
    INSERT INTO entreprises (slug, nom_commercial, email)
    VALUES (p_entreprise_slug, p_entreprise_nom, p_email) RETURNING id INTO v_e;
  END IF;

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
