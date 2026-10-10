-- =============================================================================
-- 048 — LES RÔLES MODÈLES SONT DES DONNÉES DE RÉFÉRENCE, PAS DES FIXTURES
-- -----------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ EN ÉPROUVANT L'AMORÇAGE SUR UNE BASE VIDE.
--
-- Les six rôles modèles (`entreprise_id IS NULL`) n'étaient créés que par
-- `scripts/semer.mjs`, c'est-à-dire par les FIXTURES DE DÉVELOPPEMENT. Une
-- base de production neuve n'en avait donc aucun : la création du premier
-- propriétaire échouait sur `role_id` nul, et personne ne pouvait entrer.
--
-- Le défaut ne pouvait pas se voir en développement, où le semis tourne
-- toujours avant. C'est précisément pour cela qu'on éprouve l'amorçage sur
-- une base vierge, sans fixtures.
--
-- Ce sont des données de référence, au même titre que `permissions` : leur
-- place est dans une migration.
-- =============================================================================

INSERT INTO roles (entreprise_id, cle, libelle, description, systeme) VALUES
 (NULL, 'proprietaire', 'Propriétaire',
  'Accès complet à son entreprise et à la gestion des accès.', true),
 (NULL, 'administrateur', 'Administrateur délégué',
  'Gestion courante, sans la main sur les rôles ni les remboursements.', true),
 (NULL, 'photographe', 'Photographe collaborateur',
  'Les dossiers qui lui sont attribués, sans accès aux finances.', true),
 (NULL, 'videaste', 'Vidéaste collaborateur',
  'Ses dossiers, ses documents, ses finances — et rien d''autre.', true),
 (NULL, 'assistant', 'Assistant',
  'Planning et dossiers affectés. Aucune finance, aucune coordonnée.', true),
 (NULL, 'monteur', 'Monteur',
  'Les dossiers affectés, en lecture, pour la post-production.', true)
ON CONFLICT DO NOTHING;

-- ⚠️ `finance.consolide.lire` N'EST DANS AUCUN RÔLE, Y COMPRIS PROPRIÉTAIRE.
-- Une vue consolidée agrège des montants appartenant à des entreprises
-- juridiquement distinctes : elle doit rester un choix explicite, accordé à
-- la main et tracé, jamais un effet de bord d'un rôle.
INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dossier.lire','dossier.ecrire','dossier.affecter','planning.lire','planning.ecrire',
  'client.coordonnees.lire','document.lire','document.rediger','document.emettre',
  'document.envoyer','finance.lire','finance.saisir_paiement','finance.confirmer_paiement',
  'finance.rembourser','catalogue.lire','catalogue.ecrire','collaboration.proposer',
  'collaboration.repondre','message.lire','message.envoyer','note.lire','note.ecrire',
  'membre.inviter','membre.revoquer','role.gerer','entreprise.reglages','audit.lire']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'proprietaire'
ON CONFLICT DO NOTHING;

INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dossier.lire','dossier.ecrire','dossier.affecter','planning.lire','planning.ecrire',
  'client.coordonnees.lire','document.lire','document.rediger','document.emettre',
  'document.envoyer','finance.lire','finance.saisir_paiement','catalogue.lire',
  'collaboration.proposer','collaboration.repondre','message.lire','message.envoyer',
  'note.lire','note.ecrire']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'administrateur'
ON CONFLICT DO NOTHING;

INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dossier.lire','planning.lire','client.coordonnees.lire','document.lire',
  'message.lire','message.envoyer','note.lire','note.ecrire','catalogue.lire']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'photographe'
ON CONFLICT DO NOTHING;

INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dossier.lire','dossier.ecrire','planning.lire','client.coordonnees.lire',
  'document.lire','document.rediger','document.emettre','document.envoyer',
  'finance.lire','finance.saisir_paiement','catalogue.lire','catalogue.ecrire',
  'collaboration.repondre','message.lire','message.envoyer','note.lire','note.ecrire']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'videaste'
ON CONFLICT DO NOTHING;

INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dossier.lire','planning.lire','message.lire','catalogue.lire']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'assistant'
ON CONFLICT DO NOTHING;

INSERT INTO roles_permissions (role_id, permission_cle)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dossier.lire','planning.lire','message.lire']) p
 WHERE r.entreprise_id IS NULL AND r.cle = 'monteur'
ON CONFLICT DO NOTHING;
