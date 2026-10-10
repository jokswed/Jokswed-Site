-- =============================================================================
-- 036 — UN DEVIS ENVOYÉ N'EST PAS UN ENGAGEMENT
-- -----------------------------------------------------------------------------
-- ⚠️ ERREUR DE CONCEPTION CORRIGÉE ICI.
--
-- `contractualise_cents` comptait tout devis ÉMIS. Un devis émis est une
-- proposition commerciale : le client ne l'a peut-être même pas ouvert. Le
-- confondre avec un engagement gonfle le carnet de commandes de dossiers qui
-- n'aboutiront jamais, et fausse toute projection de trésorerie.
--
-- On distingue donc quatre paliers, du moins au plus engageant :
--
--   1. PROPOSÉ   — un devis émis ou envoyé, sans réponse ;
--   2. ACCEPTÉ   — le devis porte le statut `accepte` ;
--   3. CONTRAT   — un contrat a été émis ;
--   4. RÉSERVÉ   — la demande est confirmée (mariage inscrit au carnet).
--
-- ENGAGÉ = palier ≥ 2. C'est ce chiffre qui pilote « attendu » et « reste à
-- percevoir » ; `propose_cents` reste visible, à part, comme ce qu'il est :
-- un espoir chiffré.
--
-- Le montant retenu est celui du dernier devis non annulé : accepter un
-- devis révisé ne doit pas additionner l'ancien et le nouveau.
-- =============================================================================

DROP FUNCTION IF EXISTS app.finances_par_demande(uuid);
DROP FUNCTION IF EXISTS app._finances_par_demande(uuid);
DROP TYPE IF EXISTS app.finance_demande;

CREATE TYPE app.finance_demande AS (
  demande_id              uuid,
  reference               text,
  contact_nom             text,
  date_mariage            date,
  ville                   text,
  lieu                    text,
  formule_nom             text,
  statut                  text,
  -- Les quatre paliers, chacun avec son montant.
  propose_cents           integer,
  accepte_cents           integer,
  contrat_cents           integer,
  reserve_cents           integer,
  -- Le palier atteint : 0 rien, 1 proposé, 2 accepté, 3 contrat, 4 réservé.
  niveau                  integer,
  engage_cents            integer,
  facture_cents           integer,
  avoirs_cents            integer,
  encaisse_cents          integer,
  acomptes_cents          integer,
  soldes_cents            integer,
  rembourse_cents         integer,
  exigible_cents          integer,
  solde_a_percevoir_cents integer);

