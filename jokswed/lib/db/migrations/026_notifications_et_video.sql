-- =============================================================================
-- 026 — PRÉFÉRENCES DE NOTIFICATION ET WORKFLOW VIDÉO
-- =============================================================================

-- --- 1. Le catalogue des notifications --------------------------------------
-- Une TABLE, comme les permissions : ajouter un type n'exige ni migration de
-- type énuméré ni déploiement.
CREATE TABLE types_notification (
  cle         text PRIMARY KEY,
  libelle     text NOT NULL,
  -- La permission SANS LAQUELLE la notification n'a pas lieu d'être. Une
  -- échéance financière ne part pas à quelqu'un qui ne voit pas les montants.
  permission  text REFERENCES permissions(cle) ON DELETE SET NULL,
  defaut_app   boolean NOT NULL DEFAULT true,
  defaut_email boolean NOT NULL DEFAULT false
);

INSERT INTO types_notification (cle, libelle, permission, defaut_app, defaut_email) VALUES
  ('demande.recue',          'Nouvelle demande',                 'dossier.lire',   true,  true),
  ('collaboration.proposee', 'Proposition de collaboration',     'collaboration.repondre', true, true),
  ('collaboration.repondue', 'Réponse du collaborateur',         'collaboration.proposer', true, true),
  ('dossier.modifie',        'Modification importante du dossier','dossier.lire',  true,  false),
  ('paiement.enregistre',    'Paiement enregistré',              'finance.lire',   true,  false),
  ('echeance.proche',        'Échéance financière à venir',      'finance.lire',   true,  true),
  ('invitation.acceptee',    'Invitation acceptée',              'membre.inviter', true,  false);

-- Réglage individuel. Absent = on applique le défaut du type.
CREATE TABLE preferences_notification (
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type           text NOT NULL REFERENCES types_notification(cle) ON DELETE CASCADE,
  en_app         boolean NOT NULL DEFAULT true,
  par_email      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (utilisateur_id, type)
);
ALTER TABLE preferences_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences_notification FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON preferences_notification TO jokswed_app;
-- ⚠️ CHACUN SES PRÉFÉRENCES, ET CELLES DE PERSONNE D'AUTRE.
-- Pas de clause par entreprise : un employeur n'a pas à régler les
-- notifications de son collaborateur, ni à savoir ce qu'il a désactivé.
CREATE POLICY preference_personnelle ON preferences_notification
  USING (utilisateur_id = app.acteur())
  WITH CHECK (utilisateur_id = app.acteur());

-- --- 2. Notifier, en respectant permission ET préférence --------------------
CREATE OR REPLACE FUNCTION app.notification_voulue(
  p_destinataire uuid, p_entreprise uuid, p_type text)
