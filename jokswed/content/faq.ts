/* =============================================================================
   JOKSWED — FAQ, SOURCE UNIQUE
   -----------------------------------------------------------------------------
   ⚠️ POURQUOI CE FICHIER EXISTE.

   Le site livré portait DEUX FAQ indépendantes :

     · app/faq/page.jsx      → 21 questions codées en dur dans la page ;
     · content/site.js       → `tarifs.faq`, 4 questions, rendues sur /tarifs.

   Elles se contredisaient sur trois points vérifiables :

     1. délai de livraison        « 13 à 15 jours »  vs  « 15 à 20 jours » ;
     2. nombre de photographies   « minimum 800 »    vs  « plusieurs centaines » ;
     3. frais de déplacement      « inclus »         vs  « dépendent du lieu ».

   Sur chacun, le devis et le contrat signés font foi — ce sont des engagements
   déjà pris. La bonne valeur est donc : 13 à 15 jours, minimum 800 photos,
   déplacements inclus en France métropolitaine. Les formulations retenues
   ci-dessous sont alignées sur ces documents.

   `vitrine: true` marque les questions reprises sur /tarifs. Elles ne sont pas
   recopiées : la page lit ce même tableau.
   ============================================================================= */

export interface Question {
  readonly cle: string;
  readonly question: string;
  readonly reponse: string;
  /** Reprise dans l'encart FAQ de la page Tarifs. */
  readonly vitrine?: boolean;
}

export interface GroupeFaq {
  readonly titre: string;
  readonly questions: readonly Question[];
}

export const etapes = [
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
] as const;

