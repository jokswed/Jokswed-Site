-- =============================================================================
-- 004 — MEMBRES, RÔLES, PERMISSIONS, INVITATIONS
-- =============================================================================

-- Catalogue des permissions. C'est une TABLE, pas une énumération du code :
-- en ajouter une ne demande ni migration de type, ni déploiement.
CREATE TABLE permissions (
  cle       text PRIMARY KEY,
  categorie text NOT NULL,
  libelle   text NOT NULL
);

INSERT INTO permissions (cle, categorie, libelle) VALUES
  ('dossier.lire',               'Dossiers',     'Consulter les dossiers de l''entreprise'),
  ('dossier.ecrire',             'Dossiers',     'Modifier un dossier'),
  ('dossier.affecter',           'Dossiers',     'Affecter un membre à un dossier'),
  ('planning.lire',              'Planning',     'Consulter le planning d''un mariage'),
  ('planning.ecrire',            'Planning',     'Modifier le planning'),
  ('client.coordonnees.lire',    'Données',      'Voir les coordonnées des clients'),
  ('document.lire',              'Documents',    'Consulter les documents'),
  ('document.rediger',           'Documents',    'Rédiger un brouillon'),
  ('document.emettre',           'Documents',    'Émettre un document définitif'),
  ('document.envoyer',           'Documents',    'Envoyer un document au client'),
  ('finance.lire',               'Finances',     'Voir les montants de l''entreprise'),
  ('finance.saisir_paiement',    'Finances',     'Enregistrer un paiement'),
  ('finance.confirmer_paiement', 'Finances',     'Confirmer un paiement'),
  ('finance.rembourser',         'Finances',     'Rembourser'),
  ('finance.consolide.lire',     'Finances',     'Vue consolidée INTER-ENTREPRISES'),
  ('catalogue.lire',             'Catalogue',    'Consulter les prestations et tarifs'),
  ('catalogue.ecrire',           'Catalogue',    'Modifier les prestations et tarifs'),
  ('collaboration.proposer',     'Collaboration','Proposer une prestation à un partenaire'),
  ('collaboration.repondre',     'Collaboration','Accepter ou refuser une proposition'),
  ('message.lire',               'Messagerie',   'Lire les conversations'),
  ('message.envoyer',            'Messagerie',   'Envoyer un message'),
  ('note.lire',                  'Messagerie',   'Lire les notes internes'),
  ('note.ecrire',                'Messagerie',   'Écrire une note interne'),
  ('membre.inviter',             'Administration','Inviter un collaborateur'),
  ('membre.revoquer',            'Administration','Révoquer un accès'),
  ('role.gerer',                 'Administration','Gérer les rôles et permissions'),
  ('entreprise.reglages',        'Administration','Modifier les réglages de l''entreprise'),
  ('audit.lire',                 'Journal',      'Consulter le journal d''audit');

-- Rôles. `entreprise_id IS NULL` = rôle MODÈLE, copié à la création d'une
-- entreprise. Chaque entreprise possède ensuite ses propres rôles, qu'elle
-- peut ajuster sans affecter les autres.
CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid REFERENCES entreprises(id) ON DELETE CASCADE,
  cle           text NOT NULL,
  libelle       text NOT NULL,
  description   text,
  systeme       boolean NOT NULL DEFAULT false,
  cree_le       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX role_cle_unique
  ON roles (COALESCE(entreprise_id, '00000000-0000-0000-0000-000000000000'::uuid), cle);

CREATE TABLE roles_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_cle text NOT NULL REFERENCES permissions(cle) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_cle)
);

CREATE TABLE membres (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id  uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  ajoute_le      timestamptz NOT NULL DEFAULT now(),
  ajoute_par     uuid REFERENCES utilisateurs(id),
  retire_le      timestamptz,
  retire_par     uuid REFERENCES utilisateurs(id)
);
-- Une seule adhésion ACTIVE par couple ; l'historique des adhésions passées
-- est conservé — il documente qui avait accès à quoi, et quand.
CREATE UNIQUE INDEX membre_actif_unique
  ON membres (entreprise_id, utilisateur_id) WHERE retire_le IS NULL;
CREATE INDEX membre_par_utilisateur ON membres (utilisateur_id) WHERE retire_le IS NULL;

-- Plusieurs rôles par membre : exigence explicite du cahier des charges.
CREATE TABLE membres_roles (
  membre_id uuid NOT NULL REFERENCES membres(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (membre_id, role_id)
);

-- Ajustements individuels par-dessus les rôles. UN REFUS L'EMPORTE TOUJOURS.
CREATE TABLE membres_permissions (
  membre_id      uuid NOT NULL REFERENCES membres(id) ON DELETE CASCADE,
  permission_cle text NOT NULL REFERENCES permissions(cle) ON DELETE CASCADE,
  accorde        boolean NOT NULL,
  motif          text,
  PRIMARY KEY (membre_id, permission_cle)
);

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  prenom        text,
  nom           text,
  -- ⚠️ EMPREINTE, PAS LE JETON. Le lien n'existe qu'une fois, dans l'e-mail.
  jeton_hache   text NOT NULL UNIQUE,
  roles         uuid[] NOT NULL DEFAULT '{}',
  cree_par      uuid REFERENCES utilisateurs(id),
  cree_le       timestamptz NOT NULL DEFAULT now(),
  expire_le     timestamptz NOT NULL,
  envoyee_le    timestamptz,
  utilisee_le   timestamptz,
  utilisee_par  uuid REFERENCES utilisateurs(id),
  revoquee_le   timestamptz,
  CONSTRAINT invitation_duree CHECK (expire_le > cree_le)
);
CREATE UNIQUE INDEX invitation_en_cours_unique
  ON invitations (entreprise_id, email)
  WHERE utilisee_le IS NULL AND revoquee_le IS NULL;
