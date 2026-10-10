/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compression et optimisation d'images activées par défaut sur Vercel.
  images: {
    formats: ["image/avif", "image/webp"],
    /* ⚠️ 320 ET 640 AJOUTÉS, ET CE N'EST PAS COSMÉTIQUE.

       Mesuré sur la bande : un carré de 250 px sur un écran à 2× réclame
       500 px, et la plus petite taille disponible était 768 — soit ~50 % de
       pixels inutiles, multipliés par douze photographies, sur la première
       chose que voit un visiteur en 4G. Avec 640 dans la liste, c'est 640 qui
       est servi ; 320 couvre le carré de 150 px des petits écrans. */
    deviceSizes: [320, 480, 640, 768, 1080, 1440, 1920, 2400],
  },
  reactStrictMode: true,

  /* ⚠️ EN-TÊTES DE SÉCURITÉ POSÉS GLOBALEMENT.
     Le middleware n'en posait que sur `/admin`, et le site public n'en avait
     aucun. Ceux-ci ne cassent rien : pas de CSP restrictive ici, car le site
     charge des polices et des images optimisées par Vercel et une directive
     trop serrée se découvrirait en production, écran blanc à l'appui. */
  async headers() {
    return [
      {
        source: "/:chemin*",
        headers: [
          /* Un navigateur ne doit pas deviner le type d'une réponse : c'est
             ainsi qu'un fichier déposé devient un script exécuté. */
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          /* Pas de mise en cadre : protège du détournement de clic. */
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()" },
          /* HSTS : un an, sous-domaines compris. Vercel sert déjà en HTTPS ;
             l'en-tête empêche la première requête en clair après coup. */
          { key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
