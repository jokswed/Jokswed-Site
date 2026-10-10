-- =============================================================================
-- 003 — ENTREPRISES ET RÉGIMES FISCAUX
-- =============================================================================

CREATE TABLE entreprises (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  nom_commercial  text NOT NULL,
  raison_sociale  text,
  forme_juridique text,
  siret           text,
  code_ape        text,
  adresse_ligne1  text,
  adresse_ligne2  text,
  code_postal     text,
  ville           text,
  pays            text NOT NULL DEFAULT 'FR',
  email           citext,
  telephone       text,
  iban_chiffre    bytea,
  mediateur_nom   text,
  mediateur_url   text,
  mentions_pied   text,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  maj_le          timestamptz NOT NULL DEFAULT now(),
  archivee_le     timestamptz,
  CONSTRAINT siret_format CHECK (siret IS NULL OR siret ~ '^[0-9]{14}$')
  -- ⚠️ LE RÉGIME FISCAL N'EST PAS UNE COLONNE D'ICI : voir regimes_tva.
);
CREATE TRIGGER entreprises_maj BEFORE UPDATE ON entreprises
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

-- -----------------------------------------------------------------------------
-- RÉGIMES DE TVA — HISTORISÉS, PAS GRAVÉS SUR L'ENTREPRISE.
--
-- ⚠️ POURQUOI UNE TABLE ET PAS UNE COLONNE.
--
-- Un régime change dans le temps : franchise en base dépassée en cours
-- d'année, passage à l'assujettissement. Une colonne sur `entreprises`
-- réécrirait le passé et invaliderait rétroactivement des documents déjà
-- émis sous l'ancien régime. Le document fige donc le régime applicable À SA
-- DATE D'ÉMISSION, et c'est ici qu'on le retrouve.
--
-- ⚠️ ET L'OBLIGATION DU NUMÉRO DE TVA N'EST PAS GÉNÉRALE.
--
-- En franchise en base (art. 293 B du CGI), aucune TVA n'est facturée et
-- c'est la mention d'exonération qui est obligatoire ; le numéro
-- intracommunautaire n'est pas requis pour des opérations internes. En régime
-- assujetti, le numéro du vendeur relève de l'art. 242 nonies A, ann. II CGI.
-- La contrainte ci-dessous ne vaut donc QUE pour l'assujetti.
-- -----------------------------------------------------------------------------
CREATE TABLE regimes_tva (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id  uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  regime         text NOT NULL CHECK (regime IN ('franchise_base','assujetti','exonere')),
  tva_numero     text,
  mention_legale text,
  debut_le       date NOT NULL,
  fin_le         date,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periode_valide CHECK (fin_le IS NULL OR fin_le > debut_le),
  CONSTRAINT numero_si_assujetti
    CHECK (regime <> 'assujetti' OR tva_numero IS NOT NULL),
  CONSTRAINT mention_si_franchise
    CHECK (regime <> 'franchise_base' OR mention_legale IS NOT NULL),
  -- Deux régimes ne peuvent pas se recouvrir pour une même entreprise.
  EXCLUDE USING gist (
    entreprise_id WITH =,
    daterange(debut_le, fin_le, '[)') WITH &&
  )
);

-- Taux autorisés en table de référence : en ajouter un ne touche pas au schéma.
CREATE TABLE taux_tva (
  taux_bp integer PRIMARY KEY CHECK (taux_bp BETWEEN 0 AND 10000),
  libelle text NOT NULL,
  actif   boolean NOT NULL DEFAULT true
);
INSERT INTO taux_tva (taux_bp, libelle) VALUES
  (0, 'Exonéré ou non applicable'), (550, '5,5 %'), (1000, '10 %'), (2000, '20 %');
