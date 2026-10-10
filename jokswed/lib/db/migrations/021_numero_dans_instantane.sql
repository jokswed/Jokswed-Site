-- =============================================================================
-- 021 — LE NUMÉRO DOIT FIGURER SUR LE PDF, PAS SEULEMENT EN BASE
-- -----------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ EN COMPARANT UN RENDU À SON MODÈLE.
--
-- `emettre_document` écrivait `documents.numero`, mais le PDF est rendu depuis
-- `documents.instantane` — qui gardait `"numero": null`. Un devis émis, une
-- facture émise, sortaient donc SANS leur numéro : inexploitable pour une
-- facture, dont le numéro est une mention obligatoire.
--
-- Corriger l'ordre des opérations suffit, mais il faut le faire proprement :
--
--   1. `emettre_document` attribue le numéro ET l'estampille dans l'instantané,
--      dans la MÊME mise à jour que le passage à « émis ».
--   2. Le PDF définitif ne peut donc être rendu qu'APRÈS l'émission. Son
--      empreinte est scellée dans un second temps, par `sceller_document`.
--   3. L'immuabilité autorise exactement UNE transition : `pdf_sha256` de NULL
--      vers une valeur. Toute modification ultérieure reste refusée.
--
-- L'ancienne signature à deux arguments disparaît : elle invitait à sceller une
-- empreinte calculée avant que le numéro n'existe.
-- =============================================================================

-- --- 0. LA COMPLÉTUDE D'UN DOCUMENT ÉMIS SE VÉRIFIE À LA VALIDATION ---------
-- `emis_a_un_numero` était un CHECK : il s'évaluait à chaque ligne modifiée, ce
-- qui interdisait d'émettre d'abord et de sceller ensuite. PostgreSQL ne sait
-- pas différer un CHECK — mais il sait différer un CONSTRAINT TRIGGER. La
-- garantie est la même, et elle est même plus forte : à la VALIDATION de la
-- transaction, un document émis a son numéro, sa date ET son empreinte. Une
-- transaction qui émettrait sans sceller ne peut pas aboutir.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS emis_a_un_numero;

