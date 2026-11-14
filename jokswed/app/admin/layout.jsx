import BarreAdmin from "@/components/admin/BarreAdmin";

/* Enveloppe de l'administration : interdite d'indexation, jamais en cache. */
export const metadata = {
  title: { default: "Administration", template: "%s — Administration JoksWed" },
  robots: { index: false, follow: false, nocache: true },
  /* Sur iPhone, le manifest public démarre sur "/". Une installation
     depuis /admin doit utiliser son propre manifest et ouvrir /admin.
     Le site client conserve le manifest public existant. */
  manifest: "/admin-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "JoksWed",
    statusBarStyle: "black-translucent",
  },
};
export const dynamic = "force-dynamic";

/* ⚠️ LA BARRE EST DANS LA COQUE, PAS DANS CHAQUE PAGE.
   La navigation n'existait que sur le tableau de bord : depuis une fiche ou
   une conversation, il fallait remonter à l'accueil pour aller ailleurs. Ici,
   elle survit à chaque navigation et ne se remonte jamais. */
export default function LayoutAdmin({ children }) {
  return (
    <div className="admin">
      {children}
      <BarreAdmin />
    </div>
  );
}
