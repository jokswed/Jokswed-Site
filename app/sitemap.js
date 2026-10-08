/* Plan du site généré automatiquement pour les moteurs de recherche */
import { site, mariages } from "@/content/site";

export default function sitemap() {
  const pages = ["", "/portfolio", "/mariages", "/tarifs", "/a-propos", "/contact"].map(
    (p) => ({ url: `${site.url}${p}`, lastModified: new Date() })
  );
  const reportages = mariages.map((m) => ({
    url: `${site.url}/mariages/${m.slug}`,
    lastModified: new Date(),
  }));
  return [...pages, ...reportages];
}
