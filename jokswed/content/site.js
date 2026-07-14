/* =============================================================================
   JOKSWED — CONTENU DU SITE
   -----------------------------------------------------------------------------
   ✏️  TOUT le texte et TOUTES les images du site se modifient dans CE fichier.
       Aucune connaissance en code n'est nécessaire : remplacez simplement les
       textes entre guillemets et les chemins d'images.

   🖼️  Pour remplacer une image : déposez votre photo dans /public/images/...
       en gardant le MÊME nom de fichier (ex. hero.jpg), ou changez le chemin
       ci-dessous. Formats conseillés : JPEG qualité 80, max 2400px de large.
   ============================================================================= */

export const site = {
  // --- Identité -------------------------------------------------------------
  nom: "JoksWed",
  signature: "Photographe de mariage",
  baseline: "Paris & International",
  devise: "Chaque histoire compte.",
  email: "jokswed@gmail.com",           // ← votre e-mail de contact
  telephone: "+33 7 69 90 25 99",         // ← votre téléphone (ou "" pour masquer)
  instagram: "https://instagram.com/jokswed",
  url: "https://jokswed.com",             // ← l'URL finale du site (pour le SEO)
};

// --- Page d'accueil ----------------------------------------------------------
export const accueil = {
  hero: {
    image: "/images/DSC01345-Modifier.jpg",
    titre: "Chaque histoire compte.",
    sousTitre:
      "Photographe de mariage à Paris et à l'international. Des images sincères, lumineuses, faites pour durer.",
    cta: { texte: "Vérifier ma disponibilité", lien: "/contact" },
  },
  presentation: {
    surtitre: "La démarche",
    titre: "Des photos qui vous ressemblent",
    texte:
      "Je photographie les mariages comme on écrit une histoire : avec attention, discrétion et sincérité. Pas de poses figées, pas de mise en scène artificielle — simplement la lumière, les regards et les gestes qui n'appartiennent qu'à vous. Mon travail en noir et blanc comme en couleur cherche la même chose : l'émotion juste, celle que l'on veut retrouver dans vingt ans.",
    image: "/images/accueil/presentation.jpg",
    lien: { texte: "Découvrir ma vision", href: "/a-propos" },
  },
  mosaique: [
    { src: "/images/accueil/mosaique-01.jpg", alt: "Préparatifs de la mariée, lumière naturelle" },
    { src: "/images/accueil/mosaique-02.jpg", alt: "Cérémonie en extérieur" },
    { src: "/images/accueil/mosaique-03.jpg", alt: "Portrait de couple en noir et blanc" },
    { src: "/images/accueil/mosaique-04.jpg", alt: "Détail des alliances" },
    { src: "/images/accueil/mosaique-05.jpg", alt: "Première danse" },
    { src: "/images/accueil/mosaique-06.jpg", alt: "Sortie de cérémonie" },
  ],
  avis: [
    {
      texte:
        "Franchement, on est tellement content des photos elles sont magnifiques, je suis tellement contente de t’avoir pris dans mon équipe de mariage ! Hâte de te revoir pour des photos de ouff",
      auteur: "Wendy & Enric",
      lieu: "Domaine de Merlac, Rieussec",
    },
    {
      texte:
        "Wooooow, j’ai regardé dans les grandes lignes, j’aime trop et John aussi ! Hâte de me poser et bien admirer, c’était vraiment un plaisir de t’avoir avec nous",
      auteur: "Miniola & John",
      lieu: "Paris",
    },
    {
      texte:
        "On tient à te remercier pour les magnifiques photos de notre mariage que tu as réalisées elles sont parfaites. Merci pour ton professionnalisme et ta gentillesse surtout, on et vraiment heureux du résultat ! ",
      auteur: "Celine & Kevin",
      lieu: "Paris",
    },
  ],
};

