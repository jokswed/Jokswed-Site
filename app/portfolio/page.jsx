/* =============================================================================
   PAGE PORTFOLIO — grande galerie filtrable (Mariage / Couples / Éditorial)
   ============================================================================= */

import PortfolioFiltre from "@/components/PortfolioFiltre";
import CtaBandeau from "@/components/CtaBandeau";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "Portfolio",
  description:
    "Portfolio de JoksWed, photographe de mariage à Paris : mariages, séances couples et séries éditoriales, en noir et blanc comme en couleur.",
};

export default function Portfolio() {
  return (
    <>
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">Portfolio</Reveal>
        <Reveal as="h1" className="display t-hero" retard={0.1}>
          La lumière, <em>avant tout</em>
        </Reveal>
        <Reveal as="p" className="texte" retard={0.2}>
          Une sélection de photographies de mariages, de couples et de séries
          éditoriales. Cliquez sur une image pour l'ouvrir en grand.
        </Reveal>
      </header>

      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        <PortfolioFiltre />
      </section>

      <CtaBandeau
        titre="Envie du même regard sur votre journée ?"
        texte="Parlez-moi de votre mariage : je vous réponds sous 48 heures."
      />
    </>
  );
}
