/* =============================================================================
   JOKSWED — CATALOGUE DES OFFRES
   -----------------------------------------------------------------------------
   Source UNIQUE des formules et des suppléments. L'accueil, la page Tarifs, le
   formulaire et — en V5 — les devis, contrats et factures lisent ce fichier.
   Modifier un prix ici le modifie partout.

   ⚠️ LES MONTANTS SONT EN CENTIMES, ENTIERS, TOUTES TAXES COMPRISES.
      1 300,00 € TTC s'écrit 130000. Jamais 1300.0, jamais "1300€".

      Pourquoi : 0.1 + 0.2 ne fait pas 0.3 en virgule flottante. Sur un
      échéancier en trois fois, l'erreur d'arrondi devient un écart comptable.
      Les devis existants raisonnent déjà en TTC (1 300,00 € TTC, dont 216,67 €
      de TVA à 20 %), donc le prix public affiché est un TTC.

   ⚠️ CE FICHIER EST UN AMORÇAGE, PAS LA SOURCE DÉFINITIVE.
      En V5, ces lignes passent en base (tables `formules`, `supplements`,
      `supplement_compatibilites`) et deviennent administrables sans toucher au
      code. La forme ci-dessous est déjà celle du schéma : la migration se
      résume à une insertion.
   ============================================================================= */

/** Un supplément dont le tarif n'est pas encore arrêté ne porte pas de prix. */
export type TypeTarif = "fixe" | "horaire" | "quantite" | "sur_devis" | "inclus";

/**
 * Comment un supplément se comporte face à une formule donnée.
 *
 * `inclus` est la pièce maîtresse : il interdit de facturer deux fois une
 * prestation déjà comprise dans la formule. La séance engagement est incluse
 * dans la Formule 3 — elle s'affiche « incluse », et elle compte pour 0.
 */
export type StatutCompatibilite = "proposable" | "inclus" | "incompatible";

export interface Formule {
  readonly cle: string;
  readonly nom: string;
  readonly surnom: string;
  readonly prixCents: number;
  readonly dureeMinutes: number;
  readonly dureeTexte: string;
  readonly description: string;
  readonly inclus: readonly string[];
  readonly misEnAvant: boolean;
  readonly ordre: number;
  readonly visible: boolean;
  readonly visibleAccueil: boolean;
}

export interface Supplement {
  readonly cle: string;
  readonly nom: string;
  readonly description: string;
  readonly typeTarif: TypeTarif;
  /** `null` dès que `typeTarif` vaut `sur_devis` ou `inclus`. */
  readonly prixCents: number | null;
  readonly unite: string | null;
  /** Renseigné quand la prestation est exécutée par un partenaire. */
  readonly executantPartenaire: string | null;
  readonly compatibilites: Readonly<Record<string, StatutCompatibilite>>;
  readonly ordre: number;
  readonly visible: boolean;
}

/* ───────────────────────────── LES TROIS FORMULES ─────────────────────────────
   Noms, surnoms, prix et inclusions reconduits à l'identique depuis le site
   livré. Deux précisions viennent du devis et du contrat signés, qui engagent
   déjà JoksWed et étaient absents du site :

     · « minimum 800 photographies retouchées » (devis, et article 8 du contrat) ;
     · « déplacements en France métropolitaine inclus » (devis).

   Elles ne sont donc pas des ajouts commerciaux : ce sont des engagements
   contractuels que le site passait sous silence.
   --------------------------------------------------------------------------- */
