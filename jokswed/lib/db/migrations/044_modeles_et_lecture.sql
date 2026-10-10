-- =============================================================================
-- 044 — MODÈLES DE RÉPONSE, ET LES VUES DE LA MESSAGERIE
-- =============================================================================

-- ⚠️ LES VARIABLES SONT UNE LISTE FERMÉE.
-- `{{prenom_client}}`, `{{date_mariage}}`… sont remplacées côté serveur à
-- partir du dossier. Un modèle ne peut donc pas aller chercher autre chose
-- que ce que cette liste autorise — et une variable inconnue reste visible
-- telle quelle dans l'aperçu, plutôt que de disparaître en silence.
INSERT INTO modeles_reponse (entreprise_id, cle, libelle, sujet, corps, ordre, systeme) VALUES
 (NULL, 'nouvelle_demande', 'Réponse à une nouvelle demande',
  'Votre demande pour le {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nMerci pour votre message et félicitations pour votre mariage.\n\nJ''ai bien noté votre date du {{date_mariage}}{{lieu_phrase}}. Je reviens vers vous très vite avec une proposition adaptée.\n\nÀ très bientôt,\n{{signature}}', 1, true),

 (NULL, 'disponibilite', 'Confirmation de disponibilité',
  'Je suis disponible le {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nJe vous confirme ma disponibilité pour votre mariage du {{date_mariage}}.\n\nJe vous prépare un devis détaillé dans la foulée. N''hésitez pas si vous avez des questions d''ici là.\n\nBien à vous,\n{{signature}}', 2, true),

 (NULL, 'informations', 'Demande d''informations complémentaires',
  'Quelques précisions sur votre mariage du {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nPour affiner ma proposition, auriez-vous quelques précisions à me donner ?\n\n- Le lieu de la cérémonie et celui de la réception\n- Le nombre d''invités attendu\n- Les horaires envisagés, même approximatifs\n\nMerci d''avance,\n{{signature}}', 3, true),

 (NULL, 'envoi_devis', 'Envoi du devis',
  'Votre devis — mariage du {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nVous trouverez ci-joint le devis pour votre mariage du {{date_mariage}}, d''un montant de {{montant_total}}.\n\nIl est valable 30 jours. Je reste à votre disposition pour en discuter ou l''ajuster.\n\nBien à vous,\n{{signature}}', 4, true),

 (NULL, 'envoi_contrat', 'Envoi du contrat',
  'Votre contrat — mariage du {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nVoici le contrat de prestation pour votre mariage du {{date_mariage}}, accompagné des conditions générales.\n\nLa réservation sera définitive à réception du contrat signé et du premier versement de {{montant_acompte}}.\n\nBien à vous,\n{{signature}}', 5, true),

 (NULL, 'relance_paiement', 'Relance de paiement',
  'Votre mariage du {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nJe me permets un petit rappel concernant le règlement de {{montant_restant}} pour votre mariage du {{date_mariage}}.\n\nSi le virement est déjà parti, merci de ne pas tenir compte de ce message.\n\nBien à vous,\n{{signature}}', 6, true),

 (NULL, 'confirmation_reservation', 'Confirmation de réservation',
  'C''est confirmé — {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nJ''ai bien reçu votre contrat signé et votre premier versement : votre date du {{date_mariage}} est réservée.\n\nNous reparlerons du déroulé à l''approche du jour J.\n\nÀ très bientôt,\n{{signature}}', 7, true),

 (NULL, 'preparation', 'Préparation du mariage',
  'Préparons votre journée du {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nVotre mariage approche. Je vous propose qu''on fasse le point ensemble sur le déroulé de la journée.\n\nSeriez-vous disponibles pour un échange dans les prochains jours ?\n\nBien à vous,\n{{signature}}', 8, true),

 (NULL, 'planning_definitif', 'Demande du planning définitif',
  'Votre planning définitif — {{date_mariage}}',
  E'Bonjour {{prenom_client}},\n\nPourriez-vous m''envoyer le planning définitif de la journée du {{date_mariage}} ?\n\nLes horaires des préparatifs, de la cérémonie et de la réception me suffisent, ainsi que les coordonnées d''une personne à contacter sur place.\n\nMerci,\n{{signature}}', 9, true)
ON CONFLICT DO NOTHING;

