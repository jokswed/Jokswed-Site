-- =============================================================================
-- 010 — DEMANDES CLIENTS, INSTANTANÉ TARIFAIRE, FILE D'ÉVÉNEMENTS
-- =============================================================================

CREATE TABLE demande_series (
  annee          integer PRIMARY KEY,
  dernier_numero integer NOT NULL DEFAULT 0
);

CREATE TABLE demandes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL UNIQUE,
  entreprise_destinataire_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  mariage_id    uuid REFERENCES mariages(id) ON DELETE SET NULL,
  dossier_id    uuid REFERENCES dossiers(id) ON DELETE SET NULL,
  origine       text NOT NULL DEFAULT 'formulaire_public',

  statut        text NOT NULL DEFAULT 'non_lue' CHECK (statut IN (
                  'non_lue','a_traiter','attente_client','attente_collaborateur',
                  'en_cours_devis','devis_envoye','confirmee','refusee','archivee')),

  -- ── Identité et coordonnées ──
  contact_nom       text NOT NULL,
  contact_email     citext NOT NULL,
  contact_telephone text,
  contact_prefere   text CHECK (contact_prefere IN ('email','telephone','sms')),

  -- ── Le mariage ──
  date_mariage    date,
  date_incertaine boolean NOT NULL DEFAULT false,
  lieu            text,
  ville           text,
  departement     text,
  invites_estimes integer CHECK (invites_estimes IS NULL OR invites_estimes >= 0),
  horaires        text,

  -- ── Le commercial ──
  formule_cle        text,
  formule_nom        text,
  formule_prix_cents integer CHECK (formule_prix_cents IS NULL OR formule_prix_cents >= 0),
  video_demandee     boolean NOT NULL DEFAULT false,

  message        text,
  complements    text,

  -- ⚠️ L'INSTANTANÉ : CE QUI PROTÈGE L'HISTORIQUE.
  --
  -- Il fige le catalogue TEL QU'IL ÉTAIT au moment de la demande — noms,
  -- prix, inclusions — plus la charge utile brute reçue. Changer un tarif
  -- demain ne réécrit donc pas ce que le client a vu et demandé. C'est aussi
  -- la preuve de ce qui a réellement été soumis, et de quoi rejouer un
  -- traitement sans dépendre du catalogue courant.
  instantane     jsonb NOT NULL,

  -- Idempotence EN BASE, et non plus en mémoire de processus : une contrainte
  -- UNIQUE est partagée par toutes les instances serverless.
  cle_idempotence text NOT NULL UNIQUE,
  ip_tronquee     text,

  cree_le    timestamptz NOT NULL DEFAULT now(),
  maj_le     timestamptz NOT NULL DEFAULT now(),
  lue_le     timestamptz,
  traitee_le timestamptz
);
CREATE INDEX demandes_entreprise ON demandes (entreprise_destinataire_id, statut, cree_le DESC);
CREATE INDEX demandes_date ON demandes (date_mariage) WHERE date_mariage IS NOT NULL;
CREATE TRIGGER demandes_maj BEFORE UPDATE ON demandes
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

-- Le détail de ce qui a été coché, ligne à ligne, avec son prix du jour.
CREATE TABLE demande_lignes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id  uuid NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('formule','supplement')),
  cle         text NOT NULL,
  libelle     text NOT NULL,
  -- NULL = « sur devis ». On ne convertit pas une absence de prix en zéro :
  -- un total partiel présenté comme un total est une promesse non tenue.
  prix_cents  integer CHECK (prix_cents IS NULL OR prix_cents >= 0),
  type_tarif  text,
  -- 'proposable' | 'inclus' : une ligne « incluse » est MONTRÉE mais jamais
  -- facturée. On garde la distinction jusque dans la base.
  compatibilite text,
  executant_partenaire text,
  ordre       integer NOT NULL DEFAULT 0
);
CREATE INDEX demande_lignes_demande ON demande_lignes (demande_id, ordre);

-- Un consentement PAR FINALITÉ, avec le texte exact soumis.
CREATE TABLE consentements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id    uuid REFERENCES demandes(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES contacts(id) ON DELETE CASCADE,
  finalite      text NOT NULL CHECK (finalite IN (
                  'reponse_demande','partage_partenaire_video',
                  'prospection','droit_image_portfolio')),
  accorde       boolean NOT NULL,
  texte_version text NOT NULL,
  source        text NOT NULL,
  ip_tronquee   text,
  horodatage    timestamptz NOT NULL DEFAULT now(),
  retire_le     timestamptz
);
CREATE INDEX consentements_demande ON consentements (demande_id);

