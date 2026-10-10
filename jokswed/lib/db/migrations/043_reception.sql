-- =============================================================================
-- 043 — RÉCEPTION D'UNE RÉPONSE
-- -----------------------------------------------------------------------------
-- ⚠️ LE RATTACHEMENT NE SE DEVINE PAS.
--
-- Un e-mail entrant peut porter n'importe quel `In-Reply-To`, n'importe quel
-- sujet, et prétendre venir de n'importe qui : rien de tout cela n'est
-- authentifié. Se fier au sujet (« Re: Votre mariage ») rattacherait le
-- message du couple A à la conversation du couple B. Se fier à
-- `In-Reply-To` seul laisserait n'importe qui écrire dans une conversation
-- dont il devine l'identifiant.
--
-- LA SEULE AUTORITÉ, C'EST L'ADRESSE DE RÉPONSE. Chaque conversation a un
-- jeton de 128 bits ; nos envois portent `Reply-To: rep+<jeton>@…`. Une
-- réponse arrive donc à une adresse que seul le destinataire de nos messages
-- a pu recevoir. `In-Reply-To` ne sert qu'à vérifier la cohérence, jamais à
-- décider.
--
-- ⚠️ ET L'EXPÉDITEUR DOIT ÊTRE PARTICIPANT.
-- Connaître l'adresse de réponse ne suffit pas : il faut aussi écrire depuis
-- une adresse qui participe à la conversation. Un courrier transféré à un
-- tiers ne lui ouvre donc pas le fil.
--
-- Ce qui ne remplit pas ces deux conditions n'est pas jeté : il part en
-- quarantaine (`messages_orphelins`), avec le motif.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.recevoir_message(
  p_jeton text,
  p_expediteur citext,
  p_nom text,
  p_message_id_rfc text,
  p_in_reply_to text,
  p_sujet text,
  p_corps_texte text,
  p_corps_html text,
  p_destinataires text[],
  p_charge jsonb)
RETURNS TABLE (message_id uuid, conversation_id uuid, orphelin boolean, motif text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c RECORD; v_id uuid; v_m RECORD; v_existant uuid; v_participe boolean;
BEGIN
  -- ⚠️ DÉDUPLICATION D'ABORD. Un webhook rejoué ne doit pas créer deux
  -- messages, ni deux notifications. On répond en rendant l'existant.
  IF p_message_id_rfc IS NOT NULL THEN
    SELECT m.id, m.conversation_id INTO v_existant, conversation_id
      FROM messages m WHERE m.message_id_rfc = p_message_id_rfc;
    IF v_existant IS NOT NULL THEN
      RETURN QUERY SELECT v_existant, conversation_id, false, 'déjà reçu'::text;
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM messages_orphelins o
                WHERE o.message_id_rfc = p_message_id_rfc) THEN
      RETURN QUERY SELECT NULL::uuid, NULL::uuid, true, 'déjà en quarantaine'::text;
      RETURN;
    END IF;
  END IF;

  IF p_jeton IS NOT NULL THEN
    SELECT * INTO v_c FROM conversations WHERE jeton_reponse = p_jeton;
  END IF;

  IF v_c IS NULL THEN
    INSERT INTO messages_orphelins (message_id_rfc, expediteur, destinataires, sujet,
                                    corps_texte, motif, charge_utile)
    VALUES (p_message_id_rfc, p_expediteur, p_destinataires, p_sujet, p_corps_texte,
            CASE WHEN p_jeton IS NULL
                 THEN 'aucun jeton de réponse dans les destinataires'
                 ELSE 'jeton de réponse inconnu' END,
            p_charge)
    ON CONFLICT (message_id_rfc) DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, true,
      'rattachement impossible : jeton absent ou inconnu'::text;
    RETURN;
  END IF;

  -- ⚠️ UNE CONVERSATION INTERNE NE REÇOIT RIEN DE L'EXTÉRIEUR.
  -- Elle n'a jamais rien envoyé, donc personne n'a pu obtenir son adresse de
  -- réponse — sauf à l'avoir devinée ou volée.
  IF v_c.nature <> 'client' THEN
    INSERT INTO messages_orphelins (message_id_rfc, expediteur, destinataires, sujet,
                                    corps_texte, motif, charge_utile)
    VALUES (p_message_id_rfc, p_expediteur, p_destinataires, p_sujet, p_corps_texte,
            'conversation ' || v_c.nature || ' : elle ne reçoit pas de courrier externe',
            p_charge)
    ON CONFLICT (message_id_rfc) DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, true,
      'conversation non destinée au courrier externe'::text;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM conversation_participants cp
     WHERE cp.conversation_id = v_c.id AND cp.role = 'client'
       AND cp.retire_le IS NULL AND cp.contact_email = p_expediteur)
    INTO v_participe;

  IF NOT v_participe THEN
    INSERT INTO messages_orphelins (message_id_rfc, expediteur, destinataires, sujet,
                                    corps_texte, motif, charge_utile)
    VALUES (p_message_id_rfc, p_expediteur, p_destinataires, p_sujet, p_corps_texte,
            'expéditeur non participant de la conversation visée', p_charge)
    ON CONFLICT (message_id_rfc) DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, true,
      'expéditeur non participant'::text;
    RETURN;
  END IF;

  INSERT INTO messages (conversation_id, sens, auteur_email, auteur_nom, sujet,
                        corps_texte, corps_html, message_id_rfc, in_reply_to,
                        statut, fournisseur, cree_le)
  VALUES (v_c.id, 'entrant', p_expediteur, p_nom, p_sujet,
          coalesce(p_corps_texte, ''), p_corps_html, p_message_id_rfc, p_in_reply_to,
          'recu', 'brevo', now())
  RETURNING id INTO v_id;

  UPDATE conversations SET derniere_activite_le = now(), statut = 'ouverte'
   WHERE id = v_c.id;

  -- Notifier chaque prestataire participant, selon ses permissions et ses
  -- préférences — `app.notifier` s'en charge.
  FOR v_m IN
    SELECT ma.* FROM conversation_participants cp
      CROSS JOIN LATERAL app.membres_avec(cp.entreprise_id, 'message.lire') ma
     WHERE cp.conversation_id = v_c.id AND cp.role = 'prestataire'
       AND cp.retire_le IS NULL
  LOOP
    PERFORM app.notifier(v_m.utilisateur_id, v_c.entreprise_id,
      'message.recu', 'Nouvelle réponse — ' || left(v_c.sujet, 60),
      NULL, '/admin/messagerie/' || v_c.id::text,
      'message.recu:' || v_id::text);
  END LOOP;

  RETURN QUERY SELECT v_id, v_c.id, false, NULL::text;
