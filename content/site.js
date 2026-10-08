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
    image: "/images/accueil/hero.jpg",
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
  { src: "/images/accueil/presentation.jpg", alt: "Série éditoriale en studio", categorie: "editorial" },
  { src: "/images/portfolio/07.jpg", alt: "Cortège et confettis", categorie: "mariage" },
  { src: "/images/portfolio/08.jpg", alt: "Couple en bord de mer", categorie: "couples" },
  { src: "/images/accueil/hero.jpg", alt: "Lumière de fin de journée", categorie: "editorial" },
  { src: "/images/accueil/mosaique-04.jpg", alt: "Première danse", categorie: "mariage" },
  { src: "/images/portfolio/11.jpg", alt: "Regards complices", categorie: "couples" },
  { src: "/images/portfolio/12.jpg", alt: "Composition graphique", categorie: "editorial" },
];

export const categoriesPortfolio = [
  { id: "tout", label: "Tout" },
  { id: "mariage", label: "Mariage" },
  { id: "couples", label: "Couples" },
  { id: "editorial", label: "Éditorial" },
];

/* --- Mariages (reportages) --------------------------------------------------
   ⚠️ EXPORT RETIRÉ, ET CE N'EST PAS UN OUBLI.

   Il valait `[]`, et aucune route `app/mariages/` n'a jamais existé. Pourtant
   `app/sitemap.js` annonçait `/mariages` à Google et `app/page.jsx` fabriquait
   des liens `/mariages/<slug>` : des 404 présentés comme des pages. Le README
   affirmait même que ces pages étaient « créées automatiquement ».

   Les 27 images de `public/images/mariages/` (3 reportages de démonstration à
   17-21 Ko) n'étaient référencées nulle part : supprimées.

   À reconstruire quand il y aura de vrais reportages à publier — route,
   contenu et entrées de sitemap ensemble, pas l'un sans les autres.
   ------------------------------------------------------------------------- */

/* --- Tarifs ------------------------------------------------------------------
   ⚠️ LES FORMULES, LES SUPPLÉMENTS ET LA FAQ NE SONT PLUS ICI.

     · formules et suppléments → content/offres.ts  (montants en CENTIMES)
     · FAQ                     → content/faq.ts     (source unique)

   Ils vivaient en double : les prix étaient des chaînes (« 1300€ »),
   inexploitables pour un calcul, et la FAQ de ce fichier contredisait celle de
   app/faq/page.jsx sur le délai de livraison et le nombre de photos.
   ------------------------------------------------------------------------- */
export const tarifs = {
  intro:
    "Chaque mariage est unique : les formules ci-dessous sont des points de départ, que nous affinons ensemble selon votre journée. Un devis précis vous est remis après notre premier échange.",
  deroulement: [
    { titre: "Premier échange", texte: "Un appel ou un café pour faire connaissance, comprendre votre journée et vérifier ma disponibilité." },
    { titre: "Réservation", texte: "Un contrat clair et un acompte réservent votre date. À partir de là, elle est à vous." },
    { titre: "Préparation", texte: "Quelques semaines avant le jour J, nous affinons ensemble le déroulé, les lieux et les moments qui comptent." },
    { titre: "Le jour J", texte: "Je suis là, discret et attentif, du début à la fin. Vous vivez votre journée — je m'occupe du reste." },
    { titre: "La livraison", texte: "Sous 13 à 15 jours, vous recevez votre galerie complète, retouchée avec soin, en haute définition." },
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
  image: "/images/a-propos/portrait.jpg",
  titre: "Racontez-moi votre histoire",
  texte:
    "Une date, un lieu, une envie — dites-m'en un peu plus sur vous. Je réponds personnellement à chaque message, en général sous 48 heures.",
  adresse: "Paris, France",
  zone: "Disponible partout en France et à l'international",
  lienCarte: "https://maps.google.com/?q=Paris,France",
};
