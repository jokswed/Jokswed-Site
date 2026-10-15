-- =============================================================================
-- 066 — DÉPLACER UNE ÉTAPE DE PLANNING EST UN ÉCHANGE
-- -----------------------------------------------------------------------------
-- ⚠️ CE QUE LA CONTRAINTE REFUSAIT.
--
-- `etape_ordre_unique (demande_id, ordre)` interdit deux étapes au même rang
-- — c'est ce qui garantit un ordre, et il faut le garder. Mais écrire « 2 »
-- sur une étape alors qu'une autre y est déjà levait une violation de
-- contrainte, donc une 500 sur la fiche : le geste le plus naturel du
-- réordonnancement était celui qui cassait.
--
-- Déplacer, c'est donc ÉCHANGER. Et l'échange passe par un rang temporaire
-- négatif, sinon les deux lignes se heurtent au milieu de l'opération.
--
-- ⚠️ EN BASE, ET PAS DANS LA PAGE.
-- La règle appartient à l'endroit où vit la contrainte : écrite dans un
-- gabarit, elle serait réécrite au prochain écran qui touche au planning, et
-- rien ne l'aurait rappelée.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.reordonner_etape(p_etape_id uuid, p_ordre integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e RECORD; v_occupant uuid;
BEGIN
  SELECT e.id, e.demande_id, e.entreprise_id, e.ordre INTO v_e
    FROM etapes_planning e WHERE e.id = p_etape_id;
  IF v_e.id IS NULL THEN
    RAISE EXCEPTION 'étape introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM app.exiger(v_e.entreprise_id, 'planning.ecrire');

  IF p_ordre IS NULL OR p_ordre < 1 THEN
    RAISE EXCEPTION 'rang invalide : %', p_ordre USING ERRCODE = 'check_violation';
  END IF;
  IF p_ordre = v_e.ordre THEN RETURN v_e.ordre; END IF;

  SELECT e.id INTO v_occupant FROM etapes_planning e
   WHERE e.demande_id = v_e.demande_id AND e.ordre = p_ordre AND e.id <> p_etape_id;

  -- Le rang temporaire négatif : aucune étape n'en porte, la contrainte passe.
  UPDATE etapes_planning SET ordre = -1 WHERE id = p_etape_id;
  IF v_occupant IS NOT NULL THEN
    UPDATE etapes_planning SET ordre = v_e.ordre WHERE id = v_occupant;
  END IF;
  UPDATE etapes_planning SET ordre = p_ordre WHERE id = p_etape_id;
  RETURN p_ordre;
END $$;
REVOKE ALL ON FUNCTION app.reordonner_etape(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reordonner_etape(uuid, integer) TO jokswed_app;
