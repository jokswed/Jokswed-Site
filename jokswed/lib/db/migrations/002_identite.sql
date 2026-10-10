-- =============================================================================
-- 002 — IDENTITÉ : utilisateurs, secrets, second facteur, sessions
-- =============================================================================

CREATE TABLE utilisateurs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  email_verifie_le timestamptz,
  prenom           text NOT NULL,
  nom              text NOT NULL,
  telephone        text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  maj_le           timestamptz NOT NULL DEFAULT now(),
  desactive_le     timestamptz,
  derniere_connexion_le timestamptz,
  CONSTRAINT email_plausible CHECK (email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
CREATE TRIGGER utilisateurs_maj BEFORE UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

-- -----------------------------------------------------------------------------
-- LES SECRETS DE CONNEXION.
--
-- `secret_hache` ne contient JAMAIS un mot de passe : c'est une empreinte
-- scrypt avec son sel et ses paramètres. Voir lib/auth/mot-de-passe.ts.
-- -----------------------------------------------------------------------------
CREATE TABLE identifiants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id   uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('mot_de_passe','passkey')),
  secret_hache     text NOT NULL,
  parametres       jsonb NOT NULL DEFAULT '{}',
  cree_le          timestamptz NOT NULL DEFAULT now(),
  dernier_usage_le timestamptz
);
-- Un seul mot de passe par personne ; plusieurs passkeys restent possibles.
CREATE UNIQUE INDEX identifiant_mdp_unique
  ON identifiants (utilisateur_id) WHERE type = 'mot_de_passe';

CREATE TABLE facteurs_mfa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('totp','webauthn')),
  -- Chiffré au repos par l'application, jamais journalisé.
  secret_chiffre bytea NOT NULL,
  libelle        text,
  confirme_le    timestamptz,
  cree_le        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_utilisateur ON facteurs_mfa (utilisateur_id) WHERE confirme_le IS NOT NULL;

-- -----------------------------------------------------------------------------
-- SESSIONS.
--
-- ⚠️ SEULE L'EMPREINTE DU JETON EST STOCKÉE.
-- Le jeton en clair ne vit que dans le cookie du navigateur. Une fuite de
-- cette table ne permet donc pas d'usurper une session — et la révocation
-- devient un simple UPDATE, effectif à la requête suivante.
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id   uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jeton_hache      text NOT NULL UNIQUE,
  appareil         text,
  user_agent       text,
  ip_tronquee      text,
  mfa_validee      boolean NOT NULL DEFAULT false,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  dernier_acces_le timestamptz NOT NULL DEFAULT now(),
  expire_le        timestamptz NOT NULL,
  revoquee_le      timestamptz,
  revoquee_par     uuid REFERENCES utilisateurs(id),
  CONSTRAINT expiration_future CHECK (expire_le > cree_le)
);
CREATE INDEX sessions_actives ON sessions (utilisateur_id) WHERE revoquee_le IS NULL;

-- Tentatives de connexion : la limitation de débit en base, partagée entre
-- toutes les instances — contrairement au garde-fou en mémoire de la V1.
CREATE TABLE tentatives_connexion (
  id          bigserial PRIMARY KEY,
  cle         text NOT NULL,
  horodatage  timestamptz NOT NULL DEFAULT now(),
  reussie     boolean NOT NULL
);
CREATE INDEX tentatives_fenetre ON tentatives_connexion (cle, horodatage DESC);
