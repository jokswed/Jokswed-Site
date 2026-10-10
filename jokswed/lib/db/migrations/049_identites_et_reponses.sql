-- =============================================================================
-- 049 — UNE ADRESSE DE RÉPONSE QUI EXISTE VRAIMENT
-- -----------------------------------------------------------------------------
-- ⚠️ `contact@jokswed.com` EST UN EXPÉDITEUR VÉRIFIÉ, PAS UNE BOÎTE.
--
-- Laisser un client répondre à cette adresse enverrait sa réponse nulle part.
-- Chaque identité d'envoi porte donc désormais une adresse de RÉCEPTION
-- réelle : `jokswed@gmail.com` pour John, `cretinoiry@gmail.com` pour Yvann.
--
-- ⚠️ ET CETTE ADRESSE N'EST UTILISÉE QU'EN REPLI.
--
-- Une conversation de la messagerie doit revenir DANS la messagerie : son
-- `Reply-To` est `rep+<jeton>@reply.jokswed.com`. Diriger une conversation
-- vers Gmail reviendrait à sortir le fil de la plateforme — la réponse
-- n'apparaîtrait jamais dans JoksWed, et personne ne saurait pourquoi.
-- `reponse_vers` ne sert donc que tant que la réception intégrée n'est pas
-- configurée, et l'interface le dit.
-- =============================================================================

ALTER TABLE identites_messagerie
  ADD COLUMN reponse_vers citext,
  -- Le professionnel qui répond, affiché au client. Yvann signe « Yvann
  -- Cretinoir — Vidéaste », même si le message part de contact@jokswed.com :
  -- l'expéditeur technique n'a pas à masquer l'interlocuteur réel.
  ADD COLUMN signature text;

/* L'identité à utiliser pour écrire : la personnelle si elle existe et est
   active, sinon celle de l'entreprise. */
