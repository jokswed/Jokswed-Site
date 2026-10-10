-- =============================================================================
-- 017 — LA GARDE D'ÉMISSION : CE QUI INTERDIT UN DOCUMENT INCOMPLET
-- -----------------------------------------------------------------------------
-- ⚠️ DEUX VERROUS DISTINCTS, ET IL FAUT FRANCHIR LES DEUX.
--
-- VERROU 1 — L'ENVIRONNEMENT.
-- Un banc ne doit JAMAIS consommer un numéro de la série comptable réelle :
-- une numérotation doit être continue, et un trou laissé par un essai est
-- exactement ce qu'un contrôle relève. Trois conditions indépendantes, toutes
-- requises : aucun banc déclaré, production Vercel, et pas de mode test.
--
-- VERROU 2 — LA COMPLÉTUDE LÉGALE.
-- C'est celui que tu as demandé. Tant que le médiateur de la consommation
-- n'est pas désigné et que le régime de TVA n'est pas qualifié, un BROUILLON
-- reste possible — on peut préparer, relire, corriger — mais l'émission
-- définitive est refusée, avec le motif.
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
    RETURN QUERY SELECT false, ARRAY['entreprise introuvable'];
    RETURN;
  END IF;

  -- ── Identité légale ──
  IF v_entreprise.siret IS NULL THEN
    v_motifs := v_motifs || 'SIRET manquant';
  END IF;
  IF v_entreprise.adresse_ligne1 IS NULL OR v_entreprise.ville IS NULL THEN
    v_motifs := v_motifs || 'adresse de l''entreprise incomplète';
  END IF;

  -- ── Régime fiscal, à la date du jour ──
  SELECT * INTO v_regime FROM regimes_tva r
   WHERE r.entreprise_id = p_entreprise_id
     AND r.debut_le <= current_date
     AND (r.fin_le IS NULL OR r.fin_le > current_date);
  IF v_regime IS NULL THEN
    v_motifs := v_motifs || 'régime de TVA non qualifié';
  ELSIF v_regime.regime = 'assujetti' AND v_regime.tva_numero IS NULL THEN
    -- Pour un assujetti, le numéro individuel d'identification figure parmi
    -- les mentions obligatoires. En franchise en base, il ne l'est PAS :
    -- c'est la mention d'exonération qui s'impose, et elle est contrôlée à la
    -- création du régime.
    v_motifs := v_motifs || 'numéro de TVA manquant alors que la TVA est appliquée';
  END IF;

  -- ── Médiateur : exigé dès qu'un document engage contractuellement ──
  IF p_type IN ('contrat','avenant')
     AND (v_entreprise.mediateur_nom IS NULL OR v_entreprise.mediateur_url IS NULL) THEN
    v_motifs := v_motifs || 'médiateur de la consommation non désigné';
  END IF;

  -- ── Verrou d'environnement ──
  v_reelle := coalesce(current_setting('app.emission_reelle', true), '') = '1';

  RETURN QUERY SELECT (v_reelle AND cardinality(v_motifs) = 0), v_motifs;
END $$;
REVOKE ALL ON FUNCTION app.verdict_emission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verdict_emission(uuid, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- NUMÉROTATION ATOMIQUE
-- -----------------------------------------------------------------------------
-- Une seule requête, sans lecture préalable : deux documents émis au même
-- instant ne peuvent pas porter le même numéro. « Lire puis écrire » laisse
-- une fenêtre entre les deux, et sur une numérotation comptable c'est une
-- anomalie qu'un contrôle relève.
--
-- ⚠️ ET UNE SÉRIE DE TEST SÉPARÉE. Un document de banc porte le préfixe
-- `TEST-` et puise dans son propre compteur : il ne laisse aucun trou dans la
-- série réelle.
CREATE OR REPLACE FUNCTION app.numero_suivant(
  p_entreprise_id uuid, p_type text, p_reelle boolean)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prefixes jsonb := '{"devis":"DEV","contrat":"CONT","avenant":"AVE",
                        "facture":"FACT","avoir":"AV"}'::jsonb;
  v_annee integer := extract(year from now())::integer;
  v_serie text := CASE WHEN p_reelle THEN p_type ELSE p_type || ':test' END;
  v_prefixe text := CASE WHEN p_reelle THEN v_prefixes->>p_type
                         ELSE 'TEST-' || (v_prefixes->>p_type) END;
  v_rang integer;
BEGIN
  IF v_prefixes->>p_type IS NULL THEN
    RAISE EXCEPTION 'type de document inconnu : %', p_type;
  END IF;
  INSERT INTO document_series (entreprise_id, serie, annee, dernier_numero)
  VALUES (p_entreprise_id, v_serie, v_annee, 1)
  ON CONFLICT (entreprise_id, serie, annee)
    DO UPDATE SET dernier_numero = document_series.dernier_numero + 1
  RETURNING dernier_numero INTO v_rang;

  RETURN v_prefixe || '-' || v_annee || '-' || lpad(v_rang::text, 4, '0');
END $$;
REVOKE ALL ON FUNCTION app.numero_suivant(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.numero_suivant(uuid, text, boolean) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- ÉMISSION
-- -----------------------------------------------------------------------------
-- Passe un brouillon en document émis : attribue le numéro, fige l'empreinte
-- du PDF, horodate — ou refuse, avec les motifs.
CREATE OR REPLACE FUNCTION app.emettre_document(p_document_id uuid, p_pdf_sha256 text)
RETURNS TABLE (emis boolean, numero text, motifs text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_doc     RECORD;
  v_verdict RECORD;
  v_numero  text;
  v_acteur  uuid;
  v_somme   integer;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF v_doc IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, ARRAY['document introuvable'];
    RETURN;
  END IF;
  v_acteur := app.exiger(v_doc.entreprise_id, 'document.emettre');

  IF v_doc.statut <> 'brouillon' THEN
    RETURN QUERY SELECT false, v_doc.numero, ARRAY['document déjà émis'];
    RETURN;
  END IF;

  SELECT * INTO v_verdict FROM app.verdict_emission(v_doc.entreprise_id, v_doc.type);

  -- ⚠️ UNE LIGNE SANS PRIX INTERDIT L'ÉMISSION.
  -- Un total partiel présenté comme un total est une promesse non tenue.
  IF EXISTS (SELECT 1 FROM document_lignes WHERE document_id = p_document_id
              AND prix_unitaire_cents = 0 AND origine_type = 'supplement') THEN
    v_verdict.motifs := v_verdict.motifs || 'une prestation reste à chiffrer';
  END IF;

  -- ⚠️ L'ÉCHÉANCIER DOIT SOMMER EXACTEMENT AU TOTAL.
  -- C'est ce qui garantit l'arrondi du devis fourni : 433,33 + 433,33 + 433,34.
  SELECT coalesce(sum(montant_cents), 0) INTO v_somme FROM echeances
   WHERE document_id = p_document_id AND statut <> 'annulee';
  IF v_somme > 0 AND v_somme <> v_doc.total_ttc_cents THEN
    v_verdict.motifs := v_verdict.motifs ||
      format('échéancier incohérent : %s centimes contre %s', v_somme, v_doc.total_ttc_cents);
  END IF;

  IF cardinality(v_verdict.motifs) > 0 OR NOT v_verdict.reelle THEN
    IF cardinality(v_verdict.motifs) > 0 THEN
      RETURN QUERY SELECT false, NULL::text, v_verdict.motifs;
      RETURN;
    END IF;
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
REVOKE ALL ON FUNCTION app.emettre_document(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.emettre_document(uuid, text) TO jokswed_app;
