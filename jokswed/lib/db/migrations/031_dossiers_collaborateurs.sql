-- =============================================================================
-- 031 — UN COLLABORATEUR FACTURE SES PROPRES PRESTATIONS
-- -----------------------------------------------------------------------------
-- Jusqu'ici tout le commercial pendait à une DEMANDE, c'est-à-dire à une
-- soumission du formulaire public de JoksWed. Le vidéaste, lui, n'en reçoit
-- aucune : il a un DOSSIER, créé quand il accepte une proposition. Ses
-- documents et ses paiements doivent donc pouvoir s'accrocher là.
--
-- ⚠️ CE N'EST PAS UNE DÉROGATION AU CLOISONNEMENT, C'EN EST LE PROLONGEMENT.
-- Son dossier est à lui, sa numérotation est à elle, ses montants ne sont
-- additionnés à ceux de personne. Le mariage est commun ; les dossiers
-- commerciaux ne le sont jamais.
-- =============================================================================

ALTER TABLE paiements
  ADD COLUMN dossier_id uuid REFERENCES dossiers(id) ON DELETE RESTRICT;
CREATE INDEX paiements_dossier ON paiements (dossier_id, statut);

-- Un mouvement s'accroche à UNE chose : une demande ou un dossier, pas les
-- deux, et jamais aucune des deux.
ALTER TABLE paiements ADD CONSTRAINT paiement_a_un_ancrage
  CHECK (num_nonnulls(demande_id, dossier_id) = 1);

-- -----------------------------------------------------------------------------
-- LA SITUATION D'UN DEVIS, QUEL QUE SOIT SON ANCRAGE
-- -----------------------------------------------------------------------------
-- `situation_financiere(demande)` reste pour les écrans de JoksWed. Celle-ci
-- part du DEVIS et suit son ancrage, ce qui la rend utilisable des deux côtés.
CREATE OR REPLACE FUNCTION app.situation_devis(p_devis_id uuid)
RETURNS TABLE (
  total_prestation_cents integer,
  facture_cents          integer,
  avoirs_cents           integer,
  encaisse_cents         integer,
  reste_du_cents         integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD;
BEGIN
  SELECT * INTO v_d FROM documents WHERE id = p_devis_id;
  IF v_d IS NULL THEN RETURN; END IF;

  IF v_d.demande_id IS NOT NULL THEN
    RETURN QUERY SELECT * FROM app.situation_financiere(v_d.demande_id);
    RETURN;
  END IF;

  RETURN QUERY
  WITH devis AS (
    SELECT coalesce(max(d.total_ttc_cents), 0) AS total FROM documents d
     WHERE d.dossier_id = v_d.dossier_id AND d.type = 'devis'
       AND d.statut IN ('emis','envoye','accepte')
  ),
  factures AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total FROM documents d
     WHERE d.dossier_id = v_d.dossier_id AND d.type = 'facture'
       AND d.statut NOT IN ('brouillon','annule')
  ),
  avoirs AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total FROM documents d
     WHERE d.dossier_id = v_d.dossier_id AND d.type = 'avoir'
       AND d.statut NOT IN ('brouillon','annule')
  ),
  encaisse AS (
    SELECT coalesce(sum(p.montant_signe_cents), 0) AS total FROM paiements p
     WHERE p.dossier_id = v_d.dossier_id AND p.statut = 'confirme'
  )
  /* ⚠️ CASTS EXPLICITES : `sum()` rend un bigint, et les paramètres de
     sortie sont des integer. Sans cela, « structure of query does not match
     function result type » — une erreur qui ne dit pas quelle colonne. */
  SELECT devis.total::integer, factures.total::integer, avoirs.total::integer,
         encaisse.total::integer, (devis.total - encaisse.total)::integer
    FROM devis, factures, avoirs, encaisse;
