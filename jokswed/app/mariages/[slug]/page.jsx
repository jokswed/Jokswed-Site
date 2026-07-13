/* =============================================================================
   PAGE REPORTAGE — /mariages/<slug>
   En-tête plein écran, texte de récit, galerie immersive (mosaïque + images
   pleine largeur), navigation vers le reportage suivant.
   Ces pages sont générées statiquement au build : ultra-rapides.
   ============================================================================= */

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mariages } from "@/content/site";
import Reveal from "@/components/Reveal";
import Parallaxe from "@/components/Parallaxe";
import Galerie from "@/components/Galerie";
import CtaBandeau from "@/components/CtaBandeau";

/* Génère une page statique par reportage listé dans /content/site.js */
export function generateStaticParams() {
  return mariages.map((m) => ({ slug: m.slug }));
}

export function generateMetadata({ params }) {
  const m = mariages.find((x) => x.slug === params.slug);
  if (!m) return {};
  return {
    title: `${m.titre} — Reportage de mariage`,
    description: m.extrait,
    openGraph: { images: [{ url: m.cover }] },
  };
}

export default function Reportage({ params }) {
  const index = mariages.findIndex((m) => m.slug === params.slug);
  if (index === -1) notFound();

  const m = mariages[index];
  const suivant = mariages[(index + 1) % mariages.length];
  const photos = m.photos.map((src, i) => ({
    src,
    alt: `${m.titre} — photographie ${i + 1}`,
  }));

  return (
    <>
      {/* --- En-tête plein écran --- */}
      <section className="reportage-entete">
        <Parallaxe className="heros__image">
          <Image
            src={m.cover}
            alt={`Mariage de ${m.titre} — ${m.lieu}`}
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
              {m.lieu} — {m.saison}
            </Reveal>
            <Reveal as="h1" className="display t-hero" retard={0.35}>
              {m.titre}
            </Reveal>
          </div>
        </div>
      </section>

      {/* --- Récit --- */}
      <section className="section">
        <div className="conteneur">
          <Reveal className="reportage-texte">
            <p className="label label--nu">Le récit</p>
            <p className="texte" style={{ fontSize: "1.15rem" }}>{m.texte}</p>
          </Reveal>
        </div>
      </section>

      {/* --- Galerie immersive --- */}
      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        {/* Les photos n° 3 et 6 s'affichent en pleine largeur pour rythmer la lecture */}
        <Galerie photos={photos} pleineLargeur={[2, 5]} />
      </section>

      {/* --- Navigation vers le reportage suivant --- */}
      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        <Reveal className="reportage-pied">
          <Link href="/mariages" className="lien">← Tous les reportages</Link>
          <Link href={`/mariages/${suivant.slug}`} className="lien">
            Reportage suivant : {suivant.titre} →
          </Link>
        </Reveal>
      </section>

      <CtaBandeau
        titre="Et si c'était votre histoire ?"
        texte="Chaque reportage commence par un premier message. Le vôtre, peut-être."
      />
    </>
  );
}
