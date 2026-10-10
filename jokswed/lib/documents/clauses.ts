import "server-only";

/* =============================================================================
   CLAUSES CONTRACTUELLES — CONDITIONNÉES, PAS SUBSTITUÉES
   -----------------------------------------------------------------------------
   ⚠️ CE N'EST PAS UN LONG TEXTE OÙ L'ON REMPLACE DES MOTS.

   Un contrat construit par substitution finit toujours par affirmer qu'un
   album est inclus dans une formule qui n'en comprend pas. Chaque article est
   donc une SECTION avec sa propre condition d'inclusion, évaluée sur ce que
   la formule comprend réellement.

   Les textes reprennent le modèle `Contrat Kimberly & Jérémy.pdf`. Les
   variables sont interpolées ; la structure, elle, est fixe.

   ⚠️ CE FICHIER N'EST PAS UNE VALIDATION JURIDIQUE.
   Il reproduit des clauses que tu utilises déjà. Toute évolution de fond —
   délais, pénalités, médiation — relève d'une relecture par un juriste, pas
   d'une décision d'implémentation.
   ============================================================================= */

export interface ContexteClause {
  /** Ce que la formule comprend réellement, d'après le catalogue. */
  albumInclus: boolean;
  coffretInclus: boolean;
  cleUsbIncluse: boolean;
  seanceEngagementIncluse: boolean;
  seanceCoupleJourJIncluse: boolean;
  videoIncluse: boolean;
  /** Un aperçu avant solde n'a de sens que s'il reste un solde à régler. */
  apercuAvantSolde: boolean;
  nombreEcheances: number;
}

export interface Clause {
  cle: string;
  titre: string;
  /** `null` = toujours incluse. */
  condition?: (c: ContexteClause) => boolean;
  corps: (v: Record<string, string>) => string[];
}

/* Les variables disponibles dans les corps de clause. */
export type VariablesContrat = Record<string, string>;

