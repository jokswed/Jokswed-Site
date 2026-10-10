-- =============================================================================
-- 016 — DEVIS, CONTRATS, FACTURES ET AVOIRS
-- =============================================================================

CREATE TABLE document_series (
  entreprise_id  uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  serie          text NOT NULL,
  annee          integer NOT NULL,
  dernier_numero integer NOT NULL DEFAULT 0,
  PRIMARY KEY (entreprise_id, serie, annee)
);

CREATE TABLE cgv_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  version       text NOT NULL,
  texte         text NOT NULL,
  publiee_le    timestamptz NOT NULL DEFAULT now(),
  remplacee_le  timestamptz,
  CONSTRAINT cgv_version_unique UNIQUE (entreprise_id, version)
);

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  demande_id    uuid REFERENCES demandes(id) ON DELETE RESTRICT,
  dossier_id    uuid REFERENCES dossiers(id) ON DELETE RESTRICT,

  type          text NOT NULL CHECK (type IN ('devis','contrat','avenant','facture','avoir')),
  role_facture  text CHECK (role_facture IN ('acompte','solde','totale')),
  numero        text,
  version       integer NOT NULL DEFAULT 1,
  statut        text NOT NULL DEFAULT 'brouillon' CHECK (statut IN (
                  'brouillon','emis','envoye','accepte','refuse','remplace','annule')),

  document_origine_id uuid REFERENCES documents(id),
  devis_source_id     uuid REFERENCES documents(id),
  cgv_version_id      uuid REFERENCES cgv_versions(id),

  total_ht_cents  integer NOT NULL DEFAULT 0,
  total_tva_cents integer NOT NULL DEFAULT 0,
  total_ttc_cents integer NOT NULL DEFAULT 0,
  devise          text NOT NULL DEFAULT 'EUR',

  -- ⚠️ TOUT CE QU'IL FAUT POUR RÉIMPRIMER LE DOCUMENT À L'IDENTIQUE DANS DIX
  -- ANS : identité du prestataire, régime de TVA applicable À LA DATE
  -- D'ÉMISSION, coordonnées du client, lignes, échéancier, mentions.
  instantane      jsonb NOT NULL,
  pdf_sha256      text,
  jeton_acces_hache text UNIQUE,

  -- Un document de banc ne consomme jamais un numéro de la série réelle.
  test          boolean NOT NULL DEFAULT true,

  cree_par  uuid REFERENCES utilisateurs(id),
  cree_le   timestamptz NOT NULL DEFAULT now(),
  maj_le    timestamptz NOT NULL DEFAULT now(),
  emis_le   timestamptz,
  envoye_le timestamptz,
  accepte_le timestamptz,

  CONSTRAINT numero_unique_par_entreprise UNIQUE (entreprise_id, numero),
  CONSTRAINT totaux_coherents CHECK (total_ttc_cents = total_ht_cents + total_tva_cents),
  -- Un document hors brouillon a forcément un numéro, une date et une empreinte.
  CONSTRAINT emis_a_un_numero CHECK (
    statut = 'brouillon'
    OR (numero IS NOT NULL AND emis_le IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CONSTRAINT role_facture_si_facture CHECK ((type = 'facture') = (role_facture IS NOT NULL)),
  CONSTRAINT avoir_a_une_origine CHECK (type <> 'avoir' OR document_origine_id IS NOT NULL),
  CONSTRAINT contrat_a_un_devis CHECK (
    type NOT IN ('contrat','avenant') OR devis_source_id IS NOT NULL),
  CONSTRAINT document_entreprise_unique UNIQUE (id, entreprise_id)
);
CREATE INDEX documents_entreprise ON documents (entreprise_id, type, cree_le DESC);
CREATE INDEX documents_demande ON documents (demande_id);
CREATE TRIGGER documents_maj BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

CREATE TABLE document_lignes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entreprise_id uuid NOT NULL,
  ordre         integer NOT NULL DEFAULT 0,
  designation   text NOT NULL,
  detail        text,
  -- Millièmes : 3,5 heures = 3500. Aucun flottant sur une quantité facturée.
  quantite_milliemes  integer NOT NULL DEFAULT 1000 CHECK (quantite_milliemes > 0),
  prix_unitaire_cents integer NOT NULL CHECK (prix_unitaire_cents >= 0),
  remise_cents        integer NOT NULL DEFAULT 0 CHECK (remise_cents >= 0),
  tva_taux_bp         integer NOT NULL DEFAULT 0 CHECK (tva_taux_bp BETWEEN 0 AND 10000),
  total_ht_cents      integer NOT NULL,
  total_tva_cents     integer NOT NULL,
  origine_type  text CHECK (origine_type IN ('formule','supplement','manuel')),
  origine_cle   text,
  FOREIGN KEY (document_id, entreprise_id)
    REFERENCES documents (id, entreprise_id) ON DELETE CASCADE
);
CREATE INDEX document_lignes_doc ON document_lignes (document_id, ordre);