CREATE OR REPLACE FUNCTION app._finances_par_demande(p_entreprise_id uuid)
RETURNS SETOF app.finance_demande
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT d.id, d.reference, d.contact_nom, d.date_mariage, d.ville, d.lieu,
           d.formule_nom, d.statut
      FROM demandes d
     WHERE d.entreprise_destinataire_id = p_entreprise_id
  ),
  -- Le DERNIER devis non annulé fait foi : un devis révisé remplace le
  -- précédent, il ne s'y ajoute pas.
  devis AS (
    SELECT DISTINCT ON (doc.demande_id)
           doc.demande_id, doc.total_ttc_cents AS total, doc.statut
      FROM documents doc
     WHERE doc.entreprise_id = p_entreprise_id AND doc.type = 'devis'
       AND doc.statut IN ('emis','envoye','accepte')
     ORDER BY doc.demande_id, doc.cree_le DESC
  ),
  contrat AS (
    SELECT doc.demande_id, max(doc.total_ttc_cents) AS total
      FROM documents doc
     WHERE doc.entreprise_id = p_entreprise_id AND doc.type = 'contrat'
       AND doc.statut NOT IN ('brouillon','annule')
     GROUP BY doc.demande_id
  ),
  fact AS (
    SELECT doc.demande_id,
           sum(doc.total_ttc_cents) FILTER (WHERE doc.type = 'facture') AS facture,
           sum(doc.total_ttc_cents) FILTER (WHERE doc.type = 'avoir')   AS avoirs
      FROM documents doc
     WHERE doc.entreprise_id = p_entreprise_id
       AND doc.type IN ('facture','avoir')
       AND doc.statut NOT IN ('brouillon','annule')
     GROUP BY doc.demande_id
  ),
  pay AS (
    SELECT p.demande_id,
           sum(p.montant_signe_cents) AS encaisse,
           sum(p.montant_cents) FILTER (WHERE p.type_paiement = 'acompte')       AS acomptes,
           sum(p.montant_cents) FILTER (WHERE p.type_paiement = 'solde')         AS soldes,
           sum(p.montant_cents) FILTER (WHERE p.type_paiement = 'remboursement') AS rembourse
      FROM paiements p
     WHERE p.entreprise_id = p_entreprise_id AND p.statut = 'confirme'
     GROUP BY p.demande_id
  ),
  exig AS (
    SELECT doc.demande_id, sum(e.montant_cents) AS total
      FROM echeances e
      JOIN documents doc ON doc.id = e.document_id
     WHERE e.entreprise_id = p_entreprise_id
       AND e.statut <> 'annulee'
       AND e.du_le IS NOT NULL AND e.du_le <= current_date
       AND doc.statut NOT IN ('brouillon','annule')
     GROUP BY doc.demande_id
  ),
  calcul AS (
    SELECT b.*,
           coalesce(devis.total, 0) AS devis_total,
           devis.statut AS devis_statut,
           coalesce(contrat.total, 0) AS contrat_total,
           coalesce(fact.facture, 0) AS facture,
           coalesce(fact.avoirs, 0) AS avoirs,
           coalesce(pay.encaisse, 0) AS encaisse,
           coalesce(pay.acomptes, 0) AS acomptes,
           coalesce(pay.soldes, 0) AS soldes,
           coalesce(pay.rembourse, 0) AS rembourse,
           coalesce(exig.total, 0) AS exigible
      FROM base b
      LEFT JOIN devis   ON devis.demande_id   = b.id
      LEFT JOIN contrat ON contrat.demande_id = b.id
      LEFT JOIN fact    ON fact.demande_id    = b.id
      LEFT JOIN pay     ON pay.demande_id     = b.id
      LEFT JOIN exig    ON exig.demande_id    = b.id
  ),
  paliers AS (
    SELECT c.*,
           CASE
             WHEN c.statut = 'confirmee'                 THEN 4
             WHEN c.contrat_total > 0                    THEN 3
             WHEN c.devis_statut = 'accepte'             THEN 2
             WHEN c.devis_total > 0                      THEN 1
             ELSE 0
           END AS niveau
      FROM calcul c
  )
  SELECT p.id, p.reference, p.contact_nom, p.date_mariage, p.ville, p.lieu,
         p.formule_nom, p.statut,
         CASE WHEN p.niveau = 1 THEN p.devis_total ELSE 0 END::integer,
         CASE WHEN p.niveau >= 2 THEN p.devis_total ELSE 0 END::integer,
         CASE WHEN p.niveau >= 3 THEN greatest(p.contrat_total, p.devis_total) ELSE 0 END::integer,
         CASE WHEN p.niveau = 4 THEN greatest(p.devis_total, p.contrat_total) ELSE 0 END::integer,
         p.niveau,
         -- ENGAGÉ : à partir du devis accepté. En dessous, rien n'est acquis.
         CASE WHEN p.niveau >= 2 THEN greatest(p.devis_total, p.contrat_total)
              ELSE 0 END::integer,
         p.facture::integer, p.avoirs::integer, p.encaisse::integer,
         p.acomptes::integer, p.soldes::integer, p.rembourse::integer,
         p.exigible::integer,
         CASE WHEN p.niveau >= 2
              THEN greatest(p.devis_total, p.contrat_total) - p.encaisse
              ELSE 0 END::integer
    FROM paliers p;