export const CLAUSES: Clause[] = [
  {
    cle: "objet",
    titre: "ARTICLE 1 - OBJET ET ÉTENDUE DE LA PRESTATION",
    corps: (v) => [
      `Le Photographe s'engage à réaliser la prestation « ${v.formule} » pour un montant ` +
        `total de ${v.totalTtc} TTC${v.detailTva}.`,
      `La prestation comprend jusqu'à ${v.duree} de présence le ${v.dateMariage}. ` +
        `Sont inclus : ${v.inclusions}.`,
      `Les frais de déplacement liés au mariage${v.lieuxPhrase} sont inclus dans le prix ` +
        `convenu. La prestation porte exclusivement sur la photographie ; aucune prestation ` +
        `vidéo n'est incluse.`,
    ],
  },
  {
    cle: "paiement",
    titre: "ARTICLE 2 - RÉSERVATION ET MODALITÉS DE PAIEMENT",
    corps: (v) => [
      `La réservation n'est définitive qu'après signature du devis et du présent contrat ` +
        `puis encaissement du premier versement de ${v.acompte} TTC. Ce premier versement ` +
        `est expressément qualifié d'acompte et matérialise l'engagement ferme des parties, ` +
        `sous réserve des droits impératifs du consommateur.`,
      v.versementsIntermediaires,
      `Le solde de ${v.solde} TTC est exigible ${v.conditionSolde}. Aucun téléchargement ` +
        `de la galerie complète en haute définition ni livraison des supports physiques ne ` +
        `sont exigibles avant paiement intégral.`,
    ].filter(Boolean),
  },
  {
    cle: "annulation-clients",
    titre: "ARTICLE 3 - ANNULATION PAR LES CLIENTS",
    corps: () => [
      "Hors exercice valable d'un droit légal de rétractation, cas de force majeure ou " +
        "disposition légale impérative contraire, toute annulation demandée par les Clients " +
        "doit être notifiée par écrit.",
      "En cas d'annulation à l'initiative des Clients, l'acompte déjà versé demeure acquis " +
        "au Photographe au titre de l'immobilisation de la date, sous réserve des " +
        "dispositions légales impératives applicables et du pouvoir du juge de modérer " +
        "toute clause pénale manifestement excessive ou dérisoire.",
      "Les sommes éventuellement versées au-delà de l'acompte sont remboursées, sous " +
        "déduction des prestations déjà exécutées et des frais spécifiquement engagés avec " +
        "l'accord des Clients.",
    ],
  },
  {
    cle: "report",
    titre: "ARTICLE 4 - REPORT DU MARIAGE",
    corps: () => [
      "En cas de report demandé par les Clients, l'acompte peut être transféré sur une " +
        "nouvelle date si le Photographe est disponible. La nouvelle date, les horaires et " +
        "toute adaptation éventuelle du prix font l'objet d'un écrit accepté par les parties.",
      "Si le Photographe n'est pas disponible à la nouvelle date, les parties recherchent " +
        "une solution amiable. À défaut, les règles relatives à l'annulation s'appliquent, " +
        "sauf force majeure ou disposition légale impérative contraire.",
    ],
  },
  {
    cle: "empechement",
    titre: "ARTICLE 5 - ANNULATION OU EMPÊCHEMENT DU PHOTOGRAPHE",
    corps: () => [
      "En cas d'empêchement imputable au Photographe, hors force majeure, celui-ci en " +
        "informe les Clients dans les meilleurs délais et peut proposer un photographe de " +
        "remplacement de niveau professionnel comparable. Le remplacement reste soumis à " +
        "l'accord des Clients.",
      "À défaut de remplacement accepté et si la prestation ne peut être exécutée, les " +
        "sommes versées au titre des prestations non réalisées sont remboursées. Les " +
        "éventuels droits à indemnisation restent régis par le droit commun applicable.",
    ],
  },
  {
    cle: "retractation",
    titre: "ARTICLE 6 - DROIT DE RÉTRACTATION LORSQU'IL EST APPLICABLE",
    corps: () => [
      "Lorsque le contrat est conclu à distance ou hors établissement et que la loi ouvre " +
        "un droit de rétractation, les Clients disposent d'un délai de 14 jours à compter " +
        "de la conclusion du contrat pour l'exercer, sans avoir à motiver leur décision, " +
        "sous réserve des exceptions légales. Un formulaire type figure en annexe.",
      "Si les Clients demandent expressément qu'une prestation commence avant l'expiration " +
        "de ce délai, les règles légales relatives au paiement des services déjà exécutés " +
        "demeurent applicables.",
    ],
  },
  {
    cle: "apercu-galerie",
    titre: "ARTICLE 7 - APERÇU, SOLDE ET GALERIE NUMÉRIQUE",
    corps: (v) => [
      "Le Photographe vise la finalisation de la galerie dans un délai indicatif de 13 à " +
        "15 jours après le mariage, sous réserve d'un cas de force majeure, d'une " +
        "difficulté technique majeure ou d'un volume de travail exceptionnel dûment justifié.",
      v.phraseApercu,
      `Après encaissement du solde de ${v.solde} TTC, la galerie numérique complète est ` +
        `débloquée en haute définition dans les meilleurs délais. Les Clients sont ` +
        `responsables de la sauvegarde de leurs fichiers après téléchargement.`,
    ].filter(Boolean),
  },
  {
    cle: "tri-retouche",
    titre: "ARTICLE 8 - TRI, RETOUCHE ET STYLE ARTISTIQUE",
    corps: () => [
      "Le choix des photographies livrées relève du savoir-faire et de la ligne artistique " +
        "du Photographe. Sont écartés les tests, doublons manifestes, images techniquement " +
        "inutilisables ou ne correspondant pas au niveau de qualité attendu.",
      "La prestation garantit un minimum de 800 photographies finales retouchées. Les " +
        "fichiers RAW, fichiers de travail, calques et versions non finalisées ne sont pas " +
        "livrés. Les Clients reconnaissent avoir choisi le Photographe en connaissance de " +
        "son univers visuel et de sa manière de traiter les images.",
    ],
  },
  {
    /* ⚠️ L'ARTICLE QUI MOTIVE TOUTE CETTE MÉCANIQUE.
       La Formule 1 ne comprend AUCUN album : affirmer le contraire créerait
       une obligation que la prestation vendue ne couvre pas. La clause ne
       s'écrit donc que si un album figure réellement dans la formule. */
    cle: "album",
    titre: "ARTICLE 9 - ALBUM ET SUPPORTS LIVRÉS",
    condition: (c) => c.albumInclus,
    corps: (v) => [
      `${v.descriptionAlbum} sont inclus dans la ${v.formuleCourte}.`,
      "La fabrication de l'album peut être lancée après règlement intégral de la " +
        "prestation et après validation par les Clients de la sélection des photographies, " +
        "de la maquette et des éléments de personnalisation. Le délai de fabrication, " +
        "généralement d'environ un mois, est indicatif et dépend du laboratoire ou de " +
        "l'atelier fournisseur ; il est distinct du délai de livraison de la galerie " +
        "numérique.",
      "Une fois la maquette ou les éléments de personnalisation validés et la fabrication " +
        "lancée, toute modification demandée par les Clients peut être facturée si elle " +
        "entraîne un coût auprès du fournisseur.",
    ],
  },
  {
    /* Variante pour une formule SANS album : on ne laisse pas un trou, on dit
       ce qui est réellement livré. */
    cle: "supports-sans-album",
    titre: "ARTICLE 9 - SUPPORTS LIVRÉS",
    condition: (c) => !c.albumInclus,
    corps: (v) => [
      `La prestation ne comprend pas d'album. Les photographies sont livrées via la ` +
        `galerie privée en ligne${v.mentionCleUsb}.`,
      "Un album peut être commandé séparément à tout moment : il fait alors l'objet d'un " +
        "devis distinct et d'un délai de fabrication propre.",
    ],
  },
  {
    cle: "seance-engagement",
    titre: "ARTICLE 9 BIS - SÉANCE ENGAGEMENT",
    condition: (c) => c.seanceEngagementIncluse,
    corps: () => [
      "Une séance engagement est comprise dans la formule retenue. Elle se déroule avant " +
        "le mariage, à une date et dans un lieu convenus entre les parties, et fait l'objet " +
        "d'une livraison distincte de celle du reportage de mariage.",
      "Si la séance ne peut avoir lieu du fait des Clients, elle n'ouvre droit à aucun " +
        "remboursement ni à aucune compensation sur le prix de la prestation.",
    ],
  },
  {
    cle: "deroulement",
    titre: "ARTICLE 10 - DÉROULEMENT, ACCÈS ET COOPÉRATION",
    corps: () => [
      "Les Clients communiquent au Photographe, dans un délai raisonnable avant le mariage, " +
        "le planning détaillé définitif, les horaires, toute modification d'adresse, les " +
        "coordonnées des personnes de contact et toute restriction imposée par le lieu ou " +
        "un autre prestataire.",
      "Les Clients veillent à ce que le Photographe puisse travailler dans des conditions " +
        "normales de sécurité et d'accès. Le Photographe ne peut être tenu responsable " +
        "d'images impossibles à réaliser en raison d'un retard important, d'une " +
        "interdiction du lieu, d'un comportement de tiers, d'un éclairage imposé, d'une " +
        "modification du programme non communiquée ou de circonstances extérieures " +
        "échappant raisonnablement à son contrôle.",
    ],
  },
  {
    cle: "propriete",
    titre: "ARTICLE 11 - PROPRIÉTÉ INTELLECTUELLE ET DROIT À L'IMAGE",
    corps: (v) => [
      "Le Photographe demeure titulaire des droits d'auteur attachés aux photographies. " +
        "Les Clients bénéficient d'un droit d'usage privé, familial et non commercial des " +
        "fichiers livrés, comprenant notamment le téléchargement, la sauvegarde, " +
        "l'impression personnelle et le partage à titre privé.",
      "Toute utilisation commerciale, vente, cession à une marque, campagne publicitaire " +
        "ou modification substantielle des photographies nécessite l'accord écrit préalable " +
        "du Photographe.",
      `Le droit à l'image des Clients reste distinct du droit d'auteur. La publication par ` +
        `${v.prestataireNom} sur son portfolio, son site internet, ses réseaux sociaux ou ` +
        `ses supports promotionnels n'est autorisée que si les Clients donnent leur accord ` +
        `ci-dessous :`,
      "[  ] J'autorise la publication de photographies sur lesquelles les mariés sont " +
        "reconnaissables à des fins de portfolio et de promotion.",
      "[  ] Je n'autorise pas cette utilisation.",
      "Une autorisation donnée peut être retirée pour les utilisations futures par demande " +
        "écrite, sans remettre en cause les utilisations licitement réalisées avant le retrait.",
    ],
  },
  {
    cle: "force-majeure",
    titre: "ARTICLE 12 - FORCE MAJEURE",
    corps: () => [
      "Aucune partie ne peut être tenue responsable d'un manquement résultant d'un " +
        "événement répondant aux conditions légales de la force majeure. Lorsque " +
        "l'empêchement est temporaire, les parties privilégient un report ou une solution " +
        "de remplacement. Lorsqu'il est définitif, les conséquences financières sont " +
        "réglées conformément aux dispositions légales applicables et aux prestations " +
        "effectivement exécutées.",
    ],
  },
  {
    cle: "donnees",
    titre: "ARTICLE 13 - DONNÉES PERSONNELLES",
    corps: (v) => [
      "Les informations recueillies sont utilisées pour la gestion du devis, du contrat, " +
        "de la facturation, de la galerie, des livrables et de la relation client. Elles " +
        "sont conservées pendant les durées nécessaires à l'exécution du contrat et au " +
        "respect des obligations légales du Photographe.",
      `Les Clients peuvent exercer leurs droits d'accès, de rectification, d'effacement ou ` +
        `d'opposition lorsqu'ils sont applicables en écrivant à ${v.prestataireEmail}.`,
    ],
  },
  {
    cle: "mediation",
    titre: "ARTICLE 14 - RÉCLAMATIONS, MÉDIATION ET DROIT APPLICABLE",
    corps: (v) => [
      "Le contrat est soumis au droit français. En cas de difficulté, les parties " +
        "recherchent en priorité une solution amiable.",
      "Après une réclamation écrite préalable restée sans solution, les Clients " +
        "consommateurs peuvent recourir gratuitement au médiateur de la consommation " +
        "désigné par le Photographe.",
      `Médiateur de la consommation désigné : ${v.mediateurNom}`,
      `Adresse / site internet du médiateur : ${v.mediateurUrl}`,
      "À défaut d'accord amiable ou de médiation, chacune des parties peut saisir la " +
        "juridiction compétente selon les règles légales applicables. Aucune clause du " +
        "présent contrat ne prive le consommateur de ses droits impératifs.",
    ],
  },
  {
    cle: "acceptation",
    titre: "ARTICLE 15 - ACCEPTATION ET ENSEMBLE CONTRACTUEL",
    corps: () => [
      "Le devis signé, le présent contrat/CGV et, le cas échéant, les annexes ou avenants " +
        "signés forment un ensemble contractuel. Toute modification substantielle de la " +
        "prestation, de la date, des horaires ou de l'échéancier doit faire l'objet d'un " +
        "écrit accepté par les parties.",
      "Les Clients reconnaissent avoir pu prendre connaissance des informations " +
        "essentielles relatives à la prestation, au prix, au paiement, à la livraison, à " +
        "l'annulation, au report et aux droits qui leur sont applicables avant la signature.",
    ],
  },
];

