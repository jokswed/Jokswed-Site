-- =============================================================================
-- 069 — UNE DEMANDE PUBLIQUE DEVIENT UN FIL CLIENT
-- =============================================================================
-- L'accueil d'une demande et son texte d'origine sont persistés dans la même
-- transaction. La première réponse du professionnel s'insère dans ce fil.
-- On ne mélange jamais avec les notes internes du dossier : elles restent
-- dans notes_internes et ne sont jamais transmises au client.
--
-- Le rattrapage des demandes historiques conserve les conversations existantes
-- et leurs jetons de réponse. Aucun message déjà reçu n'est déplacé.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.assurer_fil_demande(p_demande_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_d demandes%ROWTYPE;
  v_id uuid;
  v_jeton text;
BEGIN
  SELECT * INTO v_d FROM demandes WHERE id = p_demande_id;
  IF NOT FOUND OR v_d.origine <> 'formulaire_public' THEN RETURN NULL; END IF;

  -- Les doubles appels concurrents ne fabriquent pas deux fils.
  PERFORM pg_advisory_xact_lock(hashtext('demande-fil-jokswed'), hashtext(v_d.id::text));

  -- Une demande peut avoir été ouverte manuellement avant ce palier :
  -- réutiliser le fil connu du client, sans changer son jeton de réponse.
  SELECT c.id INTO v_id
    FROM conversations c
    JOIN conversation_participants cp
      ON cp.conversation_id = c.id AND cp.role = 'client'
     AND cp.retire_le IS NULL AND cp.contact_email = v_d.contact_email
   WHERE c.entreprise_id = v_d.entreprise_destinataire_id
     AND c.demande_id = v_d.id AND c.nature = 'client'
   ORDER BY (c.statut = 'ouverte') DESC, c.derniere_activite_le DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    -- 256 bits de hasard, hexadécimal accepté par le parseur de l'adresse rep+.
    v_jeton := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO conversations (
      entreprise_id, nature, sujet, demande_id, mariage_id,
      jeton_reponse, derniere_activite_le)
    VALUES (
      v_d.entreprise_destinataire_id, 'client',
      'Votre demande de mariage ' || v_d.reference || ' — JoksWed',
      v_d.id, v_d.mariage_id, v_jeton, v_d.cree_le)
    RETURNING id INTO v_id;

    INSERT INTO conversation_participants (conversation_id, role, entreprise_id)
    VALUES (v_id, 'prestataire', v_d.entreprise_destinataire_id);

    INSERT INTO conversation_participants (
      conversation_id, role, contact_email, nom)
    VALUES (v_id, 'client', v_d.contact_email, v_d.contact_nom);
  END IF;

  -- La note saisie par le client est la première bulle, mais jamais une note
  -- interne ni un message "sortant". Clé idempotente par demande et par fil.
  IF nullif(btrim(v_d.message), '') IS NOT NULL THEN
    INSERT INTO messages (
      conversation_id, sens, auteur_email, auteur_nom, sujet,
      corps_texte, statut, fournisseur, cle_idempotence, cree_le)
    VALUES (
      v_id, 'entrant', v_d.contact_email, v_d.contact_nom,
      'Demande initiale ' || v_d.reference,
      v_d.message, 'recu', 'formulaire',
      'demande-initiale:' || v_d.id::text, v_d.cree_le)
    ON CONFLICT (conversation_id, cle_idempotence)
      WHERE cle_idempotence IS NOT NULL DO NOTHING;
  END IF;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.assurer_fil_demande(uuid) FROM PUBLIC;
-- Pas de GRANT au rôle applicatif : seule la fonction déclencheur l'utilise.

CREATE OR REPLACE FUNCTION app.demande_creer_fil_client()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.origine = 'formulaire_public' THEN
    PERFORM app.assurer_fil_demande(NEW.id);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER demande_creer_fil_client
AFTER INSERT ON demandes
FOR EACH ROW EXECUTE FUNCTION app.demande_creer_fil_client();

-- Le drain d'accusé de réception n'a pas de session admin. La fonction
-- spécialisée ne rend qu'un jeton de réponse pour cette demande, jamais les
-- coordonnées des autres clients ni le contenu des conversations.
CREATE OR REPLACE FUNCTION app.jeton_reponse_demande(p_demande uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.jeton_reponse
    FROM demandes d
    JOIN conversations c
      ON c.demande_id = d.id
     AND c.entreprise_id = d.entreprise_destinataire_id
     AND c.nature = 'client'
    JOIN conversation_participants cp
      ON cp.conversation_id = c.id AND cp.role = 'client'
     AND cp.retire_le IS NULL AND cp.contact_email = d.contact_email
   WHERE d.id = p_demande AND d.origine = 'formulaire_public'
   ORDER BY (c.statut = 'ouverte') DESC, c.derniere_activite_le DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.jeton_reponse_demande(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.jeton_reponse_demande(uuid) TO jokswed_app;

-- Rattrapage sans fusion risquée : une conversation existante est conservée,
-- et la note initiale n'est insérée qu'une fois.
DO $$
DECLARE v_d record;
BEGIN
  FOR v_d IN
    SELECT id FROM demandes
     WHERE origine = 'formulaire_public' AND nullif(btrim(message), '') IS NOT NULL
     ORDER BY cree_le
  LOOP
    PERFORM app.assurer_fil_demande(v_d.id);
  END LOOP;
END $$;
