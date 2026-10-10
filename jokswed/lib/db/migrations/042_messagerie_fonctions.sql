-- =============================================================================
-- 042 — LES GESTES DE LA MESSAGERIE
-- =============================================================================

-- --- Ouvrir une conversation -------------------------------------------------
CREATE OR REPLACE FUNCTION app.ouvrir_conversation(
  p_entreprise uuid, p_nature text, p_sujet text, p_jeton text,
  p_demande_id uuid DEFAULT NULL, p_dossier_id uuid DEFAULT NULL,
  p_client_email citext DEFAULT NULL, p_client_nom text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_id uuid; v_mariage uuid;
BEGIN
  v_acteur := app.exiger(p_entreprise, 'message.envoyer');
  IF p_nature NOT IN ('client','partagee','interne') THEN
    RAISE EXCEPTION 'nature de conversation inconnue' USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠️ UNE CONVERSATION « CLIENT » SANS CLIENT N'A PAS DE SENS.
  -- Et une conversation interne AVEC un client serait exactement le piège
  -- qu'on veut rendre impossible.
  IF p_nature = 'client' AND p_client_email IS NULL THEN
    RAISE EXCEPTION 'une conversation client exige une adresse de client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_nature <> 'client' AND p_client_email IS NOT NULL THEN
    RAISE EXCEPTION 'une conversation % ne peut pas avoir de participant client', p_nature
      USING ERRCODE = 'check_violation';
  END IF;

  -- Le rattachement doit appartenir à l'entreprise : on ne s'accroche pas au
  -- dossier d'autrui pour en lire le mariage.
  IF p_demande_id IS NOT NULL THEN
    SELECT mariage_id INTO v_mariage FROM demandes
     WHERE id = p_demande_id AND entreprise_destinataire_id = p_entreprise;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'demande étrangère à cette entreprise'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF p_dossier_id IS NOT NULL THEN
    SELECT mariage_id INTO v_mariage FROM dossiers
     WHERE id = p_dossier_id AND entreprise_id = p_entreprise;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'dossier étranger à cette entreprise'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO conversations (entreprise_id, nature, sujet, demande_id, dossier_id,
                             mariage_id, jeton_reponse, cree_par)
  VALUES (p_entreprise, p_nature, p_sujet, p_demande_id, p_dossier_id,
          v_mariage, p_jeton, v_acteur)
  RETURNING id INTO v_id;

  INSERT INTO conversation_participants (conversation_id, role, entreprise_id, ajoute_par)
  VALUES (v_id, 'prestataire', p_entreprise, v_acteur);

  IF p_client_email IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, role, contact_email, nom, ajoute_par)
    VALUES (v_id, 'client', p_client_email, p_client_nom, v_acteur);
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_entreprise, 'conversation.ouverte', 'conversation', v_id::text,
          jsonb_build_object('nature', p_nature));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.ouvrir_conversation(uuid, text, text, text, uuid, uuid, citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvrir_conversation(uuid, text, text, text, uuid, uuid, citext, text) TO jokswed_app;

-- --- Ajouter un participant ---------------------------------------------------
CREATE OR REPLACE FUNCTION app.ajouter_participant(
  p_conversation uuid, p_role text, p_entreprise uuid,
  p_email citext DEFAULT NULL, p_nom text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation;
  IF v_c IS NULL THEN RETURN false; END IF;

  -- ⚠️ SEUL UN PARTICIPANT AJOUTE UN PARTICIPANT.
  -- Et il lui faut `message.envoyer` : lire une conversation ne donne pas le
  -- droit d'y faire entrer quelqu'un.
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants cp
     WHERE cp.conversation_id = p_conversation AND cp.role = 'prestataire'
       AND cp.retire_le IS NULL
       AND 'message.envoyer' = ANY (app.permissions_de(app.acteur(), cp.entreprise_id))) THEN
    RAISE EXCEPTION 'vous ne participez pas à cette conversation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.acteur();

  -- ⚠️ ON N'AJOUTE PAS UN CLIENT À UNE CONVERSATION INTERNE.
  -- C'est la règle qui empêche qu'une note devienne un e-mail. La nature
  -- d'une conversation ne change jamais ; on en ouvre une autre.
  IF p_role = 'client' AND v_c.nature <> 'client' THEN
    RAISE EXCEPTION
      'conversation % : on n''y ajoute pas de client (ouvrez-en une nouvelle)', v_c.nature
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_role = 'prestataire' THEN
    INSERT INTO conversation_participants (conversation_id, role, entreprise_id, nom, ajoute_par)
    VALUES (p_conversation, 'prestataire', p_entreprise, p_nom, v_acteur)
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO conversation_participants (conversation_id, role, contact_email, nom, ajoute_par)
    VALUES (p_conversation, 'client', p_email, p_nom, v_acteur)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_c.entreprise_id, 'conversation.participant', 'conversation',
          p_conversation::text,
          jsonb_build_object('role', p_role, 'entreprise', p_entreprise, 'email', p_email));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.ajouter_participant(uuid, text, uuid, citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ajouter_participant(uuid, text, uuid, citext, text) TO jokswed_app;

-- --- Composer un message ------------------------------------------------------
CREATE OR REPLACE FUNCTION app.composer_message(
  p_conversation uuid, p_sens text, p_corps_texte text, p_corps_html text,
  p_sujet text, p_cle text, p_identite_adresse citext DEFAULT NULL,
  p_identite_nom text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c RECORD; v_acteur uuid; v_ent uuid; v_id uuid;
BEGIN
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'conversation introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_c.statut = 'archivee' THEN
    RAISE EXCEPTION 'conversation archivée : rouvrez-la pour écrire'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- L'entreprise participante au nom de laquelle on écrit.
  SELECT cp.entreprise_id INTO v_ent
    FROM conversation_participants cp
   WHERE cp.conversation_id = p_conversation AND cp.role = 'prestataire'
     AND cp.retire_le IS NULL
     AND 'message.envoyer' = ANY (app.permissions_de(app.acteur(), cp.entreprise_id))
   LIMIT 1;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'vous ne pouvez pas écrire dans cette conversation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.acteur();

  -- ⚠️ ON NE COMPOSE PAS UN SORTANT DANS UNE CONVERSATION SANS CLIENT.
  -- Deuxième verrou, après la contrainte de table : l'un dit « un interne
  -- ne part pas », celui-ci dit « il n'y a personne à qui envoyer ».
  IF p_sens = 'sortant' AND v_c.nature <> 'client' THEN
    RAISE EXCEPTION
      'conversation % : aucun client n''y participe, un message sortant n''a nulle part où aller',
      v_c.nature USING ERRCODE = 'check_violation';
  END IF;
  IF p_sens NOT IN ('sortant','interne') THEN
    RAISE EXCEPTION 'sens invalide pour une composition' USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠️ ON N'ÉCRIT PAS DEPUIS UNE IDENTITÉ QU'ON NE POSSÈDE PAS.
  IF p_identite_adresse IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM identites_messagerie i
     WHERE i.adresse = p_identite_adresse AND i.entreprise_id = v_ent
       AND i.statut = 'active'
       AND (i.utilisateur_id IS NULL OR i.utilisateur_id = v_acteur)) THEN
    RAISE EXCEPTION 'identité d''expédition non autorisée : %', p_identite_adresse
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO messages (conversation_id, sens, auteur_utilisateur_id, auteur_entreprise_id,
                        auteur_email, auteur_nom, sujet, corps_texte, corps_html,
                        statut, cle_idempotence)
  VALUES (p_conversation, p_sens, v_acteur, v_ent, p_identite_adresse, p_identite_nom,
          coalesce(p_sujet, v_c.sujet), p_corps_texte, p_corps_html,
          CASE WHEN p_sens = 'interne' THEN 'brouillon' ELSE 'en_attente' END,
          p_cle)
  ON CONFLICT (conversation_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM messages
     WHERE conversation_id = p_conversation AND cle_idempotence = p_cle;
    RETURN v_id;
  END IF;

  UPDATE conversations SET derniere_activite_le = now() WHERE id = p_conversation;

  -- Un message sortant devient un événement : l'envoi se fait au drain,
  -- hors transaction. Une panne du fournisseur ne perd pas le message, et
  -- une transaction annulée ne laisse pas partir d'e-mail.
  IF p_sens = 'sortant' THEN
    INSERT INTO evenements (type, charge_utile, cle_idempotence)
    VALUES ('message.envoyer', jsonb_build_object('message_id', v_id),
            'message.envoyer:' || v_id::text)
    ON CONFLICT (cle_idempotence) DO NOTHING;
  END IF;

  -- L'auteur a lu son propre message.
  INSERT INTO messages_lus (message_id, utilisateur_id) VALUES (v_id, v_acteur)
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.composer_message(uuid, text, text, text, text, text, citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.composer_message(uuid, text, text, text, text, text, citext, text) TO jokswed_app;

-- --- Joindre un document ------------------------------------------------------
CREATE OR REPLACE FUNCTION app.joindre_document(p_message uuid, p_document uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_m RECORD; v_d RECORD; v_id uuid;
BEGIN
  SELECT m.*, c.nature INTO v_m FROM messages m
    JOIN conversations c ON c.id = m.conversation_id WHERE m.id = p_message;
  IF v_m IS NULL THEN RETURN NULL; END IF;
  IF v_m.statut NOT IN ('brouillon','en_attente') THEN
    RAISE EXCEPTION 'message déjà parti : on n''y ajoute plus de pièce'
      USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM app.exiger(v_m.auteur_entreprise_id, 'message.envoyer');

  SELECT * INTO v_d FROM documents WHERE id = p_document;
  IF v_d IS NULL THEN RETURN NULL; END IF;

  -- ⚠️ LE DOCUMENT D'UNE AUTRE ENTREPRISE NE SE JOINT PAS.
  IF v_d.entreprise_id <> v_m.auteur_entreprise_id THEN
    RAISE EXCEPTION 'ce document appartient à une autre entreprise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM app.exiger(v_d.entreprise_id, 'document.envoyer');

  -- ⚠️ UN BROUILLON NE S'ENVOIE PAS AU CLIENT.
  -- Il porte le bandeau « SANS VALEUR », n'a pas de numéro, et rien ne le
  -- rend opposable. L'envoyer, c'est laisser croire qu'il engage.
  IF v_d.statut = 'brouillon' AND v_m.sens = 'sortant' THEN
    RAISE EXCEPTION
      'document % : un brouillon ne peut pas être envoyé au client — émettez-le d''abord',
      coalesce(v_d.numero, v_d.id::text) USING ERRCODE = 'restrict_violation';
  END IF;

  INSERT INTO pieces_jointes (message_id, origine, document_id, nom, type_mime, taille_octets)
  VALUES (p_message, 'document', p_document,
          coalesce(v_d.numero, v_d.type) || '.pdf', 'application/pdf', 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.joindre_document(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.joindre_document(uuid, uuid) TO jokswed_app;

-- --- Archiver / rouvrir / marquer lu -----------------------------------------
CREATE OR REPLACE FUNCTION app.archiver_conversation(p_conversation uuid, p_archiver boolean)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid;
BEGIN
  SELECT cp.entreprise_id INTO v_ent FROM conversation_participants cp
   WHERE cp.conversation_id = p_conversation AND cp.role = 'prestataire'
     AND cp.retire_le IS NULL
     AND 'message.envoyer' = ANY (app.permissions_de(app.acteur(), cp.entreprise_id))
   LIMIT 1;
  IF v_ent IS NULL THEN RETURN false; END IF;
  UPDATE conversations SET statut = CASE WHEN p_archiver THEN 'archivee' ELSE 'ouverte' END
   WHERE id = p_conversation;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.archiver_conversation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.archiver_conversation(uuid, boolean) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.marquer_lue(p_conversation uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_n integer;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN RETURN 0; END IF;
  IF p_conversation NOT IN (SELECT app.conversations_de_lacteur()) THEN RETURN 0; END IF;
  WITH pose AS (
    INSERT INTO messages_lus (message_id, utilisateur_id)
    SELECT m.id, v_acteur FROM messages m
     WHERE m.conversation_id = p_conversation
       AND NOT EXISTS (SELECT 1 FROM messages_lus l
                        WHERE l.message_id = m.id AND l.utilisateur_id = v_acteur)
    RETURNING 1)
  SELECT count(*)::integer INTO v_n FROM pose;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION app.marquer_lue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.marquer_lue(uuid) TO jokswed_app;
