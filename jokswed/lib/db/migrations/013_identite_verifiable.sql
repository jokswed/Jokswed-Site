-- =============================================================================
-- 013 — L'IDENTITÉ CESSE D'ÊTRE DÉCLARÉE : ELLE EST PROUVÉE
-- -----------------------------------------------------------------------------
-- ⚠️ LA FAILLE, REPRODUITE AVANT D'ÊTRE CORRIGÉE.
--
--   BEGIN;
--   SELECT set_config('app.acteur_id', '<uuid du propriétaire>', true);
--   SELECT reference FROM dossiers;   --> D-2027-0001, D-2027-0002
--
-- Exécuté avec le rôle `jokswed_app`. Les paramètres personnalisés
-- (`app.*`) sont réglables par TOUT rôle : PostgreSQL n'a aucun moyen de
-- restreindre un GUC dont le nom contient un point. `GRANT SET ON PARAMETER`
-- ne couvre que les paramètres système.
--
-- Autrement dit : jusqu'ici, l'identité était une AFFIRMATION du client. Toute
-- exécution SQL arbitraire sous le rôle applicatif — une injection — suffisait
-- à se déclarer propriétaire et à lire l'intégralité des données.
--
-- ⚠️ LA CORRECTION : DÉRIVER L'IDENTITÉ D'UN SECRET, PAS LA DÉCLARER.
--
-- Le réglage ne porte plus un identifiant d'utilisateur mais l'EMPREINTE DU
-- JETON DE SESSION — la même que celle du cookie. `app.acteur()` ne lit plus
-- ce qu'on lui dit : elle résout la session en base et en déduit qui parle.
--
-- Déclarer `app.session_jeton = 'ce que je veux'` ne donne donc rien : il
-- faudrait posséder une empreinte de session valide, c'est-à-dire le cookie
-- d'une personne réellement connectée. Un attaquant capable d'exécuter du SQL
-- reste cantonné à SA propre identité — celle qu'il avait déjà.
--
-- Et le contrôle devient plus fin qu'avant : session non révoquée, non
-- expirée, second facteur franchi, compte actif. Une révocation prend effet
-- à la requête suivante, au niveau des POLITIQUES elles-mêmes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. L'ACTEUR, RÉSOLU DEPUIS LA SESSION
-- -----------------------------------------------------------------------------
-- `SECURITY DEFINER` parce qu'elle lit `sessions`, dont la politique appelle
-- elle-même `app.acteur()` : sans cela, récursion. `sessions` est en `ENABLE`
-- sans `FORCE` (palier 007), donc le propriétaire la lit sans politique.
CREATE OR REPLACE FUNCTION app.acteur() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
  SELECT s.utilisateur_id
    FROM sessions s
    JOIN utilisateurs u ON u.id = s.utilisateur_id
   WHERE s.jeton_hache = nullif(current_setting('app.session_jeton', true), '')
     AND s.revoquee_le IS NULL
     AND s.expire_le > now()
     -- Tant que le second facteur n'est pas franchi, la session existe mais
     -- n'ouvre AUCUNE donnée. La garde n'est plus seulement applicative.
     AND s.mfa_validee
     AND u.desactive_le IS NULL
$$;

REVOKE ALL ON FUNCTION app.acteur() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.acteur() TO jokswed_app, jokswed_auth, jokswed_public;

-- -----------------------------------------------------------------------------
-- 2. LE RÔLE APPLICATIF NE PEUT PLUS FABRIQUER DE SESSION
-- -----------------------------------------------------------------------------
-- ⚠️ SANS CECI, LA CORRECTION SERAIT CONTOURNABLE.
--
-- Il suffirait d'insérer une ligne dans `sessions` pointant sur le
-- propriétaire, puis de régler `app.session_jeton` sur son empreinte. La
-- politique `WITH CHECK (utilisateur_id = app.acteur())` l'en empêcherait
-- déjà — mais on ne laisse pas une seule barrière sur un point pareil.
--
-- La création de session appartient à `jokswed_auth` et à ses fonctions.
REVOKE INSERT, UPDATE, DELETE ON sessions FROM jokswed_app;
REVOKE INSERT, UPDATE, DELETE ON identifiants, facteurs_mfa FROM jokswed_app;
REVOKE INSERT, UPDATE, DELETE ON utilisateurs FROM jokswed_app;

-- Révoquer sa propre session reste légitime : on passe par la fonction, qui
-- exige de connaître l'empreinte du jeton — donc de le posséder.
GRANT EXECUTE ON FUNCTION app.auth_revoquer_session(text) TO jokswed_app;

-- -----------------------------------------------------------------------------
-- 3. LES TRAITEMENTS SANS IDENTITÉ RESTENT POSSIBLES, MAIS NOMMÉS
-- -----------------------------------------------------------------------------
-- Le dépôt public et le drain n'ont pas d'acteur, et n'en ont pas besoin :
-- ils passent par des fonctions `SECURITY DEFINER` au périmètre fixe. Aucune
-- d'elles n'appelle `app.acteur()`, donc rien à adapter.
--
-- Une exception à traiter : `app.notifier` écrit dans `notifications`, dont la
-- politique exige `destinataire_id = app.acteur()`. Étant `SECURITY DEFINER`
-- et `sessions` sans `FORCE`, elle contourne la politique — c'est voulu, et
-- c'est le seul chemin par lequel une notification peut être créée pour
-- quelqu'un d'autre que soi.

-- -----------------------------------------------------------------------------
-- 4. TRAÇABILITÉ DE L'USURPATION TENTÉE
-- -----------------------------------------------------------------------------
-- Si `app.session_jeton` est posé mais ne résout aucune session, c'est soit
-- une session expirée, soit une tentative. On ne peut pas journaliser depuis
-- une fonction STABLE ; la détection se fait côté serveur, qui reçoit alors
-- zéro ligne et redirige vers la connexion.
