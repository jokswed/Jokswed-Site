/* =============================================================================
   <CtaBandeau> — bandeau d'appel à l'action, réutilisé en bas de chaque page.
   ============================================================================= */

import Link from "next/link";
import Reveal from "@/components/Reveal";

export default function CtaBandeau({
  surtitre = "Votre date",
  titre = "Votre histoire mérite d'être racontée",
  texte = "Les dates se réservent souvent un an à l'avance. Écrivez-moi dès maintenant pour vérifier ma disponibilité.",
  bouton = "Vérifier ma disponibilité",
}) {
  return (
    <section className="section section--papier">
      <div className="conteneur">
        <Reveal className="cta-bandeau">
          <p className="label label--nu">{surtitre}</p>
          <h2 className="display t-section">{titre}</h2>
          <p className="texte" style={{ color: "var(--gris)" }}>{texte}</p>
          <Link href="/contact" className="btn">{bouton}</Link>
        </Reveal>
      </div>
    </section>
  );
}
