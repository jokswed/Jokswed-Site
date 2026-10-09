-- =============================================================================
-- 019 — PAIEMENTS, ET CE QUI RESTE RÉELLEMENT DÛ
-- =============================================================================

CREATE TABLE paiements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id   uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  demande_id      uuid REFERENCES demandes(id) ON DELETE RESTRICT,
  echeance_id     uuid REFERENCES echeances(id) ON DELETE SET NULL,
  document_id     uuid REFERENCES documents(id) ON DELETE SET NULL,
  montant_cents   integer NOT NULL CHECK (montant_cents > 0),
  devise          text NOT NULL DEFAULT 'EUR',
  moyen           text NOT NULL CHECK (moyen IN
                    ('virement','especes','cheque','carte','stripe','autre')),
  reference       text,
  -- ⚠️ « declare » PAR DÉFAUT : un paiement saisi n'est PAS un paiement reçu.
  -- C'est la distinction qui empêche de considérer un dossier comme soldé
  -- parce que quelqu'un a tapé un montant dans un formulaire.
  statut          text NOT NULL DEFAULT 'declare'
                    CHECK (statut IN ('declare','confirme','rejete','rembourse')),
  justificatif_r2 text,
  cle_idempotence text,
  recu_le         date NOT NULL DEFAULT current_date,
  saisi_par       uuid REFERENCES utilisateurs(id),
  saisi_le        timestamptz NOT NULL DEFAULT now(),
  confirme_par    uuid REFERENCES utilisateurs(id),
  confirme_le     timestamptz,
  CONSTRAINT confirme_a_un_auteur
    CHECK (statut <> 'confirme' OR (confirme_par IS NOT NULL AND confirme_le IS NOT NULL))
);
CREATE UNIQUE INDEX paiement_idempotence
  ON paiements (entreprise_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL;
CREATE INDEX paiements_demande ON paiements (demande_id, statut);

ALTER TABLE paiements ENABLE ROW LEVEL SECURITY;
ALTER TABLE paiements FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON paiements TO jokswed_app;
CREATE POLICY paiement_tenant ON paiements
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

-- -----------------------------------------------------------------------------
-- LA SITUATION FINANCIÈRE D'UNE DEMANDE
-- -----------------------------------------------------------------------------
-- ⚠️ TROIS MESURES DISTINCTES, QU'IL NE FAUT JAMAIS CONFONDRE.
--
--   · FACTURÉ  = somme des factures ÉMISES, moins les avoirs ;
--   · ENCAISSÉ = somme des paiements CONFIRMÉS, moins les remboursements ;
--   · RESTE    = total de la prestation − encaissé.
--
-- Émettre une facture n'encaisse rien ; encaisser ne facture rien. Les
-- additionner, ou prendre l'un pour l'autre, c'est le moyen le plus simple de
-- facturer deux fois la même somme.
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
       AND d.statut <> 'brouillon' AND d.statut <> 'annule'
  ),
  avoirs AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'avoir'
       AND d.statut <> 'brouillon' AND d.statut <> 'annule'
  ),
  encaisse AS (
    SELECT coalesce(sum(p.montant_cents), 0) AS total
      FROM paiements p
     WHERE p.demande_id = p_demande_id AND p.statut = 'confirme'
  )
  SELECT devis.total, factures.total, avoirs.total, encaisse.total,
         devis.total - encaisse.total
    FROM devis, factures, avoirs, encaisse
$$;
REVOKE ALL ON FUNCTION app.situation_financiere(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.situation_financiere(uuid) TO jokswed_app;

/* Enregistrer un paiement. Il naît « déclaré » : la confirmation est un geste
   distinct, qui exige `finance.confirmer_paiement`. */
CREATE OR REPLACE FUNCTION app.enregistrer_paiement(
  p_demande_id uuid, p_montant_cents integer, p_moyen text,
  p_reference text, p_recu_le date, p_cle text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid; v_acteur uuid; v_id uuid;
BEGIN
  SELECT entreprise_destinataire_id INTO v_ent FROM demandes WHERE id = p_demande_id;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_ent, 'finance.saisir_paiement');

  INSERT INTO paiements (entreprise_id, demande_id, montant_cents, moyen,
                         reference, recu_le, saisi_par, cle_idempotence)
  VALUES (v_ent, p_demande_id, p_montant_cents, p_moyen, p_reference,
          coalesce(p_recu_le, current_date), v_acteur, p_cle)
  ON CONFLICT (entreprise_id, cle_idempotence) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                               ressource_id, apres)
    VALUES (v_acteur, v_ent, 'paiement.saisi', 'demande', p_demande_id::text,
            jsonb_build_object('montant_cents', p_montant_cents, 'moyen', p_moyen));
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.enregistrer_paiement(uuid, integer, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enregistrer_paiement(uuid, integer, text, text, date, text) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.confirmer_paiement(p_paiement_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid; v_situation RECORD;
BEGIN
  SELECT * INTO v_p FROM paiements WHERE id = p_paiement_id;
  IF v_p IS NULL OR v_p.statut <> 'declare' THEN RETURN false; END IF;
  v_acteur := app.exiger(v_p.entreprise_id, 'finance.confirmer_paiement');

  -- ⚠️ ON N'ENCAISSE PAS PLUS QUE DÛ.
  -- Un dépassement est une erreur de saisie, pas un fait à enregistrer en
  -- silence : la somme encaissée piloterait ensuite le déblocage de la galerie.
  SELECT * INTO v_situation FROM app.situation_financiere(v_p.demande_id);
  IF v_situation.total_prestation_cents > 0
     AND v_situation.encaisse_cents + v_p.montant_cents > v_situation.total_prestation_cents THEN
    RAISE EXCEPTION 'encaissement supérieur au total de la prestation (% > %)',
      v_situation.encaisse_cents + v_p.montant_cents, v_situation.total_prestation_cents
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE paiements SET statut = 'confirme', confirme_par = v_acteur, confirme_le = now()
   WHERE id = p_paiement_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, v_p.entreprise_id, 'paiement.confirme', 'paiement', p_paiement_id::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.confirmer_paiement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirmer_paiement(uuid) TO jokswed_app;
