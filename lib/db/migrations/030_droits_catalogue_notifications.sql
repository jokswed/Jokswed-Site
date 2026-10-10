-- =============================================================================
-- 030 — LE CATALOGUE DES TYPES DE NOTIFICATION EST LISIBLE PAR L'APPLICATION
-- -----------------------------------------------------------------------------
-- Défaut trouvé par le banc des routes : la page des préférences joignait
-- `types_notification` sans qu'aucun GRANT n'ait été posé. En lecture seule —
-- c'est une table de référence, pas une table métier : l'application ne doit
-- pas pouvoir inventer un type de notification à l'exécution.
-- =============================================================================
GRANT SELECT ON types_notification TO jokswed_app;
