/* =============================================================================
   PAGE FAQ — Questions fréquentes
   Informations pratiques, déroulement, prestations et livraison.
   ============================================================================= */

import Image from "next/image";
import Link from "next/link";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";

export const metadata = {
  title: "FAQ — Photographe de mariage",
  description:
    "Retrouvez les réponses aux questions fréquentes concernant les réservations, les formules, les déplacements et la livraison de vos photos de mariage.",
};

const etapes = [
  {
    numero: "01",
    titre: "Premier contact",
    texte:
      "Vous me racontez votre projet grâce au formulaire de contact ou directement sur Instagram.",
  },
  {
    numero: "02",
    titre: "Rencontre",
    texte:
      "Nous échangeons autour de votre journée, de vos envies et de l’accompagnement qui vous correspond.",
  },
  {
    numero: "03",
    titre: "Réservation",
    texte:
      "Votre date est officiellement réservée après la signature du contrat et le versement de l’acompte.",
  },
  {
    numero: "04",
    titre: "Préparation",
    texte:
      "Avant le mariage, nous préparons ensemble le planning, les moments importants et les éventuelles photos de groupe.",
  },
  {
    numero: "05",
    titre: "Jour du mariage",
    texte:
      "Je photographie votre journée avec discrétion tout en vous guidant lorsque cela est nécessaire.",
  },
  {
    numero: "06",
    titre: "Livraison",
    texte:
      "Votre reportage entièrement sélectionné et retouché est livré sous 13 à 15 jours.",
  },
];

