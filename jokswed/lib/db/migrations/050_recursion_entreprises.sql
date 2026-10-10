-- =============================================================================
-- 050 — LA RACINE DE LA RLS NE DOIT PAS LIRE UNE TABLE QU'ELLE PROTÈGE
-- -----------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ EN APPLIQUANT LES MIGRATIONS SUR NEON.
--
-- `app.entreprises_de_lacteur()` joignait `entreprises` — pour écarter les
-- entreprises archivées. Or la politique de `entreprises` est précisément
-- « id IN (SELECT unnest(app.entreprises_de_lacteur())) ». La fonction
-- appelle donc la politique qui appelle la fonction : récursion infinie,
-- « stack depth limit exceeded », et plus rien ne fonctionne.
--
-- ⚠️ POURQUOI ÇA NE S'EST JAMAIS VU EN DÉVELOPPEMENT.
--
-- `SECURITY DEFINER` fait tourner la fonction sous `jokswed_migrateur`. En
-- local, ce rôle est SUPERUTILISATEUR : il contourne toute RLS, la politique
-- de `entreprises` ne s'évalue jamais, et la récursion n'existe pas. Sur
-- Neon — comme sur tout PostgreSQL géré — aucun rôle client n'est
-- superutilisateur. Le défaut était donc là depuis le palier 006, invisible,
-- et se serait déclaré à la première requête en production.
--
-- Deux corrections possibles :
--   · retirer `FORCE ROW LEVEL SECURITY` de `entreprises` — ce serait
--     affaiblir le modèle pour contourner un symptôme ;
--   · ne plus lire `entreprises` depuis la racine de la RLS.
--
-- On retient la seconde. L'exclusion des entreprises archivées se fait
-- désormais par les DONNÉES : archiver une entreprise retire ses adhésions.
-- C'est d'ailleurs plus juste — un accès à une entreprise archivée n'a pas
-- à dépendre d'une jointure qu'on pourrait oublier ailleurs.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.entreprises_de_lacteur() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
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

/* Archiver une entreprise retire ses adhésions : l'accès tombe par les
   données, sans qu'aucune politique n'ait à le vérifier. */
CREATE OR REPLACE FUNCTION entreprise_archivee_retire_membres() RETURNS trigger AS $$
BEGIN
  IF NEW.archivee_le IS NOT NULL AND OLD.archivee_le IS NULL THEN
    UPDATE membres SET retire_le = now()
     WHERE entreprise_id = NEW.id AND retire_le IS NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entreprises_archivage ON entreprises;
CREATE TRIGGER entreprises_archivage AFTER UPDATE OF archivee_le ON entreprises
  FOR EACH ROW EXECUTE FUNCTION entreprise_archivee_retire_membres();

/* Rattrapage : une entreprise déjà archivée ne doit plus avoir de membre. */
UPDATE membres m SET retire_le = now()
  FROM entreprises e
 WHERE e.id = m.entreprise_id AND e.archivee_le IS NOT NULL AND m.retire_le IS NULL;
