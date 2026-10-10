-- =============================================================================
-- 045 — TOUTE ENTREPRISE NAÎT AVEC SES MODÈLES
-- -----------------------------------------------------------------------------
-- Le palier 044 installait les modèles dans les entreprises EXISTANTES, au
-- moment de la migration. Celles créées après — par les fixtures, par le
-- parrainage, par n'importe quel chemin — n'en avaient aucun, et l'écran de
-- réponse s'ouvrait vide. Un déclencheur le garantit une fois pour toutes,
-- quel que soit le chemin de création.
-- =============================================================================
CREATE OR REPLACE FUNCTION entreprise_modeles_par_defaut() RETURNS trigger AS $$
BEGIN
  INSERT INTO modeles_reponse (entreprise_id, cle, libelle, sujet, corps, ordre, systeme)
  SELECT NEW.id, m.cle, m.libelle, m.sujet, m.corps, m.ordre, true
    FROM modeles_reponse m WHERE m.entreprise_id IS NULL
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER entreprises_modeles AFTER INSERT ON entreprises
  FOR EACH ROW EXECUTE FUNCTION entreprise_modeles_par_defaut();

-- Rattrapage pour les entreprises déjà là.
SELECT app.installer_modeles(id) FROM entreprises;
