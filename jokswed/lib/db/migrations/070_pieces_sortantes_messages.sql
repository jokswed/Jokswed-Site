-- =============================================================================
-- 070 — FICHIERS PDF / IMAGES / BUREAUTIQUE JOINTS AUX MESSAGES CLIENTS
-- =============================================================================
-- L'utilisateur sélectionne des fichiers depuis la barre « + ». Ils arrivent
-- par morceaux (limite de charge HTTP Vercel), puis sont attachés AU MESSAGE
-- dans la même transaction que sa composition : une panne ne crée jamais
-- d'e-mail envoyé sans pièce.
--
-- Le rôle web n'a aucun privilège direct d'écriture dans ces tables.
-- Toutes les fonctions d'upload exigent une session, un prestataire participant,
-- message.envoyer et une conversation client ouverte.
-- Seul le drain lit le contenu des pièces jointes des messages sortants.
-- =============================================================================

CREATE TABLE pieces_messages_temp (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  entreprise_id   uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  utilisateur_id  uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  nom            text NOT NULL,
  type_mime      text NOT NULL,
  taille_attendue integer NOT NULL
                   CHECK (taille_attendue BETWEEN 1 AND 8 * 1024 * 1024),
  contenu        bytea NOT NULL DEFAULT '\x'::bytea,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  expire_le      timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  CONSTRAINT pieces_temp_taille CHECK (octet_length(contenu) <= taille_attendue)
);
CREATE INDEX pieces_temp_expiration ON pieces_messages_temp(expire_le);
CREATE INDEX pieces_temp_proprietaire ON pieces_messages_temp(utilisateur_id, conversation_id);

ALTER TABLE pieces_messages_temp ENABLE ROW LEVEL SECURITY;
-- La table de transit ne se lit ni ne s'écrit directement sous jokswed_app.
REVOKE ALL ON TABLE pieces_messages_temp FROM PUBLIC;
REVOKE ALL ON TABLE pieces_messages_temp FROM jokswed_app;

ALTER TABLE pieces_jointes DROP CONSTRAINT piece_coherente;
ALTER TABLE pieces_jointes DROP CONSTRAINT pieces_jointes_origine_check;
ALTER TABLE pieces_jointes
  ADD CONSTRAINT pieces_jointes_origine_check
  CHECK (origine IN ('document','entrant','fichier'));
ALTER TABLE pieces_jointes ADD CONSTRAINT piece_coherente CHECK (
  (origine = 'document' AND document_id IS NOT NULL AND contenu IS NULL)
  OR (origine = 'entrant' AND document_id IS NULL)
  OR (origine = 'fichier' AND document_id IS NULL
      AND contenu IS NOT NULL AND taille_octets > 0)
);

-- Étape 1. Initialiser un dépôt pour une conversation AUTORISÉE.
CREATE OR REPLACE FUNCTION app.preparer_fichier_message(
  p_conversation uuid, p_nom text, p_type text, p_taille integer)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c conversations%ROWTYPE;
  v_acteur uuid;
  v_nom text;
  v_type text;
  v_ext text;
  v_nombre integer;
  v_octets bigint;
  v_id uuid;
