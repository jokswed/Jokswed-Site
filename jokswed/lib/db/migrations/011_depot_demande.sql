-- =============================================================================
-- 011 — LE DÉPÔT D'UNE DEMANDE, EN UNE SEULE TRANSACTION
-- -----------------------------------------------------------------------------
-- ⚠️ POURQUOI UNE FONCTION, ET PAS DES INSERT DEPUIS L'APPLICATION.
--
-- Le formulaire est PUBLIC : au moment du dépôt, il n'y a aucun acteur, donc
-- `app.acteur()` vaut NULL et toute politique est fausse. C'est le bon
-- comportement par défaut — refus total — mais il faut une porte, étroite et
-- nommée, comme pour l'authentification.
--
-- Cette fonction ne peut faire qu'UNE chose : déposer une demande. Elle ne
-- lit aucune donnée d'entreprise, ne modifie aucun droit, et écrit la demande,
-- ses lignes, ses consentements, la proposition vidéo éventuelle et
-- l'événement de notification DANS LA MÊME TRANSACTION. Les cinq existent, ou
-- aucun des cinq.
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
  v_partenaire uuid;
BEGIN
  IF v_cle IS NULL OR length(v_cle) < 8 THEN
    RAISE EXCEPTION 'clé d''idempotence absente' USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠️ LE REJEU REND LA DEMANDE EXISTANTE, SANS RIEN RECRÉER.
  -- Double-clic, retour réseau, relance : une seule demande, une seule
  -- notification, et l'appelant reçoit la même réponse qu'au premier coup.
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

  -- Numérotation atomique, même patron que les séries documentaires : une
  -- requête, pas de lecture préalable, donc pas de numéro en double.
  INSERT INTO demande_series (annee, dernier_numero) VALUES (v_annee, 1)
  ON CONFLICT (annee) DO UPDATE SET dernier_numero = demande_series.dernier_numero + 1
  RETURNING dernier_numero INTO v_rang;
  v_reference := 'DEM-' || v_annee || '-' || lpad(v_rang::text, 4, '0');

  INSERT INTO demandes (
    reference, entreprise_destinataire_id, origine,
    contact_nom, contact_email, contact_telephone, contact_prefere,
    date_mariage, date_incertaine, lieu, ville, departement, invites_estimes, horaires,
    formule_cle, formule_nom, formule_prix_cents, video_demandee,
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

  -- ── La collaboration vidéo est ENREGISTRÉE, pas transmise ──
  IF v_video THEN
    SELECT e.id INTO v_partenaire FROM entreprises e
     WHERE e.slug = coalesce(p_charge->>'partenaire_video_slug', 'videaste-partenaire')
       AND e.archivee_le IS NULL;
    IF v_partenaire IS NOT NULL AND v_partenaire <> v_entreprise THEN
      -- `statut = 'preparee'` et `envoyee_le` NUL : rien ne part tant que le
      -- compte du collaborateur n'est pas actif et ses permissions prêtes.
      INSERT INTO propositions (demande_id, entreprise_emettrice_id,
                                entreprise_destinataire_id, prestation, statut, origine)
      VALUES (v_id, v_entreprise, v_partenaire, 'video', 'preparee', 'automatique')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ── L'événement, dans la MÊME transaction que la demande ──
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

-- -----------------------------------------------------------------------------
-- LE DRAIN DE LA FILE
-- -----------------------------------------------------------------------------
-- `FOR UPDATE SKIP LOCKED` : deux drains concurrents ne prennent jamais le
-- même événement, et aucun des deux n'attend l'autre.
CREATE OR REPLACE FUNCTION app.evenements_a_traiter(p_max integer DEFAULT 20)
RETURNS TABLE (id uuid, type text, charge_utile jsonb, tentatives integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH pris AS (
    SELECT e.id FROM evenements e
     WHERE e.traite_le IS NULL AND e.disponible_le <= now()
     ORDER BY e.cree_le
     FOR UPDATE SKIP LOCKED
     LIMIT p_max
  )
  UPDATE evenements e SET tentatives = e.tentatives + 1
   FROM pris WHERE e.id = pris.id
  RETURNING e.id, e.type, e.charge_utile, e.tentatives
$$;

CREATE OR REPLACE FUNCTION app.evenement_traite(p_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE evenements SET traite_le = now(), derniere_erreur = NULL WHERE id = p_id
$$;

-- Report exponentiel : 1, 2, 4, 8… minutes. Une panne d'e-mail retarde la
-- notification, elle ne la perd pas et ne martèle pas le fournisseur.
CREATE OR REPLACE FUNCTION app.evenement_echoue(p_id uuid, p_erreur text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE evenements
     SET derniere_erreur = left(p_erreur, 500),
         disponible_le = now() + make_interval(mins => least(power(2, tentatives)::int, 60))
   WHERE id = p_id
$$;

-- Notification idempotente : rejouer un événement ne crée pas de doublon.
CREATE OR REPLACE FUNCTION app.notifier(
  p_destinataire uuid, p_entreprise uuid, p_type text, p_titre text,
  p_corps text, p_lien text, p_cle text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO notifications (destinataire_id, entreprise_id, type, titre, corps, lien, cle_idempotence)
  VALUES (p_destinataire, p_entreprise, p_type, p_titre, p_corps, p_lien, p_cle)
  ON CONFLICT (destinataire_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL
    DO NOTHING
$$;

/* Les membres d'une entreprise portant une permission donnée : sert à savoir
   QUI prévenir. SECURITY DEFINER car le drain n'a pas d'acteur. */
CREATE OR REPLACE FUNCTION app.membres_avec(p_entreprise uuid, p_permission text)
RETURNS TABLE (utilisateur_id uuid, email citext, prenom text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email, u.prenom
    FROM membres m
    JOIN utilisateurs u ON u.id = m.utilisateur_id
   WHERE m.entreprise_id = p_entreprise
     AND m.retire_le IS NULL
     AND u.desactive_le IS NULL
     AND p_permission = ANY (app.permissions_de(u.id, p_entreprise))
$$;

REVOKE ALL ON FUNCTION app.evenements_a_traiter(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.evenement_traite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.evenement_echoue(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.notifier(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.membres_avec(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.evenements_a_traiter(integer) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.evenement_traite(uuid) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.evenement_echoue(uuid, text) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.notifier(uuid, uuid, text, text, text, text, text) TO jokswed_app;
GRANT EXECUTE ON FUNCTION app.membres_avec(uuid, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- RLS SUR LES NOUVELLES TABLES
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['demandes','demande_lignes','consentements','notes_internes',
                           'notifications','propositions','evenements','demande_series'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON demandes, notes_internes, notifications, propositions TO jokswed_app;
GRANT SELECT ON demande_lignes, consentements TO jokswed_app;
-- Les événements ne se lisent ni ne s'écrivent directement : uniquement par
-- les fonctions du drain, qui sérialisent la prise en charge.
REVOKE ALL ON evenements, demande_series FROM jokswed_app;

CREATE POLICY demande_tenant ON demandes
  USING (entreprise_destinataire_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_destinataire_id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY ligne_tenant ON demande_lignes FOR SELECT
  USING (demande_id IN (SELECT id FROM demandes));

CREATE POLICY consentement_tenant ON consentements FOR SELECT
  USING (demande_id IN (SELECT id FROM demandes));

CREATE POLICY note_tenant ON notes_internes
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

-- Une notification appartient à SON destinataire. Ni son entreprise, ni son
-- responsable ne la lisent.
CREATE POLICY notification_proprietaire ON notifications
  USING (destinataire_id = app.acteur())
  WITH CHECK (destinataire_id = app.acteur());

-- Une proposition est visible des DEUX entreprises concernées — émettrice et
-- destinataire — et d'elles seules.
CREATE POLICY proposition_parties ON propositions
  USING (entreprise_emettrice_id IN (SELECT unnest(app.entreprises_de_lacteur()))
         OR entreprise_destinataire_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_emettrice_id IN (SELECT unnest(app.entreprises_de_lacteur())));
