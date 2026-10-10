-- =============================================================================
-- 032 — PARRAINER UNE ENTREPRISE PARTENAIRE
-- -----------------------------------------------------------------------------
-- ⚠️ LE PROBLÈME EST RÉEL, PAS THÉORIQUE.
--
-- Le vidéaste doit posséder SON entreprise : c'est elle qui portera son SIRET,
-- son régime de TVA et sa numérotation. Mais une entreprise neuve n'a aucun
-- membre — donc personne pour y créer l'invitation qui amènera son premier
-- membre. L'œuf et la poule.
--
-- La réponse n'est pas de mettre le vidéaste dans MON entreprise (ses
-- documents porteraient mon identité), ni de laisser une fonction créer des
-- adhésions sans contrôle. C'est un rôle de PARRAIN : une adhésion explicite,
-- tracée, révocable, et volontairement minuscule.
--
--   · `membre.inviter`  — créer et envoyer l'invitation ;
--   · `membre.revoquer` — défaire ce qu'on a fait.
--
-- Et RIEN D'AUTRE. Pas `finance.lire` : le parrain ne voit pas un centime des
-- comptes de son partenaire. Pas `dossier.lire` : il ne voit pas ses dossiers.
-- Le jour où le partenaire est autonome, il révoque son parrain.
-- =============================================================================

INSERT INTO roles (entreprise_id, cle, libelle, description, systeme)
VALUES (NULL, 'parrain', 'Parrain',
        'Crée et envoie l''invitation initiale d''une entreprise partenaire. '
        || 'Aucun accès aux dossiers ni aux finances.', true)
ON CONFLICT DO NOTHING;

INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY['membre.inviter','membre.revoquer']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'parrain'
ON CONFLICT DO NOTHING;

/* Crée l'entreprise partenaire et y installe l'appelant comme parrain.
   ⚠️ L'APPELANT DOIT DÉJÀ ÊTRE QUELQU'UN : la fonction exige
   `membre.inviter` sur une entreprise dont il est membre. Sans cela,
   n'importe quelle requête sous le rôle applicatif se créerait une
   entreprise et s'y donnerait les pleins pouvoirs. */
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
