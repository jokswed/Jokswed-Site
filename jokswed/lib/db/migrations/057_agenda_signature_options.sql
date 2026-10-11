-- 057 — Agenda privé/partagé, signatures individuelles protégées, ajout d'options.
-- À appliquer d'abord sur la branche Neon Preview. Ne jamais rejouer en Production
-- sans tests RLS et sauvegarde. Les documents déjà émis restent immuables.

-- Informations privées à chaque dossier commercial. Aucun détail d'un autre
-- prestataire n'est écrit dans les dossiers JoksWed.
ALTER TABLE dossiers ADD COLUMN details_prestation text;
ALTER TABLE dossiers ADD COLUMN livrables text;
ALTER TABLE dossiers ADD COLUMN horaires_prestation text;

CREATE TABLE signatures_profils (
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  trace_chiffree bytea NOT NULL,
  maj_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entreprise_id, utilisateur_id),
  CONSTRAINT trace_chiffree_max CHECK (octet_length(trace_chiffree) BETWEEN 32 AND 40000)
);
ALTER TABLE signatures_profils ENABLE ROW LEVEL SECURITY;
-- Pas de FORCE : le migrateur possede aussi les fonctions SECURITY DEFINER.
-- RLS reste ACTIVE et les roles applicatifs ne sont proprietaires d aucune table.
CREATE POLICY signature_profil_personnelle ON signatures_profils
  USING (utilisateur_id = app.acteur() AND
    entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())))
  WITH CHECK (utilisateur_id = app.acteur() AND
    entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
GRANT SELECT, INSERT, UPDATE, DELETE ON signatures_profils TO jokswed_app;

CREATE TABLE agenda_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id uuid NOT NULL REFERENCES entreprises(id) ON DELETE RESTRICT,
  mariage_id uuid REFERENCES mariages(id) ON DELETE RESTRICT,
  auteur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  titre text NOT NULL CHECK (char_length(titre) BETWEEN 2 AND 180),
  lieu text,
  debut timestamptz NOT NULL,
  fin timestamptz NOT NULL,
  partage_mariage boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  maj_le timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plage_agenda CHECK (fin > debut AND fin <= debut + interval '7 days'),
  CONSTRAINT partage_avec_mariage CHECK (NOT partage_mariage OR mariage_id IS NOT NULL)
);
CREATE INDEX agenda_entreprise_date ON agenda_evenements (entreprise_id, debut);
CREATE INDEX agenda_mariage_date ON agenda_evenements (mariage_id, debut) WHERE partage_mariage;
ALTER TABLE agenda_evenements ENABLE ROW LEVEL SECURITY;
-- Pas de FORCE : app.mon_agenda applique lui-meme le perimetre autorise.
-- RLS ACTIVE; jokswed_app n a aucun privilege direct sur cette table.
CREATE POLICY agenda_interne ON agenda_evenements
  USING (
    entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
    OR (partage_mariage AND EXISTS (
      SELECT 1 FROM dossiers ds
       WHERE ds.mariage_id = agenda_evenements.mariage_id
         AND ds.entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur()))
         AND ds.statut NOT IN ('annule','refuse')
    ))
  )
  WITH CHECK (entreprise_id IN (SELECT unnest(app.entreprises_de_lacteur())));
-- Les écritures passent exclusivement par des fonctions SEC DEFINER, qui
-- vérifient le rôle, le dossier pilote et la propriété de l'événement.
REVOKE ALL ON agenda_evenements FROM jokswed_app;

CREATE OR REPLACE FUNCTION app.mon_agenda(p_entreprise uuid)
RETURNS TABLE (id uuid, mariage_id uuid, titre text, lieu text,
               debut timestamptz, fin timestamptz, partage_mariage boolean,
               prive boolean, entreprise_source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise, 'dossier.lire');
  RETURN QUERY
  SELECT ev.id, ev.mariage_id, ev.titre, ev.lieu, ev.debut, ev.fin,
         ev.partage_mariage, NOT ev.partage_mariage,
         CASE WHEN ev.entreprise_id = p_entreprise THEN NULL::text
              ELSE e.nom_commercial END
    FROM agenda_evenements ev
    JOIN entreprises e ON e.id = ev.entreprise_id
   WHERE (ev.entreprise_id = p_entreprise AND (ev.auteur_id = app.acteur() OR ev.partage_mariage))
      OR (ev.partage_mariage AND EXISTS (
        SELECT 1 FROM dossiers ds
         WHERE ds.mariage_id = ev.mariage_id AND ds.entreprise_id = p_entreprise
           AND ds.statut NOT IN ('annule','refuse')
      ))
   ORDER BY ev.debut, ev.id;
