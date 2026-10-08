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
};

export default nextConfig;
