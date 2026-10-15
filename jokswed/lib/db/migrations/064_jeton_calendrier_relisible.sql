-- =============================================================================
-- 064 — L'URL DU FLUX RESTE AFFICHABLE
-- -----------------------------------------------------------------------------
-- ⚠️ POURQUOI UNE COPIE CHIFFRÉE, ALORS QU'ON NE GARDE D'HABITUDE QU'UNE
--    EMPREINTE.
--
-- Pour une session ou un mot de passe, l'empreinte suffit : on vérifie, on ne
-- réaffiche jamais. Une URL de flux iCalendar, elle, doit être RELUE — on
-- l'enregistre sur le Mac, puis sur l'iPhone, parfois des semaines plus tard.
-- Avec la seule empreinte, il fallait régénérer pour la revoir… ce qui
-- cassait l'abonnement déjà posé sur l'autre appareil.
--
-- On chiffre donc le jeton au repos (AES-256-GCM, `JOKSWED_CHIFFREMENT_CLE`),
-- comme le palier 027 le fait déjà pour les jetons d'invitation. Une base lue
-- sans la clé ne rend rien ; l'empreinte reste ce qui AUTHENTIFIE le flux.
-- =============================================================================

ALTER TABLE entreprises ADD COLUMN jeton_calendrier_chiffre bytea;

CREATE OR REPLACE FUNCTION app.definir_jeton_calendrier(
  p_entreprise_id uuid, p_jeton_hache text, p_jeton_chiffre bytea DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acteur uuid;
BEGIN
  v_acteur := app.exiger(p_entreprise_id, 'entreprise.reglages');
  UPDATE entreprises e
     SET jeton_calendrier_hache   = p_jeton_hache,
         jeton_calendrier_chiffre = CASE WHEN p_jeton_hache IS NULL
                                         THEN NULL ELSE p_jeton_chiffre END,
         jeton_calendrier_le      = CASE WHEN p_jeton_hache IS NULL
                                         THEN NULL ELSE now() END
   WHERE e.id = p_entreprise_id;
  INSERT INTO journal_audit (acteur_id, entreprise_id, action, ressource_type,
                             ressource_id, apres)
  VALUES (v_acteur, p_entreprise_id,
          CASE WHEN p_jeton_hache IS NULL THEN 'calendrier.revoque'
               ELSE 'calendrier.jeton_regenere' END,
          'entreprise', p_entreprise_id::text, '{}'::jsonb);
  RETURN true;
END $$;

-- ⚠️ L'ANCIENNE SIGNATURE À DEUX PARAMÈTRES EST RETIRÉE.
-- La laisser en place aurait créé une surcharge : un appel à deux arguments
-- aurait écrit l'empreinte en laissant la copie chiffrée périmée en base, et
-- l'administration aurait affiché une URL qui ne sert plus.
DROP FUNCTION IF EXISTS app.definir_jeton_calendrier(uuid, text);

REVOKE ALL ON FUNCTION app.definir_jeton_calendrier(uuid, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.definir_jeton_calendrier(uuid, text, bytea) TO jokswed_app;
