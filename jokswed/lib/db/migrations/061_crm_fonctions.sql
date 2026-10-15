-- =============================================================================
-- 061 — LE CRM : CRÉER, MODIFIER, RÉPARTIR, CONFIRMER
-- -----------------------------------------------------------------------------
-- Une fonction par geste du métier, chacune refermée sur une permission. Le
-- gabarit n'écrit jamais dans `demandes` par un UPDATE libre : il appelle.
-- C'est ce qui garantit qu'une modification de date se propage AUSSI au
-- mariage, et qu'un statut « confirmée » ne puisse pas exister sans mariage.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. L'ARITHMÉTIQUE DE L'ARGENT — EN CENTIMES ENTIERS, SANS EXCEPTION
-- -----------------------------------------------------------------------------
-- ⚠️ 1300 € EN 3× NE FAIT PAS TROIS FOIS 433,33 €.
--
--   130000 / 3 = 43333 centimes, reste 1 centime.
--
-- Ce centime doit aller quelque part, sinon la somme des échéances est
-- inférieure d'un centime au total et le dossier ne se solde jamais. On le
-- pose sur la DERNIÈRE échéance : 433,33 / 433,33 / 433,34.
--
-- Aucun flottant n'intervient — ni ici, ni dans l'appelant.
CREATE OR REPLACE FUNCTION app.repartir_centimes(p_total integer, p_nombre integer)
RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_base integer; v_reste integer; v_sortie integer[] := '{}'; i integer;
BEGIN
  IF p_nombre IS NULL OR p_nombre < 1 THEN
    RAISE EXCEPTION 'nombre d''échéances invalide : %', p_nombre
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_total IS NULL OR p_total < p_nombre THEN
    -- `echeances.montant_cents > 0` : on ne fabrique pas une échéance à zéro.
    RAISE EXCEPTION 'total % insuffisant pour % échéance(s)', p_total, p_nombre
      USING ERRCODE = 'check_violation';
  END IF;
  v_base  := p_total / p_nombre;
  v_reste := p_total - v_base * p_nombre;
  FOR i IN 1..p_nombre LOOP
    v_sortie := v_sortie || (v_base + CASE WHEN i = p_nombre THEN v_reste ELSE 0 END);
  END LOOP;
  RETURN v_sortie;
END $$;