-- ⚠️ TABLE SÉPARÉE, SANS DESTINATAIRE NI CONVERSATION.
-- Il n'existe aucun chemin par lequel une note interne pourrait partir dans
-- un e-mail client. C'est structurel, pas une précaution de code.
CREATE TABLE notes_internes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  demande_id    uuid REFERENCES demandes(id) ON DELETE CASCADE,
  dossier_id    uuid REFERENCES dossiers(id) ON DELETE CASCADE,
  auteur_id     uuid NOT NULL REFERENCES utilisateurs(id),
  corps         text NOT NULL,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_rattachee CHECK (demande_id IS NOT NULL OR dossier_id IS NOT NULL)
);
CREATE INDEX notes_demande ON notes_internes (demande_id, cree_le DESC);

-- -----------------------------------------------------------------------------
-- FILE D'ÉVÉNEMENTS — LE PATRON « BOÎTE D'ENVOI »
-- -----------------------------------------------------------------------------
-- ⚠️ POURQUOI UNE TABLE ET PAS UN APPEL DIRECT.
--
-- Envoyer l'e-mail dans la foulée de l'insertion pose deux problèmes qu'on ne
-- peut pas résoudre en réessayant :
--
--   · l'envoi réussit puis la transaction échoue → le client reçoit une
--     confirmation pour une demande qui n'existe pas ;
--   · la transaction réussit puis l'envoi échoue → la demande est là, mais
--     personne n'est prévenu, et rien ne le signale.
--
-- L'événement est écrit DANS LA MÊME TRANSACTION que la demande. Les deux
-- existent ou aucun des deux. Un drain les traite ensuite, avec un compteur
-- de tentatives : une panne d'e-mail retarde la notification, elle ne la
-- perd pas. Et `cle_idempotence` empêche le doublon à la reprise.
-- -----------------------------------------------------------------------------
CREATE TABLE evenements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  charge_utile    jsonb NOT NULL,
  cle_idempotence text NOT NULL UNIQUE,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  disponible_le   timestamptz NOT NULL DEFAULT now(),
  traite_le       timestamptz,
  tentatives      integer NOT NULL DEFAULT 0,
  derniere_erreur text
);
CREATE INDEX evenements_a_traiter ON evenements (disponible_le)
  WHERE traite_le IS NULL;

CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destinataire_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  entreprise_id   uuid REFERENCES entreprises(id) ON DELETE CASCADE,
  type            text NOT NULL,
  titre           text NOT NULL,
  -- Ni montant, ni coordonnée : juste de quoi cliquer. Une notification
  -- s'affiche sur un écran verrouillé.
  corps           text,
  lien            text,
  cle_idempotence text,
  lue_le          timestamptz,
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_idempotence
  ON notifications (destinataire_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL;
CREATE INDEX notifications_destinataire ON notifications (destinataire_id, lue_le, cree_le DESC);

-- -----------------------------------------------------------------------------
-- PROPOSITIONS DE COLLABORATION
-- -----------------------------------------------------------------------------
CREATE TABLE propositions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id                 uuid REFERENCES demandes(id) ON DELETE CASCADE,
  mariage_id                 uuid REFERENCES mariages(id) ON DELETE CASCADE,
  entreprise_emettrice_id    uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  entreprise_destinataire_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  prestation                 text NOT NULL,
  message                    text,
  statut                     text NOT NULL DEFAULT 'preparee' CHECK (statut IN (
                               'preparee','proposee','vue','acceptee','refusee','annulee')),
  origine                    text NOT NULL CHECK (origine IN ('automatique','manuelle')),
  cree_par                   uuid REFERENCES utilisateurs(id),
  cree_le                    timestamptz NOT NULL DEFAULT now(),
  -- ⚠️ `envoyee_le` NUL = RIEN N'A ÉTÉ TRANSMIS.
  -- Tant que le compte du collaborateur n'est pas actif et ses permissions
  -- opérationnelles, la proposition est ENREGISTRÉE mais jamais notifiée.
  envoyee_le                 timestamptz,
  vue_le                     timestamptz,
  repondu_le                 timestamptz,
  commentaire                text,
  CONSTRAINT pas_soi_meme CHECK (entreprise_emettrice_id <> entreprise_destinataire_id)
);
-- Idempotence : une seule proposition VIVANTE par (demande, destinataire,
-- prestation). Double soumission, relance de drain, rejeu : rien n'est dupliqué.
CREATE UNIQUE INDEX proposition_vivante_unique
  ON propositions (demande_id, entreprise_destinataire_id, prestation)
  WHERE statut IN ('preparee','proposee','vue','acceptee');
CREATE INDEX propositions_destinataire
  ON propositions (entreprise_destinataire_id, statut, cree_le DESC);
