import "./globals.css";
import localFont from "next/font/local";
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
    /* ⚠️ PAS DE `images` ICI, ET C'EST VOLONTAIRE.

       La version livrée déclarait `/images/hero.jpg`, un fichier qui n'existait
       pas : tout partage WhatsApp, iMessage ou Facebook sortait sans visuel.

       Next résout désormais l'image par convention de fichier, depuis
       `app/opengraph-image.jpg` (1200 × 630) et `app/twitter-image.jpg`. Elles
       sont réellement présentes, et Next en calcule seul l'URL absolue, la
       taille et le type. Plus de chemin à maintenir à la main. */
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.nom} — ${site.signature}`,
    description: "Photographe de mariage, Paris & International. Chaque histoire compte.",
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

/* ⚠️ CETTE DISPOSITION NE REND NI EN-TÊTE NI PIED DE PAGE.

   Ils appartiennent au SITE PUBLIC, et vivent donc dans `app/(site)/layout.jsx`.
   Tant qu'ils étaient ici, l'administration héritait de la navigation
   publique — « Portfolio », « Tarifs », « Contact » s'affichaient au-dessus
   de l'écran de connexion. Vu à l'écran en 375 px.

   Les parenthèses de `(site)` en font un GROUPE DE ROUTES : il organise les
   fichiers sans apparaître dans les URL. `/tarifs` reste `/tarifs`. */

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
