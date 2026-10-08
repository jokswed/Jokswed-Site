/* =============================================================================
   PAGE D'ACCUEIL — V2
   -----------------------------------------------------------------------------
   L'ordre suit la logique commerciale demandée :

     1. bande photographique       → on voit le travail immédiatement
     2. signature de marque        → qui je suis, et un accès direct au formulaire
     3. les trois formules         → les prix sans changer de page
     4. les suppléments + vidéo    → ce qu'on peut ajouter
     5. l'appel à l'action
     6. le formulaire              → sur la même page, avec le choix déjà repris
     7. la FAQ
     8. la démarche et les avis    → la réassurance, après la conversion

   ⚠️ LE GRAND HÉROS PLEIN ÉCRAN A DISPARU, ET C'EST UN CHOIX.

   Il occupait toute la hauteur de l'écran avant la moindre photographie, et
   repoussait les tarifs à deux ou trois défilements sur iPhone. La bande le
   remplace : le visiteur voit douze photographies dès la première seconde, et
   le titre reste juste en dessous — le <h1> et le référencement sont intacts.

   ⚠️ UN SEUL ÎLOT CLIENT.

   `<Configurateur>` porte toute l'interactivité (sections 3 à 6). La bande, la
   FAQ et le reste sont rendus côté serveur : aucun JavaScript inutile.
   ============================================================================= */

import Image from "next/image";
import Link from "next/link";
import { accueil, portfolio } from "@/content/site";
import { formules, supplements, videastePartenaire } from "@/content/offres";
import { groupesFaq, toutesLesQuestions } from "@/content/faq";
import BandePhotos from "@/components/BandePhotos";
import Configurateur from "@/components/Configurateur";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";

/* La bande réutilise les photographies du portfolio : aucun fichier dupliqué,
   aucune image à maintenir en double. L'ordre et le recadrage se règlent ici
   en attendant l'administration (V5). */
const photosBande = portfolio.map((p) => ({ src: p.src, alt: p.alt }));

export default function Accueil() {
  /* Données structurées : la page d'accueil porte désormais les tarifs et la
     FAQ, donc le balisage qui va avec. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: toutesLesQuestions.slice(0, 8).map((q) => ({
          "@type": "Question",
          name: q.question,
          acceptedAnswer: { "@type": "Answer", text: q.reponse },
        })),
      },
      ...formules.map((f) => ({
        "@type": "Offer",
        name: `${f.nom} — ${f.surnom}`,
        description: f.description,
        price: (f.prixCents / 100).toFixed(2),
        priceCurrency: "EUR",
        /* Le prix affiché est un TTC : on le dit aussi aux moteurs. */
        valueAddedTaxIncluded: true,
        category: "Reportage photographique de mariage",
      })),
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ═══════════ 1. BANDE PHOTOGRAPHIQUE ═══════════ */}
      <BandePhotos photos={photosBande} secondes={75} />

      {/* ═══════════ 2. SIGNATURE DE MARQUE ═══════════ */}
      <section className="section" style={{ paddingBlock: "clamp(3rem, 8vh, 5.5rem)" }}>
        <div className="conteneur" style={{ maxWidth: "var(--max-texte)", textAlign: "center" }}>
          <Reveal as="p" className="label">
            Photographe de mariage — Paris &amp; International
          </Reveal>
          <Reveal as="h1" className="display t-hero" retard={0.15} style={{ marginTop: "1rem" }}>
            Chaque histoire <em>compte.</em>
          </Reveal>
          <Reveal as="p" className="texte" retard={0.3} style={{ marginTop: "1.2rem" }}>
            {accueil.hero.sousTitre}
          </Reveal>
          <Reveal
            retard={0.45}
            style={{
              marginTop: "2.2rem",
              display: "flex",
              gap: "0.9rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link href="#demande" className="btn">
              Vérifier ma date et faire une demande
            </Link>
            <Link href="#formules" className="btn btn--fantome">
              Voir les formules
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ 3 à 6. FORMULES, SUPPLÉMENTS, CTA, FORMULAIRE ═══════════ */}
      <Configurateur
        formules={formules}
        supplements={supplements}
        videaste={videastePartenaire}
      />

      {/* ═══════════ 7. FAQ ═══════════ */}
      <section className="section" id="faq">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Questions fréquentes</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Ce qu&apos;on me demande <em>souvent</em>
            </Reveal>
          </div>

          <div style={{ display: "grid", gap: "clamp(2rem, 5vw, 3rem)" }}>
            {groupesFaq.map((groupe, i) => (
              <Reveal key={groupe.titre} retard={i * 0.05}>
                <p className="label label--nu" style={{ marginBottom: "1rem" }}>
                  {groupe.titre}
                </p>
                <div className="faq">
                  {groupe.questions.map((q) => (
                    <details key={q.cle}>
                      <summary>{q.question}</summary>
                      <p>{q.reponse}</p>
                    </details>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ 8. LA DÉMARCHE ═══════════ */}
      <section className="section section--papier">
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
              loading="lazy"
            />
          </Reveal>
        </div>
      </section>

      {/* ═══════════ AVIS ═══════════ */}
      <section
        className="section"
        style={{ overflow: "hidden", borderTop: "1px solid var(--ligne)" }}
      >
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Ils m&apos;ont fait confiance</Reveal>
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

      <CtaBandeau />
    </>
  );
}
