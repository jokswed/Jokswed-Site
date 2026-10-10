-- =============================================================================
-- 040 — MESSAGERIE : CONVERSATIONS, MESSAGES, PARTICIPANTS
-- -----------------------------------------------------------------------------
-- ⚠️ UNE CONVERSATION N'APPARTIENT PAS À UNE ENTREPRISE.
--
-- C'est la différence avec tout le reste du schéma. Un dossier, un document,
-- un paiement ont UN propriétaire, et le cloisonnement se lit sur une colonne.
-- Une conversation entre le couple, le photographe et le vidéaste n'en a
-- pas : elle appartient à ses PARTICIPANTS. L'accès se lit donc sur une
-- table de participation, et la politique RLS fait une sous-requête.
--
-- ⚠️ TROIS NATURES, ET LA CONFUSION SERAIT GRAVE.
--
--   · `client`   — le couple y est participant. Tout message sortant part
--                  réellement par e-mail.
--   · `partagee` — plusieurs prestataires, PAS de client. Rien n'en sort.
--   · `interne`  — une seule entreprise. Rien n'en sort non plus.
--
-- Une note interne envoyée par erreur au client, ce n'est pas un bug
-- d'affichage : c'est une fuite. On ne s'en remet donc pas à une case à
-- cocher dans un formulaire. Un message de sens `interne` ne peut
-- physiquement pas être envoyé — une contrainte l'interdit, et la nature de
-- la conversation est figée à sa création.
-- =============================================================================

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- L'entreprise qui a OUVERT la conversation. Sert à la numéroter et à
  -- savoir qui en est responsable — pas à décider qui y a accès.
  entreprise_id   uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  nature          text NOT NULL CHECK (nature IN ('client','partagee','interne')),
  sujet           text NOT NULL,
  demande_id      uuid REFERENCES demandes(id) ON DELETE SET NULL,
  dossier_id      uuid REFERENCES dossiers(id) ON DELETE SET NULL,
  mariage_id      uuid REFERENCES mariages(id) ON DELETE SET NULL,
  statut          text NOT NULL DEFAULT 'ouverte'
                    CHECK (statut IN ('ouverte','archivee')),

  -- ⚠️ LA CLÉ DE ROUTAGE DES RÉPONSES.
  -- Elle part dans l'adresse de réponse (`rep+<jeton>@…`). C'est ELLE qui
  -- rattache une réponse à sa conversation — pas `In-Reply-To`, qu'un
  -- client peut perdre, réécrire, ou qu'un tiers peut forger. 128 bits.
  jeton_reponse   text NOT NULL UNIQUE,

  derniere_activite_le timestamptz NOT NULL DEFAULT now(),
  cree_par        uuid REFERENCES utilisateurs(id),
  cree_le         timestamptz NOT NULL DEFAULT now(),

  -- Une conversation `interne` n'a qu'une entreprise : le dire ici évite
  -- d'avoir à le redémontrer à chaque lecture.
  CONSTRAINT conversation_sujet_non_vide CHECK (length(btrim(sujet)) > 0)
);
CREATE INDEX conversations_entreprise ON conversations (entreprise_id, derniere_activite_le DESC);
CREATE INDEX conversations_demande ON conversations (demande_id);
CREATE INDEX conversations_mariage ON conversations (mariage_id);

CREATE TABLE conversation_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('prestataire','client')),
  -- Un prestataire est une ENTREPRISE (tous ses membres habilités y
  -- accèdent) ; un client est une ADRESSE.
  entreprise_id   uuid REFERENCES entreprises(id) ON DELETE CASCADE,
  contact_email   citext,
  nom             text,
  ajoute_le       timestamptz NOT NULL DEFAULT now(),
  ajoute_par      uuid REFERENCES utilisateurs(id),
  retire_le       timestamptz,
  CONSTRAINT participant_coherent CHECK (
    (role = 'prestataire' AND entreprise_id IS NOT NULL AND contact_email IS NULL)
    OR (role = 'client' AND contact_email IS NOT NULL AND entreprise_id IS NULL))
);
CREATE UNIQUE INDEX participant_entreprise_unique
  ON conversation_participants (conversation_id, entreprise_id)
  WHERE role = 'prestataire' AND retire_le IS NULL;
