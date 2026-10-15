-- =============================================================================
-- WORKFLOW DEMANDE : SUIVI CLIENT PUBLIC SÉCURISÉ + PUSH ADMIN
-- =============================================================================

CREATE TABLE push_abonnements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id  uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  navigateur      text,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  maj_le          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_abonnements_utilisateur ON push_abonnements (utilisateur_id);

ALTER TABLE push_abonnements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_abonnements TO jokswed_app;

CREATE POLICY push_abonnement_proprietaire ON push_abonnements
  USING (utilisateur_id = app.acteur())
  WITH CHECK (utilisateur_id = app.acteur());

CREATE OR REPLACE FUNCTION app.demande_suivi_public(p_demande_id uuid)
RETURNS TABLE (
  reference text,
  contact_nom text,
  date_mariage date,
  lieu text,
  formule_nom text,
  statut text,
  cree_le timestamptz,
  derniere_reponse text,
  derniere_reponse_le timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    d.reference,
    d.contact_nom,
    d.date_mariage,
    d.lieu,
    d.formule_nom,
    d.statut,
    d.cree_le,
    dernier.corps_texte,
    dernier.envoye_le
  FROM demandes d
  LEFT JOIN LATERAL (
    SELECT m.corps_texte, m.envoye_le
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
     WHERE c.demande_id = d.id
       AND c.nature = 'client'
       AND m.sens = 'sortant'
       AND m.statut = 'envoye'
     ORDER BY m.envoye_le DESC NULLS LAST, m.cree_le DESC
     LIMIT 1
  ) dernier ON true
  WHERE d.id = p_demande_id
$$;

REVOKE ALL ON FUNCTION app.demande_suivi_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.demande_suivi_public(uuid) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.push_abonnements_entreprise(p_entreprise_id uuid)
RETURNS TABLE (endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT pa.endpoint, pa.p256dh, pa.auth
    FROM push_abonnements pa
    JOIN membres m
      ON m.utilisateur_id = pa.utilisateur_id
     AND m.entreprise_id = p_entreprise_id
     AND m.retire_le IS NULL
    JOIN utilisateurs u ON u.id = pa.utilisateur_id AND u.desactive_le IS NULL
   WHERE 'dossier.lire' = ANY (app.permissions_de(pa.utilisateur_id, p_entreprise_id))
$$;

REVOKE ALL ON FUNCTION app.push_abonnements_entreprise(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.push_abonnements_entreprise(uuid) TO jokswed_app;
