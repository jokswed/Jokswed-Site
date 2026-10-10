-- =============================================================================
-- 018 — `verdict_emission` : concaténation de tableau corrigée
-- -----------------------------------------------------------------------------
-- ⚠️ `tableau || 'chaîne'` N'AJOUTE PAS UN ÉLÉMENT.
--
-- PostgreSQL voit un littéral non typé à droite d'un `text[]` et tente de le
-- lire COMME UN TABLEAU. D'où, à la première exécution réelle :
--
--     malformed array literal: "régime de TVA non qualifié"
--
-- La fiche de demande répondait 500 dès qu'un motif de blocage existait —
-- c'est-à-dire exactement dans le cas que cette fonction sert à gérer.
--
-- `array_append()` ne laisse aucune ambiguïté : le second argument est un
-- ÉLÉMENT, jamais un tableau à analyser.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.verdict_emission(p_entreprise_id uuid, p_type text)
RETURNS TABLE (reelle boolean, motifs text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_entreprise RECORD;
  v_regime     RECORD;
  v_motifs     text[] := '{}';
  v_reelle     boolean;
BEGIN
  SELECT * INTO v_entreprise FROM entreprises WHERE id = p_entreprise_id;
  IF v_entreprise IS NULL THEN
    RETURN QUERY SELECT false, array_append('{}'::text[], 'entreprise introuvable');
    RETURN;
  END IF;

  IF v_entreprise.siret IS NULL THEN
    v_motifs := array_append(v_motifs, 'SIRET manquant');
  END IF;
  IF v_entreprise.adresse_ligne1 IS NULL OR v_entreprise.ville IS NULL THEN
    v_motifs := array_append(v_motifs, 'adresse de l''entreprise incomplète');
  END IF;

  SELECT * INTO v_regime FROM regimes_tva r
   WHERE r.entreprise_id = p_entreprise_id
     AND r.debut_le <= current_date
     AND (r.fin_le IS NULL OR r.fin_le > current_date);
  IF v_regime IS NULL THEN
    v_motifs := array_append(v_motifs, 'régime de TVA non qualifié');
  ELSIF v_regime.regime = 'assujetti' AND v_regime.tva_numero IS NULL THEN
    v_motifs := array_append(
      v_motifs, 'numéro de TVA manquant alors que la TVA est appliquée');
  END IF;

  IF p_type IN ('contrat','avenant')
     AND (v_entreprise.mediateur_nom IS NULL OR v_entreprise.mediateur_url IS NULL) THEN
    v_motifs := array_append(v_motifs, 'médiateur de la consommation non désigné');
  END IF;

  v_reelle := coalesce(current_setting('app.emission_reelle', true), '') = '1';
  RETURN QUERY SELECT (v_reelle AND cardinality(v_motifs) = 0), v_motifs;
END $$;

CREATE OR REPLACE FUNCTION app.emettre_document(p_document_id uuid, p_pdf_sha256 text)
RETURNS TABLE (emis boolean, numero text, motifs text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_doc     RECORD;
  v_verdict RECORD;
  v_motifs  text[];
  v_numero  text;
  v_acteur  uuid;
  v_somme   integer;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF v_doc IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, array_append('{}'::text[], 'document introuvable');
    RETURN;
  END IF;
  v_acteur := app.exiger(v_doc.entreprise_id, 'document.emettre');

  IF v_doc.statut <> 'brouillon' THEN
    RETURN QUERY SELECT false, v_doc.numero, array_append('{}'::text[], 'document déjà émis');
    RETURN;
  END IF;

  SELECT * INTO v_verdict FROM app.verdict_emission(v_doc.entreprise_id, v_doc.type);
  v_motifs := v_verdict.motifs;

  IF EXISTS (SELECT 1 FROM document_lignes WHERE document_id = p_document_id
              AND prix_unitaire_cents = 0 AND origine_type = 'supplement') THEN
    v_motifs := array_append(v_motifs, 'une prestation reste à chiffrer');
  END IF;

  SELECT coalesce(sum(montant_cents), 0) INTO v_somme FROM echeances
   WHERE document_id = p_document_id AND statut <> 'annulee';
  IF v_somme > 0 AND v_somme <> v_doc.total_ttc_cents THEN
    v_motifs := array_append(v_motifs,
      format('échéancier incohérent : %s centimes contre %s', v_somme, v_doc.total_ttc_cents));
  END IF;

  IF cardinality(v_motifs) > 0 THEN
    RETURN QUERY SELECT false, NULL::text, v_motifs;
    RETURN;
  END IF;

  v_numero := app.numero_suivant(v_doc.entreprise_id, v_doc.type, v_verdict.reelle);

  UPDATE documents
     SET numero = v_numero, statut = 'emis', emis_le = now(),
         pdf_sha256 = p_pdf_sha256, test = NOT v_verdict.reelle
   WHERE id = p_document_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_doc.entreprise_id, 'document.emis', 'document',
          p_document_id::text,
          jsonb_build_object('numero', v_numero, 'reelle', v_verdict.reelle));

  RETURN QUERY SELECT true, v_numero, '{}'::text[];
END $$;
