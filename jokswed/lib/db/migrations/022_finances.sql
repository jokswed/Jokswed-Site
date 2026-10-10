-- =============================================================================
-- 022 — FINANCES : NATURE DES PAIEMENTS, RÉGULARISATIONS, AGRÉGATS
-- -----------------------------------------------------------------------------
-- Quatre mesures, qu'on ne mélange jamais :
--
--   · CONTRACTUALISÉ — ce que le client s'est engagé à payer (devis accepté).
--   · FACTURÉ        — ce qui a fait l'objet d'une facture émise, moins avoirs.
--   · EXIGIBLE       — ce qui est facturé et dont l'échéance est passée.
--   · ENCAISSÉ       — ce qui est réellement arrivé (paiements confirmés,
--                      moins les remboursements confirmés).
--
-- Exemple du cahier des charges : prestation 1 300 €, facture d'acompte de
-- 433,33 € non réglée. Contractualisé restant = 1 300 €. Facturé = 433,33 €.
-- Encaissé = 0 €. Les trois chiffres coexistent et ne s'additionnent pas.
-- =============================================================================

-- --- 1. La nature d'un paiement ---------------------------------------------
ALTER TABLE paiements
  ADD COLUMN type_paiement text NOT NULL DEFAULT 'partiel'
    CHECK (type_paiement IN ('acompte','versement','solde','partiel','remboursement')),
  -- Une régularisation désigne l'opération qu'elle corrige. On ne supprime
  -- jamais un mouvement confirmé : on en ajoute un qui l'annule.
  ADD COLUMN corrige_id uuid REFERENCES paiements(id) ON DELETE RESTRICT,
  ADD COLUMN motif text,
  ADD COLUMN annule_le timestamptz,
  ADD COLUMN annule_par uuid REFERENCES utilisateurs(id),
  -- ⚠️ LE SIGNE EST CALCULÉ, JAMAIS SAISI.
  -- Un remboursement enregistré avec un montant positif et compté en plus,
  -- c'est un dossier soldé deux fois. La colonne est générée : aucun appelant
  -- ne peut se tromper de signe.
  ADD COLUMN montant_signe_cents integer
    GENERATED ALWAYS AS
      (CASE WHEN type_paiement = 'remboursement' THEN -montant_cents ELSE montant_cents END)
    STORED;

ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_statut_check;
ALTER TABLE paiements ADD CONSTRAINT paiements_statut_check
  CHECK (statut IN ('declare','confirme','rejete','rembourse','annule'));

-- Un remboursement doit dire ce qu'il corrige : sinon c'est un mouvement
-- orphelin, et la piste d'audit s'arrête là.
ALTER TABLE paiements ADD CONSTRAINT remboursement_motive
  CHECK (type_paiement <> 'remboursement' OR motif IS NOT NULL);

CREATE INDEX paiements_entreprise_date ON paiements (entreprise_id, recu_le);

-- --- 2. Un mouvement confirmé ne se réécrit pas -----------------------------
CREATE OR REPLACE FUNCTION paiements_geler() RETURNS trigger AS $$
BEGIN
  IF OLD.statut = 'confirme' THEN
    IF NEW.montant_cents  IS DISTINCT FROM OLD.montant_cents
       OR NEW.type_paiement IS DISTINCT FROM OLD.type_paiement
       OR NEW.moyen         IS DISTINCT FROM OLD.moyen
       OR NEW.recu_le       IS DISTINCT FROM OLD.recu_le
       OR NEW.demande_id    IS DISTINCT FROM OLD.demande_id
       OR NEW.entreprise_id IS DISTINCT FROM OLD.entreprise_id
       OR NEW.statut        IS DISTINCT FROM OLD.statut THEN
      RAISE EXCEPTION
        'paiement % confirmé : corriger par une régularisation, pas par une modification',
        OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER paiements_immuables BEFORE UPDATE ON paiements
  FOR EACH ROW EXECUTE FUNCTION paiements_geler();

