-- =============================================================================
-- 033 — UN BROUILLON N'EST PAS UN MONTANT DÛ
-- -----------------------------------------------------------------------------
-- `mes_dossiers` prenait le dernier devis du dossier, quel que soit son
-- statut, et en tirait « Devis » et « Reste ». Un simple brouillon affichait
-- donc 2 000 € de reste à percevoir — alors que rien n'a été ni signé ni
-- même émis. Les montants ne comptent plus que les devis ÉMIS ; le brouillon
-- reste visible, comme brouillon.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.mes_dossiers(p_entreprise_id uuid)
RETURNS TABLE (
  dossier_id uuid, reference text, prestation text, statut text,
  mariage_id uuid, date_mariage date, ville text,
  coordonnees_partagees boolean, contact_nom text, contact_email citext,
  contact_telephone text,
  devis_id uuid, devis_numero text, devis_statut text,
  total_cents integer, encaisse_cents integer, reste_du_cents integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'dossier.lire');
  RETURN QUERY
  WITH partage AS (
    SELECT pm.mariage_id AS partage_id FROM partages_mariage pm
     WHERE pm.entreprise_id = p_entreprise_id
       AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL
  ),
  -- Le devis À MONTRER : le plus récent, brouillon compris.
  dev AS (
    SELECT DISTINCT ON (d.dossier_id) d.dossier_id, d.id, d.numero, d.statut
      FROM documents d
     WHERE d.entreprise_id = p_entreprise_id AND d.type = 'devis'
       AND d.dossier_id IS NOT NULL
     ORDER BY d.dossier_id, d.cree_le DESC
  ),
  -- Le devis QUI COMPTE : seul un devis émis engage un montant.
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
         coalesce(engage.total, 0)::integer,
         coalesce(enc.total, 0)::integer,
         (coalesce(engage.total, 0) - coalesce(enc.total, 0))::integer
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
