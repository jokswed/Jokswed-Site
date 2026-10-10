-- =============================================================================
-- 046 — NOMMER UN CO-PARTICIPANT SANS VOIR SON ENTREPRISE
-- -----------------------------------------------------------------------------
-- ⚠️ MÊME DÉFAUT QU'AU PALIER 029, À UN AUTRE ENDROIT.
--
-- La page d'une conversation listait ses participants en joignant
-- `entreprises`. La politique `entreprise_membre` ne rend que les siennes :
-- le vidéaste co-participant s'affichait « null (prestataire) ».
--
-- Le cloisonnement est juste. Ce qu'il faut, c'est une fonction contrôlée
-- qui rende le SEUL champ nécessaire — la raison commerciale — et seulement
-- pour les entreprises qui participent à une conversation où l'appelant
-- participe lui aussi.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.participants_conversation(p_conversation uuid)
RETURNS TABLE (role text, nom text, contact_email citext, entreprise_id uuid,
               entreprise text, est_moi boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_conversation NOT IN (SELECT app.conversations_de_lacteur()) THEN RETURN; END IF;
  RETURN QUERY
  SELECT cp.role, cp.nom, cp.contact_email, cp.entreprise_id, e.nom_commercial,
         cp.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
    FROM conversation_participants cp
    LEFT JOIN entreprises e ON e.id = cp.entreprise_id
   WHERE cp.conversation_id = p_conversation AND cp.retire_le IS NULL
   ORDER BY cp.role DESC, e.nom_commercial;
END $$;
REVOKE ALL ON FUNCTION app.participants_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.participants_conversation(uuid) TO jokswed_app;

/* Les partenaires qu'on peut inviter dans une conversation : même principe
   qu'`app.partenaires_disponibles`, mais depuis une conversation. */
CREATE OR REPLACE FUNCTION app.partenaires_invitables(p_conversation uuid)
RETURNS TABLE (id uuid, nom_commercial text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid;
BEGIN
  SELECT cp.entreprise_id INTO v_ent FROM conversation_participants cp
   WHERE cp.conversation_id = p_conversation AND cp.role = 'prestataire'
     AND cp.retire_le IS NULL
     AND 'message.envoyer' = ANY (app.permissions_de(app.acteur(), cp.entreprise_id))
   LIMIT 1;
  IF v_ent IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT e.id, e.nom_commercial FROM entreprises e
   WHERE e.archivee_le IS NULL
     AND e.id NOT IN (SELECT cp.entreprise_id FROM conversation_participants cp
                       WHERE cp.conversation_id = p_conversation
                         AND cp.role = 'prestataire' AND cp.retire_le IS NULL)
   ORDER BY e.nom_commercial;
END $$;
REVOKE ALL ON FUNCTION app.partenaires_invitables(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.partenaires_invitables(uuid) TO jokswed_app;
