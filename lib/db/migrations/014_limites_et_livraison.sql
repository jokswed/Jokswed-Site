-- =============================================================================
-- 014 — LIMITATION DE DÉBIT PERSISTANTE ET SUIVI DE LIVRAISON
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LIMITATION DE DÉBIT — EN BASE, DONC PARTAGÉE PAR TOUTES LES INSTANCES
-- -----------------------------------------------------------------------------
-- ⚠️ CE QUE LA VERSION EN MÉMOIRE NE POUVAIT PAS FAIRE.
--
-- Chaque fonction Vercel avait sa propre `Map` : un script réparti sur dix
-- instances obtenait dix fois la limite affichée, et une instance fraîchement
-- démarrée repartait de zéro. C'était un garde-fou, pas un mur — on l'avait
-- écrit, mais il fallait finir par le remplacer.
--
-- ⚠️ ET LE PIÈGE INVERSE : BLOQUER DE VRAIS CLIENTS.
--
-- Derrière un réseau mobile, des milliers d'abonnés partagent la même adresse
-- publique (CGNAT). Une limite stricte par IP interdirait le formulaire à tout
-- un opérateur dès qu'un seul visiteur insiste. On combine donc deux échelles :
--
--   · par ADRESSE E-MAIL : stricte, car elle désigne une personne ;
--   · par RÉSEAU (/24)   : large, car elle peut désigner une ville entière.
--
-- Un couple qui hésite et renvoie son formulaire trois fois passe. Un script
-- qui en envoie cinquante depuis la même IP est arrêté — et s'il varie les
-- adresses e-mail, c'est la limite réseau, volontairement haute, qui agit.
CREATE TABLE limites_debit (
  cle        text NOT NULL,
  fenetre    timestamptz NOT NULL,
  compte     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (cle, fenetre)
);
CREATE INDEX limites_purge ON limites_debit (fenetre);

/* Fenêtre fixe, incrémentée atomiquement. Deux requêtes simultanées ne peuvent
   pas lire la même valeur puis l'écraser : `ON CONFLICT DO UPDATE RETURNING`
   fait l'incrément dans la base. */
CREATE OR REPLACE FUNCTION app.limiter(
  p_cle text, p_limite integer, p_fenetre_secondes integer)
RETURNS TABLE (autorise boolean, compte integer, reessayer_dans integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_debut timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_fenetre_secondes) * p_fenetre_secondes);
  v_compte integer;
BEGIN
  DELETE FROM limites_debit WHERE fenetre < now() - interval '1 day';

  INSERT INTO limites_debit (cle, fenetre, compte) VALUES (p_cle, v_debut, 1)
  ON CONFLICT (cle, fenetre) DO UPDATE SET compte = limites_debit.compte + 1
  RETURNING limites_debit.compte INTO v_compte;

  RETURN QUERY SELECT
    v_compte <= p_limite,
    v_compte,
    greatest(1, ceil(extract(epoch from
      (v_debut + make_interval(secs => p_fenetre_secondes)) - now()))::integer);
END $$;

REVOKE ALL ON FUNCTION app.limiter(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.limiter(text, integer, integer) TO jokswed_app;
ALTER TABLE limites_debit ENABLE ROW LEVEL SECURITY;
ALTER TABLE limites_debit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON limites_debit FROM jokswed_app;

-- -----------------------------------------------------------------------------
-- 2. SUIVI DE LIVRAISON DES E-MAILS
-- -----------------------------------------------------------------------------
-- ⚠️ « ENVOYÉ » N'EST PAS « REÇU ».
--
-- Le fournisseur accuse la PRISE EN CHARGE, pas la remise. Le statut distingue
-- donc les deux, et les retours de webhook Brevo viendront l'affiner. Tant
-- qu'aucun webhook n'est branché, un message reste `envoye` : on ne prétendra
-- pas qu'il a été lu.
CREATE TABLE envois_email (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id     uuid REFERENCES evenements(id) ON DELETE SET NULL,
  demande_id       uuid REFERENCES demandes(id) ON DELETE SET NULL,
  entreprise_id    uuid REFERENCES entreprises(id) ON DELETE SET NULL,
  gabarit          text NOT NULL,
  destinataire     citext NOT NULL,
  expediteur       text NOT NULL,
  sujet            text NOT NULL,
  statut           text NOT NULL DEFAULT 'en_attente' CHECK (statut IN (
                     'en_attente','envoye','echoue','inhibe','rejete')),
  fournisseur      text,
  -- Le Message-ID RFC rendu par le fournisseur : c'est l'ancre du fil de
  -- discussion pour la future messagerie entrante.
  message_id_rfc   text,
  erreur           text,
  tentatives       integer NOT NULL DEFAULT 0,
  cle_idempotence  text NOT NULL UNIQUE,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  envoye_le        timestamptz
);
CREATE INDEX envois_demande ON envois_email (demande_id, cree_le DESC);
CREATE INDEX envois_a_relancer ON envois_email (statut) WHERE statut = 'echoue';

ALTER TABLE envois_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE envois_email FORCE ROW LEVEL SECURITY;
GRANT SELECT ON envois_email TO jokswed_app;

CREATE POLICY envoi_tenant ON envois_email FOR SELECT
  USING (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));