BEGIN
  v_acteur := app.acteur();
  IF v_acteur IS NULL THEN
    RAISE EXCEPTION 'session requise' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation;
  IF NOT FOUND OR v_c.nature <> 'client' OR v_c.statut <> 'ouverte' THEN
    RAISE EXCEPTION 'conversation client ouverte requise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants cp
     WHERE cp.conversation_id = p_conversation
       AND cp.role = 'prestataire' AND cp.retire_le IS NULL
       AND 'message.envoyer' = ANY(app.permissions_de(v_acteur, cp.entreprise_id))
       AND cp.entreprise_id = v_c.entreprise_id
  ) THEN
    RAISE EXCEPTION 'envoi non autorisé' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_nom := btrim(coalesce(p_nom, ''));
  v_type := lower(btrim(coalesce(p_type, '')));
  v_ext := lower(substring(v_nom FROM '\.([^.]+)$'));
  IF length(v_nom) < 3 OR length(v_nom) > 120 OR
     v_nom ~ '[[:cntrl:]/\\]' OR
     v_ext IS NULL OR
     NOT (
       (v_ext = 'pdf' AND v_type = 'application/pdf') OR
       (v_ext IN ('jpg','jpeg') AND v_type = 'image/jpeg') OR
       (v_ext = 'png' AND v_type = 'image/png') OR
       (v_ext = 'gif' AND v_type = 'image/gif') OR
       (v_ext = 'txt' AND v_type = 'text/plain') OR
       (v_ext = 'csv' AND v_type = 'text/csv') OR
       (v_ext = 'docx' AND v_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') OR
       (v_ext = 'xlsx' AND v_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') OR
       (v_ext = 'pptx' AND v_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
     ) THEN
    RAISE EXCEPTION 'format de pièce jointe non autorisé'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_taille IS NULL OR p_taille < 1 OR p_taille > 8 * 1024 * 1024 THEN
    RAISE EXCEPTION 'fichier trop volumineux (maximum 8 Mo)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Le ménage est limité aux dépôts temporaires expirés. Jamais un fichier
  -- déjà rattaché à un message ni une pièce reçue d'un client.
  DELETE FROM pieces_messages_temp WHERE expire_le < now();

  SELECT count(*)::integer, coalesce(sum(taille_attendue),0)::bigint
    INTO v_nombre, v_octets
    FROM pieces_messages_temp
   WHERE utilisateur_id = v_acteur AND conversation_id = p_conversation;
  IF v_nombre >= 4 OR v_octets + p_taille > 10 * 1024 * 1024 THEN
    RAISE EXCEPTION '4 fichiers et 10 Mo maximum par envoi'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO pieces_messages_temp (
    conversation_id, entreprise_id, utilisateur_id, nom, type_mime,
    taille_attendue)
  VALUES (p_conversation, v_c.entreprise_id, v_acteur, v_nom, v_type, p_taille)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.preparer_fichier_message(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.preparer_fichier_message(uuid,text,text,integer)
  TO jokswed_app;

-- Étape 2. Les octets sont ajoutés par blocs de 2 Mo max, dans l'ordre.
-- Une nouvelle tentative avec les mêmes octets est idempotente.
CREATE OR REPLACE FUNCTION app.ajouter_bloc_fichier_message(
  p_fichier uuid, p_conversation uuid, p_decalage integer, p_bloc bytea)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_f pieces_messages_temp%ROWTYPE; v_taille integer; v_bloc integer;
BEGIN
  SELECT * INTO v_f FROM pieces_messages_temp
   WHERE id = p_fichier AND conversation_id = p_conversation
     AND utilisateur_id = app.acteur() AND expire_le > now()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fichier introuvable ou expiré'
    USING ERRCODE = 'insufficient_privilege'; END IF;

  v_taille := octet_length(v_f.contenu);
  v_bloc := octet_length(p_bloc);
  IF p_bloc IS NULL OR v_bloc = 0 OR v_bloc > 2 * 1024 * 1024 THEN
    RAISE EXCEPTION 'bloc de fichier invalide' USING ERRCODE = 'check_violation';
  END IF;
  IF p_decalage < 0 OR p_decalage IS NULL THEN
    RAISE EXCEPTION 'position invalide' USING ERRCODE = 'check_violation';
  END IF;
  IF p_decalage < v_taille AND p_decalage + v_bloc <= v_taille
     AND substring(v_f.contenu FROM p_decalage + 1 FOR v_bloc) = p_bloc THEN
    RETURN v_taille;
  END IF;
  IF p_decalage <> v_taille OR v_taille + v_bloc > v_f.taille_attendue THEN
    RAISE EXCEPTION 'bloc hors séquence / limite dépassée'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE pieces_messages_temp SET contenu = contenu || p_bloc WHERE id = p_fichier;
  RETURN v_taille + v_bloc;
END $$;
REVOKE ALL ON FUNCTION app.ajouter_bloc_fichier_message(uuid,uuid,integer,bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ajouter_bloc_fichier_message(uuid,uuid,integer,bytea)
  TO jokswed_app;

-- Étape 3. Le message et toutes ses pièces sont liés dans UNE transaction.
CREATE OR REPLACE FUNCTION app.joindre_fichier_message(
  p_message uuid, p_fichier uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_m messages%ROWTYPE; v_f pieces_messages_temp%ROWTYPE; v_id uuid;
  v_nb integer; v_taille bigint;
BEGIN
  SELECT * INTO v_m FROM messages WHERE id = p_message FOR UPDATE;
  IF NOT FOUND OR v_m.sens <> 'sortant' OR v_m.statut <> 'en_attente'
     OR v_m.auteur_utilisateur_id IS DISTINCT FROM app.acteur()
     OR app.acteur() IS NULL THEN
    RAISE EXCEPTION 'message non autorisé' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_f FROM pieces_messages_temp
   WHERE id = p_fichier AND utilisateur_id = app.acteur()
     AND conversation_id = v_m.conversation_id
     AND entreprise_id = v_m.auteur_entreprise_id
     AND expire_le > now()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fichier absent ou non autorisé'
    USING ERRCODE = 'insufficient_privilege'; END IF;
  IF octet_length(v_f.contenu) <> v_f.taille_attendue THEN
    RAISE EXCEPTION 'transfert incomplet' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer, coalesce(sum(taille_octets),0)::bigint
    INTO v_nb, v_taille FROM pieces_jointes
    WHERE message_id = p_message AND origine = 'fichier';
  IF v_nb >= 4 OR v_taille + v_f.taille_attendue > 10 * 1024 * 1024 THEN
    RAISE EXCEPTION 'limite de pièces jointes dépassée'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO pieces_jointes (
    message_id, origine, nom, type_mime, taille_octets, contenu)
  VALUES (p_message,'fichier',v_f.nom,v_f.type_mime,v_f.taille_attendue,v_f.contenu)
  RETURNING id INTO v_id;
  DELETE FROM pieces_messages_temp WHERE id = p_fichier;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.joindre_fichier_message(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.joindre_fichier_message(uuid,uuid) TO jokswed_app;

-- L'utilisateur peut abandonner une pièce préparée sans la conserver.
CREATE OR REPLACE FUNCTION app.annuler_fichier_message(
  p_conversation uuid, p_fichier uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM pieces_messages_temp WHERE id = p_fichier
    AND conversation_id = p_conversation
    AND utilisateur_id = app.acteur();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $$;
REVOKE ALL ON FUNCTION app.annuler_fichier_message(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.annuler_fichier_message(uuid,uuid) TO jokswed_app;

-- Le drain lit uniquement les fichiers d'un message SORTANT encore à livrer ;
-- aucun octet de pièce ENTRANTE n'est exposé par cette fonction.
CREATE OR REPLACE FUNCTION app.fichiers_pour_envoi(p_message uuid)
RETURNS TABLE (nom text, type_mime text, contenu bytea, taille_octets integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.nom,p.type_mime,p.contenu,p.taille_octets
    FROM pieces_jointes p
    JOIN messages m ON m.id=p.message_id
    JOIN conversations c ON c.id=m.conversation_id
   WHERE m.id=p_message
     AND m.sens='sortant' AND m.statut IN ('en_attente','echoue')
     AND c.nature='client' AND m.auteur_entreprise_id=c.entreprise_id
     AND p.origine='fichier' AND p.contenu IS NOT NULL
   ORDER BY p.cree_le,p.id
$$;
REVOKE ALL ON FUNCTION app.fichiers_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fichiers_pour_envoi(uuid) TO jokswed_app;