export const formules: readonly Formule[] = [
  {
    cle: "formule-1",
    nom: "Formule 1",
    surnom: "L'essentielle✨",
    prixCents: 100_000,
    dureeMinutes: 8 * 60,
    dureeTexte: "Jusqu'à 8 h de présence",
    description: "Le cœur de votre journée, des préparatifs à l'ouverture du bal.",
    inclus: [
      "Reportage complet du mariage",
      "Galerie privée en ligne",
      "Minimum 800 photographies retouchées en haute définition",
      "Clé USB personnalisée",
      "Déplacements en France métropolitaine inclus",
    ],
    misEnAvant: false,
    ordre: 1,
    visible: true,
    visibleAccueil: true,
  },
  {
    cle: "formule-2",
    nom: "Formule 2",
    surnom: "Signature🤍",
    prixCents: 130_000,
    dureeMinutes: 12 * 60,
    dureeTexte: "Jusqu'à 12 h de présence",
    description: "Votre journée entière, des préparatifs à la soirée dansante.",
    inclus: [
      "Reportage complet de la journée",
      "Galerie privée en ligne",
      "Minimum 800 photographies retouchées en haute définition",
      "Séance couple le jour J",
      "Clé USB personnalisée",
      "Album premium 25 × 25 cm",
      "Couverture en cuir personnalisée",
      "Déplacements en France métropolitaine inclus",
    ],
    misEnAvant: true,
    ordre: 2,
    visible: true,
    visibleAccueil: true,
  },
  {
    cle: "formule-3",
    nom: "Formule 3",
    surnom: "Prestige👑",
    prixCents: 160_000,
    dureeMinutes: 14 * 60,
    dureeTexte: "Jusqu'à 14 h de présence + séance engagement",
    description: "L'expérience la plus complète pour raconter votre histoire.",
    inclus: [
      "Journée complète jusqu'aux temps forts de la soirée",
      "Séance engagement avant le mariage",
      "Galerie privée en ligne",
      "Minimum 800 photographies retouchées en haute définition",
      "Clé USB personnalisée",
      "Grand album premium 30 × 30 cm",
      "Couverture en cuir personnalisée",
      "Coffret en cuir assorti",
      "Déplacements en France métropolitaine inclus",
    ],
    misEnAvant: false,
    ordre: 3,
    visible: true,
    visibleAccueil: true,
  },
];

/* ─────────────────────────────── LES SUPPLÉMENTS ──────────────────────────────
   ⚠️ AUCUN PRIX N'EST INVENTÉ ICI.

   Le site livré ne chiffrait aucune option, et aucun tarif d'option ne m'a été
   communiqué. Tous les suppléments sont donc en `sur_devis`, et la contrainte
   du schéma (`prix_requis_sauf_devis`) impose `prixCents: null` dans ce cas.

   Conséquence voulue : le récapitulatif du formulaire ne pourra pas afficher un
   total définitif tant qu'un supplément non chiffré est retenu. Il affichera le
   montant de la formule et la liste des lignes à chiffrer. Mieux vaut un total
   honnêtement incomplet qu'un total faux.
   --------------------------------------------------------------------------- */