CREATE OR REPLACE FUNCTION paiements_indestructibles() RETURNS trigger AS $$
BEGIN
  IF OLD.statut = 'confirme' THEN
    RAISE EXCEPTION 'paiement % confirmé : suppression interdite (passer par un remboursement)',
      OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER paiements_non_supprimables BEFORE DELETE ON paiements
  FOR EACH ROW EXECUTE FUNCTION paiements_indestructibles();

-- --- 3. La situation d'une demande, remboursements compris ------------------
CREATE OR REPLACE FUNCTION app.situation_financiere(p_demande_id uuid)
RETURNS TABLE (
  total_prestation_cents integer,
  facture_cents          integer,
  avoirs_cents           integer,
  encaisse_cents         integer,
  reste_du_cents         integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH
  devis AS (
    SELECT coalesce(max(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'devis'
       AND d.statut IN ('emis','envoye','accepte')
  ),
  factures AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'facture'
       AND d.statut NOT IN ('brouillon','annule')
  ),
  avoirs AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'avoir'
       AND d.statut NOT IN ('brouillon','annule')
  ),
  encaisse AS (
    -- ⚠️ `montant_signe_cents` : les remboursements SE SOUSTRAIENT.
    SELECT coalesce(sum(p.montant_signe_cents), 0) AS total
      FROM paiements p
     WHERE p.demande_id = p_demande_id AND p.statut = 'confirme'
  )
  SELECT devis.total, factures.total, avoirs.total, encaisse.total,
         devis.total - encaisse.total
    FROM devis, factures, avoirs, encaisse
$$;
REVOKE ALL ON FUNCTION app.situation_financiere(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.situation_financiere(uuid) TO jokswed_app;

-- --- 4. Saisir, modifier, confirmer, régulariser ----------------------------
DROP FUNCTION IF EXISTS app.enregistrer_paiement(uuid, integer, text, text, date, text);

CREATE OR REPLACE FUNCTION app.enregistrer_paiement(
  p_demande_id uuid, p_montant_cents integer, p_moyen text, p_type text,
  p_reference text, p_recu_le date, p_cle text, p_motif text DEFAULT NULL,
  p_corrige_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid; v_acteur uuid; v_id uuid;
BEGIN
  SELECT entreprise_destinataire_id INTO v_ent FROM demandes WHERE id = p_demande_id;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Un remboursement n'est pas une saisie ordinaire : il a sa permission.
  IF p_type = 'remboursement' THEN
    v_acteur := app.exiger(v_ent, 'finance.rembourser');
  ELSE
    v_acteur := app.exiger(v_ent, 'finance.saisir_paiement');
  END IF;

  -- ⚠️ UNE RÉGULARISATION NE TRAVERSE PAS LES ENTREPRISES.
  IF p_corrige_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM paiements WHERE id = p_corrige_id AND entreprise_id = v_ent) THEN
    RAISE EXCEPTION 'le paiement corrigé n''appartient pas à cette entreprise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO paiements (entreprise_id, demande_id, montant_cents, moyen, type_paiement,
                         reference, recu_le, saisi_par, cle_idempotence, motif, corrige_id)
  VALUES (v_ent, p_demande_id, p_montant_cents, p_moyen, coalesce(p_type, 'partiel'),
          p_reference, coalesce(p_recu_le, current_date), v_acteur, p_cle,
          p_motif, p_corrige_id)
  -- ⚠️ LE PRÉDICAT DE L'INDEX PARTIEL EST OBLIGATOIRE ICI.
  -- `paiement_idempotence` est un index UNIQUE … WHERE cle_idempotence IS NOT
  -- NULL. Sans répéter ce WHERE, PostgreSQL ne reconnaît aucune contrainte et
  -- lève « no unique or exclusion constraint matching ». Le défaut venait du
  -- palier 019 et dormait : aucun banc n'avait encore saisi deux fois la même
  -- clé de paiement.
  ON CONFLICT (entreprise_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                               ressource_id, apres)
    VALUES (v_acteur, v_ent, 'paiement.saisi', 'demande', p_demande_id::text,
            jsonb_build_object('montant_cents', p_montant_cents, 'moyen', p_moyen,
                               'type', coalesce(p_type, 'partiel')));
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.enregistrer_paiement(uuid, integer, text, text, text, date, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enregistrer_paiement(uuid, integer, text, text, text, date, text, text, uuid) TO jokswed_app;

/* Modifier une saisie AVANT confirmation. Après, le déclencheur refuse. */
CREATE OR REPLACE FUNCTION app.modifier_paiement(
  p_paiement_id uuid, p_montant_cents integer, p_moyen text, p_type text,
  p_reference text, p_recu_le date)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_p FROM paiements WHERE id = p_paiement_id;
  IF v_p IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_p.entreprise_id, 'finance.saisir_paiement');
  IF v_p.statut <> 'declare' THEN
    RAISE EXCEPTION 'paiement % : seule une saisie non confirmée se modifie', p_paiement_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE paiements
     SET montant_cents = p_montant_cents, moyen = p_moyen,
         type_paiement = coalesce(p_type, type_paiement),
         reference = p_reference, recu_le = coalesce(p_recu_le, recu_le)
   WHERE id = p_paiement_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, avant, apres)
  VALUES (v_acteur, v_p.entreprise_id, 'paiement.modifie', 'paiement', p_paiement_id::text,
          jsonb_build_object('montant_cents', v_p.montant_cents, 'moyen', v_p.moyen,
                             'type', v_p.type_paiement),
          jsonb_build_object('montant_cents', p_montant_cents, 'moyen', p_moyen,
                             'type', coalesce(p_type, v_p.type_paiement)));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.modifier_paiement(uuid, integer, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.modifier_paiement(uuid, integer, text, text, text, date) TO jokswed_app;

/* Abandonner une saisie erronée NON confirmée : on la marque, on ne l'efface
   pas. Le journal garde la trace de ce qui a été tapé puis retiré. */
CREATE OR REPLACE FUNCTION app.annuler_paiement(p_paiement_id uuid, p_motif text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_p FROM paiements WHERE id = p_paiement_id;
  IF v_p IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_p.entreprise_id, 'finance.saisir_paiement');
  IF v_p.statut <> 'declare' THEN
    RAISE EXCEPTION 'paiement % confirmé : passer par un remboursement', p_paiement_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  UPDATE paiements SET statut = 'annule', annule_le = now(), annule_par = v_acteur,
                       motif = coalesce(p_motif, motif)
   WHERE id = p_paiement_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id, avant)
  VALUES (v_acteur, v_p.entreprise_id, 'paiement.annule', 'paiement', p_paiement_id::text,
          jsonb_build_object('montant_cents', v_p.montant_cents));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.annuler_paiement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.annuler_paiement(uuid, text) TO jokswed_app;

