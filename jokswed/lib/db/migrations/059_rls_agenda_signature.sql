-- 058 — Correction du palier 057 deja applique dans une base Preview.
-- Aucune politique RLS ni aucun droit utilisateur n est supprime.
-- Le ROLE PROPRIETAIRE a besoin de ne pas etre soumis a FORCE lorsque les
-- fonctions SECURITY DEFINER executent des operations sous son identite.
-- La RLS reste applicable aux roles applicatifs qui ne possedent aucune table.
ALTER TABLE public.signatures_profils ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures_profils NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_evenements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_evenements NO FORCE ROW LEVEL SECURITY;
