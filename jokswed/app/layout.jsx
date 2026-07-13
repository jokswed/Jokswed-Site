import "./globals.css";
import localFont from "next/font/local";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { site } from "@/content/site";

/* --- Polices auto-hébergées dans /app/fonts (aucune requête externe,
       RGPD-friendly, score Lighthouse optimal, zéro flash de texte) -------- */
const display = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-300-italic.woff2", weight: "300", style: "italic" },
    { path: "./fonts/cormorant-garamond-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-display",
  display: "swap",
});

const sans = localFont({
  src: [
    { path: "./fonts/jost-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/jost-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jost-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

/* --- Métadonnées SEO globales (héritées par toutes les pages) -------------- */
export const metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.nom} — ${site.signature} | ${site.baseline}`,
    template: `%s — ${site.nom}`,
  },
  description:
    "JoksWed, photographe de mariage à Paris et à l'international. Des reportages sincères et lumineux, en noir et blanc comme en couleur. Chaque histoire compte.",
  keywords: [
    "photographe mariage Paris",
    "photographe mariage international",
    "reportage mariage",
    "photographe couple",
    "wedding photographer Paris",
  ],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: site.nom,
    title: `${site.nom} — ${site.signature}`,
    description: "Photographe de mariage, Paris & International. Chaque histoire compte.",
    images: [{ url: "/images/hero.jpg", width: 2400, height: 1500 }],
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  /* Données structurées (schema.org) : aide Google à comprendre l'activité */
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
    <html lang="fr" className={`${display.variable} ${sans.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Header />
        <main id="contenu">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