export const groupesFaq: readonly GroupeFaq[] = [
  {
    titre: "Réservation",
    questions: [
      {
        cle: "delai-reservation",
        question: "Combien de temps à l’avance faut-il réserver ?",
        reponse:
          "Il est préférable de me contacter environ un an avant votre mariage, particulièrement pour les dates les plus demandées. Une réservation quelques mois à l’avance reste tout à fait possible. Les demandes de dernière minute sont également les bienvenues, sous réserve de disponibilité.",
      },
      {
        cle: "comment-reserver",
        question: "Comment réserver notre date ?",
        reponse:
          "La première étape consiste à me contacter grâce au formulaire du site ou directement sur Instagram. Après notre échange, la date est définitivement bloquée lorsque le contrat est signé et que l’acompte est versé.",
        vitrine: true,
      },
      {
        cle: "rendez-vous",
        question: "Un rendez-vous avant le mariage est-il nécessaire ?",
        reponse:
          "Oui. Une rencontre est fortement recommandée afin de faire connaissance et de préparer votre journée sereinement. Elle nous permet d’échanger sur votre programme, vos attentes et les personnes ou moments qui comptent particulièrement pour vous.",
      },
      {
        cle: "plusieurs-formules",
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
        cle: "deplacements",
        question: "Où vous déplacez-vous ?",
        reponse:
          "Je photographie des mariages à Paris, partout en France et également à l’international. Quelle que soit la destination, vous pouvez me présenter votre projet afin que nous étudiions ensemble son organisation.",
        vitrine: true,
      },
      {
        cle: "frais-deplacement",
        // ⚠️ Réponse CORRIGÉE. L'ancienne disait que les frais « dépendent du
        // lieu », tandis que /tarifs affichait « frais de déplacement inclus ».
        // Le devis tranche : « Déplacements en France métropolitaine inclus ».
        question: "Les frais de déplacement sont-ils inclus ?",
        reponse:
          "Oui pour la France métropolitaine : les déplacements y sont compris dans les trois formules, sans supplément. Pour un mariage à l’international, en Corse ou en outre-mer, le voyage et l’hébergement sont étudiés avec vous et apparaissent clairement dans votre devis, sans surprise.",
        vitrine: true,
      },
      {
        cle: "seul-ou-accompagne",
        question: "Travaillez-vous seul ?",
        reponse:
          "Je reste le photographe principal de votre mariage. Selon la prestation et l’organisation de la journée, je peux être accompagné d’un assistant afin de garantir davantage de fluidité et de disponibilité. Un deuxième photographe peut également être ajouté en option.",
      },
      {
        cle: "video",
        question: "Proposez-vous également de la vidéo ?",
        reponse:
          "Je ne réalise pas moi-même les films de mariage, mais je travaille avec un vidéaste partenaire de confiance qui peut intervenir à mes côtés. Sa prestation est étudiée selon votre projet et ses disponibilités, et elle est facturée séparément par son entreprise.",
      },
      {
        cle: "seance-engagement",
        question: "Proposez-vous des séances engagement ?",
        reponse:
          "Oui. Une séance de couple peut être organisée avant le mariage, ou après celui-ci. Elle est comprise dans la Formule 3 et constitue une option pour les formules 1 et 2. Elle permet de créer des images dans un cadre plus calme, sans les contraintes du jour J.",
      },
      {
        cle: "albums",
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
        cle: "style",
        question: "Comment décririez-vous votre style ?",
        reponse:
          "Mon approche est naturelle, élégante et jeune. Je cherche à préserver la spontanéité de votre journée tout en créant des portraits soignés, lumineux et intemporels.",
      },
      {
        cle: "guidage",
        question: "Est-ce que vous nous guidez pour les photos de couple ?",
        reponse:
          "Oui. Vous n’avez pas besoin de savoir poser. Je vous accompagne avec des indications simples afin d’obtenir des attitudes naturelles, flatteuses et fidèles à votre personnalité.",
      },
      {
        cle: "pluie",
        question: "Que se passe-t-il en cas de pluie ?",
        reponse:
          "Je reste pleinement opérationnel, quelles que soient les conditions météorologiques. Si vous êtes prêts à profiter de votre journée, je le serai aussi. Nous adapterons simplement les lieux, les horaires ou les prises de vue lorsque cela sera nécessaire.",
      },
      {
        cle: "empechement",
        question: "Que se passe-t-il en cas d’empêchement exceptionnel ?",
        reponse:
          "Cette situation ne s’est encore jamais présentée. En cas d’empêchement grave et exceptionnel ne permettant aucune solution de remplacement, les sommes versées pour les prestations non réalisées seraient remboursées, conformément à l’article 5 du contrat.",
      },
    ],
  },
  {
    titre: "Photos et livraison",
    questions: [
      {
        cle: "delai-livraison",
        question: "Quel est le délai de livraison ?",
        reponse:
          "Votre reportage est livré sous 13 à 15 jours après le mariage. Ce délai me permet de sélectionner et de travailler chaque image avec soin, sans vous faire attendre plusieurs mois. Lorsqu’un album est compris dans votre formule, sa fabrication demande environ un mois supplémentaire après validation de la maquette.",
        vitrine: true,
      },
      {
        cle: "nombre-photos",
        // ⚠️ Réponse alignée sur le devis et l'article 8 du contrat, qui
        // engagent un minimum de 800 photographies. L'ancienne version de
        // site.js disait « plusieurs centaines » : plus vague que l'engagement
        // réellement pris.
        question: "Combien de photos allons-nous recevoir ?",
        reponse:
          "Je livre un minimum de 800 photographies retouchées. Le nombre final varie naturellement selon la durée de présence, le déroulement de votre journée et la formule choisie.",
        vitrine: true,
      },
      {
        cle: "retouches",
        question: "Toutes les photos sont-elles retouchées ?",
        reponse:
          "Oui. Chaque photographie livrée est soigneusement sélectionnée puis retouchée afin de garantir un reportage cohérent, harmonieux et fidèle à mon univers.",
      },
      {
        cle: "choix-photos",
        question: "Pouvons-nous choisir les photos à recevoir ?",
        reponse:
          "Je réalise directement la sélection finale grâce à mon regard de photographe. Cela permet de raconter votre journée de façon fluide, d’éviter les doublons et de ne conserver que les images les plus fortes.",
      },
      {
        cle: "livraison-support",
        question: "Comment les photos sont-elles livrées ?",
        reponse:
          "Vos images sont mises à disposition dans une galerie privée en ligne, en haute définition. Selon votre formule, la livraison comprend également une clé USB personnalisée, un album ou un album accompagné de son coffret.",
      },
      {
        cle: "publication",
        question: "Sommes-nous obligés d’accepter la publication de nos photos ?",
        reponse:
          "Non. Vous êtes entièrement libres de refuser la publication de vos images sur mon site, mes réseaux sociaux ou mes supports de communication. Votre choix est recueilli par écrit au contrat et il est naturellement respecté.",
      },
    ],
  },
];

/** Les questions reprises sur /tarifs. Même source, aucune recopie. */
export const faqVitrine: readonly Question[] = groupesFaq
  .flatMap((groupe) => groupe.questions)
  .filter((q) => q.vitrine);

/** Toutes les questions, à plat — pour les données structurées schema.org. */
export const toutesLesQuestions: readonly Question[] = groupesFaq.flatMap(
  (groupe) => groupe.questions,
);