const groupesFaq = [
  {
    titre: "Réservation",
    questions: [
      {
        question: "Combien de temps à l’avance faut-il réserver ?",
        reponse:
          "Il est préférable de me contacter environ un an avant votre mariage, particulièrement pour les dates les plus demandées. Une réservation quelques mois à l’avance reste tout à fait possible. Les demandes de dernière minute sont également les bienvenues, sous réserve de disponibilité.",
      },
      {
        question: "Comment réserver notre date ?",
        reponse:
          "La première étape consiste à me contacter grâce au formulaire du site ou directement sur Instagram. Après notre échange, la date est définitivement bloquée lorsque le contrat est signé et que l’acompte est versé.",
      },
      {
        question: "Un rendez-vous avant le mariage est-il nécessaire ?",
        reponse:
          "Oui. Une rencontre est fortement recommandée afin de faire connaissance et de préparer votre journée sereinement. Elle nous permet d’échanger sur votre programme, vos attentes et les personnes ou moments qui comptent particulièrement pour vous.",
      },
      {
        question: "Proposez-vous plusieurs formules ?",
        reponse:
          "Oui, trois formules sont proposées afin de s’adapter à différents besoins et différentes durées de couverture. Vous pouvez les découvrir sur la page Tarifs. Des options peuvent également être ajoutées à votre formule.",
      },
    ],
  },
  {
    titre: "Prestations",
    questions: [
      {
        question: "Où vous déplacez-vous ?",
        reponse:
          "Je photographie des mariages à Paris, partout en France et également à l’international. Quelle que soit la destination, vous pouvez me présenter votre projet afin que nous étudiions ensemble son organisation.",
      },
      {
        question: "Les frais de déplacement sont-ils inclus ?",
        reponse:
          "Les éventuels frais de déplacement dépendent du lieu, de la distance et des besoins liés au séjour. Lorsqu’ils sont nécessaires, ils apparaissent clairement et précisément dans votre devis.",
      },
      {
        question: "Travaillez-vous seul ?",
        reponse:
          "Je reste le photographe principal de votre mariage. Selon la prestation et l’organisation de la journée, je peux être accompagné d’un assistant afin de garantir davantage de fluidité et de disponibilité.",
      },
      {
        question: "Proposez-vous également de la vidéo ?",
        reponse:
          "Je ne réalise pas moi-même les films de mariage, mais je travaille avec un vidéaste de confiance qui peut intervenir à mes côtés. Cette prestation peut être étudiée en fonction de votre projet et de ses disponibilités.",
      },
      {
        question: "Proposez-vous des séances engagement ?",
        reponse:
          "Oui. Une séance de couple peut être organisée avant le mariage, ou après celui-ci. Elle constitue une option supplémentaire et permet de créer des images dans un cadre plus calme, sans les contraintes du jour J.",
      },
      {
        question: "Proposez-vous des albums photo ?",
        reponse:
          "Oui. Selon la formule choisie, votre prestation peut comprendre une clé USB, un album ou un album présenté dans son coffret. Les possibilités sont précisées sur la page Tarifs.",
      },
    ],
  },
  {
    titre: "Votre journée",
    questions: [
      {
        question: "Comment décririez-vous votre style ?",
        reponse:
          "Mon approche est naturelle, élégante et jeune. Je cherche à préserver la spontanéité de votre journée tout en créant des portraits soignés, lumineux et intemporels.",
      },
      {
        question: "Est-ce que vous nous guidez pour les photos de couple ?",
        reponse:
          "Oui. Vous n’avez pas besoin de savoir poser. Je vous accompagne avec des indications simples afin d’obtenir des attitudes naturelles, flatteuses et fidèles à votre personnalité.",
      },
      {
        question: "Que se passe-t-il en cas de pluie ?",
        reponse:
          "Je reste pleinement opérationnel, quelles que soient les conditions météorologiques. Si vous êtes prêts à profiter de votre journée, je le serai aussi. Nous adapterons simplement les lieux, les horaires ou les prises de vue lorsque cela sera nécessaire.",
      },
      {
        question: "Que se passe-t-il en cas d’empêchement exceptionnel ?",
        reponse:
          "Cette situation ne s’est encore jamais présentée. En cas d’empêchement grave et exceptionnel ne permettant aucune solution de remplacement, les sommes versées pour la prestation seraient intégralement remboursées, conformément aux conditions du contrat.",
      },
    ],
  },
  {
    titre: "Photos et livraison",
    questions: [
      {
        question: "Quel est le délai de livraison ?",
        reponse:
          "Votre reportage est livré sous 13 à 15 jours après le mariage. Ce délai me permet de sélectionner et de travailler chaque image avec soin, sans vous faire attendre plusieurs mois.",
      },
      {
        question: "Combien de photos allons-nous recevoir ?",
        reponse:
          "Je livre un minimum de 800 photographies. Le nombre final varie naturellement selon la durée de présence, le déroulement de votre journée et la formule choisie.",
      },
      {
        question: "Toutes les photos sont-elles retouchées ?",
        reponse:
          "Oui. Chaque photographie livrée est soigneusement sélectionnée puis retouchée afin de garantir un reportage cohérent, harmonieux et fidèle à mon univers.",
      },
      {
        question: "Pouvons-nous choisir les photos à recevoir ?",
        reponse:
          "Je réalise directement la sélection finale grâce à mon regard de photographe. Cela permet de raconter votre journée de façon fluide, d’éviter les doublons et de ne conserver que les images les plus fortes.",
      },
      {
        question: "Comment les photos sont-elles livrées ?",
        reponse:
          "Le support de livraison dépend de votre formule. Il peut notamment comprendre une clé USB, un album photo ou un album accompagné de son coffret.",
      },
      {
        question: "Sommes-nous obligés d’accepter la publication de nos photos ?",
        reponse:
          "Non. Vous êtes entièrement libres de refuser la publication de vos images sur mon site, mes réseaux sociaux ou mes supports de communication. Votre choix sera naturellement respecté.",
      },
    ],
  },
];

export default function FAQ() {
  return (
    <>
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
        className="conteneur presentation faq-presentation"
        style={{
          alignItems: "center",
          paddingBottom: "var(--section)",
        }}
      >
        <Reveal>
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
              src="/images/faq/faq-accompagnement.jpg"
              alt="Photographe accompagnant un couple pendant leur mariage"
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              style={{ objectFit: "cover" }}
            />
          </div>
        </Reveal>

        <Reveal retard={0.15}>
          <div className="presentation__texte">
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

            <Link href="/a-propos" className="lien">
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