/* Journal d'envoi, écrit par le drain qui n'a pas d'acteur. Idempotent :
   rejouer un événement ne crée pas une seconde ligne d'envoi. */
CREATE OR REPLACE FUNCTION app.journaliser_envoi(
  p_evenement uuid, p_demande uuid, p_entreprise uuid, p_gabarit text,
  p_destinataire citext, p_expediteur text, p_sujet text,
  p_statut text, p_fournisseur text, p_message_id text, p_erreur text, p_cle text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO envois_email (evenement_id, demande_id, entreprise_id, gabarit,
                            destinataire, expediteur, sujet, statut, fournisseur,
                            message_id_rfc, erreur, tentatives, cle_idempotence,
                            envoye_le)
  VALUES (p_evenement, p_demande, p_entreprise, p_gabarit, p_destinataire,
          p_expediteur, p_sujet, p_statut, p_fournisseur, p_message_id,
          left(p_erreur, 500), 1, p_cle,
          CASE WHEN p_statut = 'envoye' THEN now() END)
  ON CONFLICT (cle_idempotence) DO UPDATE
    SET statut = EXCLUDED.statut,
        tentatives = envois_email.tentatives + 1,
        message_id_rfc = coalesce(EXCLUDED.message_id_rfc, envois_email.message_id_rfc),
        erreur = EXCLUDED.erreur,
        envoye_le = coalesce(envois_email.envoye_le, EXCLUDED.envoye_le)
  RETURNING id
$$;
REVOKE ALL ON FUNCTION app.journaliser_envoi(uuid,uuid,uuid,text,citext,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.journaliser_envoi(uuid,uuid,uuid,text,citext,text,text,text,text,text,text,text) TO jokswed_app;

/* Relance manuelle d'un envoi échoué : remet l'événement en file. */
CREATE OR REPLACE FUNCTION app.relancer_envoi(p_envoi_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_envoi RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_envoi FROM envois_email WHERE id = p_envoi_id;
  IF v_envoi IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_envoi.entreprise_id, 'dossier.ecrire');

  UPDATE evenements SET traite_le = NULL, disponible_le = now(), derniere_erreur = NULL
   WHERE id = v_envoi.evenement_id;
  UPDATE envois_email SET statut = 'en_attente', erreur = NULL WHERE id = p_envoi_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, v_envoi.entreprise_id, 'envoi.relance', 'envoi', p_envoi_id::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.relancer_envoi(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.relancer_envoi(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 3. VERROU DU DRAIN — UN SEUL TRAITEMENT À LA FOIS
-- -----------------------------------------------------------------------------
-- `FOR UPDATE SKIP LOCKED` empêche déjà deux drains de prendre le MÊME
-- événement. Ce verrou-ci évite en plus que dix exécutions simultanées se
-- marchent dessus sans rien apporter : la seconde renonce immédiatement.
-- `pg_try_advisory_xact_lock` se libère tout seul à la fin de la transaction,
-- même si le processus meurt — c'est ce qui le rend sûr sur Vercel.
CREATE OR REPLACE FUNCTION app.verrou_drain()
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pg_try_advisory_xact_lock(hashtext('jokswed:drain'))
$$;
REVOKE ALL ON FUNCTION app.verrou_drain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verrou_drain() TO jokswed_app;
