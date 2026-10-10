-- =============================================================================
-- 054 — LE DÉCLENCHEUR DES MODÈLES BUTAIT SUR SA PROPRE POLITIQUE
-- -----------------------------------------------------------------------------
-- Créer une entreprise déclenche l'installation de ses modèles de réponse
-- (palier 045). Mais la politique de `modeles_reponse` exige
-- `message.envoyer` sur cette entreprise — permission que personne ne
-- détient à la milliseconde où elle vient d'être créée. L'INSERT dans
-- `entreprises` réussissait donc, et le déclencheur le faisait échouer.
--
-- Même règle que pour les rôles au palier 052, et elle se referme seule :
-- une entreprise SANS MEMBRE ACTIF est une entreprise en amorçage.
-- =============================================================================
DROP POLICY IF EXISTS modele_tenant ON modeles_reponse;
CREATE POLICY modele_tenant ON modeles_reponse
  USING (entreprise_id IS NULL
         OR entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (
    (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
     AND app.acteur_porte(entreprise_id, ARRAY['message.envoyer']))
    OR (entreprise_id IS NOT NULL AND app.entreprise_sans_membre(entreprise_id)));
