-- =============================================================================
-- 037 — UN MONTANT INTERDIT VAUT « — », PAS « 0 € »
-- -----------------------------------------------------------------------------
-- ⚠️ ZÉRO EST UNE INFORMATION, ET ELLE ÉTAIT FAUSSE.
--
-- La saison rendait 0 € aux collaborateurs sans `finance.lire`. Un zéro
-- laisse croire que le mariage ne rapporte rien — c'est une affirmation,
-- alors qu'on voulait un silence. On rend donc NULL, que l'interface affiche
-- « — ». Et NULL n'est pas un masquage de façade : la valeur ne quitte pas
-- PostgreSQL, donc elle n'atteint ni le serveur Next, ni le navigateur, ni
-- le code source de la page.
-- =============================================================================

DROP FUNCTION IF EXISTS app.saison_mariages(uuid, date, date, text, uuid);
CREATE OR REPLACE FUNCTION app.saison_mariages(
  p_entreprise_id uuid, p_debut date, p_fin date,
  p_statut text DEFAULT NULL, p_collaborateur uuid DEFAULT NULL)
RETURNS TABLE (
  demande_id           uuid,
  mariage_id           uuid,
  reference            text,
  date_mariage         date,
  contact_nom          text,
  ville                text,
  lieu                 text,
  formule_nom          text,
  statut               text,
  -- ⚠️ NULLABLE : NULL = « vous n'avez pas accès », 0 = « rien ».
  total_cents          integer,
  total_contractualise boolean,
  niveau               integer,
  acompte_cents        integer,
  encaisse_cents       integer,
  solde_restant_cents  integer,
  montants_masques     boolean,
  devis_numero         text,
  contrat_emis         boolean,
  factures_nb          integer,
  equipe               text[],
  videaste             text,
  videaste_statut      text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_voit_finances boolean;
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'dossier.lire');
  v_voit_finances := EXISTS (
    SELECT 1 FROM app.permissions_effectives(p_entreprise_id)
     WHERE permission_cle = 'finance.lire');

  RETURN QUERY
  WITH fin AS (
    SELECT * FROM app._finances_par_demande(p_entreprise_id) WHERE v_voit_finances
  ),
  docs AS (
    SELECT d.demande_id,
           max(d.numero) FILTER (WHERE d.type = 'devis' AND d.statut <> 'brouillon') AS devis_num,
           bool_or(d.type = 'contrat' AND d.statut <> 'brouillon') AS contrat,
           count(*) FILTER (WHERE d.type = 'facture' AND d.statut <> 'brouillon')::integer AS nb_fact
      FROM documents d
     WHERE d.entreprise_id = p_entreprise_id
     GROUP BY d.demande_id
  ),
  eq AS (
    SELECT a.dossier_id,
           array_agg(coalesce(u.prenom || ' ' || u.nom, u.email::text)
                     ORDER BY u.nom) AS noms,
           array_agg(a.utilisateur_id) AS ids
      FROM affectations a
      JOIN utilisateurs u ON u.id = a.utilisateur_id
     WHERE a.entreprise_id = p_entreprise_id AND a.retiree_le IS NULL
     GROUP BY a.dossier_id
  ),
  vid AS (
    SELECT pr.demande_id, e.nom_commercial, pr.statut
      FROM propositions pr
      JOIN entreprises e ON e.id = pr.entreprise_destinataire_id
     WHERE pr.entreprise_emettrice_id = p_entreprise_id
       AND pr.prestation = 'video'
       AND pr.statut <> 'annulee'
  )
  SELECT dm.id, dm.mariage_id, dm.reference, dm.date_mariage, dm.contact_nom,
         dm.ville, dm.lieu, dm.formule_nom, dm.statut,
         CASE WHEN v_voit_finances
              THEN coalesce(nullif(fin.engage_cents, 0),
                            nullif(fin.propose_cents, 0),
                            dm.formule_prix_cents, 0)
              ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.engage_cents, 0) > 0 ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.niveau, 0) ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.acomptes_cents, 0) ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.encaisse_cents, 0) ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.solde_a_percevoir_cents, 0) ELSE NULL END,
         NOT v_voit_finances,
         docs.devis_num, coalesce(docs.contrat, false), coalesce(docs.nb_fact, 0),
         coalesce(eq.noms, '{}'::text[]),
         vid.nom_commercial, vid.statut
    FROM demandes dm
    LEFT JOIN fin  ON fin.demande_id = dm.id
    LEFT JOIN docs ON docs.demande_id = dm.id
    LEFT JOIN eq   ON eq.dossier_id = dm.dossier_id
    LEFT JOIN vid  ON vid.demande_id = dm.id
   WHERE dm.entreprise_destinataire_id = p_entreprise_id
     AND dm.date_mariage IS NOT NULL
     AND dm.date_mariage >= p_debut AND dm.date_mariage < p_fin
     AND (p_statut IS NULL OR dm.statut = p_statut)
     AND (p_collaborateur IS NULL OR p_collaborateur = ANY (coalesce(eq.ids, '{}'::uuid[])))
   ORDER BY dm.date_mariage;