CREATE TABLE echeances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  document_id   uuid REFERENCES documents(id) ON DELETE CASCADE,
  ordre         integer NOT NULL,
  libelle       text NOT NULL,
  montant_cents integer NOT NULL CHECK (montant_cents > 0),
  du_le         date,
  nature        text NOT NULL CHECK (nature IN ('acompte','intermediaire','solde','unique')),
  statut        text NOT NULL DEFAULT 'prevue'
                  CHECK (statut IN ('prevue','exigible','reglee','annulee')),
  cree_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT echeance_ordre_unique UNIQUE (document_id, ordre)
);

CREATE TABLE signatures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  entreprise_id  uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  signataire     text NOT NULL CHECK (signataire IN ('client','prestataire')),
  nom_saisi      text NOT NULL,
  mention        text,
  -- ⚠️ `case_acceptation` N'EST PAS UNE SIGNATURE ÉLECTRONIQUE QUALIFIÉE.
  -- L'interface ne doit jamais la présenter comme telle. Le schéma est prêt
  -- à accueillir un prestataire externe le jour où le niveau de preuve
  -- l'exigera — et ce jour-là, c'est une revue juridique, pas un choix
  -- technique.
  methode        text NOT NULL CHECK (methode IN
                   ('case_acceptation','manuscrite_scannee','prestataire_externe')),
  -- L'empreinte du PDF EXACT qui a été accepté. C'est la preuve.
  empreinte_pdf  text NOT NULL,
  horodatage     timestamptz NOT NULL DEFAULT now(),
  ip_tronquee    text,
  user_agent     text,
  preuve         jsonb NOT NULL DEFAULT '{}'
);

-- -----------------------------------------------------------------------------
-- IMMUABILITÉ D'UN DOCUMENT ÉMIS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION documents_geler() RETURNS trigger AS $$
BEGIN
  IF OLD.statut <> 'brouillon' THEN
    IF NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.instantane      IS DISTINCT FROM OLD.instantane
       OR NEW.total_ttc_cents IS DISTINCT FROM OLD.total_ttc_cents
       OR NEW.total_ht_cents  IS DISTINCT FROM OLD.total_ht_cents
       OR NEW.total_tva_cents IS DISTINCT FROM OLD.total_tva_cents
       OR NEW.pdf_sha256      IS DISTINCT FROM OLD.pdf_sha256
       OR NEW.type            IS DISTINCT FROM OLD.type
       OR NEW.entreprise_id   IS DISTINCT FROM OLD.entreprise_id THEN
      RAISE EXCEPTION
        'document % déjà émis : contenu immuable (corriger par version ou avoir)',
        coalesce(OLD.numero, OLD.id::text) USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER documents_immuables BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_geler();

CREATE OR REPLACE FUNCTION lignes_geler() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT statut INTO s FROM documents
   WHERE id = COALESCE(NEW.document_id, OLD.document_id);
  IF s IS NOT NULL AND s <> 'brouillon' THEN
    RAISE EXCEPTION 'lignes figées : le document est émis'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER lignes_immuables BEFORE INSERT OR UPDATE OR DELETE ON document_lignes
  FOR EACH ROW EXECUTE FUNCTION lignes_geler();

-- ⚠️ DÉCLENCHEUR QUI LÈVE, PAS UNE `RULE ... DO INSTEAD NOTHING`.
-- Une RULE écarterait la suppression EN SILENCE : l'appelant croirait avoir
-- supprimé, et aucune erreur ne remonterait. Sur une pièce comptable, un
-- échec muet est pire qu'un refus bruyant.
CREATE OR REPLACE FUNCTION documents_refuser_suppression() RETURNS trigger AS $$
BEGIN
  IF OLD.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'document % émis : suppression interdite (passer par un avoir)',
      coalesce(OLD.numero, OLD.id::text) USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER documents_suppression_interdite BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_refuser_suppression();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents','document_lignes','echeances','signatures',
                           'cgv_versions','document_series'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON documents, document_lignes, echeances,
                               signatures, cgv_versions TO jokswed_app;
GRANT DELETE ON document_lignes TO jokswed_app;
REVOKE DELETE ON documents, signatures FROM jokswed_app;
REVOKE ALL ON document_series FROM jokswed_app;

CREATE POLICY document_tenant ON documents
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY ligne_doc_tenant ON document_lignes
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY echeance_tenant ON echeances
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY signature_tenant ON signatures
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
CREATE POLICY cgv_tenant ON cgv_versions
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
