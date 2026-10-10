-- =============================================================================
-- 028 — CE QUE LE DRAIN LIT D'UNE PROPOSITION
-- -----------------------------------------------------------------------------
-- Même raison qu'`app.demande_pour_envoi` au palier 015 : le drain n'a pas
-- d'acteur, donc la RLS lui rendrait zéro ligne et le bloc d'envoi serait
-- sauté EN SILENCE. Et comme au palier 015, la fonction ne rend que le
-- strict nécessaire — date, ville, prestation. Ni nom de client, ni e-mail,
-- ni montant : rien de tout cela n'a sa place dans un courriel adressé à un
-- partenaire qui n'a pas encore accepté.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.proposition_pour_envoi(p_proposition_id uuid)
RETURNS TABLE (prestation text, date_mariage date, ville text,
               entreprise_destinataire_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pr.prestation, d.date_mariage,
         coalesce(d.ville, split_part(d.lieu, ',', 1)),
         pr.entreprise_destinataire_id
    FROM propositions pr
    JOIN demandes d ON d.id = pr.demande_id
   WHERE pr.id = p_proposition_id
     AND pr.envoyee_le IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.proposition_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.proposition_pour_envoi(uuid) TO jokswed_app;
