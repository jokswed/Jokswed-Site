/* Enveloppe de l'administration : interdite d'indexation, jamais en cache. */
export const metadata = {
  title: { default: "Administration", template: "%s — Administration JoksWed" },
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

export default function LayoutAdmin({ children }) {
  return <div className="admin">{children}</div>;
}