// --- Portfolio -----------------------------------------------------------------
// categorie : "mariage" | "couples" | "editorial"  (utilisée pour les filtres)
export const portfolio = [
  { src: "/images/portfolio/01.jpg", alt: "Mariée en préparatifs", categorie: "mariage" },
  { src: "/images/portfolio/02.jpg", alt: "Couple au crépuscule", categorie: "couples" },
  { src: "/images/portfolio/03.jpg", alt: "Portrait éditorial", categorie: "editorial" },
  { src: "/images/portfolio/04.jpg", alt: "Échange des vœux", categorie: "mariage" },
  { src: "/images/portfolio/05.jpg", alt: "Séance couple à Paris", categorie: "couples" },
  { src: "/images/portfolio/06.jpg", alt: "Série éditoriale en studio", categorie: "editorial" },
  { src: "/images/portfolio/07.jpg", alt: "Cortège et confettis", categorie: "mariage" },
  { src: "/images/portfolio/08.jpg", alt: "Couple en bord de mer", categorie: "couples" },
  { src: "/images/portfolio/09.jpg", alt: "Lumière de fin de journée", categorie: "editorial" },
  { src: "/images/portfolio/10.jpg", alt: "Première danse", categorie: "mariage" },
  { src: "/images/portfolio/11.jpg", alt: "Regards complices", categorie: "couples" },
  { src: "/images/portfolio/12.jpg", alt: "Composition graphique", categorie: "editorial" },
];

export const categoriesPortfolio = [
  { id: "tout", label: "Tout" },
  { id: "mariage", label: "Mariage" },
  { id: "couples", label: "Couples" },
  { id: "editorial", label: "Éditorial" },
];

