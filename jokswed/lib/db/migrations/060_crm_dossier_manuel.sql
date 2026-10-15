-- =============================================================================
-- 060 — LE CRM : UN DOSSIER SAISI À LA MAIN EST UN DOSSIER COMME UN AUTRE
-- -----------------------------------------------------------------------------
-- ⚠️ AUCUNE TABLE PARALLÈLE.
--
-- Un mariage pris au téléphone n'est pas une autre espèce de mariage. La
-- source métier reste `demandes` — c'est elle que lisent le tableau de bord,
-- la saison, le tableau financier, le suivi public et la confirmation qui
-- engendre le mariage et le dossier. Créer une table « dossiers_manuels »
-- aurait dédoublé chacun de ces écrans, et le premier oubli de jointure
-- aurait fait disparaître le mariage d'un seul d'entre eux.
--
-- Ce palier n'ajoute donc QUE ce qui manquait à `demandes` pour qu'une saisie
-- manuelle soit complète : la seconde personne du couple, les horaires, les
-- trois lieux de la journée, l'échéancier voulu, et l'option Photobooth 360.
--
-- ⚠️ `origine` EXISTAIT DÉJÀ. On s'en sert — `'manuel'` au lieu de
-- `'formulaire_public'` — plutôt que d'ajouter un drapeau de plus.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LA FICHE : CE QU'ON SAISIT QUAND IL N'Y A PAS EU DE FORMULAIRE
-- -----------------------------------------------------------------------------
ALTER TABLE demandes
  ADD COLUMN contact_nom_2         text,
  ADD COLUMN contact_adresse       text,
  ADD COLUMN heure_debut           time,
  ADD COLUMN heure_fin             time,
  ADD COLUMN lieu_mairie           text,
  ADD COLUMN lieu_ceremonie        text,
  ADD COLUMN lieu_reception        text,
  -- ⚠️ LE PRIX CONVENU, DISTINCT DU PRIX DE LA FORMULE.
  -- `formule_prix_cents` est ce que le client A VU au formulaire ; il est
  -- repris dans l'accusé de réception et dans le suivi public. L'écraser pour
  -- noter un tarif négocié réécrirait l'historique. Le prix réellement
  -- convenu — formule retenue, tarif personnalisé, options — vit donc ici.
  ADD COLUMN prix_total_cents      integer
    CHECK (prix_total_cents IS NULL OR prix_total_cents >= 0),
  -- 1×, 2× ou 3×. Au-delà, ce n'est plus un échéancier de mariage.
  ADD COLUMN nombre_echeances      smallint NOT NULL DEFAULT 1
    CHECK (nombre_echeances BETWEEN 1 AND 3),
  ADD COLUMN photobooth_360        boolean NOT NULL DEFAULT false,
  -- ⚠️ NULL = « SUR DEVIS », PAS « GRATUIT ».
  -- Aucun tarif Photobooth n'a été arrêté : on n'en invente pas un. La
  -- colonne reste vide jusqu'à ce qu'un prix soit saisi en administration, et
  -- l'affichage dit « sur devis » tant qu'elle l'est.
  ADD COLUMN photobooth_prix_cents integer
    CHECK (photobooth_prix_cents IS NULL OR photobooth_prix_cents >= 0);

COMMENT ON COLUMN demandes.nombre_echeances IS
  'Échéancier voulu : 1, 2 ou 3 versements. Les montants vivent dans echeances.';

-- -----------------------------------------------------------------------------
-- 2. DEUX ÉTATS QUI MANQUAIENT : ANNULÉ, ET TERMINÉ
-- -----------------------------------------------------------------------------
-- La contrainte d'origine est anonyme (`CHECK` en ligne) : on la retrouve par
-- sa définition plutôt que par un nom généré, qu'un futur PostgreSQL pourrait
-- écrire autrement.
DO $$
DECLARE v_nom text;
BEGIN
  SELECT c.conname INTO v_nom
    FROM pg_constraint c
   WHERE c.conrelid = 'demandes'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%non_lue%';
  IF v_nom IS NOT NULL THEN
    EXECUTE format('ALTER TABLE demandes DROP CONSTRAINT %I', v_nom);
  END IF;