CREATE OR REPLACE FUNCTION app.identite_envoi(p_entreprise uuid)
RETURNS TABLE (adresse citext, nom_affiche text, reponse_vers citext, signature text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.adresse, i.nom_affiche, i.reponse_vers, i.signature
    FROM identites_messagerie i
   WHERE i.entreprise_id = p_entreprise
     AND i.statut = 'active'
     AND (i.utilisateur_id = app.acteur() OR i.utilisateur_id IS NULL)
   ORDER BY (i.utilisateur_id IS NOT NULL) DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.identite_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.identite_envoi(uuid) TO jokswed_app;

/* `message_pour_envoi` rend aussi le repli de réponse et la signature. */
DROP FUNCTION IF EXISTS app.message_pour_envoi(uuid);
CREATE OR REPLACE FUNCTION app.message_pour_envoi(p_message_id uuid)
RETURNS TABLE (
  message_id uuid, conversation_id uuid, sujet text, corps_texte text,
  corps_html text, auteur_email citext, auteur_nom text,
  entreprise_id uuid, entreprise_nom text,
  jeton_reponse text, reponse_vers citext, signature text,
  destinataires jsonb, documents uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, c.id, coalesce(m.sujet, c.sujet), m.corps_texte, m.corps_html,
         m.auteur_email, m.auteur_nom, m.auteur_entreprise_id, e.nom_commercial,
         c.jeton_reponse, i.reponse_vers, i.signature,
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
    LEFT JOIN identites_messagerie i
           ON i.entreprise_id = m.auteur_entreprise_id AND i.adresse = m.auteur_email
   WHERE m.id = p_message_id
     AND m.sens = 'sortant'
     AND m.statut IN ('en_attente','echoue')
     AND c.nature = 'client'
$$;
REVOKE ALL ON FUNCTION app.message_pour_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.message_pour_envoi(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- LE COLLABORATEUR ÉCRIT À SES CLIENTS, DEPUIS SON DOSSIER
-- -----------------------------------------------------------------------------
-- ⚠️ IL N'A PAS DE DEMANDE : il a un dossier, créé quand il a accepté une
-- proposition. Et il n'obtient l'adresse du couple QUE si le partage des
-- coordonnées lui a été accordé — même règle que partout ailleurs.
CREATE OR REPLACE FUNCTION app.ouvrir_conversation_dossier(
  p_dossier_id uuid, p_sujet text, p_jeton text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD; v_acteur uuid; v_c RECORD; v_id uuid; v_partage boolean;
BEGIN
  SELECT * INTO v_d FROM dossiers WHERE id = p_dossier_id;
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'dossier introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_d.entreprise_id, 'message.envoyer');

  SELECT EXISTS (SELECT 1 FROM partages_mariage pm
                  WHERE pm.mariage_id = v_d.mariage_id
                    AND pm.entreprise_id = v_d.entreprise_id
                    AND pm.categorie = 'coordonnees_clients'
                    AND pm.retire_le IS NULL) INTO v_partage;
  IF NOT v_partage THEN
    RAISE EXCEPTION
      'les coordonnées du couple ne vous ont pas été partagées : demandez-les au pilote'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_c FROM contacts
   WHERE mariage_id = v_d.mariage_id AND principal AND email IS NOT NULL LIMIT 1;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'aucune adresse de contact sur ce mariage'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Une seule conversation client par dossier : on rend l'existante plutôt
  -- que d'en empiler une à chaque clic.
  SELECT id INTO v_id FROM conversations
   WHERE dossier_id = p_dossier_id AND nature = 'client' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO conversations (entreprise_id, nature, sujet, dossier_id, mariage_id,
                             jeton_reponse, cree_par)
  VALUES (v_d.entreprise_id, 'client', p_sujet, p_dossier_id, v_d.mariage_id,
          p_jeton, v_acteur)
  RETURNING id INTO v_id;

  INSERT INTO conversation_participants (conversation_id, role, entreprise_id, ajoute_par)
  VALUES (v_id, 'prestataire', v_d.entreprise_id, v_acteur);
  INSERT INTO conversation_participants (conversation_id, role, contact_email, nom, ajoute_par)
  VALUES (v_id, 'client', v_c.email, coalesce(v_c.prenom, 'Les mariés'), v_acteur);

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_d.entreprise_id, 'conversation.ouverte', 'conversation',
          v_id::text, jsonb_build_object('nature', 'client', 'dossier', p_dossier_id));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.ouvrir_conversation_dossier(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvrir_conversation_dossier(uuid, text, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- TRANSMETTRE À UN PARTENAIRE, EN CHOISISSANT CE QU'ON PARTAGE
-- -----------------------------------------------------------------------------
-- Un geste unique à la place de trois : créer la proposition si elle manque,
-- la transmettre, et poser les catégories de partage retenues.
CREATE OR REPLACE FUNCTION app.transmettre_a_partenaire(
  p_demande_id uuid, p_destinataire uuid, p_prestation text,
  p_message text, p_categories text[])
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD; v_acteur uuid; v_prop uuid; v_cat text;
BEGIN
  SELECT * INTO v_d FROM demandes WHERE id = p_demande_id;
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_d.entreprise_destinataire_id, 'collaboration.proposer');

  SELECT id INTO v_prop FROM propositions
   WHERE demande_id = p_demande_id AND entreprise_destinataire_id = p_destinataire
     AND statut IN ('preparee','proposee','vue','acceptee') LIMIT 1;
  IF v_prop IS NULL THEN
    v_prop := app.proposer_prestation(p_demande_id, p_destinataire,
                                      coalesce(p_prestation, 'video'), p_message);
  END IF;

  PERFORM app.transmettre_proposition(v_prop);

  -- ⚠️ LES COORDONNÉES NE SE PARTAGENT QU'EXPLICITEMENT, ET SEULEMENT SI LE
  -- COUPLE Y A CONSENTI. Cocher la case ne suffit pas : le consentement
  -- recueilli au formulaire fait foi.
  IF v_d.mariage_id IS NOT NULL THEN
    FOREACH v_cat IN ARRAY coalesce(p_categories, '{}') LOOP
      CONTINUE WHEN v_cat NOT IN ('planning','lieux','coordonnees_clients','documents_partages');
      CONTINUE WHEN v_cat = 'coordonnees_clients' AND NOT EXISTS (
        SELECT 1 FROM consentements c
         WHERE c.demande_id = p_demande_id
           AND c.finalite = 'partage_partenaire_video' AND c.accorde);
      INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie, accorde_par)
      VALUES (v_d.mariage_id, p_destinataire, v_cat, v_acteur)
      ON CONFLICT (mariage_id, entreprise_id, categorie)
        DO UPDATE SET retire_le = NULL, accorde_le = now(), accorde_par = v_acteur;
    END LOOP;
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_d.entreprise_destinataire_id, 'proposition.transmise_manuelle',
          'proposition', v_prop::text,
          jsonb_build_object('destinataire', p_destinataire, 'partages', p_categories));
  RETURN v_prop;
END $$;
REVOKE ALL ON FUNCTION app.transmettre_a_partenaire(uuid, uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.transmettre_a_partenaire(uuid, uuid, text, text, text[]) TO jokswed_app;

-- L'identité d'envoi de JoksWed, si l'entreprise existe déjà.
INSERT INTO identites_messagerie
  (entreprise_id, adresse, nom_affiche, methode, statut, reponse_vers, signature)
SELECT e.id, 'contact@jokswed.com', 'JoksWed', 'brevo_partage', 'active',
       'jokswed@gmail.com', 'John — JoksWed'
  FROM entreprises e WHERE e.slug = 'jokswed'
ON CONFLICT (entreprise_id, adresse) DO UPDATE
  SET reponse_vers = EXCLUDED.reponse_vers, statut = 'active';