END $$;
REVOKE ALL ON FUNCTION app.mon_agenda(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mon_agenda(uuid) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.ajouter_evenement_agenda(
    p_entreprise uuid, p_mariage uuid, p_titre text, p_lieu text,
    p_debut_local timestamp, p_fin_local timestamp, p_partage boolean)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid; v_id uuid; v_debut timestamptz; v_fin timestamptz;
BEGIN
  v_acteur := app.exiger(p_entreprise, 'dossier.ecrire');
  IF char_length(trim(coalesce(p_titre,''))) NOT BETWEEN 2 AND 180 THEN
    RAISE EXCEPTION 'intitulé invalide' USING ERRCODE = 'check_violation';
  END IF;
  IF p_mariage IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dossiers d WHERE d.mariage_id = p_mariage
      AND d.entreprise_id = p_entreprise AND d.statut NOT IN ('annule','refuse')
  ) THEN
    RAISE EXCEPTION 'mariage étranger à votre entreprise' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_partage AND (p_mariage IS NULL OR NOT EXISTS (
    SELECT 1 FROM dossiers d WHERE d.mariage_id = p_mariage
      AND d.entreprise_id = p_entreprise AND d.pilote
  )) THEN
    RAISE EXCEPTION 'partage réservé au pilote du mariage' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_debut := p_debut_local AT TIME ZONE 'Europe/Paris';
  v_fin := p_fin_local AT TIME ZONE 'Europe/Paris';
  IF v_debut IS NULL OR v_fin IS NULL OR v_fin <= v_debut OR
     v_fin > v_debut + interval '7 days' THEN
    RAISE EXCEPTION 'plage horaire invalide' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO agenda_evenements
    (entreprise_id, mariage_id, auteur_id, titre, lieu, debut, fin, partage_mariage)
  VALUES (p_entreprise, p_mariage, v_acteur, trim(p_titre), nullif(trim(p_lieu),''),
          v_debut, v_fin, p_partage)
  RETURNING id INTO v_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id,
                             apres)
  VALUES (v_acteur, p_entreprise, 'agenda.ajoute', 'agenda', v_id::text,
          jsonb_build_object('partage',p_partage,'mariage',p_mariage));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.ajouter_evenement_agenda(uuid, uuid, text, text, timestamp, timestamp, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ajouter_evenement_agenda(uuid, uuid, text, text, timestamp, timestamp, boolean) TO jokswed_app;

-- Synchronise les informations communes après une modification explicite par
-- l'entreprise pilote. Une date modifiée n'efface pas les pièces émises.
CREATE OR REPLACE FUNCTION app.actualiser_mariage_pilote(p_demande uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d RECORD; a uuid; partenaire RECORD; membre RECORD;
BEGIN
  SELECT * INTO d FROM demandes WHERE id=p_demande;
  IF d IS NULL THEN RETURN false; END IF;
  a := app.exiger(d.entreprise_destinataire_id, 'dossier.ecrire');
  IF d.mariage_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM dossiers x WHERE x.mariage_id=d.mariage_id
                   AND x.entreprise_id=d.entreprise_destinataire_id AND x.pilote) THEN
    RAISE EXCEPTION 'seul le pilote peut actualiser ce mariage'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE mariages SET date_mariage=d.date_mariage, date_incertaine=d.date_incertaine,
         ville=d.ville, departement=d.departement, invites_estimes=d.invites_estimes
    WHERE id=d.mariage_id;
  UPDATE contacts SET prenom=d.contact_nom, email=d.contact_email,
      telephone=d.contact_telephone, contact_prefere=d.contact_prefere
    WHERE mariage_id=d.mariage_id AND principal;
  FOR partenaire IN SELECT DISTINCT entreprise_id FROM dossiers
     WHERE mariage_id=d.mariage_id AND entreprise_id<>d.entreprise_destinataire_id
       AND statut NOT IN ('annule','refuse') LOOP
    FOR membre IN SELECT * FROM app.membres_avec(partenaire.entreprise_id,'dossier.lire') LOOP
      PERFORM app.notifier(membre.utilisateur_id, partenaire.entreprise_id,
        'dossier.modifie', 'Planning commun mis à jour', NULL,
        '/admin/agenda', 'agenda:maj:'||p_demande::text||':'||extract(epoch from now())::text||':'||membre.utilisateur_id::text);
    END LOOP;
  END LOOP;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type, ressource_id)
   VALUES (a,d.entreprise_destinataire_id,'mariage.actualise','mariage',d.mariage_id::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.actualiser_mariage_pilote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actualiser_mariage_pilote(uuid) TO jokswed_app;

-- Ajout d'une prestation par l'entreprise pilote uniquement. Le devis déjà émis
-- n'est jamais réécrit. La notification du partenaire ne divulgue aucune coordonnée.
CREATE OR REPLACE FUNCTION app.ajouter_option_demande(
  p_demande uuid, p_libelle text, p_prix_cents integer,
  p_partenaire uuid, p_prestation text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d RECORD; a uuid; ligne uuid; partenaire_slug text; membre RECORD;
BEGIN
  SELECT * INTO d FROM demandes WHERE id=p_demande;
  IF d IS NULL THEN RAISE EXCEPTION 'demande introuvable' USING ERRCODE='insufficient_privilege'; END IF;
  a := app.exiger(d.entreprise_destinataire_id, 'dossier.ecrire');
  IF char_length(trim(coalesce(p_libelle,''))) NOT BETWEEN 3 AND 250
    OR (p_prix_cents IS NOT NULL AND (p_prix_cents < 0 OR p_prix_cents > 100000000)) THEN
    RAISE EXCEPTION 'option invalide' USING ERRCODE='check_violation';
  END IF;
  IF p_partenaire IS NOT NULL THEN
    PERFORM app.exiger(d.entreprise_destinataire_id, 'collaboration.proposer');
    IF p_partenaire = d.entreprise_destinataire_id THEN
      RAISE EXCEPTION 'partenaire identique' USING ERRCODE='check_violation';
    END IF;
    SELECT slug INTO partenaire_slug FROM entreprises WHERE id=p_partenaire AND archivee_le IS NULL;
    IF partenaire_slug IS NULL THEN RAISE EXCEPTION 'partenaire introuvable' USING ERRCODE='check_violation'; END IF;
  END IF;
  INSERT INTO demande_lignes(demande_id,type,cle,libelle,prix_cents,type_tarif,
                             compatibilite,executant_partenaire,ordre)
  VALUES(p_demande,'supplement','ajout-'||gen_random_uuid()::text,
         trim(p_libelle),p_prix_cents,CASE WHEN p_prix_cents IS NULL THEN 'sur_devis' ELSE 'fixe' END,
         'proposable',partenaire_slug,
         (SELECT coalesce(max(ordre),0)+1 FROM demande_lignes WHERE demande_id=p_demande))
  RETURNING id INTO ligne;
  IF p_partenaire IS NOT NULL THEN
    PERFORM app.transmettre_a_partenaire(p_demande,p_partenaire,
      CASE WHEN p_prestation IN ('photo','video','autre') THEN p_prestation ELSE 'autre' END,
      'Nouvelle option proposée : '||left(p_libelle,180),ARRAY[]::text[]);
    FOR membre IN SELECT * FROM app.membres_avec(p_partenaire,'dossier.lire') LOOP
      PERFORM app.notifier(membre.utilisateur_id,p_partenaire,'dossier.modifie',
        'Option supplémentaire proposée',null,'/admin/propositions',
        'option:ajoute:'||ligne::text||':'||membre.utilisateur_id::text);
    END LOOP;
  END IF;
  INSERT INTO journal_audit(acteur_id,entreprise_id,action,ressource_type,ressource_id,apres)
  VALUES(a,d.entreprise_destinataire_id,'demande.option_ajoutee','demande',p_demande::text,
         jsonb_build_object('ligne',ligne,'partenaire',p_partenaire));
  RETURN ligne;
END $$;
REVOKE ALL ON FUNCTION app.ajouter_option_demande(uuid,text,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ajouter_option_demande(uuid,text,integer,uuid,text) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.modifier_formule_demande(
  p_demande uuid,p_cle text,p_libelle text,p_prix_cents integer)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d RECORD; a uuid; v_ligne uuid;
BEGIN
  SELECT * INTO d FROM demandes WHERE id=p_demande;
  IF d IS NULL THEN RAISE EXCEPTION 'demande introuvable' USING ERRCODE='insufficient_privilege'; END IF;
  a := app.exiger(d.entreprise_destinataire_id,'dossier.ecrire');
  IF p_prix_cents IS NULL OR p_prix_cents < 0 OR p_prix_cents > 100000000
     OR char_length(p_libelle) NOT BETWEEN 3 AND 120
     OR char_length(p_cle) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'formule invalide' USING ERRCODE='check_violation';
  END IF;
  UPDATE demandes SET formule_cle=p_cle,formule_nom=p_libelle,
         formule_prix_cents=p_prix_cents WHERE id=p_demande;
  SELECT id INTO v_ligne FROM demande_lignes WHERE demande_id=p_demande AND type='formule'
     ORDER BY ordre LIMIT 1;
  IF v_ligne IS NULL THEN
    INSERT INTO demande_lignes(demande_id,type,cle,libelle,prix_cents,type_tarif,
                               compatibilite,ordre)
    VALUES(p_demande,'formule',p_cle,p_libelle,p_prix_cents,'fixe','proposable',0);
  ELSE
    UPDATE demande_lignes SET cle=p_cle,libelle=p_libelle,prix_cents=p_prix_cents,
           type_tarif='fixe' WHERE id=v_ligne;
  END IF;
  INSERT INTO journal_audit(acteur_id,entreprise_id,action,ressource_type,ressource_id,
                            apres)
  VALUES(a,d.entreprise_destinataire_id,'demande.formule_modifiee','demande',p_demande::text,
         jsonb_build_object('formule',p_cle));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.modifier_formule_demande(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.modifier_formule_demande(uuid,text,text,integer) TO jokswed_app;

CREATE OR REPLACE FUNCTION app.modifier_option_manuelle(
  p_demande uuid,p_ligne uuid,p_libelle text,p_prix_cents integer)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d RECORD; l RECORD; a uuid; destinataire RECORD; membre RECORD;
BEGIN
  SELECT * INTO d FROM demandes WHERE id=p_demande;
  IF d IS NULL THEN RETURN false; END IF;
  a := app.exiger(d.entreprise_destinataire_id,'dossier.ecrire');
  SELECT * INTO l FROM demande_lignes WHERE id=p_ligne AND demande_id=p_demande
    AND type='supplement' AND cle LIKE 'ajout-%';
  IF l IS NULL THEN RAISE EXCEPTION 'seules les options ajoutées sont modifiables'
    USING ERRCODE='insufficient_privilege'; END IF;
  IF char_length(trim(coalesce(p_libelle,''))) NOT BETWEEN 3 AND 250 OR
    (p_prix_cents IS NOT NULL AND (p_prix_cents<0 OR p_prix_cents>100000000)) THEN
    RAISE EXCEPTION 'option invalide' USING ERRCODE='check_violation';
  END IF;
  UPDATE demande_lignes SET libelle=trim(p_libelle),prix_cents=p_prix_cents,
       type_tarif=CASE WHEN p_prix_cents IS NULL THEN 'sur_devis' ELSE 'fixe' END
   WHERE id=p_ligne;
  FOR destinataire IN SELECT DISTINCT p.entreprise_destinataire_id AS id
    FROM propositions p JOIN entreprises e ON e.id=p.entreprise_destinataire_id
    WHERE p.demande_id=p_demande AND e.slug=l.executant_partenaire
       AND p.statut IN ('proposee','vue','acceptee') LOOP
    FOR membre IN SELECT * FROM app.membres_avec(destinataire.id,'dossier.lire') LOOP
      PERFORM app.notifier(membre.utilisateur_id,destinataire.id,'dossier.modifie',
        'Détail de prestation modifié',NULL,'/admin/propositions',
        'option:modifie:'||p_ligne::text||':'||extract(epoch from now())::text||':'||membre.utilisateur_id::text);
    END LOOP;
  END LOOP;
  INSERT INTO journal_audit(acteur_id,entreprise_id,action,ressource_type,ressource_id)
  VALUES(a,d.entreprise_destinataire_id,'demande.option_modifiee','demande',p_demande::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.modifier_option_manuelle(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.modifier_option_manuelle(uuid,uuid,text,integer) TO jokswed_app;
