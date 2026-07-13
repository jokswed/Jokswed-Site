/* Autorise l'indexation de tout le site */
import { site } from "@/content/site";

export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
