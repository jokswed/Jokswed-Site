-- =============================================================================
-- 015 — LE DRAIN PEUT RELIRE LA DEMANDE QU'IL DOIT ANNONCER
-- -----------------------------------------------------------------------------
-- ⚠️ LE DÉFAUT, TROUVÉ PAR LE BANC ET NON PAR RELECTURE.
--
-- Le drain tourne SANS identité : c'est voulu, il n'a pas d'acteur. Mais il
-- lisait `demandes` par une requête ordinaire, et la politique de cette table
-- exige `entreprise_destinataire_id IN (entreprises de l'acteur)`. Sans
-- acteur, elle rendait ZÉRO ligne.
--
-- Conséquence exacte : la condition `if (d)` du drain était fausse, tout le
-- bloc d'envoi était sauté, et l'événement marqué « traité ». Aucune erreur,
-- aucune trace — simplement, aucun e-mail n'était jamais composé. Le genre de
-- panne qu'on ne découvre que le jour où un client s'étonne de n'avoir rien
-- reçu.
--
-- La correction n'est PAS d'assouplir la politique : c'est de donner au drain
-- une fonction au périmètre exact de son besoin. Elle ne rend que les cinq
-- champs nécessaires à composer un accusé de réception — ni le message du
-- client, ni l'instantané, ni les consentements.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.demande_pour_envoi(p_demande_id uuid)
RETURNS TABLE (
  contact_nom text, contact_email citext, ville text,
  date_mariage date, formule_nom text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.contact_nom, d.contact_email, d.ville, d.date_mariage, d.formule_nom
    FROM demandes d WHERE d.id = p_demande_id
$$;

REVOKE ALL ON FUNCTION app.demande_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.demande_pour_envoi(uuid) TO jokswed_app;
