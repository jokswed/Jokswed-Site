-- =============================================================================
-- 056 — `FORCE ROW LEVEL SECURITY` EST INCOMPATIBLE AVEC `SECURITY DEFINER`
-- -----------------------------------------------------------------------------
-- ⚠️ CE PALIER RETIRE `FORCE`. CE N'EST PAS UN RENONCEMENT : C'EST LA
--    CORRECTION D'UNE ERREUR DE CONCEPTION QUE LE DÉVELOPPEMENT MASQUAIT.
--
-- Ce que `FORCE` fait exactement : il soumet le PROPRIÉTAIRE de la table à ses
-- propres politiques. Il ne change rien pour les autres rôles — eux y sont
-- soumis de toute façon. Le propriétaire des tables, ici, c'est
-- `jokswed_migrateur`, et lui seul.
--
-- Or tout le modèle d'accès contrôlé de JoksWed repose sur des fonctions
-- `SECURITY DEFINER` appartenant à ce même rôle : `app.acteur()`,
-- `app.entreprises_de_lacteur()`, `app.deposer_demande()`,
-- `app.partenaires_disponibles()`, `app.participants_conversation()`… Leur
-- raison d'être est précisément de lire ce que l'appelant ne peut pas lire,
-- puis de ne rendre que le strict nécessaire. Avec `FORCE`, elles sont
-- soumises aux politiques de l'appelant qu'elles sont censées arbitrer : elles
-- échouent, ou — pire — renvoient silencieusement un résultat vide.
--
-- En local, le migrateur est superutilisateur : il ignore la RLS quoi qu'on
-- fasse, et `FORCE` n'a jamais eu d'effet observable. Sur PostgreSQL géré
-- (Neon), le propriétaire n'est pas superutilisateur, et le défaut sort au
-- grand jour. Les paliers 007, 050 à 055 ont traité ce symptôme table par
-- table, cas par cas ; en voici la cause commune.
--
-- Ce qui n'est PAS perdu : les rôles applicatifs — `jokswed_app`,
-- `jokswed_public`, `jokswed_auth` — ne possèdent AUCUNE table. Ils restent
-- intégralement soumis à la RLS, `FORCE` ou non. Le cloisonnement entre
-- entreprises, l'identité prouvée par session, le masquage des montants : rien
-- de tout cela ne dépend de `FORCE`. Un banc le vérifie.
--
-- Ce qui est perdu, et il faut le dire : `FORCE` offrait un garde-fou contre
-- une MIGRATION maladroite qui aurait lu ou écrit hors de son entreprise. Il
-- ne protégeait pas contre un migrateur hostile — ce rôle peut supprimer les
-- politiques. C'était un filet contre l'accident, pas contre l'attaque, et il
-- coûtait le fonctionnement du produit.
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity
     ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- La RLS elle-même reste activée partout où elle l'était : on vérifie ici
-- qu'aucun palier ne l'a désactivée au passage.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity;
  IF n > 0 THEN
    RAISE EXCEPTION '% table(s) encore en FORCE', n;
  END IF;
  SELECT count(*) INTO n FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
  IF n < 25 THEN
    RAISE EXCEPTION 'seulement % table(s) avec RLS activée : inattendu', n;
  END IF;
END $$;
