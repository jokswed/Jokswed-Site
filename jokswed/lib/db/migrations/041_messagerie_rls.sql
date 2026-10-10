-- =============================================================================
-- 041 — QUI VOIT QUELLE CONVERSATION
-- -----------------------------------------------------------------------------
-- ⚠️ L'ACCÈS SE LIT SUR LA PARTICIPATION, PAS SUR UNE COLONNE.
--
-- Partout ailleurs, « cette ligne est-elle à moi ? » se répond en comparant
-- `entreprise_id`. Ici, non : une conversation entre le couple, le
-- photographe et le vidéaste n'appartient à aucun des deux prestataires
-- seul. La politique passe donc par `conversation_participants`.
--
-- Et comme partout depuis le palier 034, l'appartenance ne suffit pas : il
-- faut aussi porter `message.lire`.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.conversations_de_lacteur()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cp.conversation_id
    FROM conversation_participants cp
   WHERE cp.role = 'prestataire'
     AND cp.retire_le IS NULL
     AND cp.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
     AND app.acteur_porte(cp.entreprise_id, ARRAY['message.lire','message.envoyer'])
$$;
REVOKE ALL ON FUNCTION app.conversations_de_lacteur() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.conversations_de_lacteur() TO jokswed_app;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE messages_lus ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_lus FORCE ROW LEVEL SECURITY;
ALTER TABLE pieces_jointes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pieces_jointes FORCE ROW LEVEL SECURITY;
ALTER TABLE modeles_reponse ENABLE ROW LEVEL SECURITY;
ALTER TABLE modeles_reponse FORCE ROW LEVEL SECURITY;
ALTER TABLE identites_messagerie ENABLE ROW LEVEL SECURITY;
ALTER TABLE identites_messagerie FORCE ROW LEVEL SECURITY;
ALTER TABLE messages_orphelins ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_orphelins FORCE ROW LEVEL SECURITY;

GRANT SELECT ON conversations, conversation_participants, messages,
                pieces_jointes, modeles_reponse, identites_messagerie,
                messages_orphelins TO jokswed_app;
GRANT INSERT, UPDATE, DELETE ON messages_lus TO jokswed_app;
GRANT SELECT ON messages_lus TO jokswed_app;
GRANT INSERT, UPDATE ON identites_messagerie TO jokswed_app;
GRANT INSERT, UPDATE, DELETE ON modeles_reponse TO jokswed_app;

-- ⚠️ PAS DE GRANT D'ÉCRITURE SUR `conversations`, `messages`,
-- `conversation_participants` NI `pieces_jointes`.
-- Toute création passe par une fonction qui vérifie la permission, la
-- nature de la conversation et la provenance des pièces. Le rôle applicatif
-- ne peut donc pas composer un message « sortant » dans une conversation
-- interne par une requête directe : il n'a pas le droit d'écrire du tout.

CREATE POLICY conversation_participant ON conversations FOR SELECT
  USING (id IN (SELECT app.conversations_de_lacteur()));
CREATE POLICY participant_visible ON conversation_participants FOR SELECT
  USING (conversation_id IN (SELECT app.conversations_de_lacteur()));
CREATE POLICY message_visible ON messages FOR SELECT
  USING (conversation_id IN (SELECT app.conversations_de_lacteur()));
CREATE POLICY piece_visible ON pieces_jointes FOR SELECT
  USING (message_id IN (SELECT id FROM messages
                         WHERE conversation_id IN (SELECT app.conversations_de_lacteur())));
CREATE POLICY lu_personnel ON messages_lus
  USING (utilisateur_id = app.acteur())
  WITH CHECK (utilisateur_id = app.acteur()
              AND message_id IN (SELECT id FROM messages
                                  WHERE conversation_id IN (SELECT app.conversations_de_lacteur())));

-- Les modèles : ceux de son entreprise, plus les modèles système partagés.
CREATE POLICY modele_tenant ON modeles_reponse
  USING (entreprise_id IS NULL
         OR entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
              AND app.acteur_porte(entreprise_id, ARRAY['message.envoyer']));

-- ⚠️ CHACUN SON IDENTITÉ D'ENVOI.
-- Une identité personnelle n'est visible que de son titulaire ; les
-- identités d'entreprise (utilisateur_id NULL) le sont de ses membres
-- habilités. Sans quoi un collaborateur verrait l'adresse professionnelle
-- d'un autre — et pourrait tenter de s'en servir.
CREATE POLICY identite_sienne ON identites_messagerie
  USING ((utilisateur_id = app.acteur())
         OR (utilisateur_id IS NULL
             AND entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
             AND app.acteur_porte(entreprise_id, ARRAY['message.envoyer','entreprise.reglages'])))
  WITH CHECK ((utilisateur_id = app.acteur()
               AND entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
              OR (utilisateur_id IS NULL
                  AND app.acteur_porte(entreprise_id, ARRAY['entreprise.reglages'])));

-- Les orphelins : réservés à qui administre les réglages. Ils contiennent
-- du courrier non rattaché, donc potentiellement destiné à n'importe qui.
CREATE POLICY orphelin_admin ON messages_orphelins FOR SELECT
  USING (EXISTS (SELECT 1 FROM unnest(app.entreprises_de_lacteur()) e
                  WHERE app.acteur_porte(e, ARRAY['entreprise.reglages'])));