// --- Mariages (reportages) ------------------------------------------------------
// Chaque reportage a sa propre page : /mariages/<slug>
/*export const mariages = [
  {
    slug: "clara-et-hugo",
    titre: "Wendy & Enric",
    lieu: "Domaine de Merlac, Rieussec",
    saison: "Été 2026",
    extrait:
      "Un mariage intime au cœur de grillons et du soleil, entre lumière d'été et douceur des derniers instants du jour.",
    cover: "/images/mariages/clara-et-hugo/cover.jpg",
    texte:
      "Wendy et Enric se sont dit oui un jour de Juin, entourés d'une quarantaine de proches. De la matinée des préparatifs à la dernière danse, la journée a été traversée par cette lumière franche et généreuse que seul l'été montpellierain sait offrir. J'ai voulu en garder la simplicité : des rires, des mains serrées, et ce moment suspendu sur les quais, juste avant le dîner.",
    photos: [
      "/images/mariages/clara-et-hugo/01.jpg",
      "/images/mariages/clara-et-hugo/02.jpg",
      "/images/mariages/clara-et-hugo/03.jpg",
      "/images/mariages/clara-et-hugo/04.jpg",
      "/images/mariages/clara-et-hugo/05.jpg",
      "/images/mariages/clara-et-hugo/06.jpg",
      "/images/mariages/clara-et-hugo/07.jpg",
      "/images/mariages/clara-et-hugo/08.jpg",
    ],
  },
  {
    slug: "ines-et-adam",
    titre: "Inès & Adam",
    lieu: "Provence, France",
    saison: "Printemps 2025",
    extrait:
      "Deux jours en Provence, un domaine entre les oliviers, et une fête qui n'a pas voulu finir.",
    cover: "/images/mariages/ines-et-adam/cover.jpg",
    texte:
      "Inès et Adam avaient choisi un domaine perdu entre les oliviers, à une heure d'Aix. Deux jours de fête, une cérémonie laïque écrite à quatre mains, et cette lumière de printemps qui rase les pierres blondes en fin de journée. Le reportage alterne noir et blanc et couleur, comme la journée elle-même alternait solennité et joie pure.",
    photos: [
      "/images/mariages/ines-et-adam/01.jpg",
      "/images/mariages/ines-et-adam/02.jpg",
      "/images/mariages/ines-et-adam/03.jpg",
      "/images/mariages/ines-et-adam/04.jpg",
      "/images/mariages/ines-et-adam/05.jpg",
      "/images/mariages/ines-et-adam/06.jpg",
      "/images/mariages/ines-et-adam/07.jpg",
      "/images/mariages/ines-et-adam/08.jpg",
    ],
  },
  {
    slug: "louise-et-theo",
    titre: "Louise & Théo",
    lieu: "Normandie, France",
    saison: "Automne 2025",
    extrait:
      "Un mariage d'automne face à la mer, entre vent, lumière grise et immense tendresse.",
    cover: "/images/mariages/louise-et-theo/cover.jpg",
    texte:
      "Louise et Théo voulaient la mer, quitte à affronter le vent d'octobre. Ils ont eu les deux, et c'est ce qui fait la beauté de ce reportage : des voiles qui s'envolent, des éclats de rire sous la pluie fine, et une lumière grise, douce, profondément normande, qui donne aux images un grain de film ancien.",
    photos: [
      "/images/mariages/louise-et-theo/01.jpg",
      "/images/mariages/louise-et-theo/02.jpg",
      "/images/mariages/louise-et-theo/03.jpg",
      "/images/mariages/louise-et-theo/04.jpg",
      "/images/mariages/louise-et-theo/05.jpg",
      "/images/mariages/louise-et-theo/06.jpg",
      "/images/mariages/louise-et-theo/07.jpg",
      "/images/mariages/louise-et-theo/08.jpg",
    ],
  },
];
*/
// --- Tarifs -----------------------------------------------------------------
// ✏️ Remplacez les prix "Sur demande" et complétez les listes quand vous êtes prêt.
export const tarifs = {
  intro:
    "Chaque mariage est unique : les formules ci-dessous sont des points de départ, que nous affinons ensemble selon votre journée. Un devis précis vous est remis après notre premier échange.",
  formules: [
    {
      nom: "Formule 1",
      surnom: "L'essentielle",
      prix: "1000€",
      duree: "Jusqu'à 8 h de présence",
      description: "Le cœur de votre journée, des préparatifs à l'ouverture du bal.",
      inclus: [ 
         "Reportage complet du mariage", 
         "Galerie privée en ligne", 
         "Photographies retouchées en haute définition", 
         "Clé USB personnalisée", 
      ],
      misEnAvant: false,
    },
    {
      nom: "Formule 2",
      surnom: "Signature",
      prix: "1300€",
      duree: "Jusqu'à 12 h de présence",
      description: "Votre journée entière, des préparatifs à la soirée dansante.",
      inclus: [ 
         "Reportage complet de la journée", 
         "Galerie privée en ligne", 
         "Photographies retouchées en haute définition", 
         "Séance couple le jour J", "Clé USB personnalisée", 
         "Album premium 25 × 25 cm", 
         "Couverture en cuir personnalisée", 
      ],
      misEnAvant: true, // ← la carte mise en valeur au centre
    },
    {
      nom: "Formule 3",
      surnom: "Prestige",
      prix: "1600€",
      duree: "Jusqu'à 14 h de présence + séance engagement",
      description: "L'expérience la plus complète pour raconter votre histoire.",
      inclus: [ 
         "Journée complète jusqu'aux temps forts de la soirée", 
         "Séance engagement avant le mariage", 
         "Galerie privée en ligne", 
         "Photographies retouchées en haute définition", 
         "Clé USB personnalisée", 
         "Grand album premium 30 × 30 cm", 
         "Couverture en cuir personnalisée", 
         "Coffret en cuir assorti", 
      ],
      misEnAvant: false,
    },
  ],
  options: [
    { nom: "Séance engagement", detail: "Une séance couple avant le mariage, pour se rencontrer et apprivoiser l'objectif." },
    { nom: "Album premium supplémentaire", detail: "Un second album en cuir personnalisé, parfait pour offrir à vos proches." },
    { nom: "Vidéaste professionnel", detail: "Immortalisez votre journée en vidéo grâce à un vidéaste partenaire sélectionné avec soin. Disponible sur demande." },
    { nom: "Jour d'après (day after)", detail: "Une séance libre le lendemain, en tenue de mariés, là où vous voulez." },
    { nom: "Tirages d'exposition", detail: "Tirages grand format, contrecollés et prêts à accrocher." },
  ],
  deroulement: [
    { titre: "Premier échange", texte: "Un appel ou un café pour faire connaissance, comprendre votre journée et vérifier ma disponibilité." },
    { titre: "Réservation", texte: "Un contrat clair et un acompte réservent votre date. À partir de là, elle est à vous." },
    { titre: "Préparation", texte: "Quelques semaines avant le jour J, nous affinons ensemble le déroulé, les lieux et les moments qui comptent." },
    { titre: "Le jour J", texte: "Je suis là, discret et attentif, du début à la fin. Vous vivez votre journée — je m'occupe du reste." },
    { titre: "La livraison", texte: "Sous 13 à 15 jours, vous recevez votre galerie complète, retouchée avec soin, en haute définition." },
  ],
  faq: [
    {
      question: "Vous déplacez-vous partout en France et à l'étranger ?",
      reponse:
        "Oui. Je suis basé à Paris et je photographie des mariages partout en France comme à l'international. Les frais de déplacement sont intégrés au devis, sans surprise.",
    },
    {
      question: "Combien de photos recevons-nous ?",
      reponse:
        "Cela dépend de la durée de présence, mais comptez plusieurs centaines de photographies soigneusement sélectionnées et retouchées — jamais de rafales brutes livrées en vrac.",
    },
    {
      question: "Sous quel délai les photos sont-elles livrées ?",
      reponse:
        "Une sélection d'avant-première vous parvient dans la semaine qui suit le mariage. La galerie complète est livrée sous 15 à 20 jours.",
    },
    {
      question: "Comment réserver une date ?",
      reponse:
        "Un simple message via la page contact suffit. Après un premier échange, la date est bloquée à la signature du contrat et au versement de l'acompte.",
    },
  ],
};

