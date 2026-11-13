-- =============================================================================
-- 068 — ENVOYER DEPUIS SA PROPRE BOÎTE GMAIL
-- -----------------------------------------------------------------------------
-- Une réponse écrite à la main depuis l'administration doit partir de la boîte
-- du professionnel et apparaître dans ses messages envoyés. Brevo ne sait pas
-- faire cela : il expédie depuis `contact@jokswed.com`, un expéditeur vérifié
-- qui n'est la boîte de personne. Les notifications automatiques y restent.
--
-- ⚠️ LA RÉCEPTION NE PASSE PAS PAR GMAIL, ET C'EST UN CHOIX.
--
-- Lire la boîte demanderait `gmail.readonly`, une portée RESTREINTE : Google
-- exige alors une évaluation de sécurité tierce, renouvelée chaque année. Le
-- webhook entrant Brevo et l'adresse à jeton `rep+<jeton>@…` existent déjà,
-- sont éprouvés, et ne coûtent rien. On n'emporte donc que `gmail.send`, une
-- portée simplement « sensible ».
--
-- Conséquence assumée : la réponse de la cliente arrive dans JoksWed, pas dans
-- le fil Gmail d'origine. Le `Reply-To` pointe l'adresse à jeton — jamais la
-- boîte Gmail, sans quoi la réponse sortirait de la plateforme sans y revenir.
-- =============================================================================
CREATE TABLE IF NOT EXISTS gmail_comptes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id   uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  /* Le compte appartient à UNE personne : la réponse d'Yvann part de la boîte
     d'Yvann, pas de la mienne. */
  utilisateur_id  uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  adresse         citext NOT NULL,
  /* ⚠️ CHIFFRÉS AU REPOS, avec la même clé que les graines TOTP.
     Un jeton de rafraîchissement Google vaut un accès durable à une boîte
     mail : en clair dans une colonne, une lecture de la base suffirait. */
  jeton_acces            bytea NOT NULL,
  jeton_rafraichissement bytea,
  expire_le       timestamptz NOT NULL,
  portees         text[] NOT NULL DEFAULT '{}',
  statut          text NOT NULL DEFAULT 'actif'
                    CHECK (statut IN ('actif', 'revoque', 'expire')),
  /* Pourquoi l'accès ne marche plus : à afficher, pas à deviner. */
  motif_panne     text,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  maj_le          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, utilisateur_id)
);

