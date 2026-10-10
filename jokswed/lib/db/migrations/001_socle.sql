-- =============================================================================
-- 001 — SOCLE : extensions, journal d'audit, horodatage automatique
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;      -- e-mails insensibles à la casse
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusions mêlant uuid et plage

-- Mise à jour automatique de `maj_le`. Déclaré ici une fois, réutilisé partout.
CREATE OR REPLACE FUNCTION tenir_maj_le() RETURNS trigger AS $$
BEGIN
  NEW.maj_le := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- JOURNAL D'AUDIT — AJOUT SEUL.
--
-- Il est créé en PREMIER parce que tout le reste écrit dedans. Les privilèges
-- de modification et de suppression sont retirés au palier 006 : une ligne
-- d'audit qu'on peut réécrire ne prouve rien.
-- -----------------------------------------------------------------------------
CREATE TABLE journal_audit (
  id             bigserial PRIMARY KEY,
  horodatage     timestamptz NOT NULL DEFAULT now(),
  acteur_id      uuid,
  acteur_type    text NOT NULL DEFAULT 'utilisateur'
                   CHECK (acteur_type IN ('utilisateur','contact','systeme','support')),
  entreprise_id  uuid,
  action         text NOT NULL,
  ressource_type text NOT NULL,
  ressource_id   text,
  avant          jsonb,
  apres          jsonb,
  -- IP TRONQUÉE : /24 en IPv4, /48 en IPv6. Jamais l'adresse complète.
  ip_tronquee    text,
  user_agent     text
);
CREATE INDEX audit_ressource ON journal_audit (ressource_type, ressource_id, horodatage DESC);
CREATE INDEX audit_entreprise ON journal_audit (entreprise_id, horodatage DESC);
CREATE INDEX audit_acteur ON journal_audit (acteur_id, horodatage DESC);
