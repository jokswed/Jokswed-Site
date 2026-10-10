-- =============================================================================
-- 052 — AUTORISER L'AMORÇAGE PAR UNE CONDITION, PAS PAR UN DRAPEAU
-- -----------------------------------------------------------------------------
-- Le palier 051 passait par un indicateur de transaction posé par les
-- fonctions légitimes. Deux défauts : il n'a pas fonctionné sous
-- `jokswed_auth`, et surtout n'importe quelle requête pouvait le poser —
-- ce n'était donc pas une garantie, seulement une convention.
--
-- ⚠️ LA BONNE CONDITION EXISTE, ET ELLE SE REFERME TOUTE SEULE.
--
--   · créer une ENTREPRISE est inoffensif : une entreprise sans membre ne
--     donne accès à rien, et `membres` reste sous sa propre politique.
--     L'INSERT est donc permis, et c'est l'adhésion qui est gardée.
--   · créer un RÔLE n'est permis que pour une entreprise qui n'a AUCUN
--     membre actif — c'est-à-dire une entreprise en cours d'amorçage, et
--     elle seule. Dès le premier membre, la condition devient fausse et la
--     règle habituelle reprend. Rien à poser, rien à forger.
-- =============================================================================

DROP POLICY IF EXISTS entreprise_creation ON entreprises;
CREATE POLICY entreprise_creation ON entreprises FOR INSERT
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION app.entreprise_sans_membre(p_entreprise uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM membres m
     WHERE m.entreprise_id = p_entreprise AND m.retire_le IS NULL)
$$;
REVOKE ALL ON FUNCTION app.entreprise_sans_membre(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.entreprise_sans_membre(uuid)
  TO jokswed_app, jokswed_auth, jokswed_public;

DROP POLICY IF EXISTS role_ecriture ON roles;
CREATE POLICY role_ecriture ON roles FOR INSERT
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
              OR (entreprise_id IS NOT NULL
                  AND app.entreprise_sans_membre(entreprise_id)));

DROP POLICY IF EXISTS roles_perm_tenant ON roles_permissions;
CREATE POLICY roles_perm_tenant ON roles_permissions
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_id
      AND (r.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
           OR (r.entreprise_id IS NOT NULL
               AND app.entreprise_sans_membre(r.entreprise_id)))));

/* Le drapeau n'a plus lieu d'être : on retire ce qui l'utilisait pour que
   personne ne croie qu'il protège encore quelque chose. */
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

  -- ⚠️ L'ADHÉSION EN DERNIER : c'est elle qui referme la fenêtre d'amorçage.
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

CREATE OR REPLACE FUNCTION app.creer_entreprise_partenaire(
  p_depuis_entreprise uuid, p_slug text, p_nom text, p_email citext)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_ent uuid; v_membre uuid; v_role uuid;
BEGIN
  v_acteur := app.exiger(p_depuis_entreprise, 'membre.inviter');

  SELECT id INTO v_ent FROM entreprises WHERE slug = p_slug;
  IF v_ent IS NULL THEN
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

DROP FUNCTION IF EXISTS app.en_creation_entreprise();