RETURNS TABLE (en_app boolean, par_email boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    coalesce(pr.en_app, t.defaut_app)
      AND (t.permission IS NULL
           OR t.permission = ANY (app.permissions_de(p_destinataire, p_entreprise))),
    coalesce(pr.par_email, t.defaut_email)
      AND (t.permission IS NULL
           OR t.permission = ANY (app.permissions_de(p_destinataire, p_entreprise)))
    FROM types_notification t
    LEFT JOIN preferences_notification pr
           ON pr.type = t.cle AND pr.utilisateur_id = p_destinataire
   WHERE t.cle = p_type
$$;
REVOKE ALL ON FUNCTION app.notification_voulue(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notification_voulue(uuid, uuid, text) TO jokswed_app;

-- `notifier` devient silencieuse quand la permission manque ou que la
-- personne a dit non. Un type inconnu du catalogue passe quand même : on ne
-- perd pas une notification parce qu'un `INSERT` de référence a été oublié.
CREATE OR REPLACE FUNCTION app.notifier(
  p_destinataire uuid, p_entreprise uuid, p_type text, p_titre text,
  p_corps text, p_lien text, p_cle text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_voulue RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM types_notification WHERE cle = p_type) THEN
    SELECT * INTO v_voulue FROM app.notification_voulue(p_destinataire, p_entreprise, p_type);
    IF NOT v_voulue.en_app THEN RETURN; END IF;
  END IF;
  INSERT INTO notifications (destinataire_id, entreprise_id, type, titre, corps,
                             lien, cle_idempotence)
  VALUES (p_destinataire, p_entreprise, p_type, p_titre, p_corps, p_lien, p_cle)
  ON CONFLICT (destinataire_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL
    DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION app.notifier(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notifier(uuid, uuid, text, text, text, text, text) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.mes_notifications(p_limite integer DEFAULT 30)
RETURNS TABLE (id uuid, type text, titre text, corps text, lien text,
               lue_le timestamptz, cree_le timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.id, n.type, n.titre, n.corps, n.lien, n.lue_le, n.cree_le
    FROM notifications n
   WHERE n.destinataire_id = app.acteur()
   ORDER BY n.cree_le DESC
   LIMIT greatest(1, least(coalesce(p_limite, 30), 200))
$$;
REVOKE ALL ON FUNCTION app.mes_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mes_notifications(integer) TO jokswed_app;

-- --- 3. Workflow vidéo -------------------------------------------------------
-- Transmission MANUELLE : le client n'avait pas demandé de vidéo au départ,
-- ou le destinataire change. L'automatique reste géré au dépôt du formulaire.
CREATE OR REPLACE FUNCTION app.proposer_prestation(
  p_demande_id uuid, p_destinataire_id uuid, p_prestation text, p_message text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD; v_acteur uuid; v_id uuid;
BEGIN
  SELECT * INTO v_d FROM demandes WHERE id = p_demande_id;
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_d.entreprise_destinataire_id, 'collaboration.proposer');

  IF p_destinataire_id = v_d.entreprise_destinataire_id THEN
    RAISE EXCEPTION 'on ne se propose pas une prestation à soi-même'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO propositions (demande_id, mariage_id, entreprise_emettrice_id,
                            entreprise_destinataire_id, prestation, message,
                            statut, origine, cree_par)
  VALUES (p_demande_id, v_d.mariage_id, v_d.entreprise_destinataire_id,
          p_destinataire_id, p_prestation, p_message, 'preparee', 'manuelle', v_acteur)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                               ressource_id, apres)
    VALUES (v_acteur, v_d.entreprise_destinataire_id, 'proposition.creee',
            'proposition', v_id::text,
            jsonb_build_object('prestation', p_prestation,
                               'destinataire', p_destinataire_id));
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.proposer_prestation(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.proposer_prestation(uuid, uuid, text, text) TO jokswed_app;

-- ⚠️ TRANSMETTRE EST UN GESTE EXPLICITE, SÉPARÉ DE LA CRÉATION.
-- Tant que `envoyee_le` est nul, la proposition est enregistrée chez
-- l'émetteur mais INVISIBLE du destinataire : aucune coordonnée ne circule.
CREATE OR REPLACE FUNCTION app.transmettre_proposition(p_proposition_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid; v_m RECORD; v_ref text;
BEGIN
  SELECT * INTO v_p FROM propositions WHERE id = p_proposition_id;
  IF v_p IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_p.entreprise_emettrice_id, 'collaboration.proposer');
  IF v_p.statut NOT IN ('preparee') THEN RETURN false; END IF;

  UPDATE propositions SET statut = 'proposee', envoyee_le = now()
   WHERE id = p_proposition_id;

  SELECT reference INTO v_ref FROM demandes WHERE id = v_p.demande_id;

  -- Notification interne pour chaque membre du destinataire habilité à
  -- répondre. Ni nom de client, ni montant : juste de quoi cliquer.
  FOR v_m IN SELECT * FROM app.membres_avec(v_p.entreprise_destinataire_id,
                                            'collaboration.repondre') LOOP
    PERFORM app.notifier(v_m.utilisateur_id, v_p.entreprise_destinataire_id,
      'collaboration.proposee',
      'Nouvelle proposition de prestation ' || v_p.prestation,
      NULL,
      '/admin/propositions',
      'collaboration.proposee:' || p_proposition_id::text);
  END LOOP;

  INSERT INTO evenements (type, charge_utile, cle_idempotence)
  VALUES ('collaboration.proposee',
          jsonb_build_object('proposition_id', p_proposition_id,
                             'entreprise_id', v_p.entreprise_destinataire_id),
          'collaboration.proposee:' || p_proposition_id::text)
  ON CONFLICT (cle_idempotence) DO NOTHING;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
  VALUES (v_acteur, v_p.entreprise_emettrice_id, 'proposition.transmise',
          'proposition', p_proposition_id::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.transmettre_proposition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.transmettre_proposition(uuid) TO jokswed_app;

-- Ce que le destinataire voit d'une proposition : PAS la demande entière.
-- Ni le message du client, ni son e-mail, ni le prix de la photo.
CREATE OR REPLACE FUNCTION app.propositions_recues(p_entreprise_id uuid)
RETURNS TABLE (
  id uuid, prestation text, statut text, message text,
  date_mariage date, ville text, lieu text, invites_estimes integer,
  horaires text, emetteur text, envoyee_le timestamptz, repondu_le timestamptz,
  commentaire text, demande_id uuid, coordonnees_partagees boolean,
  contact_nom text, contact_email citext, contact_telephone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_partage boolean;
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'collaboration.repondre');
  RETURN QUERY
  SELECT pr.id, pr.prestation, pr.statut, pr.message,
         d.date_mariage, d.ville, d.lieu, d.invites_estimes, d.horaires,
         e.nom_commercial, pr.envoyee_le, pr.repondu_le, pr.commentaire,
         pr.demande_id,
         -- ⚠️ LES COORDONNÉES NE SORTENT QU'APRÈS ACCEPTATION ET PARTAGE.
         -- Avant cela, le vidéaste décide sur la DATE et le LIEU : c'est ce
         -- dont il a besoin pour dire oui ou non. Pas sur l'identité du couple.
         (pr.statut = 'acceptee' AND EXISTS (
            SELECT 1 FROM partages_mariage pm
             WHERE pm.mariage_id = d.mariage_id
               AND pm.entreprise_id = p_entreprise_id
               AND pm.categorie = 'coordonnees_clients'
               AND pm.retire_le IS NULL)),
         CASE WHEN pr.statut = 'acceptee' AND EXISTS (
            SELECT 1 FROM partages_mariage pm
             WHERE pm.mariage_id = d.mariage_id AND pm.entreprise_id = p_entreprise_id
               AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL)
              THEN d.contact_nom END,
         CASE WHEN pr.statut = 'acceptee' AND EXISTS (
            SELECT 1 FROM partages_mariage pm
             WHERE pm.mariage_id = d.mariage_id AND pm.entreprise_id = p_entreprise_id
               AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL)
              THEN d.contact_email END,
         CASE WHEN pr.statut = 'acceptee' AND EXISTS (
            SELECT 1 FROM partages_mariage pm
             WHERE pm.mariage_id = d.mariage_id AND pm.entreprise_id = p_entreprise_id
               AND pm.categorie = 'coordonnees_clients' AND pm.retire_le IS NULL)
              THEN d.contact_telephone END
    FROM propositions pr
    JOIN demandes d ON d.id = pr.demande_id
    JOIN entreprises e ON e.id = pr.entreprise_emettrice_id
   WHERE pr.entreprise_destinataire_id = p_entreprise_id
     -- ⚠️ `envoyee_le IS NOT NULL` : une proposition préparée n'existe pas
     -- encore pour son destinataire.
     AND pr.envoyee_le IS NOT NULL
   ORDER BY d.date_mariage NULLS LAST, pr.envoyee_le DESC;
END $$;
REVOKE ALL ON FUNCTION app.propositions_recues(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.propositions_recues(uuid) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.repondre_proposition(
  p_proposition_id uuid, p_acceptee boolean, p_commentaire text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_acteur uuid; v_m RECORD; v_d RECORD; v_dossier uuid;
BEGIN
  SELECT * INTO v_p FROM propositions WHERE id = p_proposition_id;
  IF v_p IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_p.entreprise_destinataire_id, 'collaboration.repondre');
  IF v_p.envoyee_le IS NULL OR v_p.statut NOT IN ('proposee','vue') THEN
    RETURN false;
  END IF;

  UPDATE propositions
     SET statut = CASE WHEN p_acceptee THEN 'acceptee' ELSE 'refusee' END,
         repondu_le = now(), commentaire = p_commentaire
   WHERE id = p_proposition_id;

  -- L'ACCEPTATION CRÉE LE DOSSIER DU COLLABORATEUR, chez lui, avec sa propre
  -- numérotation. Le mariage est commun ; les dossiers ne le sont jamais.
  IF p_acceptee THEN
    SELECT * INTO v_d FROM demandes WHERE id = v_p.demande_id;
    IF v_d.mariage_id IS NOT NULL THEN
      INSERT INTO dossiers (mariage_id, entreprise_id, reference, prestation,
                            statut, pilote)
      VALUES (v_d.mariage_id, v_p.entreprise_destinataire_id,
              v_d.reference || '-V', v_p.prestation, 'a_qualifier', false)
      ON CONFLICT (mariage_id, entreprise_id, prestation) DO NOTHING
      RETURNING id INTO v_dossier;

      -- Le partage opérationnel, et lui seul : planning et lieux. Les
      -- coordonnées du couple restent un geste distinct du pilote.
      INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie, accorde_par)
      SELECT v_d.mariage_id, v_p.entreprise_destinataire_id, c, v_acteur
        FROM unnest(ARRAY['planning','lieux']) AS c
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  FOR v_m IN SELECT * FROM app.membres_avec(v_p.entreprise_emettrice_id,
                                            'collaboration.proposer') LOOP
    PERFORM app.notifier(v_m.utilisateur_id, v_p.entreprise_emettrice_id,
      'collaboration.repondue',
      CASE WHEN p_acceptee THEN 'Proposition acceptée' ELSE 'Proposition refusée' END,
      NULL, '/admin/demandes/' || v_p.demande_id::text,
      'collaboration.repondue:' || p_proposition_id::text);
  END LOOP;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_p.entreprise_destinataire_id, 'proposition.repondue',
          'proposition', p_proposition_id::text,
          jsonb_build_object('acceptee', p_acceptee));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.repondre_proposition(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.repondre_proposition(uuid, boolean, text) TO jokswed_app;

-- Le pilote partage (ou retire) les coordonnées du couple. Geste explicite,
-- tracé, réversible.
CREATE OR REPLACE FUNCTION app.partager_coordonnees(
  p_demande_id uuid, p_entreprise_beneficiaire uuid, p_partager boolean)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d RECORD; v_acteur uuid;
BEGIN
  SELECT * INTO v_d FROM demandes WHERE id = p_demande_id;
  IF v_d IS NULL OR v_d.mariage_id IS NULL THEN RETURN false; END IF;
  v_acteur := app.exiger(v_d.entreprise_destinataire_id, 'client.coordonnees.lire');
  PERFORM app.exiger(v_d.entreprise_destinataire_id, 'collaboration.proposer');

  IF p_partager THEN
    INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie, accorde_par)
    VALUES (v_d.mariage_id, p_entreprise_beneficiaire, 'coordonnees_clients', v_acteur)
    ON CONFLICT (mariage_id, entreprise_id, categorie)
      DO UPDATE SET retire_le = NULL, accorde_le = now(), accorde_par = v_acteur;
  ELSE
    UPDATE partages_mariage SET retire_le = now()
     WHERE mariage_id = v_d.mariage_id AND entreprise_id = p_entreprise_beneficiaire
       AND categorie = 'coordonnees_clients';
  END IF;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_d.entreprise_destinataire_id,
          CASE WHEN p_partager THEN 'coordonnees.partagees' ELSE 'coordonnees.retirees' END,
          'mariage', v_d.mariage_id::text,
          jsonb_build_object('beneficiaire', p_entreprise_beneficiaire));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.partager_coordonnees(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.partager_coordonnees(uuid, uuid, boolean) TO jokswed_app;