/* La confirmation recalcule le plafond en tenant compte des remboursements. */
CREATE OR REPLACE FUNCTION app.confirmer_paiement(p_paiement_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid; v_situation RECORD;
BEGIN
  SELECT * INTO v_p FROM paiements WHERE id = p_paiement_id;
  IF v_p IS NULL OR v_p.statut <> 'declare' THEN RETURN false; END IF;
  IF v_p.type_paiement = 'remboursement' THEN
    v_acteur := app.exiger(v_p.entreprise_id, 'finance.rembourser');
  ELSE
    v_acteur := app.exiger(v_p.entreprise_id, 'finance.confirmer_paiement');
  END IF;

  SELECT * INTO v_situation FROM app.situation_financiere(v_p.demande_id);

  -- ⚠️ ON N'ENCAISSE PAS PLUS QUE DÛ, ET ON NE REMBOURSE PAS PLUS QUE REÇU.
  IF v_p.type_paiement = 'remboursement' THEN
    IF v_situation.encaisse_cents - v_p.montant_cents < 0 THEN
      RAISE EXCEPTION 'remboursement supérieur aux encaissements (% > %)',
        v_p.montant_cents, v_situation.encaisse_cents USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_situation.total_prestation_cents > 0
     AND v_situation.encaisse_cents + v_p.montant_cents > v_situation.total_prestation_cents THEN
    RAISE EXCEPTION 'encaissement supérieur au total de la prestation (% > %)',
      v_situation.encaisse_cents + v_p.montant_cents, v_situation.total_prestation_cents
      USING ERRCODE = 'check_violation';
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
