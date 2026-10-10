/* =============================================================================
   PLAN DU SITE
   -----------------------------------------------------------------------------
   ⚠️ UNE SEULE RÈGLE : ON N'ANNONCE QUE DES PAGES QUI RÉPONDENT 200.

   La version livrée déclarait `/mariages` et une URL par reportage, alors
   qu'aucune route `app/mariages/` n'existait et que le tableau `mariages`
   valait `[]`. Google recevait donc une liste d'URL en 404. Dans le même
   temps, `/faq` — bien réelle, 21 questions, dans la navigation — était
   ABSENTE du plan.

   Le banc `scripts/verifier-sitemap.mjs` compare cette liste aux routes
   réellement rendues par le build : il échoue si l'une des deux dérive.
   ============================================================================= */
import { site } from "@/content/site";

/** Les pages publiques indexables. Ajouter ici = ajouter aussi la route. */
export const PAGES = [
  "",
  "/portfolio",
  "/tarifs",
  "/faq",
  "/a-propos",
  "/contact",
  "/mentions-legales",
  "/confidentialite",
];

export default function sitemap() {
  const maintenant = new Date();
  return PAGES.map((chemin) => ({
    url: `${site.url}${chemin}`,
    lastModified: maintenant,
    changeFrequency: chemin === "" ? "weekly" : "monthly",
    priority:
      chemin === ""
        ? 1
        : chemin === "/tarifs"
          ? 0.9
          : chemin.startsWith("/mentions") || chemin.startsWith("/confidentialite")
            ? 0.2
            : 0.7,
  }));
}