END $$;

ALTER TABLE demandes ADD CONSTRAINT demande_statut_connu CHECK (statut IN (
  'non_lue','a_traiter','attente_client','attente_collaborateur',
  'en_cours_devis','devis_envoye','confirmee','refusee','annulee','close','archivee'));

-- ⚠️ RÉFÉRENÇABLE PAR COUPLE, comme `dossiers` l'est depuis le palier 005.
-- C'est ce qui permet aux tables rattachées — planning, fichiers — d'exiger
-- par clé étrangère LA MÊME entreprise que la demande. Sans cela, un membre
-- pouvait insérer une étape portant SON entreprise_id et le demande_id d'un
-- confrère : la politique de tenant, qui ne regarde que `entreprise_id`, l'a
-- laissé passer.
ALTER TABLE demandes
  ADD CONSTRAINT demande_entreprise_unique UNIQUE (id, entreprise_destinataire_id);

-- -----------------------------------------------------------------------------
-- 3. UN ÉCHÉANCIER SANS DEVIS
-- -----------------------------------------------------------------------------
-- ⚠️ POURQUOI PAS UNE NOUVELLE TABLE.
--
-- `echeances` porte déjà l'ordre, le libellé, le montant en centimes, la
-- nature et l'état — et `paiements.echeance_id` pointe déjà dessus. Il
-- manquait seulement de pouvoir rattacher une échéance à la DEMANDE quand
-- aucun devis n'a encore été émis : un acompte se convient au téléphone,
-- avant tout document.
ALTER TABLE echeances
  ADD COLUMN demande_id uuid REFERENCES demandes(id) ON DELETE CASCADE;

ALTER TABLE echeances ADD CONSTRAINT echeance_rattachee
  CHECK (document_id IS NOT NULL OR demande_id IS NOT NULL);

-- `echeance_ordre_unique (document_id, ordre)` ne contraint rien quand
-- `document_id` est NULL — deux NULL sont distincts. On pose donc l'unicité
-- qui manque, sur le seul cas des échéances de demande.
CREATE UNIQUE INDEX echeance_ordre_par_demande ON echeances (demande_id, ordre)
  WHERE demande_id IS NOT NULL AND document_id IS NULL;
CREATE INDEX echeance_demande ON echeances (demande_id) WHERE demande_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. LE PLANNING DE LA JOURNÉE
-- -----------------------------------------------------------------------------
-- Une liste d'étapes, et rien de plus. Pas un logiciel de planification :
-- une heure, un intitulé, un lieu, une note.
CREATE TABLE etapes_planning (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id    uuid NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
  -- Dénormalisé comme sur `affectations` : c'est ce qui permet à la politique
  -- de filtrer sans jointure, et à la clé composite d'exiger la même
  -- entreprise que la demande.
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  ordre         integer NOT NULL,
  heure         time,
  titre         text NOT NULL,
  lieu          text,
  notes         text,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  maj_le        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT etape_ordre_unique UNIQUE (demande_id, ordre),
  FOREIGN KEY (demande_id, entreprise_id)
    REFERENCES demandes (id, entreprise_destinataire_id) ON DELETE CASCADE
);
CREATE INDEX etape_planning_demande ON etapes_planning (demande_id, ordre);
CREATE TRIGGER etapes_planning_maj BEFORE UPDATE ON etapes_planning
  FOR EACH ROW EXECUTE FUNCTION tenir_maj_le();

