-- =============================================================================
-- 024 — DE LA DEMANDE AU MARIAGE, ET LA SAISON
-- -----------------------------------------------------------------------------
-- Jusqu'ici une demande confirmée restait une demande. Le modèle « mariage
-- partagé / dossiers commerciaux séparés » existait en base mais rien ne le
-- peuplait. La confirmation crée donc :
--
--   · UN mariage           — l'objet commun, partageable ;
--   · UN dossier par entreprise — le commercial, jamais partagé ;
--   · les contacts du couple, rattachés au mariage.
--
-- C'est ce qui permettra à plusieurs professionnels d'intervenir sur le même
-- mariage sans jamais voir les finances l'un de l'autre.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.confirmer_demande(p_demande_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_d RECORD; v_acteur uuid; v_mariage uuid; v_dossier uuid;
  v_prenom text; v_nom text;
BEGIN
  SELECT * INTO v_d FROM demandes WHERE id = p_demande_id;
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'demande introuvable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_acteur := app.exiger(v_d.entreprise_destinataire_id, 'dossier.ecrire');

  -- ⚠️ IDEMPOTENT. Confirmer deux fois ne crée pas deux mariages : un
  -- double-clic, un rejeu de formulaire, et le carnet serait dédoublé.
  IF v_d.mariage_id IS NOT NULL THEN
    UPDATE demandes SET statut = 'confirmee' WHERE id = p_demande_id;
    RETURN v_d.mariage_id;
  END IF;

  IF v_d.date_mariage IS NULL THEN
    RAISE EXCEPTION 'confirmer sans date de mariage : impossible'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO mariages (reference, date_mariage, ville, departement, invites_estimes)
  VALUES (v_d.reference, v_d.date_mariage, v_d.ville, v_d.departement, v_d.invites_estimes)
  RETURNING id INTO v_mariage;

  -- Le nom saisi au formulaire est une chaîne libre (« Camille & Noé ») : on
  -- la conserve telle quelle plutôt que d'inventer un découpage prénom/nom.
  INSERT INTO contacts (mariage_id, role, prenom, email, telephone,
                        contact_prefere, principal)
  VALUES (v_mariage, 'marie_1', v_d.contact_nom, v_d.contact_email,
          v_d.contact_telephone, v_d.contact_prefere, true);

  INSERT INTO dossiers (mariage_id, entreprise_id, reference, prestation,
                        statut, pilote, responsable_id)
  VALUES (v_mariage, v_d.entreprise_destinataire_id, v_d.reference, 'photo',
          'reserve', true, v_acteur)
  RETURNING id INTO v_dossier;

  UPDATE demandes
     SET mariage_id = v_mariage, dossier_id = v_dossier,
         statut = 'confirmee', traitee_le = coalesce(traitee_le, now())
   WHERE id = p_demande_id;

  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, v_d.entreprise_destinataire_id, 'demande.confirmee', 'demande',
          p_demande_id::text,
          jsonb_build_object('mariage_id', v_mariage, 'dossier_id', v_dossier));

  RETURN v_mariage;
END $$;
REVOKE ALL ON FUNCTION app.confirmer_demande(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirmer_demande(uuid) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- LA SAISON
-- -----------------------------------------------------------------------------
-- Une ligne par mariage de l'entreprise, sur une période configurable. Les
-- montants viennent de `finances_par_demande`, donc de la MÊME source que le
-- tableau financier : deux écrans ne peuvent pas afficher deux totaux.
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
  total_cents          integer,
  total_contractualise boolean,
  acompte_cents        integer,
  encaisse_cents       integer,
  solde_restant_cents  integer,
  devis_numero         text,
  contrat_emis         boolean,
  factures_nb          integer,
  equipe               text[],
  videaste             text,
  videaste_statut      text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_voit_finances boolean;
BEGIN
  -- ⚠️ DEUX PERMISSIONS, DEUX NIVEAUX DE LECTURE.
  -- Voir la saison ne donne pas le droit de voir les montants : un assistant
  -- a besoin des dates et des lieux, pas du chiffre d'affaires. Les colonnes
  -- financières sortent à zéro pour qui n'a pas `finance.lire` — et c'est la
  -- BASE qui le décide, pas le gabarit qui masque une colonne déjà chargée.
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
  -- Le vidéaste est l'entreprise DESTINATAIRE d'une proposition vidéo : on
  -- montre son nom commercial et l'état de sa réponse, rien de plus.
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
         -- ⚠️ `nullif(…, 0)` ET PAS `coalesce` SEUL.
         -- Sans devis émis, `contractualise_cents` vaut 0, pas NULL : le
         -- coalesce ne se déclenchait jamais et la saison affichait 0 € sur
         -- un mariage réservé. On retombe donc sur le prix de la formule
         -- demandée, et `total_contractualise` dit lequel des deux on montre.
         CASE WHEN v_voit_finances
              THEN coalesce(nullif(fin.contractualise_cents, 0), dm.formule_prix_cents, 0)
              ELSE 0 END,
         coalesce(fin.contractualise_cents, 0) > 0,
         coalesce(fin.acomptes_cents, 0),
         coalesce(fin.encaisse_cents, 0),
         coalesce(fin.solde_a_percevoir_cents, 0),
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
