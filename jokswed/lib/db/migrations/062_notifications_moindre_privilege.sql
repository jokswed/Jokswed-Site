-- =============================================================================
-- 062 — LES NOTIFICATIONS CESSENT DE CHOISIR LEUR ENTREPRISE
-- -----------------------------------------------------------------------------
-- ⚠️ LA LIMITE QUE LE BANC DOCUMENTAIT, ET QU'ON FERME ICI.
--
-- `app.push_abonnements_entreprise(p_entreprise_id)` était `SECURITY DEFINER`
-- et ne vérifiait pas son appelant — elle ne POUVAIT pas : le drain tourne
-- sans acteur, `app.exiger` n'a donc personne à interroger. Conséquence
-- exacte :
--
--     SELECT * FROM app.push_abonnements_entreprise('<entreprise d''autrui>');
--
-- exécuté sous le rôle métier — par exemple à la faveur d'une injection dans
-- une requête — rendait les `endpoint`, `p256dh` et `auth` des abonnements
-- push d'un confrère. De quoi pousser une notification signée sur les
-- téléphones de son équipe.
--
-- ⚠️ LA CORRECTION : L'ÉVÉNEMENT DEVIENT LA CAPACITÉ.
--
-- L'appelant ne nomme plus une entreprise : il nomme l'ÉVÉNEMENT qu'il est en
-- train de traiter, et la fonction en déduit elle-même l'entreprise. Or
-- `evenements` est retirée au rôle métier depuis le palier 010 : les seuls
-- identifiants d'événement qu'on puisse obtenir viennent de
-- `app.evenements_a_traiter()`, qui EST la porte du drain. L'autorité de cette
-- fonction devient donc exactement celle du drain — ni plus, ni moins.
--
-- Trois conditions, toutes nécessaires :
--   · l'événement existe et est de type `demande.recue` ;
--   · il n'est pas encore traité (`traite_le IS NULL`) ;
--   · il a été PRIS (`tentatives > 0`), c'est-à-dire réclamé par un drain.
--
-- Un identifiant inventé, un événement déjà traité, un événement d'un autre
-- type : zéro ligne. Il n'existe plus de chemin par lequel le rôle métier
-- désigne l'entreprise dont il veut les abonnements.
--
-- ⚠️ POURQUOI PAS UN RÔLE DÉDIÉ.
-- Un `jokswed_drain` avec son propre pool, comme `jokswed_auth`, serait la
-- forme canonique. Il exige une variable d'environnement de plus en
-- production, et un oubli de configuration couperait les notifications en
-- silence. L'événement-capacité donne le même cloisonnement sans ce risque de
-- mise en service. shortcut: si le drain gagne d'autres fonctions sensibles,
-- lui donner son rôle devient le bon investissement.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.push_abonnements_evenement(p_evenement_id uuid)
RETURNS TABLE (endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT pa.endpoint, pa.p256dh, pa.auth
    FROM evenements ev
    JOIN membres m
      ON m.entreprise_id = (ev.charge_utile->>'entreprise_id')::uuid
     AND m.retire_le IS NULL
    JOIN push_abonnements pa ON pa.utilisateur_id = m.utilisateur_id
    JOIN utilisateurs u ON u.id = pa.utilisateur_id AND u.desactive_le IS NULL
   WHERE ev.id = p_evenement_id
     AND ev.type = 'demande.recue'
     AND ev.traite_le IS NULL
     AND ev.tentatives > 0
     AND 'dossier.lire' = ANY (app.permissions_de(pa.utilisateur_id, m.entreprise_id))
$$;

REVOKE ALL ON FUNCTION app.push_abonnements_evenement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.push_abonnements_evenement(uuid) TO jokswed_app;

-- L'ancienne porte est condamnée, pas laissée entrouverte « au cas où ».
DROP FUNCTION IF EXISTS app.push_abonnements_entreprise(uuid);
