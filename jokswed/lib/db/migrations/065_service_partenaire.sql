-- =============================================================================
-- 065 — UN PRESTATAIRE A UN MÉTIER
-- -----------------------------------------------------------------------------
-- ⚠️ POURQUOI PAS SUR `dossiers.prestation`.
--
-- `dossiers.prestation` vaut `photo`, `video` ou `autre` : c'est la NATURE
-- COMMERCIALE du dossier, et toute la facturation en dépend. Y ajouter
-- « photobooth » aurait obligé à relire chaque CHECK, chaque gabarit de devis
-- et chaque total — pour une information qui ne concerne pas le dossier mais
-- le PRESTATAIRE, et qui ne change pas d'un mariage à l'autre.
--
-- Le métier se déclare donc une fois, sur l'entreprise partenaire. Un
-- photobooth reste, côté dossier, une prestation `autre` — ce qu'elle est.
-- =============================================================================

ALTER TABLE entreprises ADD COLUMN service_partenaire text
  CHECK (service_partenaire IS NULL OR service_partenaire IN
    ('photographe','videaste','second_shooter','photobooth','autre'));

COMMENT ON COLUMN entreprises.service_partenaire IS
  'Métier d''un prestataire parrainé. NULL pour une entreprise titulaire.';

-- ⚠️ ON SUPPRIME L'ANCIENNE SIGNATURE AVANT DE CRÉER LA NOUVELLE.
-- Les deux coexistant, un appel à quatre arguments deviendrait ambigu : la
-- version à cinq paramètres y répond aussi, grâce à son `DEFAULT NULL`. Les
-- bancs qui appellent avec quatre arguments continuent donc de fonctionner.
DROP FUNCTION IF EXISTS app.creer_entreprise_partenaire(uuid, text, text, citext);

CREATE OR REPLACE FUNCTION app.creer_entreprise_partenaire(
  p_depuis_entreprise uuid, p_slug text, p_nom text, p_email citext,
  p_service text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_ent uuid; v_membre uuid; v_role uuid;
BEGIN
  v_acteur := app.exiger(p_depuis_entreprise, 'membre.inviter');

  SELECT id INTO v_ent FROM entreprises WHERE slug = p_slug;
  IF v_ent IS NULL THEN
    PERFORM set_config('app.creation_entreprise', 'oui', true);
    INSERT INTO entreprises (slug, nom_commercial, email, service_partenaire)
    VALUES (p_slug, p_nom, p_email, p_service) RETURNING id INTO v_ent;

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
  ELSIF p_service IS NOT NULL THEN
    -- L'entreprise existait déjà : on ne réécrit que ce qui manque.
    UPDATE entreprises SET service_partenaire = coalesce(service_partenaire, p_service)
     WHERE id = v_ent;
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
          jsonb_build_object('slug', p_slug, 'parrain', v_acteur, 'service', p_service));
  RETURN v_ent;
END $$;

REVOKE ALL ON FUNCTION app.creer_entreprise_partenaire(uuid, text, text, citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.creer_entreprise_partenaire(uuid, text, text, citext, text) TO jokswed_app;

-- --- La liste des partenaires, avec leur métier ------------------------------
-- ⚠️ ELLE REMPLACE UN `SELECT … FROM entreprises` IMPOSSIBLE.
-- La politique `entreprise_membre` ne rend que SES propres entreprises : la
-- fiche de demande ne pouvait pas afficher le nom d'un partenaire par une
-- jointure (palier 012). On n'élargit pas la politique — RLS filtre des
-- lignes, pas des colonnes, et l'entreprise porte SIRET, adresse et IBAN
-- chiffré. On rend donc trois champs, et trois seulement.
-- Le type de retour gagne une colonne : `CREATE OR REPLACE` ne sait pas le
-- changer, il faut donc supprimer d'abord.
DROP FUNCTION IF EXISTS app.partenaires_disponibles(uuid);

CREATE OR REPLACE FUNCTION app.partenaires_disponibles(p_entreprise_id uuid)
RETURNS TABLE (id uuid, nom_commercial text, service_partenaire text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'collaboration.proposer');
  RETURN QUERY
  SELECT e.id, e.nom_commercial, e.service_partenaire
    FROM entreprises e
   WHERE e.id <> p_entreprise_id AND e.archivee_le IS NULL
   ORDER BY e.nom_commercial;
END $$;
REVOKE ALL ON FUNCTION app.partenaires_disponibles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.partenaires_disponibles(uuid) TO jokswed_app;
