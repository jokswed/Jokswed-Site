-- =============================================================================
-- 051 — CRÉER UNE ENTREPRISE QUAND AUCUNE POLITIQUE NE PEUT L'AUTORISER
-- -----------------------------------------------------------------------------
-- ⚠️ L'ŒUF ET LA POULE, VERSION RLS.
--
-- Les politiques de `entreprises`, `roles` et `roles_permissions` disent
-- toutes « … IN (SELECT unnest(app.entreprises_de_lacteur())) ». Or une
-- entreprise qu'on vient de créer n'a, par définition, aucun membre : la
-- condition est fausse pour celui-là même qui la crée. Il n'existe aucune
-- formulation de politique qui autorise la création de la chose dont
-- dépendent toutes les politiques.
--
-- Invisible en développement, encore une fois : le migrateur y est
-- superutilisateur, donc `SECURITY DEFINER` contourne tout. Sur Neon,
-- l'amorçage du premier propriétaire échoue au premier INSERT.
--
-- ⚠️ CE QU'ON FAIT, ET CE QUE ÇA VAUT.
--
-- Un indicateur local à la transaction, posé par les DEUX seules fonctions
-- qui ont le droit de créer une entreprise, et lu par des politiques
-- d'INSERT dédiées. Honnêtement : `set_config` est appelable par n'importe
-- quelle requête sous `jokswed_app`, donc ce n'est pas une barrière contre
-- une injection SQL. Ce que cela garantit vraiment :
--
--   · une entreprise créée ne donne AUCUN accès — seule une ligne dans
--     `membres` en donne, et `membres` reste sous sa politique ;
--   · les permissions attachées aux rôles d'une entreprise neuve ne valent
--     que pour elle ;
--   · les deux fonctions légitimes vérifient, elles, une permission réelle.
--
-- Autrement dit : au pire, du bruit. Jamais un accès.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.en_creation_entreprise()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(current_setting('app.creation_entreprise', true), '') = 'oui'
$$;
REVOKE ALL ON FUNCTION app.en_creation_entreprise() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.en_creation_entreprise() TO jokswed_app, jokswed_public;

CREATE POLICY entreprise_creation ON entreprises FOR INSERT
  WITH CHECK (app.en_creation_entreprise());

DROP POLICY IF EXISTS role_ecriture ON roles;
CREATE POLICY role_ecriture ON roles FOR INSERT
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
              OR app.en_creation_entreprise());

DROP POLICY IF EXISTS roles_perm_tenant ON roles_permissions;
CREATE POLICY roles_perm_tenant ON roles_permissions
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
                        AND r.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
              OR app.en_creation_entreprise());

-- Les deux fonctions légitimes posent l'indicateur, le temps de leur
-- transaction, et le retirent avant de rendre la main.
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

  PERFORM set_config('app.creation_entreprise', 'oui', true);

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

  PERFORM set_config('app.creation_entreprise', '', true);

  INSERT INTO journal_audit (acteur_id, acteur_type, entreprise_id, action,
                             ressource_type, ressource_id, apres)
  VALUES (v_u, 'systeme', v_e, 'amorcage.proprietaire', 'utilisateur', v_u::text,
          jsonb_build_object('email', p_email, 'entreprise', p_entreprise_slug));
  RETURN v_u;
END $$;
REVOKE ALL ON FUNCTION app.auth_amorcer_proprietaire(citext, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_amorcer_proprietaire(citext, text, text, text, text, text) TO jokswed_auth;

CREATE OR REPLACE FUNCTION app.creer_entreprise_partenaire(
  p_depuis_entreprise uuid, p_slug text, p_nom text, p_email citext)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_ent uuid; v_membre uuid; v_role uuid;
BEGIN
  v_acteur := app.exiger(p_depuis_entreprise, 'membre.inviter');

  SELECT id INTO v_ent FROM entreprises WHERE slug = p_slug;
  IF v_ent IS NULL THEN
    PERFORM set_config('app.creation_entreprise', 'oui', true);
    INSERT INTO entreprises (slug, nom_commercial, email)
    VALUES (p_slug, p_nom, p_email) RETURNING id INTO v_ent;

    INSERT INTO roles (entreprise_id, cle, libelle, description, systeme)
    SELECT v_ent, cle, libelle, description, true FROM roles WHERE entreprise_id IS NULL
    ON CONFLICT DO NOTHING;
    INSERT INTO roles_permissions (role_id, permission_cle)
    SELECT r2.id, rp.permission_cle
      FROM roles r1
      JOIN roles_permissions rp ON rp.role_id = r1.id
      JOIN roles r2 ON r2.cle = r1.cle AND r2.entreprise_id = v_ent
     WHERE r1.entreprise_id IS NULL
    ON CONFLICT DO NOTHING;
    PERFORM set_config('app.creation_entreprise', '', true);
  END IF;

  SELECT id INTO v_membre FROM membres
   WHERE entreprise_id = v_ent AND utilisateur_id = v_acteur AND retire_le IS NULL;
  IF v_membre IS NULL THEN
    INSERT INTO membres (entreprise_id, utilisateur_id, ajoute_par)
    VALUES (v_ent, v_acteur, v_acteur) RETURNING id INTO v_membre;
  END IF;

  SELECT id INTO v_role FROM roles WHERE entreprise_id = v_ent AND cle = 'parrain';
  INSERT INTO membres_roles (membre_id, role_id) VALUES (v_membre, v_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_depuis_entreprise, 'partenaire.cree', 'entreprise', v_ent::text,
          jsonb_build_object('slug', p_slug, 'parrain', v_acteur));
  RETURN v_ent;
END $$;
REVOKE ALL ON FUNCTION app.creer_entreprise_partenaire(uuid, text, text, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.creer_entreprise_partenaire(uuid, text, text, citext) TO jokswed_app;
