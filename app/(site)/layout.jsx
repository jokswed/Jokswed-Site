import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { site } from "@/content/site";

/* Disposition du SITE PUBLIC. L'administration ne passe pas par ici. */
export default function LayoutSite({ children }) {
  /* Données structurées de l'activité : elles décrivent le site public, pas
     l'outil de gestion. Elles descendent donc avec lui. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: site.nom,
    description: "Photographe de mariage à Paris et à l'international.",
    url: site.url,
    email: site.email,
    areaServed: ["Paris", "France", "International"],
    sameAs: [site.instagram],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main id="contenu">{children}</main>
      <Footer />
    </>
  );
}
