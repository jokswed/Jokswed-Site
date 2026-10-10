/* Page 404 — sobre et utile */
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="conteneur page-entete" style={{ minHeight: "60svh" }}>
      <p className="label">Erreur 404</p>
      <h1 className="display t-hero">Cette page n'existe pas</h1>
      <p className="texte">
        Le lien que vous avez suivi ne mène nulle part. Retournez à l'accueil
        pour retrouver votre chemin.
      </p>
      <p><Link href="/" className="btn">Retour à l'accueil</Link></p>
    </section>
  );
}