END $$;
REVOKE ALL ON FUNCTION app.situation_devis(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.situation_devis(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- CE QU'UN COLLABORATEUR VOIT DE SES DOSSIERS
-- -----------------------------------------------------------------------------
-- ⚠️ LES COORDONNÉES DU COUPLE NE SORTENT QUE SI ELLES SONT PARTAGÉES.
-- Même règle que pour les propositions : c'est le pilote du mariage qui
-- décide, par un geste explicite et réversible.
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
  -- ⚠️ `partage_id` ET PAS `mariage_id` : le paramètre de SORTIE porte déjà
  -- ce nom, et plpgsql le résout avant la colonne du CTE.
  WITH partage AS (
    SELECT pm.mariage_id AS partage_id FROM partages_mariage pm
     WHERE pm.entreprise_id = p_entreprise_id
       AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL
  ),
  dev AS (
    SELECT DISTINCT ON (d.dossier_id) d.dossier_id, d.id, d.numero, d.statut,
           d.total_ttc_cents
      FROM documents d
     WHERE d.entreprise_id = p_entreprise_id AND d.type = 'devis'
       AND d.dossier_id IS NOT NULL
     ORDER BY d.dossier_id, d.cree_le DESC
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
         coalesce(dev.total_ttc_cents, 0)::integer,
         coalesce(enc.total, 0)::integer,
         (coalesce(dev.total_ttc_cents, 0) - coalesce(enc.total, 0))::integer
    FROM dossiers ds
    JOIN mariages m ON m.id = ds.mariage_id
    LEFT JOIN contacts c ON c.mariage_id = m.id AND c.principal
    LEFT JOIN dev ON dev.dossier_id = ds.id
    LEFT JOIN enc ON enc.dossier_id = ds.id
   WHERE ds.entreprise_id = p_entreprise_id
   ORDER BY m.date_mariage NULLS LAST;
END $$;
REVOKE ALL ON FUNCTION app.mes_dossiers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mes_dossiers(uuid) TO jokswed_app;

/* Le contexte d'un dossier pour composer un document : ce que le
   collaborateur a le droit de faire figurer sur SON devis. */
CREATE OR REPLACE FUNCTION app.contexte_dossier(p_dossier_id uuid)
RETURNS TABLE (
  entreprise_id uuid, reference text, prestation text,
  date_mariage date, ville text, lieu text,
  contact_nom text, contact_email citext, contact_telephone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid; v_partage boolean;
BEGIN
  SELECT d.entreprise_id INTO v_ent FROM dossiers d WHERE d.id = p_dossier_id;
  IF v_ent IS NULL THEN RETURN; END IF;
  PERFORM app.exiger(v_ent, 'document.rediger');

  SELECT EXISTS (SELECT 1 FROM partages_mariage pm
                   JOIN dossiers d2 ON d2.mariage_id = pm.mariage_id
                  WHERE d2.id = p_dossier_id AND pm.entreprise_id = v_ent
                    AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL)
    INTO v_partage;

  RETURN QUERY
  SELECT ds.entreprise_id, ds.reference, ds.prestation,
         m.date_mariage, m.ville,
         coalesce(dm.lieu, m.ville),
         CASE WHEN v_partage THEN c.prenom END,
         CASE WHEN v_partage THEN c.email END,
         CASE WHEN v_partage THEN c.telephone END
    FROM dossiers ds
    JOIN mariages m ON m.id = ds.mariage_id
    LEFT JOIN contacts c ON c.mariage_id = m.id AND c.principal
    LEFT JOIN demandes dm ON dm.mariage_id = m.id
   WHERE ds.id = p_dossier_id
   LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION app.contexte_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.contexte_dossier(uuid) TO jokswed_app;

/* Saisir un paiement sur SON dossier. Symétrique d'`enregistrer_paiement`,
   mais ancré au dossier : le collaborateur n'a aucun accès aux demandes. */
CREATE OR REPLACE FUNCTION app.enregistrer_paiement_dossier(
  p_dossier_id uuid, p_montant_cents integer, p_moyen text, p_type text,
  p_reference text, p_recu_le date, p_cle text, p_motif text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid; v_acteur uuid; v_id uuid;
BEGIN
  SELECT d.entreprise_id INTO v_ent FROM dossiers d WHERE d.id = p_dossier_id;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'dossier introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_type = 'remboursement' THEN
    v_acteur := app.exiger(v_ent, 'finance.rembourser');
  ELSE
    v_acteur := app.exiger(v_ent, 'finance.saisir_paiement');
  END IF;

  INSERT INTO paiements (entreprise_id, dossier_id, montant_cents, moyen, type_paiement,
                         reference, recu_le, saisi_par, cle_idempotence, motif)
  VALUES (v_ent, p_dossier_id, p_montant_cents, p_moyen, coalesce(p_type, 'partiel'),
          p_reference, coalesce(p_recu_le, current_date), v_acteur, p_cle, p_motif)
  ON CONFLICT (entreprise_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                               ressource_id, apres)
    VALUES (v_acteur, v_ent, 'paiement.saisi', 'dossier', p_dossier_id::text,
            jsonb_build_object('montant_cents', p_montant_cents,
                               'type', coalesce(p_type, 'partiel')));
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.enregistrer_paiement_dossier(uuid, integer, text, text, text, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enregistrer_paiement_dossier(uuid, integer, text, text, text, date, text, text) TO jokswed_app;

/* La confirmation d'un paiement de dossier : même garde-fou de plafond. */
CREATE OR REPLACE FUNCTION app.confirmer_paiement(p_paiement_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid; v_total integer; v_encaisse integer;
BEGIN
  SELECT * INTO v_p FROM paiements WHERE id = p_paiement_id;
  IF v_p IS NULL OR v_p.statut <> 'declare' THEN RETURN false; END IF;
  IF v_p.type_paiement = 'remboursement' THEN
    v_acteur := app.exiger(v_p.entreprise_id, 'finance.rembourser');
  ELSE
    v_acteur := app.exiger(v_p.entreprise_id, 'finance.confirmer_paiement');
  END IF;

  IF v_p.demande_id IS NOT NULL THEN
    SELECT s.total_prestation_cents, s.encaisse_cents INTO v_total, v_encaisse
      FROM app.situation_financiere(v_p.demande_id) s;
  ELSE
    SELECT coalesce(max(d.total_ttc_cents), 0) INTO v_total FROM documents d
     WHERE d.dossier_id = v_p.dossier_id AND d.type = 'devis'
       AND d.statut IN ('emis','envoye','accepte');
    SELECT coalesce(sum(p.montant_signe_cents), 0) INTO v_encaisse FROM paiements p
     WHERE p.dossier_id = v_p.dossier_id AND p.statut = 'confirme';
  END IF;

  IF v_p.type_paiement = 'remboursement' THEN
    IF v_encaisse - v_p.montant_cents < 0 THEN
      RAISE EXCEPTION 'remboursement supérieur aux encaissements (% > %)',
        v_p.montant_cents, v_encaisse USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_total > 0 AND v_encaisse + v_p.montant_cents > v_total THEN
    RAISE EXCEPTION 'encaissement supérieur au total de la prestation (% > %)',
      v_encaisse + v_p.montant_cents, v_total USING ERRCODE = 'check_violation';
  END IF;

  UPDATE paiements SET statut = 'confirme', confirme_par = v_acteur, confirme_le = now()
   WHERE id = p_paiement_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id, apres)
  VALUES (v_acteur, v_p.entreprise_id, 'paiement.confirme', 'paiement', p_paiement_id::text,
          jsonb_build_object('montant_cents', v_p.montant_cents, 'type', v_p.type_paiement));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.confirmer_paiement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirmer_paiement(uuid) TO jokswed_app;


-- -----------------------------------------------------------------------------
-- LES ENCOURS D'UNE ENTREPRISE, QUEL QUE SOIT L'ANCRAGE
-- -----------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ PAR LE BANC V6.
--
-- `finances_resume` déduisait « attendu » et « facturé non réglé » de
-- `_finances_par_demande`, qui ne connaît que les demandes. Pour une
-- entreprise qui n'en reçoit aucune — tout collaborateur — ces deux chiffres
-- restaient obstinément à zéro alors qu'elle avait des impayés. Le tableau
-- était faux, et silencieusement : aucune erreur, juste un bon chiffre
-- manquant.
CREATE OR REPLACE FUNCTION app._encours_entreprise(p_entreprise_id uuid)
RETURNS TABLE (attendu_cents integer, impaye_cents integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH par_demande AS (
    SELECT greatest(fd.contractualise_cents - fd.encaisse_cents, 0) AS attendu,
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

CREATE OR REPLACE FUNCTION app.finances_resume(
  p_entreprise_id uuid, p_debut date, p_fin date)
RETURNS TABLE (
  encaisse_cents            integer,
  acomptes_cents            integer,
  soldes_cents              integer,
  rembourse_cents           integer,
  facture_cents             integer,
  contractualise_cents      integer,
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
  c AS (
    SELECT coalesce(sum(total_ttc_cents), 0) AS contractualise
      FROM documents
     WHERE entreprise_id = p_entreprise_id AND type = 'devis'
       AND statut IN ('emis','envoye','accepte')
       AND emis_le >= p_debut AND emis_le < (p_fin + 1)
  ),
  encours AS (SELECT * FROM app._encours_entreprise(p_entreprise_id)),
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
         encours.attendu_cents, encours.impaye_cents,
         res.nb, res.valeur::integer, prev.total::integer
    FROM p, f, c, encours, res, prev;
END $$;
REVOKE ALL ON FUNCTION app.finances_resume(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finances_resume(uuid, date, date) TO jokswed_app;
