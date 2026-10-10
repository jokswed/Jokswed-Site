-- =============================================================================
-- 035 — TRANSMISSION AUTOMATIQUE, MAIS SEULEMENT QUAND C'EST SÛR
-- -----------------------------------------------------------------------------
-- La proposition vidéo doit partir seule, sans clic. Mais « seule » ne veut
-- pas dire « quoi qu'il arrive » : transmettre à une entreprise dont personne
-- ne peut répondre, c'est écrire dans le vide ; transmettre avant que le
-- compte existe, c'est envoyer un e-mail à une adresse qui n'a pas encore
-- accepté d'être destinataire.
--
-- ⚠️ TROIS CONDITIONS, VÉRIFIÉES EN BASE.
--   1. le destinataire a au moins UN membre actif, non suspendu ;
--   2. ce membre porte `collaboration.repondre` ;
--   3. le couple a consenti au partage avec le partenaire vidéo.
--
-- Si l'une manque, la proposition reste « préparée ». Elle n'est PAS
-- rattrapée rétroactivement : le jour où le compte s'active, les demandes
-- déjà déposées attendent un geste manuel — c'est le seul moyen d'en revoir
-- le périmètre de partage avant d'envoyer quoi que ce soit.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.destinataire_operationnel(p_entreprise uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM membres m
      JOIN utilisateurs u ON u.id = m.utilisateur_id
     WHERE m.entreprise_id = p_entreprise
       AND m.retire_le IS NULL AND m.suspendu_le IS NULL
       AND u.desactive_le IS NULL
       AND 'collaboration.repondre' = ANY (app.permissions_de(u.id, p_entreprise)))
$$;
REVOKE ALL ON FUNCTION app.destinataire_operationnel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.destinataire_operationnel(uuid) TO jokswed_app;

/* Transmet TOUTES les propositions encore « préparées » d'une demande, si et
   seulement si les conditions sont réunies. Appelée par le drain, juste
   après la notification de l'équipe — donc hors de la transaction de dépôt :
   une panne d'envoi ne peut pas annuler la demande.

   ⚠️ SANS ACTEUR. Le drain n'en a pas. La fonction ne s'appuie donc sur
   aucune permission de l'appelant : elle est déclenchée par un ÉVÉNEMENT
   déjà créé dans la transaction de dépôt, pas par une requête d'utilisateur.
   C'est pourquoi elle n'est accordée qu'à `jokswed_app` et ne prend qu'un
   identifiant de demande — elle ne peut rien transmettre d'autre. */
CREATE OR REPLACE FUNCTION app.transmettre_propositions_auto(p_demande_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p RECORD; v_m RECORD; v_n integer := 0; v_consenti boolean;
BEGIN
  SELECT coalesce(bool_or(c.accorde), false) INTO v_consenti
    FROM consentements c
   WHERE c.demande_id = p_demande_id
     AND c.finalite = 'partage_partenaire_video';

  FOR v_p IN
    SELECT * FROM propositions
     WHERE demande_id = p_demande_id AND statut = 'preparee' AND envoyee_le IS NULL
  LOOP
    -- ⚠️ LE CONSENTEMENT DU COUPLE CONDITIONNE LA TRANSMISSION.
    -- Même sans coordonnée dans la proposition, transmettre un dossier à un
    -- tiers sans l'accord du client n'a pas à se faire tout seul.
    CONTINUE WHEN NOT v_consenti;
    CONTINUE WHEN NOT app.destinataire_operationnel(v_p.entreprise_destinataire_id);

    UPDATE propositions SET statut = 'proposee', envoyee_le = now()
     WHERE id = v_p.id;

    FOR v_m IN SELECT * FROM app.membres_avec(v_p.entreprise_destinataire_id,
                                              'collaboration.repondre') LOOP
      PERFORM app.notifier(v_m.utilisateur_id, v_p.entreprise_destinataire_id,
        'collaboration.proposee',
        'Nouvelle proposition de prestation ' || v_p.prestation,
        NULL, '/admin/propositions',
        'collaboration.proposee:' || v_p.id::text);
    END LOOP;

    -- Clé d'idempotence stable : rejouer le drain n'enverra pas deux e-mails.
    INSERT INTO evenements (type, charge_utile, cle_idempotence)
    VALUES ('collaboration.proposee',
            jsonb_build_object('proposition_id', v_p.id,
                               'entreprise_id', v_p.entreprise_destinataire_id),
            'collaboration.proposee:' || v_p.id::text)
    ON CONFLICT (cle_idempotence) DO NOTHING;

    INSERT INTO journal_audit (acteur_id, acteur_type, entreprise_id, action,
                               ressource_type, ressource_id, apres)
    VALUES (NULL, 'systeme', v_p.entreprise_emettrice_id, 'proposition.transmise',
            'proposition', v_p.id::text,
            jsonb_build_object('automatique', true));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION app.transmettre_propositions_auto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.transmettre_propositions_auto(uuid) TO jokswed_app;

/* Les propositions restées en attente, avec la RAISON. Un écran qui dit
   « en attente » sans dire pourquoi oblige à deviner. */
CREATE OR REPLACE FUNCTION app.propositions_en_attente(p_entreprise_id uuid)
RETURNS TABLE (id uuid, demande_id uuid, reference text, prestation text,
               destinataire text, motif text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.exiger(p_entreprise_id, 'collaboration.proposer');
  RETURN QUERY
  SELECT pr.id, pr.demande_id, d.reference, pr.prestation, e.nom_commercial,
         CASE
           WHEN NOT app.destinataire_operationnel(pr.entreprise_destinataire_id)
             THEN 'le compte du partenaire n''est pas encore opérationnel'
           WHEN NOT EXISTS (SELECT 1 FROM consentements c
                             WHERE c.demande_id = pr.demande_id
                               AND c.finalite = 'partage_partenaire_video' AND c.accorde)
             THEN 'le couple n''a pas consenti au partage'
           ELSE 'en attente de transmission manuelle'
         END
    FROM propositions pr
    JOIN entreprises e ON e.id = pr.entreprise_destinataire_id
    LEFT JOIN demandes d ON d.id = pr.demande_id
   WHERE pr.entreprise_emettrice_id = p_entreprise_id
     AND pr.statut = 'preparee' AND pr.envoyee_le IS NULL
   ORDER BY pr.cree_le DESC;
END $$;
REVOKE ALL ON FUNCTION app.propositions_en_attente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.propositions_en_attente(uuid) TO jokswed_app;
