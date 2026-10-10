-- =============================================================================
-- 023 — AGRÉGATS FINANCIERS PAR ENTREPRISE
-- -----------------------------------------------------------------------------
-- ⚠️ TOUT PASSE PAR `app.exiger(entreprise, 'finance.lire')`.
--
-- Ces fonctions sont SECURITY DEFINER : sans contrôle explicite, elles
-- contourneraient la RLS et rendraient les chiffres de n'importe quelle
-- entreprise à qui en connaîtrait l'identifiant. L'autorisation est vérifiée
-- EN BASE, à l'entrée de chaque fonction, pas dans la page qui l'appelle.
-- =============================================================================

-- --- La base commune : un dossier commercial, ses quatre mesures ------------
-- Une VUE serait plus simple à lire, mais elle hériterait de la RLS de
-- l'appelant ; en fonction, on contrôle une fois et on calcule une fois.
--
-- ⚠️ DEUX FONCTIONS, ET C'EST VOULU.
--
-- `_finances_par_demande` CALCULE et ne contrôle rien ; elle n'est accordée à
-- AUCUN rôle et n'est appelable que depuis une autre fonction du schéma `app`.
-- `finances_par_demande` contrôle `finance.lire` puis délègue. Sans ce
-- découpage, un écran mixte — la saison des mariages, qui montre des dates à
-- tout le monde et des montants aux seuls autorisés — devrait soit lever pour
-- un collaborateur sans droit financier, soit recalculer la requête en double.
CREATE TYPE app.finance_demande AS (

  demande_id              uuid,
  reference               text,
  contact_nom             text,
  date_mariage            date,
  ville                   text,
  lieu                    text,
  formule_nom             text,
  statut                  text,
  contractualise_cents    integer,
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
  devis AS (
    SELECT doc.demande_id, max(doc.total_ttc_cents) AS total
      FROM documents doc
     WHERE doc.entreprise_id = p_entreprise_id AND doc.type = 'devis'
       AND doc.statut IN ('emis','envoye','accepte')
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
  -- EXIGIBLE : facturé dont l'échéance est passée. Une facture émise dont
  -- l'échéance est à venir n'est pas en retard — la confondre avec un impayé
  -- ferait relancer des clients qui n'ont rien à se reprocher.
  exig AS (
    SELECT doc.demande_id, sum(e.montant_cents) AS total
      FROM echeances e
      JOIN documents doc ON doc.id = e.document_id
     WHERE e.entreprise_id = p_entreprise_id
       AND e.statut <> 'annulee'
       AND e.du_le IS NOT NULL AND e.du_le <= current_date
       AND doc.statut NOT IN ('brouillon','annule')
     GROUP BY doc.demande_id
  )
  SELECT b.id, b.reference, b.contact_nom, b.date_mariage, b.ville, b.lieu,
         b.formule_nom, b.statut,
         coalesce(devis.total, 0)::integer,
         coalesce(fact.facture, 0)::integer,
         coalesce(fact.avoirs, 0)::integer,
         coalesce(pay.encaisse, 0)::integer,
         coalesce(pay.acomptes, 0)::integer,
         coalesce(pay.soldes, 0)::integer,
         coalesce(pay.rembourse, 0)::integer,
         coalesce(exig.total, 0)::integer,
         (coalesce(devis.total, 0) - coalesce(pay.encaisse, 0))::integer
    FROM base b
    LEFT JOIN devis ON devis.demande_id = b.id
    LEFT JOIN fact  ON fact.demande_id  = b.id
    LEFT JOIN pay   ON pay.demande_id   = b.id
    LEFT JOIN exig  ON exig.demande_id  = b.id;
END $$;
-- Aucun GRANT : `jokswed_app` ne peut pas l'appeler directement.
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

-- --- Le résumé d'une période -------------------------------------------------
CREATE OR REPLACE FUNCTION app.finances_resume(
  p_entreprise_id uuid, p_debut date, p_fin date)
RETURNS TABLE (
  encaisse_cents            integer,  -- réellement reçu sur la période
  acomptes_cents            integer,
  soldes_cents              integer,
  rembourse_cents           integer,
  facture_cents             integer,  -- factures ÉMISES sur la période
  contractualise_cents      integer,  -- devis acceptés sur la période
  attendu_cents             integer,  -- contractualisé non encore encaissé
  facture_non_regle_cents   integer,  -- facturé − encaissé, jamais négatif
  reserves_nb               integer,
  reserves_valeur_cents     integer,
  previsionnel_cents        integer)  -- échéances à venir, toutes périodes
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'finance.lire');
  RETURN QUERY
  WITH
  -- ENCAISSÉ : daté par `recu_le`, la date réelle du mouvement, et non par la
  -- date de saisie — on peut enregistrer en octobre un virement reçu en août.
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
  c AS (
    SELECT coalesce(sum(total_ttc_cents), 0) AS contractualise
      FROM documents
     WHERE entreprise_id = p_entreprise_id AND type = 'devis'
       AND statut IN ('emis','envoye','accepte')
       AND emis_le >= p_debut AND emis_le < (p_fin + 1)
  ),
  -- Les encours ne se bornent pas à la période : un solde dû est dû, quelle
  -- que soit la case du calendrier où on se trouve.
  -- ⚠️ ALIAS OBLIGATOIRE : les paramètres de SORTIE portent les mêmes noms que
  -- les colonnes de `finances_par_demande`, et plpgsql résout le paramètre
  -- avant la colonne. Sans `fd.`, « contractualise_cents is ambiguous ».
  encours AS (
    SELECT coalesce(sum(greatest(fd.contractualise_cents - fd.encaisse_cents, 0)), 0) AS attendu,
           coalesce(sum(greatest(fd.facture_cents - fd.avoirs_cents - fd.encaisse_cents, 0)), 0) AS impaye
      FROM app._finances_par_demande(p_entreprise_id) fd
  ),
  res AS (
    SELECT count(*)::integer AS nb,
           coalesce(sum(fd.contractualise_cents), 0) AS valeur
      FROM app._finances_par_demande(p_entreprise_id) fd
     WHERE fd.statut = 'confirmee'
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
         f.facture::integer, c.contractualise::integer,
         encours.attendu::integer, encours.impaye::integer,
         res.nb, res.valeur::integer, prev.total::integer
    FROM p, f, c, encours, res, prev;
END $$;
REVOKE ALL ON FUNCTION app.finances_resume(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_resume(uuid, date, date) TO jokswed_app;

-- --- Mois par mois -----------------------------------------------------------
CREATE OR REPLACE FUNCTION app.finances_mensuelles(
  p_entreprise_id uuid, p_debut date, p_fin date)
RETURNS TABLE (
  mois                 date,
  encaisse_cents       integer,
  facture_cents        integer,
  contractualise_cents integer,
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
    SELECT date_trunc('month', recu_le)::date AS m,
           sum(montant_signe_cents) AS total
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
  con AS (
    SELECT date_trunc('month', emis_le)::date AS m, sum(total_ttc_cents) AS total
      FROM documents
     WHERE entreprise_id = p_entreprise_id AND type = 'devis'
       AND statut IN ('emis','envoye','accepte') AND emis_le IS NOT NULL
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
         coalesce(con.total, 0)::integer, coalesce(pre.total, 0)::integer,
         coalesce(mar.n, 0)::integer
    FROM mois
    LEFT JOIN enc ON enc.m = mois.m
    LEFT JOIN fac ON fac.m = mois.m
    LEFT JOIN con ON con.m = mois.m
    LEFT JOIN pre ON pre.m = mois.m
    LEFT JOIN mar ON mar.m = mois.m
   ORDER BY mois.m;
END $$;
REVOKE ALL ON FUNCTION app.finances_mensuelles(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_mensuelles(uuid, date, date) TO jokswed_app;
