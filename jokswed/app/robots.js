import { site } from "@/content/site";

/* =============================================================================
   ROBOTS
   -----------------------------------------------------------------------------
   Le site public est entièrement indexable. L'administration et les routes
   ne le sont pas : elles redirigent vers la connexion, il n'y a donc rien à
   explorer, et les laisser dans le budget de crawl n'apporte rien.

   ⚠️ CE N'EST PAS LA PROTECTION. `robots.txt` est une convention, pas une
   serrure : n'importe qui peut l'ignorer. La vraie barrière est
   `exigerSession()` dans chaque page. Ici, on évite simplement du bruit —
   et un en-tête `X-Robots-Tag: noindex` est posé en plus par le middleware.
   ============================================================================= */
export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api"],
    },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