-- -----------------------------------------------------------------------------
-- 5. LES FICHIERS DU DOSSIER
-- -----------------------------------------------------------------------------
-- ⚠️ LE MÊME STOCKAGE QUE LES PIÈCES JOINTES : `bytea`, DANS LA BASE.
--
-- Aucun fournisseur de plus. Les pièces reçues par e-mail sont déjà stockées
-- ainsi, avec la même borne de 8 Mio, et bénéficient donc des mêmes
-- sauvegardes et de la même RLS. Un planning PDF et une photo d'inspiration
-- n'ont pas besoin d'un bucket.
--
-- ⚠️ `partage` DÉCIDE DE CE QUE VOIT UN COLLABORATEUR.
-- Par défaut, non. Un contrat ou un relevé n'a pas à partir chez le vidéaste
-- parce qu'il est affecté à la journée.
CREATE TABLE fichiers_dossier (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id    uuid NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  categorie     text NOT NULL CHECK (categorie IN
                  ('planning','inspirations','contrat','devis','paiement','photos','autre')),
  nom           text NOT NULL,
  -- Liste blanche. Un type absent d'ici n'entre pas : c'est le contrôle qui
  -- empêche de déposer un .html ou un .svg servis plus tard sur le domaine.
  type_mime     text NOT NULL CHECK (type_mime IN
                  ('application/pdf','image/jpeg','image/png','image/webp','image/heic')),
  taille_octets integer NOT NULL CHECK (taille_octets > 0),
  contenu       bytea NOT NULL,
  partage       boolean NOT NULL DEFAULT false,
  depose_par    uuid REFERENCES utilisateurs(id),
  cree_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fichier_borne CHECK (taille_octets <= 8 * 1024 * 1024),
  FOREIGN KEY (demande_id, entreprise_id)
    REFERENCES demandes (id, entreprise_destinataire_id) ON DELETE CASCADE
);
CREATE INDEX fichier_dossier_demande ON fichiers_dossier (demande_id, cree_le DESC);

-- -----------------------------------------------------------------------------
-- 6. LE JETON DU FLUX DE CALENDRIER
-- -----------------------------------------------------------------------------
-- ⚠️ ON STOCKE L'EMPREINTE, PAS LE JETON.
-- L'URL d'un flux iCalendar s'enregistre une fois dans Apple Calendar et
-- circule ensuite en clair dans les réglages de l'appareil. Une base lue ne
-- doit pas rendre le flux de quiconque : on y garde un SHA-256, et on
-- compare. Régénérer écrase l'empreinte — l'ancienne URL cesse de servir.
ALTER TABLE entreprises
  ADD COLUMN jeton_calendrier_hache text UNIQUE,
  ADD COLUMN jeton_calendrier_le    timestamptz;

-- -----------------------------------------------------------------------------
-- 7. RLS ET PRIVILÈGES
-- -----------------------------------------------------------------------------
-- ⚠️ `ENABLE` SEUL, JAMAIS `FORCE` — VOIR LE PALIER 056.
-- `FORCE` soumet le PROPRIÉTAIRE à ses propres politiques, et c'est lui qui
-- exécute les fonctions `SECURITY DEFINER` dont dépend tout l'accès contrôlé :
-- elles rendraient un résultat vide, en silence. Un banc vérifie qu'aucune
-- table n'est en `FORCE`.
ALTER TABLE etapes_planning  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichiers_dossier ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON etapes_planning  TO jokswed_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fichiers_dossier TO jokswed_app;

CREATE POLICY etape_tenant ON etapes_planning
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY etape_permission ON etapes_planning AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id, ARRAY['planning.lire','planning.ecrire','dossier.lire']))
  WITH CHECK (app.acteur_porte(entreprise_id, ARRAY['planning.ecrire']));

CREATE POLICY fichier_tenant ON fichiers_dossier
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

CREATE POLICY fichier_permission ON fichiers_dossier AS RESTRICTIVE
  USING (app.acteur_porte(entreprise_id, ARRAY['dossier.lire','dossier.ecrire']))
  WITH CHECK (app.acteur_porte(entreprise_id, ARRAY['dossier.ecrire']));