CREATE UNIQUE INDEX participant_client_unique
  ON conversation_participants (conversation_id, contact_email)
  WHERE role = 'client' AND retire_le IS NULL;
CREATE INDEX participants_conversation ON conversation_participants (conversation_id);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- ⚠️ `interne` N'EST PAS UN SENS DE CIRCULATION, C'EST UNE INTERDICTION.
  --   · sortant — part par e-mail aux participants client ;
  --   · entrant — reçu par le webhook ;
  --   · interne — ne sort jamais, quelle que soit la conversation.
  sens            text NOT NULL CHECK (sens IN ('sortant','entrant','interne')),

  auteur_utilisateur_id uuid REFERENCES utilisateurs(id),
  auteur_entreprise_id  uuid REFERENCES entreprises(id),
  auteur_email    citext,
  auteur_nom      text,

  sujet           text,
  corps_texte     text NOT NULL,
  corps_html      text,

  -- En-têtes RFC 5322. `message_id_rfc` est notre clé de déduplication :
  -- un fournisseur qui rejoue un webhook ne crée pas deux messages.
  message_id_rfc  text,
  in_reply_to     text,
  references_rfc  text[],

  statut          text NOT NULL DEFAULT 'brouillon' CHECK (statut IN
                    ('brouillon','en_attente','envoye','echoue','recu')),
  fournisseur     text,
  fournisseur_id  text,
  erreur          text,
  cle_idempotence text,

  cree_le         timestamptz NOT NULL DEFAULT now(),
  envoye_le       timestamptz,

  -- ⚠️ LA GARANTIE, EXPRIMÉE PAR UNE CONTRAINTE.
  -- Un message interne ne peut pas porter un statut d'envoi. Ce n'est pas
  -- une convention que le code respecte : c'est PostgreSQL qui refuse.
  CONSTRAINT interne_ne_part_jamais CHECK (
    sens <> 'interne' OR statut IN ('brouillon','recu'))
);
CREATE UNIQUE INDEX message_rfc_unique ON messages (message_id_rfc)
  WHERE message_id_rfc IS NOT NULL;
CREATE UNIQUE INDEX message_idempotence ON messages (conversation_id, cle_idempotence)
  WHERE cle_idempotence IS NOT NULL;
CREATE INDEX messages_conversation ON messages (conversation_id, cree_le);

-- Qui a lu quoi. Une colonne `lu` sur le message ne marcherait pas : une
-- conversation partagée a plusieurs lecteurs, et « lu » n'a de sens que
-- pour une personne.
CREATE TABLE messages_lus (
  message_id     uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  lu_le          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, utilisateur_id)
);

-- -----------------------------------------------------------------------------
-- PIÈCES JOINTES
-- -----------------------------------------------------------------------------
-- Deux origines, deux traitements :
--
--   · `document` — un devis, un contrat, une facture de NOTRE base. On ne
--     stocke RIEN : on garde l'identifiant, et le PDF se régénère depuis
--     l'instantané au moment de l'envoi. Impossible de joindre un document
--     périmé, et impossible de joindre celui d'une autre entreprise.
--   · `entrant` — un fichier reçu d'un client. Stocké en base, chiffré au
--     repos par l'hébergeur, cloisonné par la même politique que le message.
--
-- ⚠️ PAS DE STOCKAGE OBJET POUR L'INSTANT. `bytea` convient à des pièces de
-- quelques mégaoctets et évite d'introduire un service — donc un coût — sans
-- validation. La borne est explicite ; au-delà, il faudra R2.
CREATE TABLE pieces_jointes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  origine       text NOT NULL CHECK (origine IN ('document','entrant')),
  document_id   uuid REFERENCES documents(id) ON DELETE RESTRICT,
  nom           text NOT NULL,
  type_mime     text NOT NULL,
  taille_octets integer NOT NULL CHECK (taille_octets >= 0),
  contenu       bytea,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT piece_coherente CHECK (
    (origine = 'document' AND document_id IS NOT NULL AND contenu IS NULL)
    OR (origine = 'entrant' AND document_id IS NULL)),
  CONSTRAINT piece_bornee CHECK (taille_octets <= 8 * 1024 * 1024)
);
CREATE INDEX pieces_message ON pieces_jointes (message_id);