-- -----------------------------------------------------------------------------
-- 2. LE TOTAL D'UNE PRESTATION : LE DEVIS S'IL EXISTE, LE PRIX CONVENU SINON
-- -----------------------------------------------------------------------------
-- ⚠️ CE QUI ÉTAIT CASSÉ POUR UN DOSSIER SAISI À LA MAIN.
--
-- `situation_financiere` ne lisait que les devis émis. Un mariage convenu au
-- téléphone n'en a pas : son total sortait à 0 €, « reste dû » devenait
-- NÉGATIF à chaque encaissement, et le garde-fou de `confirmer_paiement`
-- — qui refuse d'encaisser plus que dû — était désactivé par sa propre
-- condition `total > 0`.
--
-- Le total devient donc : devis émis, à défaut prix convenu, à défaut prix de
-- la formule demandée. Le même ordre que la saison, pour que deux écrans ne
-- montrent pas deux totaux.
CREATE OR REPLACE FUNCTION app.situation_financiere(p_demande_id uuid)
RETURNS TABLE (
  total_prestation_cents integer,
  facture_cents          integer,
  avoirs_cents           integer,
  encaisse_cents         integer,
  reste_du_cents         integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH
  convenu AS (
    SELECT coalesce(d.prix_total_cents, d.formule_prix_cents, 0) AS total
      FROM demandes d WHERE d.id = p_demande_id
  ),
  devis AS (
    SELECT coalesce(max(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'devis'
       AND d.statut IN ('emis','envoye','accepte')
  ),
  factures AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'facture'
       AND d.statut NOT IN ('brouillon','annule')
  ),
  avoirs AS (
    SELECT coalesce(sum(d.total_ttc_cents), 0) AS total
      FROM documents d
     WHERE d.demande_id = p_demande_id AND d.type = 'avoir'
       AND d.statut NOT IN ('brouillon','annule')
  ),
  -- ⚠️ « confirme » SEUL, ET `montant_signe_cents`.
  -- Un paiement déclaré n'est pas un paiement reçu : le compter ferait
  -- apparaître soldé un dossier qui ne l'est pas. Et la colonne SIGNÉE est
  -- celle où un remboursement se soustrait au lieu de s'ajouter (palier 022).
  encaisse AS (
    SELECT coalesce(sum(p.montant_signe_cents), 0) AS total
      FROM paiements p
     WHERE p.demande_id = p_demande_id AND p.statut = 'confirme'
  ),
  total AS (
    SELECT coalesce(nullif(devis.total, 0), convenu.total, 0) AS t
      FROM devis, convenu
  )
  SELECT total.t::integer, factures.total::integer, avoirs.total::integer,
         encaisse.total::integer, (total.t - encaisse.total)::integer
    FROM total, factures, avoirs, encaisse
$$;
REVOKE ALL ON FUNCTION app.situation_financiere(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.situation_financiere(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 3. L'ÉCHÉANCIER
-- -----------------------------------------------------------------------------
-- ⚠️ UN ENCAISSEMENT NE SE RECALCULE JAMAIS.
--
-- Si le prix change après un acompte reçu, les échéances déjà couvertes par
-- un paiement CONFIRMÉ sont intouchables : elles gardent leur montant et leur
-- rang. Seul le restant est réparti à nouveau. Réécrire une échéance payée
-- reviendrait à réécrire une recette.
CREATE OR REPLACE FUNCTION app.definir_echeancier(
  p_demande_id uuid, p_total_cents integer, p_nombre integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ent uuid; v_acteur uuid;
  v_fige_nb integer; v_fige_cents integer;
  v_parts integer[]; v_natures text[]; i integer; v_restant integer;
BEGIN
  SELECT d.entreprise_destinataire_id INTO v_ent
    FROM demandes d WHERE d.id = p_demande_id;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_ent, 'dossier.ecrire');

  IF p_nombre NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'échéancier 1×, 2× ou 3× uniquement' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer, coalesce(sum(e.montant_cents), 0)::integer
    INTO v_fige_nb, v_fige_cents
    FROM echeances e
   WHERE e.demande_id = p_demande_id AND e.document_id IS NULL
     AND EXISTS (SELECT 1 FROM paiements p
                  WHERE p.echeance_id = e.id AND p.statut = 'confirme');

  IF v_fige_nb >= p_nombre THEN
    RAISE EXCEPTION '% échéance(s) déjà encaissée(s) : impossible de passer à %×',
      v_fige_nb, p_nombre USING ERRCODE = 'check_violation';
  END IF;
  v_restant := p_total_cents - v_fige_cents;
  IF v_restant < (p_nombre - v_fige_nb) THEN
    /* ⚠️ DEUX CAUSES, DEUX MESSAGES.
       Sans encaissement, le problème est que le total ne peut pas se diviser
       en N échéances d'au moins un centime. Avec encaissement, c'est que le
       nouveau prix passerait sous ce qui est déjà reçu. Le même texte pour
       les deux faisait lire « inférieur à ce qui est déjà encaissé (0) ». */
    IF v_fige_cents = 0 THEN
      RAISE EXCEPTION 'total % insuffisant pour % échéance(s)', p_total_cents, p_nombre
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'prix total % inférieur à ce qui est déjà encaissé (%)',
      p_total_cents, v_fige_cents USING ERRCODE = 'check_violation';
  END IF;

  -- Les échéances non encaissées disparaissent — y compris celles qui ne
  -- portent qu'un paiement DÉCLARÉ, dont le lien se dénoue proprement grâce à
  -- `paiements.echeance_id ON DELETE SET NULL`.
  DELETE FROM echeances e
   WHERE e.demande_id = p_demande_id AND e.document_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM paiements p
                      WHERE p.echeance_id = e.id AND p.statut = 'confirme');

  v_parts := app.repartir_centimes(v_restant, p_nombre - v_fige_nb);
  v_natures := CASE p_nombre
                 WHEN 1 THEN ARRAY['unique']
                 WHEN 2 THEN ARRAY['acompte','solde']
                 ELSE        ARRAY['acompte','intermediaire','solde']
               END;

  FOR i IN 1..array_length(v_parts, 1) LOOP
    INSERT INTO echeances (entreprise_id, demande_id, ordre, libelle,
                           montant_cents, nature, statut)
    VALUES (v_ent, p_demande_id, v_fige_nb + i,
            format('Versement %s/%s', v_fige_nb + i, p_nombre),
            v_parts[i], v_natures[v_fige_nb + i], 'prevue');
  END LOOP;

  UPDATE demandes d
     SET nombre_echeances = p_nombre, prix_total_cents = p_total_cents
   WHERE d.id = p_demande_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_ent, 'echeancier.defini', 'demande', p_demande_id::text,
          jsonb_build_object('total_cents', p_total_cents, 'nombre', p_nombre,
                             'figees', v_fige_nb));
  RETURN p_nombre;
END $$;
REVOKE ALL ON FUNCTION app.definir_echeancier(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.definir_echeancier(uuid, integer, integer) TO jokswed_app;

-- --- L'état réel de chaque échéance -----------------------------------------
-- ⚠️ L'ÉTAT N'EST PAS STOCKÉ DEUX FOIS.
-- « à recevoir / déclaré / reçu » se DÉDUIT des paiements rattachés. Une
-- colonne de plus se serait désynchronisée au premier paiement annulé.
CREATE OR REPLACE FUNCTION app.echeancier_demande(p_demande_id uuid)
RETURNS TABLE (
  echeance_id    uuid,
  ordre          integer,
  libelle        text,
  montant_cents  integer,
  nature         text,
  du_le          date,
  recu_cents     integer,
  declare_cents  integer,
  etat           text)
-- ⚠️ `SECURITY INVOKER` — VOULU.
-- Les politiques de `echeances` et de `paiements` exigent déjà le bon tenant
-- ET une permission financière. En `DEFINER`, cette fonction aurait rendu
-- l'échéancier de n'importe quelle demande à qui connaît son identifiant.
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT e.id, e.ordre, e.libelle, e.montant_cents, e.nature, e.du_le,
         coalesce(p.recu, 0)::integer,
         coalesce(p.declare, 0)::integer,
         CASE
           WHEN coalesce(p.recu, 0) >= e.montant_cents THEN 'recu'
           WHEN coalesce(p.recu, 0) > 0                THEN 'partiel'
           WHEN coalesce(p.declare, 0) > 0             THEN 'declare'
           ELSE 'a_recevoir'
         END
    FROM echeances e
    LEFT JOIN LATERAL (
      SELECT sum(x.montant_cents) FILTER (WHERE x.statut = 'confirme') AS recu,
             sum(x.montant_cents) FILTER (WHERE x.statut = 'declare')  AS declare
        FROM paiements x WHERE x.echeance_id = e.id
    ) p ON true
   WHERE e.demande_id = p_demande_id AND e.document_id IS NULL
   ORDER BY e.ordre
$$;
REVOKE ALL ON FUNCTION app.echeancier_demande(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.echeancier_demande(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 4. CRÉER UN DOSSIER À LA MAIN
-- -----------------------------------------------------------------------------
-- ⚠️ ELLE N'ENVOIE RIEN.
--
-- Pas d'accusé de réception, pas d'événement dans la file, pas de push.
-- Enregistrer un mariage pris au téléphone ne doit pas écrire au couple : il
-- vient de raccrocher. L'envoi est un geste séparé, déclenché depuis la fiche.
-- C'est la différence entre « Enregistrer » et « Envoyer ».
--
-- ⚠️ `SECURITY DEFINER` POUR UNE RAISON PRÉCISE : la numérotation.
-- `demande_series` est retirée au rôle métier (palier 010) — une série de
-- références doit être continue, et personne ne doit pouvoir la faire
-- avancer. La permission est vérifiée explicitement, en première ligne.
CREATE OR REPLACE FUNCTION app.creer_demande_manuelle(
  p_entreprise_id uuid, p_champs jsonb)
RETURNS TABLE (demande_id uuid, reference text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_acteur uuid; v_annee integer := extract(year from now())::integer;
  v_rang integer; v_reference text; v_id uuid; v_cle text;
  v_total integer; v_nombre integer;
BEGIN
  v_acteur := app.exiger(p_entreprise_id, 'dossier.ecrire');

  IF coalesce(p_champs->>'contact_nom', '') = '' THEN
    RAISE EXCEPTION 'le nom du couple est obligatoire' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotence en base, comme pour le dépôt public : un double envoi de
  -- formulaire ne crée pas deux fois le mariage.
  v_cle := coalesce(nullif(p_champs->>'cle_idempotence', ''),
                    'manuel:' || p_entreprise_id::text || ':' || gen_random_uuid()::text);
  SELECT d.id, d.reference INTO v_id, v_reference
    FROM demandes d WHERE d.cle_idempotence = v_cle;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_reference;
    RETURN;
  END IF;

  INSERT INTO demande_series (annee, dernier_numero) VALUES (v_annee, 1)
  ON CONFLICT (annee) DO UPDATE SET dernier_numero = demande_series.dernier_numero + 1
  RETURNING dernier_numero INTO v_rang;
  v_reference := 'DEM-' || v_annee || '-' || lpad(v_rang::text, 4, '0');

  INSERT INTO demandes (
    reference, entreprise_destinataire_id, origine, statut,
    contact_nom, contact_nom_2, contact_email, contact_telephone,
    contact_prefere, contact_adresse,
    date_mariage, date_incertaine, heure_debut, heure_fin,
    lieu, lieu_mairie, lieu_ceremonie, lieu_reception,
    ville, departement, invites_estimes, horaires,
    formule_cle, formule_nom, formule_prix_cents, prix_total_cents,
    nombre_echeances, photobooth_360, photobooth_prix_cents,
    video_demandee, message, complements, instantane, cle_idempotence)
  VALUES (
    v_reference, p_entreprise_id, 'manuel',
    coalesce(nullif(p_champs->>'statut', ''), 'a_traiter'),
    p_champs->>'contact_nom', p_champs->>'contact_nom_2',
    -- Un dossier pris au téléphone n'a pas toujours d'e-mail ; `contact_email`
    -- est NOT NULL. On pose une adresse d'attente dans le domaine réservé
    -- `.invalid` (RFC 2606) : elle ne peut pas être livrée par erreur.
    coalesce(nullif(p_champs->>'contact_email', ''),
             'sans-email+' || v_reference || '@jokswed.invalid')::citext,
    p_champs->>'contact_telephone', nullif(p_champs->>'contact_prefere', ''),
    p_champs->>'contact_adresse',
    nullif(p_champs->>'date_mariage', '')::date,
    coalesce((p_champs->>'date_incertaine')::boolean, nullif(p_champs->>'date_mariage','') IS NULL),
    nullif(p_champs->>'heure_debut', '')::time,
    nullif(p_champs->>'heure_fin', '')::time,
    p_champs->>'lieu', p_champs->>'lieu_mairie',
    p_champs->>'lieu_ceremonie', p_champs->>'lieu_reception',
    p_champs->>'ville', p_champs->>'departement',
    nullif(p_champs->>'invites_estimes', '')::integer, p_champs->>'horaires',
    nullif(p_champs->>'formule_cle', ''), nullif(p_champs->>'formule_nom', ''),
    nullif(p_champs->>'formule_prix_cents', '')::integer,
    nullif(p_champs->>'prix_total_cents', '')::integer,
    coalesce((p_champs->>'nombre_echeances')::smallint, 1),
    coalesce((p_champs->>'photobooth_360')::boolean, false),
    nullif(p_champs->>'photobooth_prix_cents', '')::integer,
    coalesce((p_champs->>'video_demandee')::boolean, false),
    p_champs->>'message', p_champs->>'complements',
    p_champs, v_cle)
  RETURNING id INTO v_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_entreprise_id, 'demande.creee_manuellement', 'demande',
          v_id::text, jsonb_build_object('reference', v_reference));

  v_total  := nullif(p_champs->>'prix_total_cents', '')::integer;
  v_nombre := coalesce((p_champs->>'nombre_echeances')::integer, 1);
  IF v_total IS NOT NULL AND v_total >= v_nombre THEN
    PERFORM app.definir_echeancier(v_id, v_total, v_nombre);
  END IF;

  RETURN QUERY SELECT v_id, v_reference;
END $$;
REVOKE ALL ON FUNCTION app.creer_demande_manuelle(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.creer_demande_manuelle(uuid, jsonb) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 5. MODIFIER — ET QUE LA MODIFICATION ARRIVE PARTOUT
-- -----------------------------------------------------------------------------
-- ⚠️ LE MARIAGE EST MIS À JOUR DANS LA MÊME TRANSACTION.
--
-- La date vit à deux endroits : sur la demande (ce que lisent le tableau de
-- bord, la saison, le suivi public) et sur le mariage (ce que lisent les
-- dossiers des collaborateurs et le flux de calendrier). Ce n'est pas une
-- copie à synchroniser « plus tard » : les deux écritures sont ici, ensemble,
-- ou aucune. Un collaborateur ne peut donc pas voir une date périmée.
CREATE OR REPLACE FUNCTION app.maj_demande(p_demande_id uuid, p_champs jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD; v_acteur uuid; v_total integer; v_nombre integer;
BEGIN
  SELECT * INTO v_d FROM demandes d WHERE d.id = p_demande_id;
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_d.entreprise_destinataire_id, 'dossier.ecrire');

  /* `p_champs ? 'cle'` et non `coalesce(...)` : une clé ABSENTE laisse la
     valeur en place, une clé présente et vide EFFACE. Sans cette distinction,
     vider un numéro de téléphone était impossible. */
  UPDATE demandes d SET
    contact_nom       = CASE WHEN p_champs ? 'contact_nom'       THEN coalesce(nullif(p_champs->>'contact_nom',''), d.contact_nom) ELSE d.contact_nom END,
    contact_nom_2     = CASE WHEN p_champs ? 'contact_nom_2'     THEN nullif(p_champs->>'contact_nom_2','')   ELSE d.contact_nom_2 END,
    contact_email     = CASE WHEN p_champs ? 'contact_email'     THEN coalesce(nullif(p_champs->>'contact_email','')::citext, d.contact_email) ELSE d.contact_email END,
    contact_telephone = CASE WHEN p_champs ? 'contact_telephone' THEN nullif(p_champs->>'contact_telephone','') ELSE d.contact_telephone END,
    contact_adresse   = CASE WHEN p_champs ? 'contact_adresse'   THEN nullif(p_champs->>'contact_adresse','') ELSE d.contact_adresse END,
    date_mariage      = CASE WHEN p_champs ? 'date_mariage'      THEN nullif(p_champs->>'date_mariage','')::date ELSE d.date_mariage END,
    date_incertaine   = CASE WHEN p_champs ? 'date_mariage'      THEN nullif(p_champs->>'date_mariage','') IS NULL ELSE d.date_incertaine END,
    heure_debut       = CASE WHEN p_champs ? 'heure_debut'       THEN nullif(p_champs->>'heure_debut','')::time ELSE d.heure_debut END,
    heure_fin         = CASE WHEN p_champs ? 'heure_fin'         THEN nullif(p_champs->>'heure_fin','')::time   ELSE d.heure_fin END,
    lieu              = CASE WHEN p_champs ? 'lieu'              THEN nullif(p_champs->>'lieu','')            ELSE d.lieu END,
    lieu_mairie       = CASE WHEN p_champs ? 'lieu_mairie'       THEN nullif(p_champs->>'lieu_mairie','')     ELSE d.lieu_mairie END,
    lieu_ceremonie    = CASE WHEN p_champs ? 'lieu_ceremonie'    THEN nullif(p_champs->>'lieu_ceremonie','')  ELSE d.lieu_ceremonie END,
    lieu_reception    = CASE WHEN p_champs ? 'lieu_reception'    THEN nullif(p_champs->>'lieu_reception','')  ELSE d.lieu_reception END,
    ville             = CASE WHEN p_champs ? 'ville'             THEN nullif(p_champs->>'ville','')           ELSE d.ville END,
    departement       = CASE WHEN p_champs ? 'departement'       THEN nullif(p_champs->>'departement','')     ELSE d.departement END,
    invites_estimes   = CASE WHEN p_champs ? 'invites_estimes'   THEN nullif(p_champs->>'invites_estimes','')::integer ELSE d.invites_estimes END,
    horaires          = CASE WHEN p_champs ? 'horaires'          THEN nullif(p_champs->>'horaires','')        ELSE d.horaires END,
    formule_nom       = CASE WHEN p_champs ? 'formule_nom'       THEN nullif(p_champs->>'formule_nom','')     ELSE d.formule_nom END,
    photobooth_360    = CASE WHEN p_champs ? 'photobooth_360'    THEN coalesce((p_champs->>'photobooth_360')::boolean, false) ELSE d.photobooth_360 END,
    photobooth_prix_cents = CASE WHEN p_champs ? 'photobooth_prix_cents' THEN nullif(p_champs->>'photobooth_prix_cents','')::integer ELSE d.photobooth_prix_cents END,
    video_demandee    = CASE WHEN p_champs ? 'video_demandee'    THEN coalesce((p_champs->>'video_demandee')::boolean, false) ELSE d.video_demandee END,
    message           = CASE WHEN p_champs ? 'message'           THEN nullif(p_champs->>'message','')         ELSE d.message END,
    complements       = CASE WHEN p_champs ? 'complements'       THEN nullif(p_champs->>'complements','')     ELSE d.complements END
  WHERE d.id = p_demande_id;

  -- La journée elle-même, si le mariage existe déjà.
  IF v_d.mariage_id IS NOT NULL THEN
    UPDATE mariages m SET
      date_mariage    = dd.date_mariage,
      date_incertaine = dd.date_incertaine,
      ville           = dd.ville,
      departement     = dd.departement,
      invites_estimes = dd.invites_estimes
      FROM demandes dd
     WHERE m.id = v_d.mariage_id AND dd.id = p_demande_id;
  END IF;

  -- Le prix reprend tout l'échéancier restant. Jamais les encaissements.
  IF p_champs ? 'prix_total_cents' OR p_champs ? 'nombre_echeances' THEN
    SELECT coalesce(nullif(p_champs->>'prix_total_cents','')::integer, d.prix_total_cents),
           coalesce((p_champs->>'nombre_echeances')::integer, d.nombre_echeances)
      INTO v_total, v_nombre
      FROM demandes d WHERE d.id = p_demande_id;
    IF v_total IS NOT NULL AND v_nombre IS NOT NULL THEN
      PERFORM app.definir_echeancier(p_demande_id, v_total, v_nombre);
    END IF;
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_d.entreprise_destinataire_id, 'demande.modifiee', 'demande',
          p_demande_id::text, p_champs - 'cle_idempotence');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.maj_demande(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.maj_demande(uuid, jsonb) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 6. LE STATUT — UNE SEULE TRANSITION MÉTIER
-- -----------------------------------------------------------------------------
-- ⚠️ « CONFIRMÉE » NE S'ÉCRIT PAS À LA MAIN.
--
-- Une demande confirmée sans mariage derrière, c'est un carnet qui annonce une
-- date qu'aucun dossier ne porte : ni planning, ni affectation, ni flux de
-- calendrier. Demander le statut « confirmee » passe donc par
-- `app.confirmer_demande`, qui crée le mariage, le contact et le dossier — ou
-- refuse s'il n'y a pas de date. Tous les autres statuts sont libres :
-- corriger un état reste un droit de l'administration.
CREATE OR REPLACE FUNCTION app.definir_statut_demande(
  p_demande_id uuid, p_statut text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid; v_acteur uuid; v_avant text;
BEGIN
  SELECT d.entreprise_destinataire_id, d.statut INTO v_ent, v_avant
    FROM demandes d WHERE d.id = p_demande_id;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_ent, 'dossier.ecrire');

  IF p_statut = 'confirmee' THEN
    PERFORM app.confirmer_demande(p_demande_id);
  ELSE
    UPDATE demandes d SET statut = p_statut,
           traitee_le = CASE WHEN p_statut IN ('refusee','annulee','close','archivee')
                             THEN coalesce(d.traitee_le, now()) ELSE d.traitee_le END
     WHERE d.id = p_demande_id;
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, avant, apres)
  VALUES (v_acteur, v_ent, 'demande.statut', 'demande', p_demande_id::text,
          jsonb_build_object('statut', v_avant), jsonb_build_object('statut', p_statut));
  RETURN p_statut;
END $$;
REVOKE ALL ON FUNCTION app.definir_statut_demande(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.definir_statut_demande(uuid, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 7. UN PAIEMENT MANUEL, RATTACHÉ À SON ÉCHÉANCE
-- -----------------------------------------------------------------------------
-- ⚠️ UN NOM PROPRE, PAS UNE SURCHARGE.
-- `app.enregistrer_paiement` existe déjà avec six paramètres. Ajouter une
-- variante à huit aurait créé deux fonctions de même nom : plpgsql choisit
-- alors par types, et un `NULL` non typé rend l'appel ambigu à l'exécution.
--
-- ⚠️ ET IL ARRIVE « declare », JAMAIS « confirme ».
-- Saisir un montant n'est pas l'avoir reçu. La confirmation est un second
-- geste, porté par une autre permission.
CREATE OR REPLACE FUNCTION app.enregistrer_paiement_echeance(
  p_demande_id uuid, p_echeance_id uuid, p_montant_cents integer,
  p_moyen text, p_type text, p_reference text, p_recu_le date, p_cle text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ent uuid; v_acteur uuid; v_id uuid;
BEGIN
  SELECT d.entreprise_destinataire_id INTO v_ent
    FROM demandes d WHERE d.id = p_demande_id;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_ent, 'finance.saisir_paiement');

  -- L'échéance doit appartenir à CETTE demande : un identifiant d'échéance
  -- d'autrui rattacherait un encaissement au dossier d'un confrère.
  IF p_echeance_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM echeances e
                      WHERE e.id = p_echeance_id AND e.demande_id = p_demande_id) THEN
    RAISE EXCEPTION 'échéance étrangère à cette demande' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO paiements (entreprise_id, demande_id, echeance_id, montant_cents,
                         moyen, type_paiement, reference, recu_le,
                         saisi_par, cle_idempotence)
  VALUES (v_ent, p_demande_id, p_echeance_id, p_montant_cents,
          p_moyen, coalesce(p_type, 'partiel'), nullif(p_reference, ''),
          coalesce(p_recu_le, current_date), v_acteur, p_cle)
  /* ⚠️ LE PRÉDICAT EST OBLIGATOIRE : `paiement_idempotence` est un index
     PARTIEL (`WHERE cle_idempotence IS NOT NULL`). Sans le répéter ici,
     PostgreSQL ne sait pas quel index viser et lève « there is no unique or
     exclusion constraint matching the ON CONFLICT specification ». */
  ON CONFLICT (entreprise_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                               ressource_id, apres)
    VALUES (v_acteur, v_ent, 'paiement.saisi', 'demande', p_demande_id::text,
            jsonb_build_object('montant_cents', p_montant_cents, 'moyen', p_moyen,
                               'echeance_id', p_echeance_id));
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.enregistrer_paiement_echeance(uuid, uuid, integer, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enregistrer_paiement_echeance(uuid, uuid, integer, text, text, text, date, text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 8. CONFIRMER UN ENCAISSEMENT CONFIRME LE DOSSIER
-- -----------------------------------------------------------------------------
-- ⚠️ C'EST L'ARGENT REÇU QUI RÉSERVE LA DATE, PAS UN CLIC SUR UN STATUT.
--
-- Un acompte réellement reçu — donc confirmé — engendre le mariage, le
-- contact et le dossier, dans LA MÊME transaction. Si la création du dossier
-- échoue (pas de date au carnet), la confirmation du paiement échoue avec
-- elle : on ne garde pas un encaissement sur un dossier fantôme.
--
-- Sans date de mariage, on confirme quand même le paiement mais pas le
-- dossier : l'argent est arrivé, c'est un fait, et la date viendra.
CREATE OR REPLACE FUNCTION app.confirmer_paiement_et_dossier(p_paiement_id uuid)
RETURNS TABLE (confirme boolean, mariage_id uuid, motif text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_d RECORD; v_mariage uuid; v_ok boolean;
BEGIN
  SELECT p.demande_id INTO v_p FROM paiements p WHERE p.id = p_paiement_id;
  v_ok := app.confirmer_paiement(p_paiement_id);
  IF NOT v_ok OR v_p.demande_id IS NULL THEN
    RETURN QUERY SELECT v_ok, NULL::uuid, 'paiement non confirmable'::text;
    RETURN;
  END IF;

  SELECT d.id, d.statut, d.date_mariage, d.mariage_id INTO v_d
    FROM demandes d WHERE d.id = v_p.demande_id;

  IF v_d.mariage_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_d.mariage_id, 'dossier déjà ouvert'::text;
    RETURN;
  END IF;
  IF v_d.date_mariage IS NULL THEN
    RETURN QUERY SELECT true, NULL::uuid, 'date de mariage à renseigner'::text;
    RETURN;
  END IF;
  IF v_d.statut IN ('refusee','annulee','archivee') THEN
    RETURN QUERY SELECT true, NULL::uuid, 'demande close'::text;
    RETURN;
  END IF;

  /* ⚠️ L'ENCAISSEMENT RESTE CONFIRMÉ MÊME SI L'OUVERTURE DU DOSSIER ÉCHOUE.
     Confirmer un paiement demande `finance.confirmer_paiement` ; ouvrir le
     dossier demande `dossier.ecrire`. Qui n'a que la première doit pouvoir
     enregistrer l'argent reçu : le bloc rend alors un motif, et l'écran
     affiche « dossier à confirmer ». Sans ce rattrapage, un comptable ne
     pouvait plus rien confirmer du tout. */
  BEGIN
    v_mariage := app.confirmer_demande(v_p.demande_id);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RETURN QUERY SELECT true, NULL::uuid, 'dossier à confirmer manuellement'::text;
    RETURN;
  END;
  RETURN QUERY SELECT true, v_mariage, NULL::text;
END $$;
REVOKE ALL ON FUNCTION app.confirmer_paiement_et_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirmer_paiement_et_dossier(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 9. CE QU'UN COLLABORATEUR VOIT DE LA JOURNÉE
-- -----------------------------------------------------------------------------
-- ⚠️ ON NE DUPLIQUE PAS LE DOSSIER : ON LE RÉFÉRENCE.
--
-- Le planning et les fichiers vivent sur la demande du PILOTE. Un vidéaste ou
-- un prestataire photobooth n'en reçoit pas une copie : il interroge la même
-- ligne, à travers une fonction qui vérifie deux choses — qu'il a bien un
-- dossier sur CE mariage, et que la catégorie lui a été partagée.
--
-- Sans partage, il ne voit rien. Et il ne voit JAMAIS les montants : aucune
-- colonne financière ne sort d'ici.
CREATE OR REPLACE FUNCTION app.planning_du_dossier(p_dossier_id uuid)
RETURNS TABLE (ordre integer, heure time, titre text, lieu text, notes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mariage uuid; v_ent uuid; v_pilote boolean;
BEGIN
  SELECT d.mariage_id, d.entreprise_id, d.pilote INTO v_mariage, v_ent, v_pilote
    FROM dossiers d WHERE d.id = p_dossier_id;
  IF v_mariage IS NULL THEN RETURN; END IF;
  PERFORM app.exiger(v_ent, 'dossier.lire');

  IF NOT v_pilote AND NOT EXISTS (
       SELECT 1 FROM partages_mariage pm
        WHERE pm.mariage_id = v_mariage AND pm.entreprise_id = v_ent
          AND pm.categorie = 'planning' AND pm.retire_le IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT e.ordre, e.heure, e.titre, e.lieu, e.notes
    FROM etapes_planning e
    JOIN demandes dm  ON dm.id = e.demande_id
    JOIN dossiers pil ON pil.id = dm.dossier_id AND pil.pilote
                     AND pil.mariage_id = v_mariage
   ORDER BY e.ordre;
END $$;
REVOKE ALL ON FUNCTION app.planning_du_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.planning_du_dossier(uuid) TO jokswed_app;

-- --- Les fichiers explicitement partagés ------------------------------------
-- ⚠️ `partage = true` SEUL. Un contrat, un relevé de paiement, une note
-- interne restent chez moi : être affecté à la journée n'ouvre pas le dossier.
CREATE OR REPLACE FUNCTION app.fichiers_du_dossier(p_dossier_id uuid)
RETURNS TABLE (fichier_id uuid, nom text, categorie text, type_mime text,
               taille_octets integer, cree_le timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mariage uuid; v_ent uuid; v_pilote boolean;
BEGIN
  SELECT d.mariage_id, d.entreprise_id, d.pilote INTO v_mariage, v_ent, v_pilote
    FROM dossiers d WHERE d.id = p_dossier_id;
  IF v_mariage IS NULL THEN RETURN; END IF;
  PERFORM app.exiger(v_ent, 'dossier.lire');

  IF NOT v_pilote AND NOT EXISTS (
       SELECT 1 FROM partages_mariage pm
        WHERE pm.mariage_id = v_mariage AND pm.entreprise_id = v_ent
          AND pm.categorie = 'documents_partages' AND pm.retire_le IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.id, f.nom, f.categorie, f.type_mime, f.taille_octets, f.cree_le
    FROM fichiers_dossier f
    JOIN demandes dm  ON dm.id = f.demande_id
    JOIN dossiers pil ON pil.id = dm.dossier_id AND pil.pilote
                     AND pil.mariage_id = v_mariage
   WHERE f.partage
   ORDER BY f.cree_le DESC;
END $$;
REVOKE ALL ON FUNCTION app.fichiers_du_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fichiers_du_dossier(uuid) TO jokswed_app;

-- --- Le contenu d'un fichier partagé ----------------------------------------
-- La route de téléchargement ne décide rien : elle redemande ici, avec LE
-- dossier au nom duquel on prétend lire. Un identifiant de fichier seul ne
-- suffit donc pas — c'est ce qui ferme l'IDOR.
CREATE OR REPLACE FUNCTION app.fichier_du_dossier(
  p_fichier_id uuid, p_dossier_id uuid)
RETURNS TABLE (nom text, type_mime text, contenu bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.fichiers_du_dossier(p_dossier_id) f
                  WHERE f.fichier_id = p_fichier_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT f.nom, f.type_mime, f.contenu FROM fichiers_dossier f WHERE f.id = p_fichier_id;
END $$;
REVOKE ALL ON FUNCTION app.fichier_du_dossier(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fichier_du_dossier(uuid, uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 10. LE FLUX DE CALENDRIER
-- -----------------------------------------------------------------------------
-- ⚠️ LE JETON EST LA SEULE AUTHENTIFICATION, ET ON N'EN GARDE QUE L'EMPREINTE.
--
-- Une URL de flux iCalendar s'enregistre une fois dans Apple Calendar, puis
-- dort en clair dans les réglages de l'appareil. Elle doit donc : être
-- indevinable, ne rien ouvrir d'autre que le carnet, et pouvoir être révoquée.
--
-- ⚠️ ET AUCUN MONTANT N'EN SORT.
-- Ni prix, ni acompte, ni reste dû. Un calendrier se partage, se synchronise,
-- s'affiche sur un écran verrouillé.
CREATE OR REPLACE FUNCTION app.definir_jeton_calendrier(
  p_entreprise_id uuid, p_jeton_hache text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  v_acteur := app.exiger(p_entreprise_id, 'entreprise.reglages');
  UPDATE entreprises e
     SET jeton_calendrier_hache = p_jeton_hache,
         jeton_calendrier_le    = CASE WHEN p_jeton_hache IS NULL THEN NULL ELSE now() END
   WHERE e.id = p_entreprise_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_entreprise_id,
          CASE WHEN p_jeton_hache IS NULL THEN 'calendrier.revoque'
               ELSE 'calendrier.jeton_regenere' END,
          'entreprise', p_entreprise_id::text, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.definir_jeton_calendrier(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.definir_jeton_calendrier(uuid, text) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.calendrier_entreprise(p_jeton_hache text)
RETURNS TABLE (
  demande_id   uuid,
  reference    text,
  couple       text,
  date_mariage date,
  heure_debut  time,
  heure_fin    time,
  lieu         text,
  ville        text,
  annule       boolean,
  maj_le       timestamptz,
  planning     text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.id, d.reference,
         d.contact_nom || coalesce(' & ' || d.contact_nom_2, ''),
         d.date_mariage, d.heure_debut, d.heure_fin,
         coalesce(d.lieu_reception, d.lieu_ceremonie, d.lieu_mairie, d.lieu),
         d.ville,
         d.statut IN ('refusee','annulee'),
         d.maj_le,
         (SELECT string_agg(
                   coalesce(to_char(e.heure, 'HH24:MI') || ' — ', '') || e.titre
                   || coalesce(' (' || e.lieu || ')', ''),
                   E'\n' ORDER BY e.ordre)
            FROM etapes_planning e WHERE e.demande_id = d.id)
    FROM demandes d
    JOIN entreprises ent ON ent.id = d.entreprise_destinataire_id
   WHERE ent.jeton_calendrier_hache IS NOT NULL
     AND ent.jeton_calendrier_hache = p_jeton_hache
     AND ent.archivee_le IS NULL
     -- Seuls les mariages RÉELLEMENT au carnet : un dossier existe derrière,
     -- et une date aussi. Un simple prospect n'encombre pas le calendrier.
     AND d.mariage_id IS NOT NULL
     AND d.date_mariage IS NOT NULL
     AND d.statut <> 'archivee'
   ORDER BY d.date_mariage
$$;
REVOKE ALL ON FUNCTION app.calendrier_entreprise(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.calendrier_entreprise(text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 11. SUPPRESSION DÉFINITIVE
-- -----------------------------------------------------------------------------
-- ⚠️ ELLE REFUSE DÈS QU'IL Y A UNE TRACE COMPTABLE.
--
-- Un paiement confirmé est une recette ; un document émis porte un numéro
-- d'une série qui doit rester continue. Ni l'un ni l'autre ne se supprime —
-- les déclencheurs `paiements_indestructibles` et
-- `documents_refuser_suppression` le refuseraient de toute façon, mais mieux
-- vaut un message clair qu'une erreur de contrainte. Dans ce cas : archiver.
--
-- Pour le reste, tout part dans LA MÊME transaction, dans l'ordre des clés
-- étrangères : rien ne survit en orphelin.
CREATE OR REPLACE FUNCTION app.supprimer_demande(p_demande_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD; v_acteur uuid; v_n integer;
BEGIN
  SELECT d.id, d.reference, d.entreprise_destinataire_id AS ent,
         d.mariage_id, d.dossier_id
    INTO v_d FROM demandes d WHERE d.id = p_demande_id;
  IF v_d.id IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_d.ent, 'dossier.ecrire');

  SELECT count(*)::integer INTO v_n FROM paiements p
   WHERE p.demande_id = p_demande_id AND p.statut = 'confirme';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% encaissement(s) confirmé(s) : archiver au lieu de supprimer', v_n
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT count(*)::integer INTO v_n FROM documents doc
   WHERE doc.demande_id = p_demande_id AND doc.statut <> 'brouillon';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% document(s) émis : archiver au lieu de supprimer', v_n
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Les conversations et leurs messages ne portent pas de valeur comptable,
  -- mais ils portent des échanges : on les détache plutôt que de les détruire
  -- (`ON DELETE SET NULL` sur `conversations.demande_id` et `.dossier_id`).
  DELETE FROM paiements      WHERE demande_id = p_demande_id;
  DELETE FROM echeances      WHERE demande_id = p_demande_id;
  DELETE FROM document_lignes WHERE document_id IN
    (SELECT id FROM documents WHERE demande_id = p_demande_id);
  DELETE FROM echeances      WHERE document_id IN
    (SELECT id FROM documents WHERE demande_id = p_demande_id);
  DELETE FROM documents      WHERE demande_id = p_demande_id;
  DELETE FROM propositions   WHERE demande_id = p_demande_id;
  DELETE FROM affectations    WHERE dossier_id = v_d.dossier_id;
  -- `etapes_planning`, `fichiers_dossier`, `notes_internes`, `demande_lignes`
  -- et `consentements` partent en cascade avec la demande.
  DELETE FROM demandes       WHERE id = p_demande_id;
  IF v_d.dossier_id IS NOT NULL THEN
    DELETE FROM dossiers WHERE id = v_d.dossier_id;
  END IF;
  IF v_d.mariage_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM dossiers dd WHERE dd.mariage_id = v_d.mariage_id) THEN
    DELETE FROM partages_mariage WHERE mariage_id = v_d.mariage_id;
    DELETE FROM contacts         WHERE mariage_id = v_d.mariage_id;
    DELETE FROM mariages         WHERE id = v_d.mariage_id;
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, avant)
  VALUES (v_acteur, v_d.ent, 'demande.supprimee', 'demande', p_demande_id::text,
          jsonb_build_object('reference', v_d.reference));
  RETURN v_d.reference;
END $$;
REVOKE ALL ON FUNCTION app.supprimer_demande(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.supprimer_demande(uuid) TO jokswed_app;


-- -----------------------------------------------------------------------------
-- 12. LA SAISON CONNAÎT LE PRIX CONVENU
-- -----------------------------------------------------------------------------
-- Seule la ligne de repli du total change. Le reste est repris à l'identique
-- du palier 037 — celui qui masque les montants — parce que deux écrans ne
-- doivent jamais calculer un total différemment.
CREATE OR REPLACE FUNCTION app.saison_mariages(
  p_entreprise_id uuid, p_debut date, p_fin date,
  p_statut text DEFAULT NULL, p_collaborateur uuid DEFAULT NULL)
RETURNS TABLE (
  demande_id           uuid,
  mariage_id           uuid,
  reference            text,
  date_mariage         date,
  contact_nom          text,
  ville                text,
  lieu                 text,
  formule_nom          text,
  statut               text,
  -- ⚠️ NULLABLE : NULL = « vous n'avez pas accès », 0 = « rien ».
  total_cents          integer,
  total_contractualise boolean,
  niveau               integer,
  acompte_cents        integer,
  encaisse_cents       integer,
  solde_restant_cents  integer,
  montants_masques     boolean,
  devis_numero         text,
  contrat_emis         boolean,
  factures_nb          integer,
  equipe               text[],
  videaste             text,
  videaste_statut      text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_voit_finances boolean;
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'dossier.lire');
  v_voit_finances := EXISTS (
    SELECT 1 FROM app.permissions_effectives(p_entreprise_id)
     WHERE permission_cle = 'finance.lire');

  RETURN QUERY
  WITH fin AS (
    SELECT * FROM app._finances_par_demande(p_entreprise_id) WHERE v_voit_finances
  ),
  docs AS (
    SELECT d.demande_id,
           max(d.numero) FILTER (WHERE d.type = 'devis' AND d.statut <> 'brouillon') AS devis_num,
           bool_or(d.type = 'contrat' AND d.statut <> 'brouillon') AS contrat,
           count(*) FILTER (WHERE d.type = 'facture' AND d.statut <> 'brouillon')::integer AS nb_fact
      FROM documents d
     WHERE d.entreprise_id = p_entreprise_id
     GROUP BY d.demande_id
  ),
  eq AS (
    SELECT a.dossier_id,
           array_agg(coalesce(u.prenom || ' ' || u.nom, u.email::text)
                     ORDER BY u.nom) AS noms,
           array_agg(a.utilisateur_id) AS ids
      FROM affectations a
      JOIN utilisateurs u ON u.id = a.utilisateur_id
     WHERE a.entreprise_id = p_entreprise_id AND a.retiree_le IS NULL
     GROUP BY a.dossier_id
  ),
  vid AS (
    SELECT pr.demande_id, e.nom_commercial, pr.statut
      FROM propositions pr
      JOIN entreprises e ON e.id = pr.entreprise_destinataire_id
     WHERE pr.entreprise_emettrice_id = p_entreprise_id
       AND pr.prestation = 'video'
       AND pr.statut <> 'annulee'
  )
  SELECT dm.id, dm.mariage_id, dm.reference, dm.date_mariage, dm.contact_nom,
         dm.ville, dm.lieu, dm.formule_nom, dm.statut,
         CASE WHEN v_voit_finances
              -- ⚠️ `prix_total_cents` S'INSÈRE AVANT LA FORMULE (palier 060).
              -- Un dossier saisi à la main n'a ni devis ni proposition : son
              -- total est le prix convenu. Sans cette marche, la saison
              -- affichait le tarif de la formule — ou 0 € s'il n'y en a pas.
              THEN coalesce(nullif(fin.engage_cents, 0),
                            nullif(fin.propose_cents, 0),
                            dm.prix_total_cents, dm.formule_prix_cents, 0)
              ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.engage_cents, 0) > 0 ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.niveau, 0) ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.acomptes_cents, 0) ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.encaisse_cents, 0) ELSE NULL END,
         CASE WHEN v_voit_finances THEN coalesce(fin.solde_a_percevoir_cents, 0) ELSE NULL END,
         NOT v_voit_finances,
         docs.devis_num, coalesce(docs.contrat, false), coalesce(docs.nb_fact, 0),
         coalesce(eq.noms, '{}'::text[]),
         vid.nom_commercial, vid.statut
    FROM demandes dm
    LEFT JOIN fin  ON fin.demande_id = dm.id
    LEFT JOIN docs ON docs.demande_id = dm.id
    LEFT JOIN eq   ON eq.dossier_id = dm.dossier_id
    LEFT JOIN vid  ON vid.demande_id = dm.id
   WHERE dm.entreprise_destinataire_id = p_entreprise_id
     AND dm.date_mariage IS NOT NULL
     AND dm.date_mariage >= p_debut AND dm.date_mariage < p_fin
     AND (p_statut IS NULL OR dm.statut = p_statut)
     AND (p_collaborateur IS NULL OR p_collaborateur = ANY (coalesce(eq.ids, '{}'::uuid[])))
   ORDER BY dm.date_mariage;
END $$;
REVOKE ALL ON FUNCTION app.saison_mariages(uuid, date, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.saison_mariages(uuid, date, date, text, uuid) TO jokswed_app;
