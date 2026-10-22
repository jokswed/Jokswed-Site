-- =============================================================================
-- 067 — NOTIFICATION PUSH À L'ARRIVÉE D'UNE RÉPONSE CLIENT
-- -----------------------------------------------------------------------------
-- L'e-mail et la notification en application existent déjà : `recevoir_message`
-- appelle `app.notifier` pour le type `message.recu`, et déduplique par
-- `message_id_rfc` — un webhook rejoué ne crée ni second message, ni seconde
-- notification. Seul le push web manquait.
--
-- ⚠️ CETTE FONCTION EST PLUS ÉTROITE QUE `push_abonnements_entreprise`.
--
-- Celle-là prend une entreprise ; toute exécution SQL sous le rôle métier
-- pouvait donc demander les abonnements de n'importe laquelle (limite déjà
-- consignée dans le banc de sécurité). Celle-ci prend une CONVERSATION et
-- déduit l'entreprise de la ligne : on ne peut viser que là où une conversation
-- existe réellement.
--
-- Trois conditions, et pas une de moins :
--   · le destinataire est membre ACTIF de l'entreprise de la conversation ;
--   · il porte `message.lire` — sans quoi la notification parlerait d'un fil
--     qu'il n'a pas le droit d'ouvrir ;
--   · il n'a pas désactivé `message.recu` dans ses préférences.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.push_cible_conversation(p_conversation uuid)
RETURNS TABLE (endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT pa.endpoint, pa.p256dh, pa.auth
    FROM conversations c
    JOIN membres m
      ON m.entreprise_id = c.entreprise_id
     AND m.retire_le IS NULL
     AND m.suspendu_le IS NULL
    JOIN push_abonnements pa ON pa.utilisateur_id = m.utilisateur_id
    JOIN utilisateurs u ON u.id = pa.utilisateur_id AND u.desactive_le IS NULL
   WHERE c.id = p_conversation
     AND 'message.lire' = ANY (app.permissions_de(m.utilisateur_id, c.entreprise_id))
     /* ⚠️ `notification_voulue` REND UNE LIGNE, PAS UN BOOLÉEN : elle rend
        `en_app` et `par_email` séparément, et une fonction à ensemble n'a pas
        sa place dans un WHERE. Le push suit la préférence « en application » :
        c'est la même intention — être prévenu sur l'appareil — alors que
        `par_email` concerne le courrier. */
     AND EXISTS (
       SELECT 1 FROM app.notification_voulue(m.utilisateur_id, c.entreprise_id, 'message.recu') nv
        WHERE nv.en_app)
$$;

REVOKE ALL ON FUNCTION app.push_cible_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.push_cible_conversation(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- De quoi rédiger la notification sans rien divulguer de trop.
--
-- ⚠️ CE QUI SORT D'ICI S'AFFICHE SUR UN ÉCRAN VERROUILLÉ.
-- Le prénom de l'expéditeur, la date du mariage, et l'adresse de la
-- conversation : assez pour savoir qu'il faut répondre, et rien du contenu du
-- message. Pas d'extrait, pas d'adresse e-mail, pas de montant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.push_sujet_conversation(p_conversation uuid)
RETURNS TABLE (expediteur text, date_mariage date, demande_id uuid, dossier_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    coalesce(d.contact_nom, c.sujet, 'Un client'),
    coalesce(d.date_mariage, ma.date_mariage),
    c.demande_id,
    c.dossier_id
  FROM conversations c
  LEFT JOIN demandes d ON d.id = c.demande_id
  LEFT JOIN mariages ma ON ma.id = c.mariage_id
  WHERE c.id = p_conversation
$$;

REVOKE ALL ON FUNCTION app.push_sujet_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.push_sujet_conversation(uuid) TO jokswed_app;