export const supplements: readonly Supplement[] = [
  {
    cle: "videaste",
    nom: "Vidéaste partenaire",
    description:
      "Un film de votre mariage, réalisé par un vidéaste partenaire. " +
      "La prestation vidéo est facturée séparément par son entreprise.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    executantPartenaire: "videaste-partenaire",
    // Compatible avec les trois formules : aucune ne comprend de vidéo.
    // L'article 1 du contrat le dit explicitement : « aucune prestation vidéo
    // n'est incluse ».
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 1,
    visible: true,
  },
  {
    cle: "seance-engagement",
    nom: "Séance engagement",
    description:
      "Une séance couple avant le mariage, pour se rencontrer et apprivoiser l'objectif.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    executantPartenaire: null,
    // ⚠️ LE CAS QUI MOTIVE TOUTE CETTE TABLE.
    // La Formule 3 comprend déjà la séance engagement. Marquée `inclus`, elle
    // s'affiche « incluse dans votre formule » et compte pour 0 € — sans
    // qu'aucune condition n'ait à être écrite à la main dans le calculateur.
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "inclus",
    },
    ordre: 2,
    visible: true,
  },
  {
    cle: "album-supplementaire",
    nom: "Album supplémentaire",
    description:
      "Un second album en cuir personnalisé, parfait pour offrir à vos proches. " +
      "S'ajoute à l'album déjà compris dans les formules 2 et 3.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 3,
    visible: true,
  },
  {
    cle: "cle-usb-supplementaire",
    nom: "Clé USB supplémentaire",
    description:
      "Une clé USB personnalisée de plus. Les trois formules en comprennent déjà une.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 4,
    visible: true,
  },
  {
    cle: "heure-supplementaire",
    nom: "Heure supplémentaire",
    description:
      "Une heure de présence au-delà de la durée comprise dans votre formule.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: "heure",
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 5,
    visible: true,
  },
  {
    cle: "second-photographe",
    nom: "Deuxième photographe",
    description:
      "Un second opérateur à mes côtés, pour couvrir deux lieux ou deux moments simultanés.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 6,
    visible: true,
  },
  {
    cle: "jour-dapres",
    nom: "Jour d'après (day after)",
    description: "Une séance libre le lendemain, en tenue de mariés, là où vous voulez.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 7,
    visible: true,
  },
  {
    cle: "tirages-exposition",
    nom: "Tirages d'exposition",
    description: "Tirages grand format, contrecollés et prêts à accrocher.",
    typeTarif: "sur_devis",
    prixCents: null,
    unite: "tirage",
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 8,
    visible: true,
  },
  {
    cle: "photobooth-360",
    nom: "Photobooth 360",
    description:
      "Une plateforme rotative qui filme vos invités à 360°, avec partage immédiat "
      + "des vidéos. Installée et animée pendant la soirée.",
    /* ⚠️ `sur_devis`, ET `prixCents: null` — AUCUN TARIF NE M'A ÉTÉ DONNÉ.
       Inventer un prix ici le ferait apparaître sur le site, dans l'instantané
       de la demande, puis sur un devis : une promesse chiffrée que personne
       n'a jamais faite. La prestation est donc proposable et comptée « sur
       devis » tant qu'un montant n'est pas saisi sur la fiche du dossier.
       Le catalogue gère déjà ce cas — `tirages-exposition` fonctionne ainsi. */
    typeTarif: "sur_devis",
    prixCents: null,
    unite: null,
    /* ⚠️ PAS D'EXÉCUTANT PARTENAIRE DÉCLARÉ ICI.
       Ce champ déclenche la proposition AUTOMATIQUE au dépôt (voir
       `deposerDemande`) : un simple prospect serait transmis au prestataire
       photobooth avant toute confirmation. L'affectation se fait depuis la
       fiche, une fois le dossier confirmé. */
    executantPartenaire: null,
    compatibilites: {
      "formule-1": "proposable",
      "formule-2": "proposable",
      "formule-3": "proposable",
    },
    ordre: 9,
    visible: true,
  },
];

/* ──────────────────────── LE VIDÉASTE PARTENAIRE ────────────────────────────
   Texte de présentation fourni le 9 octobre 2026, qui remplace l'ancien
   « BRIEF » (celui qui parlait de « Focus Mariés »). Reproduit mot pour mot.

   ⚠️ NI SON TÉLÉPHONE NI SON ADRESSE E-MAIL NE FIGURENT ICI.
      Ils m'ont été communiqués pour configurer son compte collaborateur, pas
      pour être publiés. Ils vivront en base, dans sa fiche d'entreprise.
   --------------------------------------------------------------------------- */
