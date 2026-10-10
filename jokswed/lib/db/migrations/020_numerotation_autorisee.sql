-- =============================================================================
-- 020 — LA NUMÉROTATION EXIGE UNE AUTORISATION
-- -----------------------------------------------------------------------------
-- ⚠️ FAILLE TROUVÉE PAR LE BANC, PAS PAR RELECTURE.
--
-- `app.numero_suivant(entreprise_id, type, reelle)` est `SECURITY DEFINER` et
-- accordée au rôle applicatif. Elle ne vérifiait RIEN : n'importe quel membre
-- pouvait appeler
--
--     SELECT app.numero_suivant('<entreprise d''autrui>', 'facture', true);
--
-- et faire avancer la série comptable d'un confrère. Le dommage n'est pas
-- théorique : une numérotation de factures doit être CONTINUE, et un saut
-- laissé par un tiers est précisément ce qu'un contrôle relève — sans que le
-- titulaire puisse l'expliquer.
--
-- `emettre_document` vérifiait bien l'autorisation avant de l'appeler, mais
-- rien n'obligeait à passer par elle. La garde descend donc d'un cran.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.numero_suivant(
  p_entreprise_id uuid, p_type text, p_reelle boolean)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prefixes jsonb := '{"devis":"DEV","contrat":"CONT","avenant":"AVE",
                        "facture":"FACT","avoir":"AV"}'::jsonb;
  v_annee integer := extract(year from now())::integer;
  v_serie text;
  v_prefixe text;
  v_rang integer;
BEGIN
  IF v_prefixes->>p_type IS NULL THEN
    RAISE EXCEPTION 'type de document inconnu : %', p_type;
  END IF;

  -- ⚠️ LA LIGNE QUI MANQUAIT.
  -- Consommer un numéro, c'est écrire dans la comptabilité d'une entreprise.
  PERFORM app.exiger(p_entreprise_id, 'document.emettre');

  v_serie := CASE WHEN p_reelle THEN p_type ELSE p_type || ':test' END;
  v_prefixe := CASE WHEN p_reelle THEN v_prefixes->>p_type
                    ELSE 'TEST-' || (v_prefixes->>p_type) END;

  INSERT INTO document_series (entreprise_id, serie, annee, dernier_numero)
  VALUES (p_entreprise_id, v_serie, v_annee, 1)
  ON CONFLICT (entreprise_id, serie, annee)
    DO UPDATE SET dernier_numero = document_series.dernier_numero + 1
  RETURNING dernier_numero INTO v_rang;

  RETURN v_prefixe || '-' || v_annee || '-' || lpad(v_rang::text, 4, '0');
END $$;