END $$;
REVOKE ALL ON FUNCTION app._finances_par_demande(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.finances_par_demande(p_entreprise_id uuid)
RETURNS SETOF app.finance_demande
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'finance.lire');
  RETURN QUERY SELECT * FROM app._finances_par_demande(p_entreprise_id);
END $$;
REVOKE ALL ON FUNCTION app.finances_par_demande(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_par_demande(uuid) TO jokswed_app;

-- --- Les encours suivent le même principe -----------------------------------
CREATE OR REPLACE FUNCTION app._encours_entreprise(p_entreprise_id uuid)
RETURNS TABLE (attendu_cents integer, impaye_cents integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH par_demande AS (
    -- ⚠️ `engage_cents`, PAS `propose_cents` : on n'attend pas l'argent d'un
    -- devis que personne n'a accepté.
    SELECT greatest(fd.engage_cents - fd.encaisse_cents, 0) AS attendu,
           greatest(fd.facture_cents - fd.avoirs_cents - fd.encaisse_cents, 0) AS impaye
      FROM app._finances_par_demande(p_entreprise_id) fd
  ),
  par_dossier AS (
    SELECT greatest(coalesce(d.total, 0) - coalesce(p.total, 0), 0) AS attendu,
           greatest(coalesce(fa.total, 0) - coalesce(av.total, 0) - coalesce(p.total, 0), 0) AS impaye
      FROM dossiers ds
      LEFT JOIN LATERAL (
        SELECT max(x.total_ttc_cents) AS total FROM documents x
         WHERE x.dossier_id = ds.id AND x.type = 'devis'
           AND x.statut IN ('emis','envoye','accepte')) d ON true
      LEFT JOIN LATERAL (
        SELECT sum(x.total_ttc_cents) AS total FROM documents x
         WHERE x.dossier_id = ds.id AND x.type = 'facture'
           AND x.statut NOT IN ('brouillon','annule')) fa ON true
      LEFT JOIN LATERAL (
        SELECT sum(x.total_ttc_cents) AS total FROM documents x
         WHERE x.dossier_id = ds.id AND x.type = 'avoir'
           AND x.statut NOT IN ('brouillon','annule')) av ON true
      LEFT JOIN LATERAL (
        SELECT sum(y.montant_signe_cents) AS total FROM paiements y
         WHERE y.dossier_id = ds.id AND y.statut = 'confirme') p ON true
     WHERE ds.entreprise_id = p_entreprise_id
  ),
  tout AS (SELECT * FROM par_demande UNION ALL SELECT * FROM par_dossier)
  SELECT coalesce(sum(attendu), 0)::integer, coalesce(sum(impaye), 0)::integer FROM tout
$$;
REVOKE ALL ON FUNCTION app._encours_entreprise(uuid) FROM PUBLIC;

-- --- Le résumé expose les paliers -------------------------------------------
DROP FUNCTION IF EXISTS app.finances_resume(uuid, date, date);
CREATE OR REPLACE FUNCTION app.finances_resume(
  p_entreprise_id uuid, p_debut date, p_fin date)
RETURNS TABLE (
  encaisse_cents            integer,
  acomptes_cents            integer,
  soldes_cents              integer,
  rembourse_cents           integer,
  facture_cents             integer,
  -- ⚠️ DEUX CHIFFRES LÀ OÙ IL N'Y EN AVAIT QU'UN.
  propose_cents             integer,  -- devis émis, sans réponse du client
  engage_cents              integer,  -- devis accepté, contrat, ou réservation
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
  niveaux AS (
    SELECT coalesce(sum(fd.propose_cents), 0) AS propose,
           coalesce(sum(fd.engage_cents), 0)  AS engage
      FROM app._finances_par_demande(p_entreprise_id) fd
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
         f.facture::integer, niveaux.propose::integer, niveaux.engage::integer,
         encours.attendu_cents, encours.impaye_cents,
         res.nb, res.valeur::integer, prev.total::integer
    FROM p, f, niveaux, encours, res, prev;
END $$;
REVOKE ALL ON FUNCTION app.finances_resume(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_resume(uuid, date, date) TO jokswed_app;

-- --- La série mensuelle sépare proposé et engagé ----------------------------
DROP FUNCTION IF EXISTS app.finances_mensuelles(uuid, date, date);
CREATE OR REPLACE FUNCTION app.finances_mensuelles(
  p_entreprise_id uuid, p_debut date, p_fin date)
RETURNS TABLE (
  mois                 date,
  encaisse_cents       integer,
  facture_cents        integer,
  engage_cents         integer,
  previsionnel_cents   integer,
  mariages_nb          integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'finance.lire');
  RETURN QUERY
  WITH mois AS (
    SELECT generate_series(date_trunc('month', p_debut),
                           date_trunc('month', p_fin - 1), interval '1 month')::date AS m
  ),
  enc AS (
    SELECT date_trunc('month', recu_le)::date AS m, sum(montant_signe_cents) AS total
      FROM paiements
     WHERE entreprise_id = p_entreprise_id AND statut = 'confirme'
     GROUP BY 1
  ),
  fac AS (
    SELECT date_trunc('month', emis_le)::date AS m,
           sum(total_ttc_cents) FILTER (WHERE type = 'facture')
           - coalesce(sum(total_ttc_cents) FILTER (WHERE type = 'avoir'), 0) AS total
      FROM documents
     WHERE entreprise_id = p_entreprise_id AND type IN ('facture','avoir')
       AND statut NOT IN ('brouillon','annule') AND emis_le IS NOT NULL
     GROUP BY 1
  ),
  -- ⚠️ ENGAGÉ, PAS « TOUT DEVIS ÉMIS ». Daté au mois du devis ACCEPTÉ, ou du
  -- contrat quand il existe : c'est la date où l'affaire est entrée.
  eng AS (
    SELECT date_trunc('month', doc.emis_le)::date AS m, sum(doc.total_ttc_cents) AS total
      FROM documents doc
     WHERE doc.entreprise_id = p_entreprise_id AND doc.emis_le IS NOT NULL
       AND ((doc.type = 'devis' AND doc.statut = 'accepte')
            OR (doc.type = 'contrat' AND doc.statut NOT IN ('brouillon','annule')))
     GROUP BY 1
  ),
  pre AS (
    SELECT date_trunc('month', e.du_le)::date AS m, sum(e.montant_cents) AS total
      FROM echeances e
      JOIN documents doc ON doc.id = e.document_id
     WHERE e.entreprise_id = p_entreprise_id AND e.statut IN ('prevue','exigible')
       AND e.du_le IS NOT NULL AND doc.statut NOT IN ('brouillon','annule')
     GROUP BY 1
  ),
  mar AS (
    SELECT date_trunc('month', date_mariage)::date AS m, count(*) AS n
      FROM demandes
     WHERE entreprise_destinataire_id = p_entreprise_id
       AND statut = 'confirmee' AND date_mariage IS NOT NULL
     GROUP BY 1
  )
  SELECT mois.m,
         coalesce(enc.total, 0)::integer, coalesce(fac.total, 0)::integer,
         coalesce(eng.total, 0)::integer, coalesce(pre.total, 0)::integer,
         coalesce(mar.n, 0)::integer
    FROM mois
    LEFT JOIN enc ON enc.m = mois.m
    LEFT JOIN fac ON fac.m = mois.m
    LEFT JOIN eng ON eng.m = mois.m
    LEFT JOIN pre ON pre.m = mois.m
    LEFT JOIN mar ON mar.m = mois.m
   ORDER BY mois.m;
END $$;
REVOKE ALL ON FUNCTION app.finances_mensuelles(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_mensuelles(uuid, date, date) TO jokswed_app;