export const videastePartenaire = {
  cle: "videaste-partenaire",
  nom: "Yvann Cretinoir",
  metier: "Vidéaste et créateur de contenu",
  presentation:
    "Je suis Yvann Cretinoir, spécialisé dans la création de contenu. Je privilégie des " +
    "films de mariage de 3 à 5 minutes : un format court, dynamique et pensé pour être " +
    "regardé facilement, encore et encore.\n" +
    "L'objectif est de raconter votre mariage en capturant les moments forts, les émotions " +
    "et l'ambiance de cette journée, sans perdre l'essentiel dans un film trop long.\n" +
    "Ce format est également idéal pour partager facilement votre film avec vos proches ou " +
    "sur vos réseaux sociaux, tout en conservant un véritable souvenir de votre journée.",
  lienPortfolio:
    "https://youtube.com/playlist?list=PL9TT-zVmhlkWUND7_QD96A1DUloDffp6q",
  /**
   * ⚠️ AUCUNE VIDÉO D'APERÇU N'A ÉTÉ FOURNIE.
   *
   * Je l'ai cherchée dans Jokswed-Site-main.zip et dans les pièces jointes :
   * elle n'y est pas. L'emplacement est prêt ; tant qu'il vaut `null`, la carte
   * vidéo affichera le lien vers les réalisations, et pas un lecteur vide.
   * Je ne remplace pas l'aperçu attendu par une autre vidéo.
   */
  apercuVideo: null as string | null,
  apercuMiniature: null as string | null,
} as const;

/* ──────────────────────────────── UTILITAIRES ─────────────────────────────── */

/** « 1 300 € » — format public, sans décimales quand le montant est rond. */
export function formaterPrix(cents: number): string {
  const euros = cents / 100;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: euros % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(euros);
}

export function formuleParCle(cle: string): Formule | undefined {
  return formules.find((f) => f.cle === cle);
}

export function statutSupplement(
  supplement: Supplement,
  formuleCle: string | null,
): StatutCompatibilite {
  if (!formuleCle) return "proposable";
  return supplement.compatibilites[formuleCle] ?? "incompatible";
}

export interface Devis {
  readonly formuleCents: number;
  /** Somme des suppléments dont le tarif est connu. */
  readonly supplementsCents: number;
  /** Total des lignes chiffrables UNIQUEMENT. */
  readonly totalChiffrableCents: number;
  /** Suppléments retenus dont le prix reste à établir. */
  readonly aChiffrer: readonly string[];
  /** Suppléments déjà comprises dans la formule : affichées, jamais facturées. */
  readonly dejaIncluses: readonly string[];
  /** `false` dès qu'une ligne reste à chiffrer : interdit d'afficher un total ferme. */
  readonly totalDefinitif: boolean;
}

/**
 * Chiffrage indicatif.
 *
 * ⚠️ CETTE FONCTION NE FAIT PAS AUTORITÉ.
 *
 * Elle sert à l'affichage. Le calcul qui engage JoksWed sera refait côté
 * serveur en V4, à partir du catalogue en base, parce qu'un prix envoyé par le
 * navigateur est un prix qu'on peut modifier avant l'envoi.
 */
export function chiffrer(
  formuleCle: string | null,
  supplementsCles: readonly string[],
): Devis {
  const formule = formuleCle ? formuleParCle(formuleCle) : undefined;
  const formuleCents = formule?.prixCents ?? 0;

  let supplementsCents = 0;
  const aChiffrer: string[] = [];
  const dejaIncluses: string[] = [];

  for (const cle of supplementsCles) {
    const supplement = supplements.find((s) => s.cle === cle);
    if (!supplement) continue;

    const statut = statutSupplement(supplement, formuleCle);

    // Déjà comprise dans la formule : on l'affiche, on ne l'ajoute pas.
    if (statut === "inclus") {
      dejaIncluses.push(supplement.nom);
      continue;
    }
    if (statut === "incompatible") continue;

    if (supplement.typeTarif === "sur_devis" || supplement.prixCents === null) {
      aChiffrer.push(supplement.nom);
      continue;
    }
    supplementsCents += supplement.prixCents;
  }

  return {
    formuleCents,
    supplementsCents,
    totalChiffrableCents: formuleCents + supplementsCents,
    aChiffrer,
    dejaIncluses,
    totalDefinitif: aChiffrer.length === 0,
  };
}
