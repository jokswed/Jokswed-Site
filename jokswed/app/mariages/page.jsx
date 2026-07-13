/* =============================================================================
   PAGE MARIAGES — liste des reportages complets
   Chaque carte mène à la page immersive du reportage (/mariages/<slug>).
   ============================================================================= */

import Image from "next/image";
import Link from "next/link";
import { mariages } from "@/content/site";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";

export const metadata = {
  title: "Mariages — Reportages",
  description:
    "Découvrez des reportages de mariage complets photographiés par JoksWed : Paris, Provence, Normandie et au-delà.",
};

export default function Mariages() {
  return (
    <>
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">Reportages</Reveal>
        <Reveal as="h1" className="display t-hero" retard={0.1}>
          Des journées <em>entières</em>
        </Reveal>
        <Reveal as="p" className="texte" retard={0.2}>
          Un mariage ne se résume pas à quelques belles images : c'est un récit.
          Voici des reportages complets, du matin des préparatifs à la nuit.
        </Reveal>
      </header>

      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        <div style={{ display: "grid", gap: "clamp(3.5rem, 8vw, 6rem)" }}>
          {mariages.map((m, i) => (
            <Reveal key={m.slug}>
              <Link
                href={`/mariages/${m.slug}`}
                className="presentation"
                style={{ alignItems: "center" }}
              >
                <span
                  className="photo"
                  style={{
                    aspectRatio: "3 / 2",
                    order: i % 2 === 0 ? 0 : 1, /* alternance gauche / droite */
                  }}
                >
                  <Image
                    src={m.cover}
                    alt={`Reportage de mariage — ${m.titre}`}
                    width={1800}
                    height={1200}
                    sizes="(max-width: 900px) 100vw, 55vw"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </span>
                <span className="presentation__texte">
                  <span className="carte-reportage__meta">
                    <span>{m.lieu}</span>·<span>{m.saison}</span>
                  </span>
                  <span className="display t-section">{m.titre}</span>
                  <span className="texte" style={{ color: "var(--gris)" }}>{m.extrait}</span>
                  <span className="lien">Voir le reportage →</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBandeau
        titre="Votre mariage pourrait être le prochain"
        texte="Chaque reportage commence par un simple message. Racontez-moi votre journée."
      />
    </>
  );
}