/** Les clauses retenues pour un contexte donné, dans l'ordre. */
export function clausesApplicables(contexte: ContexteClause): Clause[] {
  return CLAUSES.filter((c) => !c.condition || c.condition(contexte));
}

/**
 * Déduit le contexte des clauses depuis les inclusions RÉELLES de la formule.
 *
 * ⚠️ ON LIT LE CATALOGUE, ON NE DEVINE PAS.
 * « Formule 3 » ne signifie rien pour le contrat : ce qui compte, c'est
 * qu'elle comprenne un album, un coffret et une séance engagement. Si tu
 * modifies une formule demain, les clauses suivent sans toucher au code.
 */
export function contexteDepuisInclusions(
  inclusions: readonly string[],
  nombreEcheances: number,
): ContexteClause {
  const contient = (motif: RegExp) => inclusions.some((i) => motif.test(i));
  return {
    albumInclus: contient(/album/i),
    coffretInclus: contient(/coffret/i),
    cleUsbIncluse: contient(/cl[ée] usb/i),
    seanceEngagementIncluse: contient(/s[ée]ance engagement/i),
    seanceCoupleJourJIncluse: contient(/s[ée]ance couple/i),
    videoIncluse: contient(/vid[ée]o/i),
    apercuAvantSolde: nombreEcheances > 1,
    nombreEcheances,
  };
}