ALTER TABLE gmail_comptes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gmail_compte_sien ON gmail_comptes;
CREATE POLICY gmail_compte_sien ON gmail_comptes FOR ALL
  USING (utilisateur_id = app.acteur()
         AND entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (utilisateur_id = app.acteur()
              AND entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

GRANT SELECT, INSERT, UPDATE, DELETE ON gmail_comptes TO jokswed_app;

/* Le fil Gmail, pour que la réponse suivante reste dans la même conversation
   côté Google. `message_id_rfc` existe déjà depuis le palier 043. */
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_thread_id text;

-- -----------------------------------------------------------------------------
-- Enregistrer le compte après l'autorisation OAuth.
--
-- ⚠️ EXIGE `message.envoyer` : connecter une boîte, c'est se donner le moyen
-- d'écrire aux clientes de l'entreprise.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.gmail_enregistrer(
  p_entreprise uuid, p_adresse citext, p_acces bytea,
  p_rafraichissement bytea, p_expire timestamptz, p_portees text[])
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_id uuid;
BEGIN
  v_acteur := app.exiger(p_entreprise, 'message.envoyer');

  INSERT INTO gmail_comptes (entreprise_id, utilisateur_id, adresse, jeton_acces,
                             jeton_rafraichissement, expire_le, portees,
                             statut, motif_panne)
  VALUES (p_entreprise, v_acteur, p_adresse, p_acces,
          p_rafraichissement, p_expire, p_portees, 'actif', NULL)
  ON CONFLICT (entreprise_id, utilisateur_id) DO UPDATE SET
    adresse = EXCLUDED.adresse,
    jeton_acces = EXCLUDED.jeton_acces,
    /* ⚠️ GOOGLE NE REDONNE PAS TOUJOURS LE JETON DE RAFRAÎCHISSEMENT.
       Il ne l'émet qu'au premier consentement, ou avec `prompt=consent`. En
       écrasant par NULL, une reconnexion aurait silencieusement retiré la
       capacité de renouveler l'accès — et l'envoi se serait arrêté une heure
       plus tard. */
    jeton_rafraichissement =
      COALESCE(EXCLUDED.jeton_rafraichissement, gmail_comptes.jeton_rafraichissement),
    expire_le = EXCLUDED.expire_le,
    portees = EXCLUDED.portees,
    statut = 'actif',
    motif_panne = NULL,
    maj_le = now()
  RETURNING id INTO v_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_entreprise, 'gmail.connecte', 'gmail_compte', v_id::text,
          jsonb_build_object('adresse', p_adresse, 'portees', p_portees));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.gmail_enregistrer(uuid, citext, bytea, bytea, timestamptz, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_enregistrer(uuid, citext, bytea, bytea, timestamptz, text[]) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- Ce que l'écran de réglages doit montrer. Jamais les jetons.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.gmail_etat(p_entreprise uuid)
RETURNS TABLE (adresse citext, statut text, expire_le timestamptz,
               portees text[], motif_panne text, renouvelable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.adresse, g.statut, g.expire_le, g.portees, g.motif_panne,
         g.jeton_rafraichissement IS NOT NULL
    FROM gmail_comptes g
   WHERE g.entreprise_id = p_entreprise
     AND g.utilisateur_id = app.acteur()
$$;
REVOKE ALL ON FUNCTION app.gmail_etat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_etat(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- Le compte à utiliser pour UN message donné.
--
-- ⚠️ ELLE NE PREND PAS D'ENTREPRISE, ELLE PREND UN MESSAGE.
--
-- Le drain tourne sans acteur : `app.acteur()` y rend NULL. Cette fonction
-- déduit donc tout du message — son auteur, son entreprise — exactement comme
-- `app.message_pour_envoi`. Impossible de réclamer la boîte de quelqu'un
-- d'autre : il faudrait posséder l'identifiant d'un message qu'il a écrit.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.gmail_pour_message(p_message_id uuid)
RETURNS TABLE (compte_id uuid, adresse citext, jeton_acces bytea,
               jeton_rafraichissement bytea, expire_le timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.id, g.adresse, g.jeton_acces, g.jeton_rafraichissement, g.expire_le
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN gmail_comptes g
      ON g.utilisateur_id = m.auteur_utilisateur_id
     AND g.entreprise_id = c.entreprise_id
     AND g.statut = 'actif'
   WHERE m.id = p_message_id
     AND m.sens = 'sortant'
$$;
REVOKE ALL ON FUNCTION app.gmail_pour_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_pour_message(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- Après un rafraîchissement, et après une panne.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.gmail_jeton_maj(
  p_compte uuid, p_acces bytea, p_expire timestamptz)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE gmail_comptes
     SET jeton_acces = p_acces, expire_le = p_expire,
         statut = 'actif', motif_panne = NULL, maj_le = now()
   WHERE id = p_compte
$$;
REVOKE ALL ON FUNCTION app.gmail_jeton_maj(uuid, bytea, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_jeton_maj(uuid, bytea, timestamptz) TO jokswed_app;

/* ⚠️ UNE AUTORISATION RÉVOQUÉE DOIT SE VOIR, PAS SE DEVINER.
   Sur EyesofJoks, un accès Gmail révoqué a cessé de fonctionner en silence :
   les réponses clientes n'entraient plus, et rien ne le disait. */
CREATE OR REPLACE FUNCTION app.gmail_panne(p_compte uuid, p_motif text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE gmail_comptes
     SET statut = 'revoque', motif_panne = left(p_motif, 300), maj_le = now()
   WHERE id = p_compte
$$;
REVOKE ALL ON FUNCTION app.gmail_panne(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_panne(uuid, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- Se déconnecter : la ligne disparaît, et avec elle les jetons.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.gmail_deconnecter(p_entreprise uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_n integer;
BEGIN
  v_acteur := app.exiger(p_entreprise, 'message.envoyer');
  DELETE FROM gmail_comptes
   WHERE entreprise_id = p_entreprise AND utilisateur_id = v_acteur;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                               ressource_id, apres)
    VALUES (v_acteur, p_entreprise, 'gmail.deconnecte', 'gmail_compte', NULL,
            jsonb_build_object('comptes', v_n));
  END IF;
  RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION app.gmail_deconnecter(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_deconnecter(uuid) TO jokswed_app;

/* Le fil Gmail, enregistré au moment de l'envoi, pour que la réponse suivante
   reste dans la même conversation côté Google. */
CREATE OR REPLACE FUNCTION app.gmail_fil_message(
  p_message_id uuid, p_thread_id text, p_message_id_rfc text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE messages
     SET gmail_thread_id = COALESCE(p_thread_id, gmail_thread_id),
         message_id_rfc = COALESCE(p_message_id_rfc, message_id_rfc)
   WHERE id = p_message_id
$$;
REVOKE ALL ON FUNCTION app.gmail_fil_message(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.gmail_fil_message(uuid, text, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- LE FIL, JUSQU'AU DRAIN
--
-- ⚠️ SANS CES TROIS COLONNES, LE THREADING ÉTAIT SILENCIEUSEMENT PERDU.
-- Le drain lisait `msg.gmail_thread_id`, `msg.in_reply_to` et
-- `msg.references_rfc` — qu'aucune version de `message_pour_envoi` ne rendait.
-- Les champs valaient `undefined`, chaque réponse ouvrait un fil neuf chez la
-- cliente, et rien ne le signalait. Le reste du corps est celui du palier 049.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.message_pour_envoi(uuid);
CREATE OR REPLACE FUNCTION app.message_pour_envoi(p_message_id uuid)
RETURNS TABLE (
  message_id uuid, conversation_id uuid, sujet text, corps_texte text,
  corps_html text, auteur_email citext, auteur_nom text,
  entreprise_id uuid, entreprise_nom text,
  jeton_reponse text, reponse_vers citext, signature text,
  destinataires jsonb, documents uuid[],
  gmail_thread_id text, in_reply_to text, references_rfc text)
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
           WHERE pj.message_id = m.id AND pj.origine = 'document'),
         /* Le fil se reprend sur le DERNIER message de la conversation qui en
            porte un : c'est lui que la cliente a sous les yeux. */
         (SELECT a.gmail_thread_id FROM messages a
           WHERE a.conversation_id = c.id AND a.gmail_thread_id IS NOT NULL
           ORDER BY a.cree_le DESC LIMIT 1),
         (SELECT a.message_id_rfc FROM messages a
           WHERE a.conversation_id = c.id AND a.message_id_rfc IS NOT NULL
             AND a.id <> m.id
           ORDER BY a.cree_le DESC LIMIT 1),
         m.references_rfc
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
