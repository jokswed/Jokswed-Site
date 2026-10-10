/* =============================================================================
   PAGE FAQ — Questions fréquentes
   Informations pratiques, déroulement, prestations et livraison.
   ============================================================================= */

import Image from "next/image";
import Link from "next/link";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";
import { etapes, groupesFaq, toutesLesQuestions } from "@/content/faq";

export const metadata = {
  title: "FAQ — Photographe de mariage",
  description:
    "Retrouvez les réponses aux questions fréquentes concernant les réservations, les formules, les déplacements et la livraison de vos photos de mariage.",
};

/* ⚠️ LES DONNÉES ONT QUITTÉ CETTE PAGE.

   Les 21 questions et les 6 étapes vivaient ici, en dur, tandis que
   `content/site.js` portait une SECONDE FAQ de 4 questions rendue sur /tarifs.
   Les deux se contredisaient sur le délai de livraison (13-15 vs 15-20 jours),
   le nombre de photos (« minimum 800 » vs « plusieurs centaines ») et les frais
   de déplacement. Tout est désormais dans content/faq.ts, corrigé et aligné sur
   le devis et le contrat signés. */

export default function FAQ() {
  /* Données structurées FAQPage : rend la page éligible aux questions
     dépliables directement dans les résultats Google. La page portait 21
     questions et aucun balisage. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: toutesLesQuestions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.reponse },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* EN-TÊTE */}
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">
          Questions fréquentes
        </Reveal>

        <Reveal as="h1" className="display t-hero" retard={0.1}>
          Tout commence par une rencontre
        </Reveal>

        <Reveal as="p" className="texte" retard={0.2}>
          Réservation, organisation, déroulement et livraison : retrouvez ici
          les réponses aux principales questions concernant votre reportage de
          mariage.
        </Reveal>
      </header>

      {/* GRANDE IMAGE D’INTRODUCTION */}
      <section
        className="conteneur"
        style={{ paddingBottom: "var(--section)" }}
      >
        <Reveal>
          <div
            className="photo"
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 8",
              overflow: "hidden",
            }}
          >
            <Image
              src="/images/faq/faq-introduction.jpg"
              alt="Couple de mariés photographié par JoksWed"
              fill
              priority
              sizes="100vw"
              style={{ objectFit: "cover" }}
            />
          </div>
        </Reveal>
      </section>

      {/* DÉROULEMENT */}
      <section
        className="conteneur"
        style={{ paddingBottom: "var(--section)" }}
      >
        <Reveal>
          <div style={{ maxWidth: "760px", marginBottom: "4rem" }}>
            <p className="label">L’expérience JoksWed</p>

            <h2 className="display t-section">
              Du premier message à la livraison
            </h2>

            <p className="texte" style={{ color: "var(--gris)" }}>
              Un accompagnement clair et attentif, pensé pour que vous puissiez
              profiter de votre mariage en toute sérénité.
            </p>
          </div>
        </Reveal>

        <div className="faq-etapes">
          {etapes.map((etape, index) => (
            <Reveal key={etape.numero} retard={index * 0.06}>
              <article className="faq-etape">
                <span className="faq-etape__numero">{etape.numero}</span>

                <h3 className="display faq-etape__titre">{etape.titre}</h3>

                <p className="texte faq-etape__texte">{etape.texte}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* IMAGE ET PHILOSOPHIE */}
      <section
        className="conteneur"
        style={{
          alignItems: "center",
          paddingBottom: "var(--section)",
        }}
      >
        <Reveal>
          <div 
             className="presentation__texte"
             style={{
               maxWidth: "850px",
               margin: "0 auto",
               textAlign: "center",
             }}
            >
            <p className="label">Ma manière de travailler</p>

            <h2 className="display t-section">
              Présent, sans jamais prendre toute la place
            </h2>

            <p className="texte" style={{ color: "var(--gris)" }}>
              Je photographie les moments spontanés avec discrétion, tout en
              sachant intervenir lorsqu’un conseil ou une direction est
              nécessaire.
            </p>

            <p className="texte" style={{ color: "var(--gris)" }}>
              Pour vos portraits et votre séance de couple, je vous guide avec
              simplicité. Vous restez vous-mêmes, sans poses figées ni gestes
              qui ne vous ressemblent pas.
            </p>

            <Link
              href="/a-propos"
              className="lien"
              style={{
                display: "flex",
                justifyContent: "center",
                width: "fit-content",
                margin: "2rem auto 0",
              }}
            >
              Découvrir mon approche →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* QUESTIONS */}
      <section
        className="conteneur"
        style={{ paddingBottom: "var(--section)" }}
      >
        <div className="faq-groupes">
          {groupesFaq.map((groupe, groupeIndex) => (
            <Reveal key={groupe.titre} retard={groupeIndex * 0.05}>
              <section className="faq-groupe">
                <header className="faq-groupe__entete">
                  <p className="label">
                    {String(groupeIndex + 1).padStart(2, "0")}
                  </p>

                  <h2 className="display t-section">{groupe.titre}</h2>
                </header>

                <div className="faq-liste">
                  {groupe.questions.map((item) => (
                    <details className="faq-item" key={item.question}>
                      <summary className="faq-item__question">
                        <span>{item.question}</span>
                        <span
                          className="faq-item__icone"
                          aria-hidden="true"
                        />
                      </summary>

                      <div className="faq-item__reponse">
                        <p className="texte">{item.reponse}</p>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            </Reveal>
          ))}
        </div>
      </section>

      {/* TARIFS */}
      <section
        className="conteneur presentation faq-tarifs"
        style={{
          alignItems: "center",
          paddingBottom: "var(--section)",
        }}
      >
        <Reveal>
          <div className="presentation__texte">
            <p className="label">Formules et options</p>

            <h2 className="display t-section">
              Une prestation pensée pour votre journée
            </h2>

            <p className="texte" style={{ color: "var(--gris)" }}>
              Trois formules sont disponibles, avec différents supports de
              livraison et différentes possibilités d’accompagnement.
            </p>

            <p className="texte" style={{ color: "var(--gris)" }}>
              Vous pouvez également ajouter une séance engagement, un album, un
              coffret ou la présence d’un vidéaste partenaire selon votre
              projet.
            </p>

            <Link href="/tarifs" className="lien">
              Découvrir les formules →
            </Link>
          </div>
        </Reveal>

        <Reveal retard={0.15}>
          <div
            className="photo"
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "4 / 5",
              overflow: "hidden",
            }}
          >
            <Image
              src="/images/faq/faq-album.jpg"
              alt="Album photo de mariage JoksWed"
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              style={{ objectFit: "cover" }}
            />
          </div>
        </Reveal>
      </section>

      <CtaBandeau
        titre="Une question reste sans réponse ?"
        texte="Écrivez-moi et racontez-moi votre projet. Je vous répondrai avec plaisir."
      />
    </>
  );
}