// --- À propos -----------------------------------------------------------------
export const aPropos = {
  portrait: "/images/a-propos/portrait.jpg",
  imageSecondaire: "/images/a-propos/atelier.jpg",
  intro: "Amoureux d'images, avant tout.",
  presentation:
    "Je m'appelle John. Photographe basé à Paris, je consacre mon travail aux mariages, aux couples et aux séries éditoriales. Ce qui me guide n'a pas changé depuis mes débuts : la conviction que chaque histoire compte, et qu'elle mérite d'être racontée avec justesse.",
  vision: {
    titre: "Ma vision",
    texte:
      "La photographie de mariage n'est pas une succession de poses : c'est un récit. Je cherche la lumière avant tout — celle qui sculpte un visage, qui isole un geste, qui transforme un instant ordinaire en souvenir. Mon regard s'est construit dans le noir et blanc, et il en garde l'exigence : quand la couleur disparaît, il ne reste que l'émotion.",
  },
  maniere: {
    titre: "Ma manière de travailler",
    texte:
      "Discrétion, anticipation, bienveillance. Je me fonds dans votre journée pour la vivre avec vous plutôt que la diriger. Je guide quand il le faut — quelques minutes volées pour les portraits — mais l'essentiel de mon travail consiste à être au bon endroit, au bon moment, sans jamais m'imposer.",
  },
  pourquoi: {
    titre: "Pourquoi me choisir",
    points: [
      { titre: "Un regard d'auteur", texte: "Une écriture visuelle reconnaissable, nourrie par la couleur mais aussi par le noir et blanc et le travail éditorial." },
      { titre: "Une présence discrète", texte: "Vous vivez votre journée pleinement ; les images se font sans que vous y pensiez." },
      { titre: "Une exigence artisanale", texte: "Chaque photographie livrée est choisie et retouchée individuellement, à la main." },
      { titre: "Un engagement clair", texte: "Contrat précis, délais tenus, galerie sécurisée : tout est simple et transparent." },
    ],
  },
};

// --- Contact --------------------------------------------------------------------
export const contact = {
  image: "/images/contact/contact.jpg",
  titre: "Racontez-moi votre histoire",
  texte:
    "Une date, un lieu, une envie — dites-m'en un peu plus sur vous. Je réponds personnellement à chaque message, en général sous 48 heures.",
  adresse: "Paris, France",
  zone: "Disponible partout en France et à l'international",
  lienCarte: "https://maps.google.com/?q=Paris,France",
};