END $$;
REVOKE ALL ON FUNCTION app.recevoir_message(text, citext, text, text, text, text, text, text, text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.recevoir_message(text, citext, text, text, text, text, text, text, text[], jsonb) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.joindre_piece_entrante(
  p_message uuid, p_nom text, p_type text, p_contenu bytea)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_contenu IS NULL OR octet_length(p_contenu) = 0 THEN RETURN NULL; END IF;
  INSERT INTO pieces_jointes (message_id, origine, nom, type_mime, taille_octets, contenu)
  VALUES (p_message, 'entrant', p_nom, p_type, octet_length(p_contenu), p_contenu)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.joindre_piece_entrante(uuid, text, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.joindre_piece_entrante(uuid, text, text, bytea) TO jokswed_app;

-- --- Ce que le drain lit pour envoyer un message -----------------------------
-- Même raison qu'au palier 015 : le drain n'a pas d'acteur, donc la RLS lui
-- rendrait zéro ligne et l'envoi serait sauté EN SILENCE.
CREATE OR REPLACE FUNCTION app.message_pour_envoi(p_message_id uuid)
RETURNS TABLE (
  message_id uuid, conversation_id uuid, sujet text, corps_texte text,
  corps_html text, auteur_email citext, auteur_nom text,
  entreprise_id uuid, entreprise_nom text,
  jeton_reponse text, destinataires jsonb, documents uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, c.id, coalesce(m.sujet, c.sujet), m.corps_texte, m.corps_html,
         m.auteur_email, m.auteur_nom, m.auteur_entreprise_id, e.nom_commercial,
         c.jeton_reponse,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('email', cp.contact_email,
                                                       'nom', cp.nom)), '[]'::jsonb)
            FROM conversation_participants cp
           WHERE cp.conversation_id = c.id AND cp.role = 'client' AND cp.retire_le IS NULL),
         (SELECT coalesce(array_agg(pj.document_id), '{}'::uuid[])
            FROM pieces_jointes pj
           WHERE pj.message_id = m.id AND pj.origine = 'document')
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN entreprises e ON e.id = m.auteur_entreprise_id
   WHERE m.id = p_message_id
     AND m.sens = 'sortant'
     AND m.statut IN ('en_attente','echoue')
     -- Ceinture et bretelles : même ici, un interne ne sortirait pas.
     AND c.nature = 'client'
$$;
REVOKE ALL ON FUNCTION app.message_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.message_pour_envoi(uuid) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.message_envoye(
  p_message_id uuid, p_statut text, p_fournisseur text,
  p_fournisseur_id text, p_message_id_rfc text, p_erreur text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE messages
     SET statut = p_statut, fournisseur = p_fournisseur, fournisseur_id = p_fournisseur_id,
         message_id_rfc = coalesce(p_message_id_rfc, message_id_rfc),
         erreur = p_erreur,
         envoye_le = CASE WHEN p_statut = 'envoye' THEN now() ELSE envoye_le END
   WHERE id = p_message_id
$$;
REVOKE ALL ON FUNCTION app.message_envoye(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.message_envoye(uuid, text, text, text, text, text) TO jokswed_app;

-- Le type de notification pour un message reçu.
INSERT INTO types_notification (cle, libelle, permission, defaut_app, defaut_email)
VALUES ('message.recu', 'Réponse reçue d''un client', 'message.lire', true, false)
ON CONFLICT (cle) DO NOTHING;
