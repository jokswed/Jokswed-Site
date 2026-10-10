-- =============================================================================
-- 038 — ON N'INVITE PAS PLUS HAUT QUE SOI (SAUF POUR AMORCER)
-- -----------------------------------------------------------------------------
-- ⚠️ CHEMIN D'ÉLÉVATION TROUVÉ EN AUDITANT LE RÔLE `parrain`.
--
-- `admin_creer_invitation` vérifiait que les rôles proposés appartenaient à
-- l'entreprise — et rien de plus. Un parrain, qui ne porte que deux
-- permissions, pouvait donc créer une invitation au rôle « Propriétaire » :
-- il lui suffisait de la diriger vers une adresse qu'il contrôle pour
-- s'accorder, en deux temps, tous les droits qu'on lui refusait en un.
--
-- RÈGLE : les permissions conférées par une invitation doivent être INCLUSES
-- dans celles de l'invitant.
--
-- EXCEPTION, ET UNE SEULE : l'AMORÇAGE. Une entreprise dont tous les membres
-- actifs sont des parrains n'a encore personne pour la diriger — c'est
-- exactement la situation que le parrainage existe pour résoudre. Dans ce cas
-- précis, et seulement celui-là, l'invitation peut conférer davantage.
-- L'exception se referme d'elle-même dès le premier membre non parrain.
--
-- `role.gerer` ouvre aussi la porte : qui peut composer les rôles peut déjà
-- s'accorder ce qu'il veut par ce chemin-là. L'interdire ici ne protégerait
-- rien et compliquerait l'usage normal.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.entreprise_en_amorcage(p_entreprise uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM membres m
      JOIN membres_roles mr ON mr.membre_id = m.id
      JOIN roles r ON r.id = mr.role_id
     WHERE m.entreprise_id = p_entreprise
       AND m.retire_le IS NULL
       AND r.cle <> 'parrain')
$$;
REVOKE ALL ON FUNCTION app.entreprise_en_amorcage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.entreprise_en_amorcage(uuid) TO jokswed_app;

DROP FUNCTION IF EXISTS app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer, bytea);

CREATE OR REPLACE FUNCTION app.admin_creer_invitation(
  p_entreprise uuid, p_email citext, p_prenom text, p_nom text,
  p_jeton_hache text, p_roles uuid[], p_jours integer,
  p_jeton_chiffre bytea DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_acteur uuid; v_id uuid;
  v_siennes text[]; v_conferees text[]; v_surplus text[];
BEGIN
  v_acteur := app.exiger(p_entreprise, 'membre.inviter');

  IF EXISTS (SELECT 1 FROM unnest(p_roles) r
              WHERE r NOT IN (SELECT id FROM roles WHERE entreprise_id = p_entreprise)) THEN
    RAISE EXCEPTION 'rôle étranger à cette entreprise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_siennes := app.permissions_de(v_acteur, p_entreprise);
  SELECT coalesce(array_agg(DISTINCT rp.permission_cle), '{}')
    INTO v_conferees
    FROM roles_permissions rp
   WHERE rp.role_id = ANY (p_roles);

  SELECT coalesce(array_agg(x), '{}') INTO v_surplus
    FROM unnest(v_conferees) x WHERE NOT (x = ANY (v_siennes));

  IF cardinality(v_surplus) > 0
     AND NOT ('role.gerer' = ANY (v_siennes))
     AND NOT app.entreprise_en_amorcage(p_entreprise) THEN
    RAISE EXCEPTION
      'invitation refusée : elle conférerait des permissions que vous n''avez pas (%)',
      array_to_string(v_surplus, ', ')
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
          jsonb_build_object('email', p_email,
                             'amorcage', app.entreprise_en_amorcage(p_entreprise),
                             'surplus', to_jsonb(v_surplus)));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_creer_invitation(uuid, citext, text, text, text, uuid[], integer, bytea) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- RENDRE SON TABLIER
-- -----------------------------------------------------------------------------
-- ⚠️ SE RETIRER SOI-MÊME EST TOUJOURS PERMIS.
-- `app.exiger(..., cible)` interdit d'agir sur soi parce que toutes les
-- actions visées ÉLARGISSENT ou retirent les droits d'autrui. Ici le geste ne
-- fait que réduire les siens : il n'y a rien à protéger contre. Et il faut
-- qu'il reste possible même sans `membre.revoquer`, sinon un parrain dont on
-- a retiré les droits resterait membre indéfiniment.
CREATE OR REPLACE FUNCTION app.quitter_entreprise(p_entreprise uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_membre uuid;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN
    RAISE EXCEPTION 'aucune identité' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_membre FROM membres
   WHERE entreprise_id = p_entreprise AND utilisateur_id = v_acteur AND retire_le IS NULL;
  IF v_membre IS NULL THEN RETURN false; END IF;

  -- ⚠️ ON NE LAISSE PAS UNE ENTREPRISE SANS PERSONNE POUR L'ADMINISTRER.
  IF NOT EXISTS (
    SELECT 1 FROM membres m
     WHERE m.entreprise_id = p_entreprise AND m.retire_le IS NULL
       AND m.utilisateur_id <> v_acteur
       AND 'membre.inviter' = ANY (app.permissions_de(m.utilisateur_id, p_entreprise))) THEN
    RAISE EXCEPTION
      'vous êtes le dernier à pouvoir administrer cette entreprise : désignez un successeur d''abord'
      USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE membres SET retire_le = now(), retire_par = v_acteur WHERE id = v_membre;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, p_entreprise, 'membre.parti', 'membre', v_membre::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.quitter_entreprise(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.quitter_entreprise(uuid) TO jokswed_app;