/* Les modèles copiés dans chaque entreprise existante et future. */
CREATE OR REPLACE FUNCTION app.installer_modeles(p_entreprise uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  WITH pose AS (
    INSERT INTO modeles_reponse (entreprise_id, cle, libelle, sujet, corps, ordre, systeme)
    SELECT p_entreprise, m.cle, m.libelle, m.sujet, m.corps, m.ordre, true
      FROM modeles_reponse m WHERE m.entreprise_id IS NULL
    ON CONFLICT DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO v_n FROM pose;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION app.installer_modeles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.installer_modeles(uuid) TO jokswed_app;

SELECT app.installer_modeles(id) FROM entreprises;

-- -----------------------------------------------------------------------------
-- LES VUES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.mes_conversations(
  p_entreprise uuid, p_archivees boolean DEFAULT false, p_recherche text DEFAULT NULL)
RETURNS TABLE (
  id uuid, sujet text, nature text, statut text,
  demande_id uuid, dossier_id uuid, mariage_id uuid,
  reference text, client_nom text, client_email citext,
  participants text[], derniere_activite_le timestamptz,
  messages_nb integer, non_lus integer, apercu text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  PERFORM app.exiger(p_entreprise, 'message.lire');
  v_acteur := app.acteur();
  RETURN QUERY
  SELECT c.id, c.sujet, c.nature, c.statut,
         c.demande_id, c.dossier_id, c.mariage_id,
         coalesce(d.reference, do2.reference),
         cl.nom, cl.contact_email,
         (SELECT coalesce(array_agg(DISTINCT coalesce(e.nom_commercial, p2.nom,
                                                      p2.contact_email::text)), '{}')
            FROM conversation_participants p2
            LEFT JOIN entreprises e ON e.id = p2.entreprise_id
           WHERE p2.conversation_id = c.id AND p2.retire_le IS NULL),
         c.derniere_activite_le,
         (SELECT count(*)::integer FROM messages m WHERE m.conversation_id = c.id),
         (SELECT count(*)::integer FROM messages m
           WHERE m.conversation_id = c.id
             AND NOT EXISTS (SELECT 1 FROM messages_lus l
                              WHERE l.message_id = m.id AND l.utilisateur_id = v_acteur)),
         (SELECT left(m.corps_texte, 140) FROM messages m
           WHERE m.conversation_id = c.id ORDER BY m.cree_le DESC LIMIT 1)
    FROM conversations c
    JOIN conversation_participants cp
      ON cp.conversation_id = c.id AND cp.entreprise_id = p_entreprise
     AND cp.role = 'prestataire' AND cp.retire_le IS NULL
    LEFT JOIN demandes d ON d.id = c.demande_id
    LEFT JOIN dossiers do2 ON do2.id = c.dossier_id
    LEFT JOIN conversation_participants cl
      ON cl.conversation_id = c.id AND cl.role = 'client' AND cl.retire_le IS NULL
   WHERE (p_archivees OR c.statut = 'ouverte')
     AND (p_recherche IS NULL OR p_recherche = ''
          OR c.sujet ILIKE '%' || p_recherche || '%'
          OR cl.nom ILIKE '%' || p_recherche || '%'
          OR cl.contact_email::text ILIKE '%' || p_recherche || '%'
          OR EXISTS (SELECT 1 FROM messages m
                      WHERE m.conversation_id = c.id
                        AND m.corps_texte ILIKE '%' || p_recherche || '%'))
   ORDER BY c.derniere_activite_le DESC;
END $$;
REVOKE ALL ON FUNCTION app.mes_conversations(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mes_conversations(uuid, boolean, text) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.fil_conversation(p_conversation uuid)
RETURNS TABLE (
  id uuid, sens text, auteur_nom text, auteur_email citext,
  auteur_entreprise text, sujet text, corps_texte text, corps_html text,
  statut text, erreur text, cree_le timestamptz, envoye_le timestamptz,
  lu boolean, pieces jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  IF p_conversation NOT IN (SELECT app.conversations_de_lacteur()) THEN RETURN; END IF;
  v_acteur := app.acteur();
  RETURN QUERY
  SELECT m.id, m.sens,
         coalesce(m.auteur_nom, u.prenom || ' ' || u.nom, m.auteur_email::text),
         m.auteur_email, e.nom_commercial, m.sujet, m.corps_texte, m.corps_html,
         m.statut, m.erreur, m.cree_le, m.envoye_le,
         EXISTS (SELECT 1 FROM messages_lus l
                  WHERE l.message_id = m.id AND l.utilisateur_id = v_acteur),
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', pj.id, 'nom', pj.nom, 'type', pj.type_mime,
                   'octets', pj.taille_octets, 'origine', pj.origine,
                   'document_id', pj.document_id)), '[]'::jsonb)
            FROM pieces_jointes pj WHERE pj.message_id = m.id)
    FROM messages m
    LEFT JOIN utilisateurs u ON u.id = m.auteur_utilisateur_id
    LEFT JOIN entreprises e ON e.id = m.auteur_entreprise_id
   WHERE m.conversation_id = p_conversation
   ORDER BY m.cree_le;
END $$;
REVOKE ALL ON FUNCTION app.fil_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fil_conversation(uuid) TO jokswed_app;

/* Les variables de substitution d'un dossier. Liste FERMÉE : la fonction
   rend un objet, le serveur remplace ce qu'il y trouve, et rien d'autre. */
CREATE OR REPLACE FUNCTION app.variables_conversation(p_conversation uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c RECORD; v_d RECORD; v_f RECORD; v_cl RECORD;
BEGIN
  IF p_conversation NOT IN (SELECT app.conversations_de_lacteur()) THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT * INTO v_c FROM conversations WHERE id = p_conversation;
  SELECT * INTO v_cl FROM conversation_participants
   WHERE conversation_id = p_conversation AND role = 'client' AND retire_le IS NULL
   LIMIT 1;
  IF v_c.demande_id IS NOT NULL THEN
    SELECT * INTO v_d FROM demandes WHERE id = v_c.demande_id;
    SELECT * INTO v_f FROM app._finances_par_demande(v_c.entreprise_id) f
     WHERE f.demande_id = v_c.demande_id;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'prenom_client', coalesce(v_cl.nom, v_d.contact_nom),
    'date_mariage', to_char(v_d.date_mariage, 'DD/MM/YYYY'),
    'lieu', coalesce(v_d.lieu, v_d.ville),
    'formule', v_d.formule_nom,
    'reference', v_d.reference,
    'montant_total_cents', v_f.engage_cents,
    'montant_restant_cents', v_f.solde_a_percevoir_cents
  ));
END $$;
REVOKE ALL ON FUNCTION app.variables_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.variables_conversation(uuid) TO jokswed_app;