-- -----------------------------------------------------------------------------
-- MODÈLES DE RÉPONSE
-- -----------------------------------------------------------------------------
CREATE TABLE modeles_reponse (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = modèle MODÈLE, copié à la création d'une entreprise, comme les rôles.
  entreprise_id uuid REFERENCES entreprises(id) ON DELETE CASCADE,
  cle           text NOT NULL,
  libelle       text NOT NULL,
  sujet         text NOT NULL,
  corps         text NOT NULL,
  ordre         integer NOT NULL DEFAULT 0,
  systeme       boolean NOT NULL DEFAULT false,
  cree_le       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX modele_cle_unique
  ON modeles_reponse (COALESCE(entreprise_id, '00000000-0000-0000-0000-000000000000'::uuid), cle);

-- -----------------------------------------------------------------------------
-- IDENTITÉS D'ENVOI
-- -----------------------------------------------------------------------------
-- ⚠️ AUCUN MOT DE PASSE DE BOÎTE N'EST DEMANDÉ, JAMAIS.
-- `methode` dit comment l'envoi se fait réellement. `brevo_partage` est la
-- seule opérationnelle aujourd'hui : l'envoi passe par le compte Brevo de
-- JoksWed, avec une identité d'expéditeur vérifiée. Les méthodes OAuth sont
-- déclarées mais marquées `non_disponible` — elles exigent une validation
-- Google ou Microsoft qui n'est pas faite. Le schéma les prévoit ; l'écran
-- dit qu'elles ne marchent pas encore.
CREATE TABLE identites_messagerie (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id  uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  -- NULL = identité de l'entreprise ; sinon, celle d'une personne.
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE CASCADE,
  adresse        citext NOT NULL,
  nom_affiche    text NOT NULL,
  methode        text NOT NULL DEFAULT 'brevo_partage'
                   CHECK (methode IN ('brevo_partage','oauth_gmail','oauth_outlook','smtp')),
  statut         text NOT NULL DEFAULT 'a_configurer'
                   CHECK (statut IN ('active','a_configurer','non_disponible')),
  verifiee_le    timestamptz,
  note           text,
  cree_le        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX identite_adresse_unique ON identites_messagerie (entreprise_id, adresse);

-- -----------------------------------------------------------------------------
-- MESSAGES ENTRANTS NON RATTACHÉS
-- -----------------------------------------------------------------------------
-- ⚠️ ON NE DEVINE PAS. Un e-mail entrant dont le jeton de réponse est
-- absent, inconnu ou illisible n'est rattaché à AUCUNE conversation : le
-- rattacher « au plus probable » reviendrait à montrer le message d'un
-- couple à un autre. Il atterrit ici, visible du seul propriétaire, qui
-- décidera. C'est moins pratique et beaucoup plus sûr.
CREATE TABLE messages_orphelins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id_rfc text UNIQUE,
  expediteur     citext,
  destinataires  text[],
  sujet          text,
  corps_texte    text,
  motif          text NOT NULL,
  charge_utile   jsonb,
  traite_le      timestamptz,
  cree_le        timestamptz NOT NULL DEFAULT now()
);
