-- =============================================================================
-- 029 — VOIR LE NOM D'UN PARTENAIRE SANS VOIR SON ENTREPRISE
-- -----------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ PAR LE BANC DES ROUTES.
--
-- La fiche d'une demande interrogeait `entreprises` directement pour lister
-- les partenaires et nommer le destinataire d'une proposition. Or la
-- politique `entreprise_membre` ne rend que SES propres entreprises : la
-- jointure supprimait silencieusement la proposition, et la fiche affichait
-- « aucune proposition enregistrée » alors qu'il y en avait une.
--
-- Le cloisonnement était juste ; c'est la page qui demandait mal. On ne
-- l'assouplit donc pas : on expose, par une fonction contrôlée, le SEUL
-- champ dont l'émetteur a besoin — la raison commerciale. Ni e-mail, ni
-- SIRET, ni adresse, ni médiateur, ni rien de financier.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.partenaires_disponibles(p_entreprise_id uuid)
RETURNS TABLE (id uuid, nom_commercial text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'collaboration.proposer');
  RETURN QUERY
  SELECT e.id, e.nom_commercial
    FROM entreprises e
   WHERE e.id <> p_entreprise_id AND e.archivee_le IS NULL
   ORDER BY e.nom_commercial;
END $$;
REVOKE ALL ON FUNCTION app.partenaires_disponibles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.partenaires_disponibles(uuid) TO jokswed_app;

-- La vue de l'ÉMETTEUR sur ses propres propositions. Symétrique de
-- `propositions_recues`, qui est la vue du destinataire.
CREATE OR REPLACE FUNCTION app.propositions_emises(p_demande_id uuid)
RETURNS TABLE (
  id uuid, prestation text, statut text, origine text,
  envoyee_le timestamptz, repondu_le timestamptz, commentaire text,
  entreprise_destinataire_id uuid, destinataire text,
  coordonnees_partagees boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid;
BEGIN
  -- ⚠️ ALIAS OBLIGATOIRE : `entreprise_destinataire_id` est AUSSI un paramètre
  -- de sortie de cette fonction, et plpgsql résout le paramètre avant la
  -- colonne. Sans `d.`, « column reference … is ambiguous ».
  SELECT d.entreprise_destinataire_id INTO v_ent FROM demandes d WHERE d.id = p_demande_id;
  IF v_ent IS NULL THEN RETURN; END IF;
  PERFORM app.exiger(v_ent, 'dossier.lire');

  RETURN QUERY
  SELECT pr.id, pr.prestation, pr.statut, pr.origine, pr.envoyee_le,
         pr.repondu_le, pr.commentaire, pr.entreprise_destinataire_id,
         e.nom_commercial,
         EXISTS (SELECT 1 FROM partages_mariage pm
                  JOIN demandes d2 ON d2.mariage_id = pm.mariage_id
                 WHERE d2.id = p_demande_id
                   AND pm.entreprise_id = pr.entreprise_destinataire_id
                   AND pm.categorie = 'coordonnees_clients'
                   AND pm.retire_le IS NULL)
    FROM propositions pr
    JOIN entreprises e ON e.id = pr.entreprise_destinataire_id
   WHERE pr.demande_id = p_demande_id
     AND pr.entreprise_emettrice_id = v_ent
   ORDER BY pr.cree_le;
END $$;
REVOKE ALL ON FUNCTION app.propositions_emises(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.propositions_emises(uuid) TO jokswed_app;