END $$;
REVOKE ALL ON FUNCTION app.saison_mariages(uuid, date, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.saison_mariages(uuid, date, date, text, uuid) TO jokswed_app;

-- Même règle pour l'écran des dossiers d'un collaborateur.
DROP FUNCTION IF EXISTS app.mes_dossiers(uuid);
CREATE OR REPLACE FUNCTION app.mes_dossiers(p_entreprise_id uuid)
RETURNS TABLE (
  dossier_id uuid, reference text, prestation text, statut text,
  mariage_id uuid, date_mariage date, ville text,
  coordonnees_partagees boolean, contact_nom text, contact_email citext,
  contact_telephone text,
  devis_id uuid, devis_numero text, devis_statut text,
  total_cents integer, encaisse_cents integer, reste_du_cents integer,
  montants_masques boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_voit_finances boolean;
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'dossier.lire');
  v_voit_finances := EXISTS (
    SELECT 1 FROM app.permissions_effectives(p_entreprise_id)
     WHERE permission_cle = 'finance.lire');

  RETURN QUERY
  WITH partage AS (
    SELECT pm.mariage_id AS partage_id FROM partages_mariage pm
     WHERE pm.entreprise_id = p_entreprise_id
       AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL
  ),
  dev AS (
    SELECT DISTINCT ON (d.dossier_id) d.dossier_id, d.id, d.numero, d.statut
      FROM documents d
     WHERE d.entreprise_id = p_entreprise_id AND d.type = 'devis'
       AND d.dossier_id IS NOT NULL
     ORDER BY d.dossier_id, d.cree_le DESC
  ),
  engage AS (
    SELECT d.dossier_id, max(d.total_ttc_cents) AS total
      FROM documents d
     WHERE d.entreprise_id = p_entreprise_id AND d.type = 'devis'
       AND d.dossier_id IS NOT NULL
       AND d.statut IN ('emis','envoye','accepte')
     GROUP BY d.dossier_id
  ),
  enc AS (
    SELECT p.dossier_id, sum(p.montant_signe_cents) AS total
      FROM paiements p
     WHERE p.entreprise_id = p_entreprise_id AND p.statut = 'confirme'
       AND p.dossier_id IS NOT NULL
     GROUP BY p.dossier_id
  )
  SELECT ds.id, ds.reference, ds.prestation, ds.statut,
         m.id, m.date_mariage, m.ville,
         (m.id IN (SELECT partage_id FROM partage)),
         CASE WHEN m.id IN (SELECT partage_id FROM partage) THEN c.prenom END,
         CASE WHEN m.id IN (SELECT partage_id FROM partage) THEN c.email END,
         CASE WHEN m.id IN (SELECT partage_id FROM partage) THEN c.telephone END,
         dev.id, dev.numero, dev.statut,
         CASE WHEN v_voit_finances THEN coalesce(engage.total, 0)::integer END,
         CASE WHEN v_voit_finances THEN coalesce(enc.total, 0)::integer END,
         CASE WHEN v_voit_finances
              THEN (coalesce(engage.total, 0) - coalesce(enc.total, 0))::integer END,
         NOT v_voit_finances
    FROM dossiers ds
    JOIN mariages m ON m.id = ds.mariage_id
    LEFT JOIN contacts c ON c.mariage_id = m.id AND c.principal
    LEFT JOIN dev ON dev.dossier_id = ds.id
    LEFT JOIN engage ON engage.dossier_id = ds.id
    LEFT JOIN enc ON enc.dossier_id = ds.id
   WHERE ds.entreprise_id = p_entreprise_id
   ORDER BY m.date_mariage NULLS LAST;
END $$;
REVOKE ALL ON FUNCTION app.mes_dossiers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mes_dossiers(uuid) TO jokswed_app;
