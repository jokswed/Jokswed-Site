-- =============================================================================
-- 039 — « ENGAGÉ » DOIT AUSSI COMPTER LES DOSSIERS
-- -----------------------------------------------------------------------------
-- Même défaut que celui corrigé au palier 031 pour les encours, à un autre
-- endroit : `finances_resume` tirait `propose` et `engage` des seules
-- DEMANDES. Une entreprise de collaborateur n'en reçoit aucune — ses devis
-- pendent à ses dossiers. Son tableau affichait donc 100 000 d'attendu et
-- 0 d'engagé : deux chiffres contradictoires, côte à côte.
--
-- Un devis de dossier n'a pas de statut « accepté » distinct aujourd'hui :
-- l'émettre, c'est l'avoir négocié avec le couple. Il compte donc comme
-- engagé dès l'émission — et le commentaire est là pour que, le jour où une
-- acceptation explicite existera, on sache quoi resserrer.
-- =============================================================================
DROP FUNCTION IF EXISTS app.finances_resume(uuid, date, date);
CREATE OR REPLACE FUNCTION app.finances_resume(
  p_entreprise_id uuid, p_debut date, p_fin date)
RETURNS TABLE (
  encaisse_cents            integer,
  acomptes_cents            integer,
  soldes_cents              integer,
  rembourse_cents           integer,
  facture_cents             integer,
  propose_cents             integer,
  engage_cents              integer,
  attendu_cents             integer,
  facture_non_regle_cents   integer,
  reserves_nb               integer,
  reserves_valeur_cents     integer,
  previsionnel_cents        integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'finance.lire');
  RETURN QUERY
  WITH
  p AS (
    SELECT coalesce(sum(montant_signe_cents), 0) AS encaisse,
           coalesce(sum(montant_cents) FILTER (WHERE type_paiement = 'acompte'), 0) AS acomptes,
           coalesce(sum(montant_cents) FILTER (WHERE type_paiement = 'solde'), 0) AS soldes,
           coalesce(sum(montant_cents) FILTER (WHERE type_paiement = 'remboursement'), 0) AS rembourse
      FROM paiements
     WHERE entreprise_id = p_entreprise_id AND statut = 'confirme'
       AND recu_le >= p_debut AND recu_le < p_fin
  ),
  f AS (
    SELECT coalesce(sum(total_ttc_cents) FILTER (WHERE type = 'facture'), 0)
           - coalesce(sum(total_ttc_cents) FILTER (WHERE type = 'avoir'), 0) AS facture
      FROM documents
     WHERE entreprise_id = p_entreprise_id AND type IN ('facture','avoir')
       AND statut NOT IN ('brouillon','annule')
       AND emis_le >= p_debut AND emis_le < (p_fin + 1)
  ),
  par_demande AS (
    SELECT coalesce(sum(fd.propose_cents), 0) AS propose,
           coalesce(sum(fd.engage_cents), 0)  AS engage
      FROM app._finances_par_demande(p_entreprise_id) fd
  ),
  par_dossier AS (
    SELECT coalesce(sum(d.total), 0) AS engage
      FROM dossiers ds
      LEFT JOIN LATERAL (
        SELECT max(x.total_ttc_cents) AS total FROM documents x
         WHERE x.dossier_id = ds.id AND x.type = 'devis'
           AND x.statut IN ('emis','envoye','accepte')) d ON true
     WHERE ds.entreprise_id = p_entreprise_id
  ),
  encours AS (SELECT * FROM app._encours_entreprise(p_entreprise_id)),
  res AS (
    SELECT count(*)::integer AS nb,
           coalesce(sum(fd.engage_cents), 0) AS valeur
      FROM app._finances_par_demande(p_entreprise_id) fd
     WHERE fd.niveau = 4
  ),
  prev AS (
    SELECT coalesce(sum(e.montant_cents), 0) AS total
      FROM echeances e
      JOIN documents doc ON doc.id = e.document_id
     WHERE e.entreprise_id = p_entreprise_id
       AND e.statut IN ('prevue','exigible')
       AND doc.statut NOT IN ('brouillon','annule')
  )
  SELECT p.encaisse::integer, p.acomptes::integer, p.soldes::integer, p.rembourse::integer,
         f.facture::integer,
         par_demande.propose::integer,
         (par_demande.engage + par_dossier.engage)::integer,
         encours.attendu_cents, encours.impaye_cents,
         res.nb, res.valeur::integer, prev.total::integer
    FROM p, f, par_demande, par_dossier, encours, res, prev;
END $$;
REVOKE ALL ON FUNCTION app.finances_resume(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_resume(uuid, date, date) TO jokswed_app;
