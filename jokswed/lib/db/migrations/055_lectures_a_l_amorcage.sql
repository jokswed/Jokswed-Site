-- =============================================================================
-- 055 — `RETURNING` EST SOUMIS À LA POLITIQUE DE LECTURE
-- -----------------------------------------------------------------------------
-- ⚠️ L'AMORÇAGE ÉCHOUAIT ENCORE, ALORS QUE L'INSERT NU PASSAIT.
--
--   INSERT INTO entreprises (…) VALUES (…)              → ok
--   INSERT INTO entreprises (…) VALUES (…) RETURNING id → refusé
--
-- PostgreSQL applique la politique SELECT à la ligne renvoyée par un
-- `RETURNING`. `entreprise_membre` exige que l'entreprise figure dans
-- `app.entreprises_de_lacteur()` : impossible pour une entreprise qui n'a pas
-- encore de membre. Le message d'erreur est celui d'un `WITH CHECK` refusé, ce
-- qui envoie chercher le défaut du mauvais côté.
--
-- Trois opérations de l'amorçage butaient sur une politique de LECTURE :
--   • `INSERT INTO entreprises … RETURNING id`
--   • `SELECT id FROM roles WHERE entreprise_id = v_e AND cle = 'proprietaire'`
--   • le `WITH CHECK` de `membres_roles`, qui relit l'appartenance
--
-- On étend aux lectures la clause auto-refermante déjà admise en écriture aux
-- paliers 052 et 054. La symétrie est volontaire : qui peut écrire les rôles
-- d'une entreprise sans membre peut les relire. La RLS reste ENABLE + FORCE,
-- et l'appartenance demeure la seule voie dès qu'un membre existe.
--
-- ⚠️ LE RATTACHEMENT DU RÔLE DEMANDE UN AUTRE PRÉDICAT.
-- « Entreprise sans membre actif » est vraie pour l'INSERT de l'entreprise et
-- de ses rôles, mais plus au moment d'attacher un rôle : le membre vient
-- d'être créé. La condition qui tient à cet instant — et qui cesse de tenir
-- définitivement ensuite — est : aucun membre de cette entreprise ne porte de
-- rôle, ET la base entière ne compte qu'un seul membre actif. C'est l'état du
-- tout premier compte, et de lui seul.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.entreprise_sans_role(p_entreprise uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM membres_roles mr
      JOIN membres m ON m.id = mr.membre_id
     WHERE m.entreprise_id = p_entreprise)
$$;

CREATE OR REPLACE FUNCTION app.base_un_seul_membre()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT count(*) = 1 FROM membres WHERE retire_le IS NULL
$$;

-- 1. Lecture d'une entreprise sans membre actif.
DROP POLICY IF EXISTS entreprise_amorcage_lecture ON entreprises;
CREATE POLICY entreprise_amorcage_lecture ON entreprises FOR SELECT
  USING (app.entreprise_sans_membre(id));

-- 2. Lecture des rôles d'une entreprise sans membre actif — exactement le
--    périmètre que `role_ecriture` autorise déjà en insertion.
DROP POLICY IF EXISTS role_tenant ON roles;
CREATE POLICY role_tenant ON roles FOR SELECT
  USING (entreprise_id IS NULL
         OR entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
         OR (entreprise_id IS NOT NULL AND app.entreprise_sans_membre(entreprise_id)));

-- 3. Premier rôle du tout premier membre de la base.
DROP POLICY IF EXISTS membres_roles_tenant ON membres_roles;
CREATE POLICY membres_roles_tenant ON membres_roles FOR ALL
  USING (EXISTS (SELECT 1 FROM membres m WHERE m.id = membres_roles.membre_id))
  WITH CHECK (EXISTS (
    SELECT 1 FROM membres m
     WHERE m.id = membres_roles.membre_id
       AND (m.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
            OR (app.entreprise_sans_role(m.entreprise_id)
                AND app.base_un_seul_membre()))));

-- -----------------------------------------------------------------------------
-- La fonction d'amorçage lit le rôle `proprietaire` AVANT de créer le membre :
-- après, l'entreprise a un membre actif et la politique de lecture des rôles
-- se referme. Seul l'ordre change ; le contenu est celui du palier 053.
-- -----------------------------------------------------------------------------
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

  SELECT id INTO v_r FROM roles WHERE entreprise_id = v_e AND cle = 'proprietaire';
  IF v_r IS NULL THEN
    RAISE EXCEPTION 'amorçage impossible : rôle « proprietaire » introuvable'
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO membres (entreprise_id, utilisateur_id) VALUES (v_e, v_u)
  RETURNING id INTO v_m;
  INSERT INTO membres_roles (membre_id, role_id) VALUES (v_m, v_r);

  INSERT INTO journal_audit (acteur_id, acteur_type, entreprise_id, action,
                             ressource_type, ressource_id, apres)
  VALUES (v_u, 'systeme', v_e, 'amorcage.proprietaire', 'utilisateur', v_u::text,
          jsonb_build_object('email', p_email, 'entreprise', p_entreprise_slug));
  RETURN v_u;
END $$;
REVOKE ALL ON FUNCTION app.auth_amorcer_proprietaire(citext, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_amorcer_proprietaire(citext, text, text, text, text, text) TO jokswed_auth;

REVOKE ALL ON FUNCTION app.entreprise_sans_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.base_un_seul_membre() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.entreprise_sans_membre(uuid) TO jokswed_app, jokswed_auth, jokswed_public;
GRANT EXECUTE ON FUNCTION app.entreprise_sans_role(uuid) TO jokswed_app, jokswed_auth, jokswed_public;
GRANT EXECUTE ON FUNCTION app.base_un_seul_membre() TO jokswed_app, jokswed_auth, jokswed_public;
