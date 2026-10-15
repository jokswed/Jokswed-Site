-- =============================================================================
-- 063 — LE DÉPÔT PUBLIC ENREGISTRE LE PHOTOBOOTH 360
-- -----------------------------------------------------------------------------
-- L'option existe désormais au catalogue (`photobooth-360`, « sur devis », sans
-- tarif inventé) : elle arrive donc déjà dans `demande_lignes` et dans
-- l'instantané. Il manquait le OUI/NON sur la demande elle-même, que lisent la
-- fiche, la saison et l'alerte « Photobooth sélectionné — collaborateur à
-- assigner ».
--
-- ⚠️ UNE SEULE LIGNE CHANGE. Le reste est repris à l'identique du palier 012 :
-- on ne réécrit jamais une migration appliquée, on en publie une nouvelle.
--
-- ⚠️ ET AUCUNE PROPOSITION AUTOMATIQUE.
-- `executantPartenaire` reste nul au catalogue : cocher Photobooth ne transmet
-- rien à personne. Un prospect non confirmé ne part pas chez un prestataire.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.deposer_demande(p_charge jsonb)
RETURNS TABLE (demande_id uuid, reference text, rejeu boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cle        text := p_charge->>'cle_idempotence';
  v_existante  RECORD;
  v_entreprise uuid;
  v_annee      integer := extract(year from now())::integer;
  v_rang       integer;
  v_reference  text;
  v_id         uuid;
  v_ligne      jsonb;
  v_cons       jsonb;
  v_video      boolean := coalesce((p_charge->>'video_demandee')::boolean, false);
  v_partenaire RECORD;
BEGIN
  IF v_cle IS NULL OR length(v_cle) < 8 THEN
    RAISE EXCEPTION 'clé d''idempotence absente' USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.id, d.reference INTO v_existante
    FROM demandes d WHERE d.cle_idempotence = v_cle;
  IF v_existante.id IS NOT NULL THEN
    RETURN QUERY SELECT v_existante.id, v_existante.reference, true;
    RETURN;
  END IF;

  SELECT e.id INTO v_entreprise FROM entreprises e
   WHERE e.slug = coalesce(p_charge->>'entreprise_slug', 'jokswed');
  IF v_entreprise IS NULL THEN
    RAISE EXCEPTION 'entreprise destinataire introuvable' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO demande_series (annee, dernier_numero) VALUES (v_annee, 1)
  ON CONFLICT (annee) DO UPDATE SET dernier_numero = demande_series.dernier_numero + 1
  RETURNING dernier_numero INTO v_rang;
  v_reference := 'DEM-' || v_annee || '-' || lpad(v_rang::text, 4, '0');

  INSERT INTO demandes (
    reference, entreprise_destinataire_id, origine,
    contact_nom, contact_email, contact_telephone, contact_prefere,
    date_mariage, date_incertaine, lieu, ville, departement, invites_estimes, horaires,
    formule_cle, formule_nom, formule_prix_cents, video_demandee,
    photobooth_360,
    message, complements, instantane, cle_idempotence, ip_tronquee)
  VALUES (
    v_reference, v_entreprise, coalesce(p_charge->>'origine', 'formulaire_public'),
    p_charge->>'contact_nom', (p_charge->>'contact_email')::citext,
    p_charge->>'contact_telephone', p_charge->>'contact_prefere',
    nullif(p_charge->>'date_mariage','')::date,
    coalesce((p_charge->>'date_incertaine')::boolean, false),
    p_charge->>'lieu', p_charge->>'ville', p_charge->>'departement',
    nullif(p_charge->>'invites_estimes','')::integer, p_charge->>'horaires',
    p_charge->>'formule_cle', p_charge->>'formule_nom',
    nullif(p_charge->>'formule_prix_cents','')::integer, v_video,
    coalesce((p_charge->>'photobooth_360')::boolean, false),
    p_charge->>'message', p_charge->>'complements',
    p_charge, v_cle, p_charge->>'ip_tronquee')
  RETURNING id INTO v_id;

  FOR v_ligne IN SELECT * FROM jsonb_array_elements(coalesce(p_charge->'lignes', '[]'::jsonb))
  LOOP
    INSERT INTO demande_lignes (demande_id, type, cle, libelle, prix_cents,
                                type_tarif, compatibilite, executant_partenaire, ordre)
    VALUES (v_id, v_ligne->>'type', v_ligne->>'cle', v_ligne->>'libelle',
            nullif(v_ligne->>'prix_cents','')::integer, v_ligne->>'type_tarif',
            v_ligne->>'compatibilite', v_ligne->>'executant_partenaire',
            coalesce((v_ligne->>'ordre')::integer, 0));
  END LOOP;

  FOR v_cons IN SELECT * FROM jsonb_array_elements(coalesce(p_charge->'consentements', '[]'::jsonb))
  LOOP
    INSERT INTO consentements (demande_id, finalite, accorde, texte_version, source, ip_tronquee)
    VALUES (v_id, v_cons->>'finalite', (v_cons->>'accorde')::boolean,
            v_cons->>'texte_version', coalesce(v_cons->>'source','formulaire_public'),
            p_charge->>'ip_tronquee');
  END LOOP;

  IF v_video THEN
    SELECT e.id, e.nom_commercial INTO v_partenaire FROM entreprises e
     WHERE e.slug = coalesce(p_charge->>'partenaire_video_slug', 'videaste-partenaire')
       AND e.archivee_le IS NULL;
    IF v_partenaire.id IS NOT NULL AND v_partenaire.id <> v_entreprise THEN
      INSERT INTO propositions (demande_id, entreprise_emettrice_id,
                                entreprise_destinataire_id, destinataire_nom,
                                prestation, statut, origine)
      VALUES (v_id, v_entreprise, v_partenaire.id, v_partenaire.nom_commercial,
              'video', 'preparee', 'automatique')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  INSERT INTO evenements (type, charge_utile, cle_idempotence)
  VALUES ('demande.recue',
          jsonb_build_object('demande_id', v_id, 'reference', v_reference,
                             'entreprise_id', v_entreprise, 'video_demandee', v_video),
          'demande.recue:' || v_id::text)
  ON CONFLICT (cle_idempotence) DO NOTHING;

  RETURN QUERY SELECT v_id, v_reference, false;
END $$;
REVOKE ALL ON FUNCTION app.deposer_demande(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.deposer_demande(jsonb) TO jokswed_app;
