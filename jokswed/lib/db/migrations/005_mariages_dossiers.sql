-- =============================================================================
-- 005 — MARIAGES (partagé) ET DOSSIERS (cloisonné)
-- -----------------------------------------------------------------------------
-- La décision structurante du schéma :
--
--   mariage  = objet OPÉRATIONNEL, partageable entre entreprises affectées
--   dossier  = vue COMMERCIALE d'UNE SEULE entreprise sur ce mariage
--
-- ⚠️ CE DÉCOUPAGE NE PROTÈGE RIEN À LUI SEUL.
--
-- On pourrait croire qu'en l'absence de `mariage_id` sur les tables
-- commerciales, aucune requête ne peut relier deux entreprises. C'est faux :
-- `paiements → dossiers → mariage_id → dossiers d'une autre entreprise` y
-- suffit. La protection vient du RLS (palier 006), qui filtre les lignes au
-- niveau de chaque table — le chemin de jointure devient alors sans effet.
-- Ce découpage sert la clarté du modèle, pas la sécurité.
-- =============================================================================

CREATE TABLE mariages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       text NOT NULL UNIQUE,
  date_mariage    date,
  date_incertaine boolean NOT NULL DEFAULT false,
  plusieurs_jours boolean NOT NULL DEFAULT false,
  ville           text,
  departement     text,
  pays            text NOT NULL DEFAULT 'FR',
  invites_estimes integer CHECK (invites_estimes IS NULL OR invites_estimes >= 0),
  types_ceremonie text[] NOT NULL DEFAULT '{}',
  cree_le         timestamptz NOT NULL DEFAULT now(),
  maj_le          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT date_ou_incertaine CHECK (date_mariage IS NOT NULL OR date_incertaine)
);
CREATE TRIGGER mariages_maj BEFORE UPDATE ON mariages
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mariage_id      uuid NOT NULL REFERENCES mariages(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('marie_1','marie_2','autre')),
  prenom          text,
  nom             text,
  email           citext,
  telephone       text,
  contact_prefere text CHECK (contact_prefere IN ('email','telephone','sms')),
  principal       boolean NOT NULL DEFAULT false,
  adresse_ligne1  text,
  code_postal     text,
  ville           text,
  pays            text,
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_principal_unique ON contacts (mariage_id) WHERE principal;
CREATE INDEX contacts_mariage ON contacts (mariage_id);

CREATE TABLE dossiers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mariage_id     uuid NOT NULL REFERENCES mariages(id) ON DELETE RESTRICT,
  entreprise_id  uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  reference      text NOT NULL,
  prestation     text NOT NULL CHECK (prestation IN ('photo','video','autre')),
  statut         text NOT NULL DEFAULT 'nouvelle_demande' CHECK (statut IN (
                   'nouvelle_demande','a_qualifier','devis_en_preparation','devis_envoye',
                   'attente_client','attente_collaborateur','contrat_envoye',
                   'attente_signature','attente_acompte','reserve','mariage_effectue',
                   'retouches','livraison_prete','livre','clos','refuse','annule')),
  -- L'entreprise PILOTE du mariage : la seule à pouvoir réécrire le planning.
  pilote         boolean NOT NULL DEFAULT false,
  responsable_id uuid REFERENCES utilisateurs(id),
  cree_le        timestamptz NOT NULL DEFAULT now(),
  maj_le         timestamptz NOT NULL DEFAULT now(),
  cloture_le     timestamptz,
  CONSTRAINT dossier_unique UNIQUE (mariage_id, entreprise_id, prestation),
  CONSTRAINT reference_unique_par_entreprise UNIQUE (entreprise_id, reference),
  -- Référençable par couple : c'est ce qui permettra aux tables commerciales
  -- (documents, paiements…) d'exiger la MÊME entreprise par clé composite.
  CONSTRAINT dossier_entreprise_unique UNIQUE (id, entreprise_id)
);
CREATE UNIQUE INDEX dossier_pilote_unique ON dossiers (mariage_id) WHERE pilote;
CREATE INDEX dossiers_entreprise ON dossiers (entreprise_id, statut);
CREATE INDEX dossiers_mariage ON dossiers (mariage_id);
CREATE TRIGGER dossiers_maj BEFORE UPDATE ON dossiers
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

-- Ce qu'une entreprise affectée a le droit de VOIR du mariage partagé.
-- Les notes internes n'y figurent pas, et ce n'est pas un oubli : elles ne
-- sont jamais partageables, par construction.
CREATE TABLE partages_mariage (
  mariage_id    uuid NOT NULL REFERENCES mariages(id) ON DELETE CASCADE,
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  categorie     text NOT NULL CHECK (categorie IN
                  ('planning','lieux','coordonnees_clients','documents_partages')),
  accorde_le    timestamptz NOT NULL DEFAULT now(),
  accorde_par   uuid REFERENCES utilisateurs(id),
  retire_le     timestamptz,
  PRIMARY KEY (mariage_id, entreprise_id, categorie)
);

-- Qui travaille sur quoi. Pend au DOSSIER : une entreprise n'affecte que ses
-- propres membres, vérifié par le déclencheur ci-dessous.
CREATE TABLE affectations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id     uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  entreprise_id  uuid NOT NULL,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  mission        text NOT NULL,
  debut_le       timestamptz,
  fin_le         timestamptz,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  retiree_le     timestamptz,
  FOREIGN KEY (dossier_id, entreprise_id)
    REFERENCES dossiers (id, entreprise_id) ON DELETE CASCADE
);

-- ⚠️ COHÉRENCE QU'UNE CLÉ ÉTRANGÈRE NE SAIT PAS EXPRIMER.
-- On ne peut affecter que quelqu'un qui est membre ACTIF de l'entreprise du
-- dossier. Sans cela, une entreprise affecterait le collaborateur d'une autre.
CREATE OR REPLACE FUNCTION affectation_verifier_membre() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM membres m
     WHERE m.utilisateur_id = NEW.utilisateur_id
       AND m.entreprise_id  = NEW.entreprise_id
       AND m.retire_le IS NULL
  ) THEN
    RAISE EXCEPTION 'affectation refusée : % n''est pas membre actif de l''entreprise %',
      NEW.utilisateur_id, NEW.entreprise_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER affectation_membre_actif
  BEFORE INSERT OR UPDATE ON affectations
  FOR EACH ROW EXECUTE FUNCTION affectation_verifier_membre();
