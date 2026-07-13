/* =============================================================================
   PAGE D'ACCUEIL
   Héros plein écran → présentation → galerie mosaïque → derniers mariages
   → avis → appel à l'action. Tout le contenu vient de /content/site.js.
   ============================================================================= */

import Image from "next/image";
import Link from "next/link";
import { accueil, mariages } from "@/content/site";
import Parallaxe from "@/components/Parallaxe";
import Reveal from "@/components/Reveal";
import Galerie from "@/components/Galerie";
import CtaBandeau from "@/components/CtaBandeau";

export default function Accueil() {
  return (
    <>
      {/* ===================== HÉROS ===================== */}
      <section className="heros">
        <Parallaxe className="heros__image">
          <Image
            src={accueil.hero.image}
            alt="Photographie de mariage par JoksWed"
            fill
            priority
            sizes="100vw"
            style={{ objectFit: "cover" }}
          />
        </Parallaxe>
        <div className="heros__voile" aria-hidden="true" />

        <div className="conteneur">
          <div className="heros__contenu">
            <Reveal as="p" className="label" retard={0.2}>
              Photographe de mariage — Paris &amp; International
            </Reveal>
            <Reveal as="h1" className="display t-hero" retard={0.35}>
              Chaque histoire <em>compte.</em>
            </Reveal>
            <Reveal as="p" className="heros__sous-titre" retard={0.5}>
              {accueil.hero.sousTitre}
            </Reveal>
            <Reveal retard={0.65}>
              <Link href={accueil.hero.cta.lien} className="btn btn--clair">
                {accueil.hero.cta.texte}
              </Link>
            </Reveal>
          </div>
        </div>

        <div className="heros__fleche" aria-hidden="true" />
      </section>

      {/* ===================== PRÉSENTATION ===================== */}
      <section className="section">
        <div className="conteneur presentation">
          <div className="presentation__texte">
            <Reveal as="p" className="label">{accueil.presentation.surtitre}</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              {accueil.presentation.titre}
            </Reveal>
            <Reveal as="p" className="texte" retard={0.2}>
              {accueil.presentation.texte}
            </Reveal>
            <Reveal retard={0.3}>
              <Link href={accueil.presentation.lien.href} className="lien">
                {accueil.presentation.lien.texte} →
              </Link>
            </Reveal>
          </div>
          <Reveal photo className="presentation__image">
            <Image
              src={accueil.presentation.image}
              alt="JoksWed en reportage"
              width={1200}
              height={1500}
              sizes="(max-width: 900px) 100vw, 45vw"
            />
          </Reveal>
        </div>
      </section>

      {/* ===================== GALERIE MOSAÏQUE ===================== */}
      <section className="section section--papier">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Sélection</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Des instants, <em>pas des poses</em>
            </Reveal>
          </div>
          <Galerie photos={accueil.mosaique} />
          <Reveal style={{ marginTop: "3rem" }}>
            <Link href="/portfolio" className="lien">Voir le portfolio complet →</Link>
          </Reveal>
        </div>
      </section>

      {/* ===================== DERNIERS MARIAGES ===================== */}
      <section className="section">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Reportages</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Derniers mariages
            </Reveal>
          </div>

          <div className="reportages">
            {mariages.map((m, i) => (
              <Reveal key={m.slug} retard={i * 0.12}>
                <Link href={`/mariages/${m.slug}`} className="carte-reportage">
                  <span className="photo">
                    <Image
                      src={m.cover}
                      alt={`Reportage de mariage — ${m.titre}, ${m.lieu}`}
                      width={1200}
                      height={1500}
                      sizes="(max-width: 800px) 100vw, 33vw"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </span>
                  <span className="carte-reportage__meta">
                    <span>{m.lieu}</span>·<span>{m.saison}</span>
                  </span>
                  <h3>{m.titre}</h3>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== AVIS ===================== */}
      <section className="section" style={{ overflow: "hidden", borderTop: "1px solid var(--ligne)" }}>
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Ils m'ont fait confiance</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Paroles de mariés
            </Reveal>
          </div>
          <Reveal className="avis" as="div" aria-label="Avis de mariés">
            {accueil.avis.map((a) => (
              <figure key={a.auteur}>
                <blockquote>« {a.texte} »</blockquote>
                <figcaption>{a.auteur} — {a.lieu}</figcaption>
              </figure>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ===================== CTA ===================== */}
      <CtaBandeau />
    </>
  );
}
