-- =============================================================================
-- 034 — LA RLS NE DOIT PAS S'ARRÊTER AU CLOISONNEMENT PAR ENTREPRISE
-- -----------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ EN AUDITANT LE RÔLE `parrain`.
--
-- Toutes les politiques métier disaient la même chose : « cette ligne
-- appartient-elle à une entreprise dont l'acteur est membre ? ». C'est
-- nécessaire, mais insuffisant. Un membre SANS `finance.lire` pouvait, par
-- une requête SQL directe sous `jokswed_app`, lire `paiements` et `documents`
-- de son entreprise. L'interface le lui refusait ; la base, non.
--
-- Le cas du parrain le rend criant : il est membre de l'entreprise de son
-- partenaire pour pouvoir l'inviter, et il n'a aucune raison d'en voir les
-- documents ni les comptes.
--
-- ⚠️ POLITIQUES RESTRICTIVES, PAS PERMISSIVES.
-- Les politiques permissives s'additionnent par OU : en ajouter une
-- ÉLARGIRAIT l'accès. `AS RESTRICTIVE` se combine par ET : la ligne doit
-- satisfaire le cloisonnement ET porter la permission. C'est la seule forme
-- qui resserre.
--
-- ⚠️ ELLES S'APPLIQUENT AUSSI AUX FONCTIONS `SECURITY DEFINER`.
-- Ces tables sont en `FORCE ROW LEVEL SECURITY` : le propriétaire y est
-- soumis comme les autres. Une fonction qui lit `documents` pour le compte
-- d'un acteur sans aucun droit documentaire ne verra donc rien — ce qui est
-- exactement ce qu'on veut, mais explique pourquoi les listes de permissions
-- ci-dessous sont des UNIONS : il faut couvrir tous les verbes légitimes.
-- =============================================================================

-- Petit utilitaire : l'acteur courant porte-t-il l'une de ces permissions ?
-- STABLE et SECURITY DEFINER, comme `permissions_de`, qu'elle ne fait
-- qu'envelopper pour alléger les politiques.
CREATE OR REPLACE FUNCTION app.acteur_porte(p_entreprise uuid, p_permissions text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.permissions_de(app.acteur(), p_entreprise) && p_permissions
$$;
REVOKE ALL ON FUNCTION app.acteur_porte(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.acteur_porte(uuid, text[]) TO jokswed_app;

-- --- Documents et leurs satellites ------------------------------------------
CREATE POLICY document_permission ON documents AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id,
    ARRAY['document.lire','document.rediger','document.emettre','document.envoyer']))
  WITH CHECK (app.acteur_porte(entreprise_id,
    ARRAY['document.rediger','document.emettre']));

CREATE POLICY ligne_doc_permission ON document_lignes AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id,
    ARRAY['document.lire','document.rediger','document.emettre','document.envoyer']))
  WITH CHECK (app.acteur_porte(entreprise_id,
    ARRAY['document.rediger','document.emettre']));

CREATE POLICY signature_permission ON signatures AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id,
    ARRAY['document.lire','document.rediger','document.emettre','document.envoyer']))
  WITH CHECK (app.acteur_porte(entreprise_id, ARRAY['document.emettre']));

-- Les échéances sont à la fois documentaires et financières : l'un ou l'autre
-- suffit à les lire, puisqu'elles figurent sur le devis que le client reçoit.
CREATE POLICY echeance_permission ON echeances AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id,
    ARRAY['document.lire','document.rediger','document.emettre','document.envoyer',
          'finance.lire']))
  WITH CHECK (app.acteur_porte(entreprise_id,
    ARRAY['document.rediger','document.emettre']));

-- --- Paiements ----------------------------------------------------------------
CREATE POLICY paiement_permission ON paiements AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id,
    ARRAY['finance.lire','finance.saisir_paiement','finance.confirmer_paiement',
          'finance.rembourser']))
  WITH CHECK (app.acteur_porte(entreprise_id,
    ARRAY['finance.saisir_paiement','finance.confirmer_paiement','finance.rembourser']));

-- --- Dossiers et demandes -----------------------------------------------------
CREATE POLICY dossier_permission ON dossiers AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id, ARRAY['dossier.lire','dossier.ecrire']))
  WITH CHECK (app.acteur_porte(entreprise_id, ARRAY['dossier.ecrire']));

CREATE POLICY demande_permission ON demandes AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_destinataire_id,
    ARRAY['dossier.lire','dossier.ecrire']))
  WITH CHECK (app.acteur_porte(entreprise_destinataire_id, ARRAY['dossier.ecrire']));

-- --- Informations fiscales ----------------------------------------------------
-- ⚠️ LA LECTURE RESTE OUVERTE AUX MEMBRES : la mention de TVA figure sur
-- chaque document que le client reçoit, elle n'a rien de confidentiel. C'est
-- l'ÉCRITURE qui change le visage fiscal de l'entreprise, et elle exige
-- `entreprise.reglages` — que le parrain n'a pas.
CREATE POLICY regime_ecriture ON regimes_tva AS RESTRICTIVE
  FOR INSERT WITH CHECK (app.acteur_porte(entreprise_id, ARRAY['entreprise.reglages']));
CREATE POLICY regime_maj ON regimes_tva AS RESTRICTIVE
  FOR UPDATE USING (app.acteur_porte(entreprise_id, ARRAY['entreprise.reglages']))
             WITH CHECK (app.acteur_porte(entreprise_id, ARRAY['entreprise.reglages']));
CREATE POLICY regime_suppression ON regimes_tva AS RESTRICTIVE
  FOR DELETE USING (app.acteur_porte(entreprise_id, ARRAY['entreprise.reglages']));

CREATE POLICY entreprise_maj_permission ON entreprises AS RESTRICTIVE
  FOR UPDATE USING (app.acteur_porte(id, ARRAY['entreprise.reglages']))
             WITH CHECK (app.acteur_porte(id, ARRAY['entreprise.reglages']));