-- ⚠️ UN DÉCLENCHEUR DIFFÉRÉ NE VOIT PAS L'ÉTAT FINAL DE LA LIGNE.
-- `NEW` est la version produite par l'instruction qui a mis l'événement en
-- file, pas celle qui sera validée : l'émission échouait alors que le
-- scellement qui suivait, dans la même transaction, l'avait complétée. On
-- relit donc la ligne telle qu'elle est au moment de la validation.
CREATE OR REPLACE FUNCTION documents_emis_complets() RETURNS trigger AS $$
DECLARE d RECORD;
BEGIN
  SELECT * INTO d FROM documents WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;   -- supprimé avant la validation
  IF d.statut <> 'brouillon'
     AND (d.numero IS NULL OR d.emis_le IS NULL OR d.pdf_sha256 IS NULL) THEN
    RAISE EXCEPTION
      'document % émis sans numéro, date ou empreinte', coalesce(d.numero, d.id::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql
  -- En SECURITY DEFINER : si la RLS cachait la ligne au rôle appelant, la
  -- relecture ne trouverait rien et le contrôle serait silencieusement sauté.
  SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS documents_complets ON documents;
CREATE CONSTRAINT TRIGGER documents_complets
  AFTER INSERT OR UPDATE ON documents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION documents_emis_complets();

-- --- 1. L'immuabilité tolère le scellement initial, et lui seul --------------
CREATE OR REPLACE FUNCTION documents_geler() RETURNS trigger AS $$
BEGIN
  IF OLD.statut <> 'brouillon' THEN
    IF NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.instantane      IS DISTINCT FROM OLD.instantane
       OR NEW.total_ttc_cents IS DISTINCT FROM OLD.total_ttc_cents
       OR NEW.total_ht_cents  IS DISTINCT FROM OLD.total_ht_cents
       OR NEW.total_tva_cents IS DISTINCT FROM OLD.total_tva_cents
       OR NEW.type            IS DISTINCT FROM OLD.type
       OR NEW.entreprise_id   IS DISTINCT FROM OLD.entreprise_id THEN
      RAISE EXCEPTION
        'document % déjà émis : contenu immuable (corriger par version ou avoir)',
        coalesce(OLD.numero, OLD.id::text) USING ERRCODE = 'restrict_violation';
    END IF;
    -- L'empreinte se pose une fois. Elle ne se remplace jamais, et ne
    -- s'efface jamais.
    IF NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
       AND NOT (OLD.pdf_sha256 IS NULL AND NEW.pdf_sha256 IS NOT NULL) THEN
      RAISE EXCEPTION
        'document % : empreinte déjà scellée', coalesce(OLD.numero, OLD.id::text)
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- --- 2. Émission : le numéro entre dans l'instantané -------------------------
DROP FUNCTION IF EXISTS app.emettre_document(uuid, text);

CREATE OR REPLACE FUNCTION app.emettre_document(p_document_id uuid)
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

  IF EXISTS (SELECT 1 FROM document_lignes WHERE document_id = p_document_id
              AND prix_unitaire_cents = 0 AND origine_type = 'supplement') THEN
    -- ⚠️ `array_append`, PAS `||` : PostgreSQL interprète `text[] || 'chaîne'`
    -- comme une concaténation de DEUX tableaux et tente de lire la chaîne
    -- comme un littéral de tableau. Déjà corrigé en 018 ; la faute est
    -- revenue en recopiant le corps de la fonction.
    v_verdict.motifs := array_append(v_verdict.motifs, 'une prestation reste à chiffrer');
  END IF;

  SELECT coalesce(sum(montant_cents), 0) INTO v_somme FROM echeances
   WHERE document_id = p_document_id AND statut <> 'annulee';
  IF v_somme > 0 AND v_somme <> v_doc.total_ttc_cents THEN
    v_verdict.motifs := array_append(v_verdict.motifs,
      format('échéancier incohérent : %s centimes contre %s', v_somme, v_doc.total_ttc_cents));
  END IF;

  IF cardinality(v_verdict.motifs) > 0 THEN
    RETURN QUERY SELECT false, NULL::text, v_verdict.motifs;
    RETURN;
  END IF;

  v_numero := app.numero_suivant(v_doc.entreprise_id, v_doc.type, v_verdict.reelle);

  UPDATE documents
     SET numero     = v_numero,
         statut     = 'emis',
         emis_le    = now(),
         -- ⚠️ C'EST ICI QUE LE NUMÉRO ATTEINT LE PDF.
         instantane = jsonb_set(instantane, '{numero}', to_jsonb(v_numero), true),
         test       = NOT v_verdict.reelle
   WHERE id = p_document_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_doc.entreprise_id, 'document.emis', 'document',
          p_document_id::text,
          jsonb_build_object('numero', v_numero, 'reelle', v_verdict.reelle));

  RETURN QUERY SELECT true, v_numero, '{}'::text[];
END $$;

REVOKE ALL ON FUNCTION app.emettre_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.emettre_document(uuid) TO jokswed_app;

-- --- 3. Scellement de l'empreinte, après rendu du PDF définitif --------------
CREATE OR REPLACE FUNCTION app.sceller_document(p_document_id uuid, p_pdf_sha256 text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_doc RECORD;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF v_doc IS NULL THEN RETURN false; END IF;
  PERFORM app.exiger(v_doc.entreprise_id, 'document.emettre');

  IF v_doc.statut = 'brouillon' THEN
    RAISE EXCEPTION 'un brouillon ne se scelle pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_doc.pdf_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'document % : empreinte déjà scellée', v_doc.numero
      USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE documents SET pdf_sha256 = p_pdf_sha256 WHERE id = p_document_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.sceller_document(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sceller_document(uuid, text) TO jokswed_app;
