CREATE TABLE IF NOT EXISTS jw_dossiers (
 id uuid PRIMARY KEY,
 capture_key text UNIQUE NOT NULL,
 data jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Accès uniquement via les routes authentifiées du serveur, jamais directement depuis le navigateur.
