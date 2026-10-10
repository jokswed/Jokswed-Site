-- =============================================================================
-- 009 — `permissions_effectives` rendue appelable
-- -----------------------------------------------------------------------------
-- ⚠️ CE QUE LE PALIER 008 A CASSÉ SANS LE VOULOIR.
--
-- Il a rendu `app.permissions_de(acteur, entreprise)` INTERNE — il le fallait :
-- exposée, elle permettrait d'interroger les permissions de n'importe qui.
-- Mais `app.permissions_effectives()`, elle, est `SECURITY INVOKER` : appelée
-- par `jokswed_app`, elle tentait d'exécuter une fonction à laquelle ce rôle
-- n'a plus droit, et échouait avec « permission denied for function ».
--
-- La bonne réponse n'est PAS de rendre `permissions_de` publique. C'est de
-- faire de `permissions_effectives` une fonction `SECURITY DEFINER` : elle
-- fige `app.acteur()` dans son corps, donc on ne peut pas lui demander les
-- permissions d'un autre. Le périmètre reste exactement le même, l'appel
-- redevient possible.
--
-- Migration SÉPARÉE plutôt que correction du palier 008 : une migration déjà
-- appliquée quelque part ne se réécrit pas, sinon deux bases portant le même
-- numéro n'ont plus le même contenu.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.permissions_effectives(p_entreprise_id uuid)
RETURNS TABLE (permission_cle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT unnest(app.permissions_de(app.acteur(), p_entreprise_id))
$$;

REVOKE ALL ON FUNCTION app.permissions_effectives(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.permissions_effectives(uuid) TO jokswed_app;
