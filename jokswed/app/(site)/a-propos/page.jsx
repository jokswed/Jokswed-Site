/* =============================================================================
   PAGE À PROPOS — portrait, vision, manière de travailler, pourquoi me choisir
   ============================================================================= */

import Image from "next/image";
import { aPropos } from "@/content/site";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";

export const metadata = {
  title: "À propos",
  description:
    "Joks, photographe de mariage basé à Paris. Un regard d'auteur, une présence discrète, une exigence artisanale. Chaque histoire compte.",
};

export default function APropos() {
  return (
    <>
      {/* --- Portrait + introduction --- */}
      <section className="conteneur page-entete" style={{ paddingBottom: 0 }}>
        <div className="apropos-heros">
          <Reveal photo>
            <Image
              src={aPropos.portrait}
              alt="Portrait de Joks, photographe de mariage"
              width={1200}
              height={1500}
              priority
              sizes="(max-width: 900px) 100vw, 42vw"
            />
          </Reveal>
          <div className="presentation__texte">
            <Reveal as="p" className="label">À propos</Reveal>
            <Reveal as="h1" className="display t-hero" retard={0.1}>
              {aPropos.intro}
            </Reveal>
            <Reveal as="p" className="texte" retard={0.2}>
              {aPropos.presentation}
            </Reveal>
          </div>
        </div>
      </section>

      {/* --- Vision + manière de travailler --- */}
      <section className="section">
        <div className="conteneur blocs-vision">
          <div className="presentation__texte">
            <Reveal as="p" className="label">{aPropos.vision.titre}</Reveal>
            <Reveal as="p" className="texte" retard={0.1}>{aPropos.vision.texte}</Reveal>
          </div>
          <div className="presentation__texte">
            <Reveal as="p" className="label">{aPropos.maniere.titre}</Reveal>
            <Reveal as="p" className="texte" retard={0.1}>{aPropos.maniere.texte}</Reveal>
          </div>
        </div>
      </section>

      {/* --- Grande image d'ambiance --- */}
      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        <Reveal photo className="pleine-largeur">
          <Image
            src={aPropos.imageSecondaire}
            alt="Joks en reportage de mariage"
            width={2400}
            height={1030}
            sizes="100vw"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Reveal>
      </section>

      {/* --- Pourquoi me choisir --- */}
      <section className="section section--papier">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">La différence</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              {aPropos.pourquoi.titre}
            </Reveal>
          </div>
          <div className="pourquoi">
            {aPropos.pourquoi.points.map((p, i) => (
              <Reveal key={p.titre} className="pourquoi__point" retard={i * 0.06}>
                <h3>{p.titre}</h3>
                <p>{p.texte}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CtaBandeau
        titre="Faisons connaissance"
        texte="Un appel, un café, un message : c'est toujours comme ça que les plus belles collaborations commencent."
        bouton="Me contacter"
      />
    </>
  );
}
