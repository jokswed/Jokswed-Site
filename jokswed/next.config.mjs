/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compression et optimisation d'images activées par défaut sur Vercel.
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [480, 768, 1080, 1440, 1920, 2400],
  },
  reactStrictMode: true,
};

export default nextConfig;
