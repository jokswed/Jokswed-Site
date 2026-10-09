import "server-only";
import {
  DocumentPdf, LARGEUR, BLANC, ENCRE, GRIS, GRIS_BOITE, BORDURE,
} from "./pdf";
import { clausesApplicables, type ContexteClause } from "./clauses";
import type { IdentiteDocument } from "./gabarit-commercial";

/* =============================================================================
   GABARIT DU CONTRAT — REPRODUIT DEPUIS `Contrat Kimberly & Jérémy.pdf`
   -----------------------------------------------------------------------------
   Structure relevée sur le modèle (4 pages, LibreOffice, LiberationSans —
   métriquement identique à Helvetica) :

     CONTRAT (grand titre)
     JoksWed
     CONTRAT DE PRESTATION PHOTOGRAPHIQUE & CONDITIONS GÉNÉRALES
     Date du contrat : …
     ───────────────────────────────────────────────────────────
     ENTRE LES SOUSSIGNÉS
     ┌ boîte grise ───────────────┬──────────────────────────┐
     │ LE PHOTOGRAPHE             │ LES CLIENTS              │
     └────────────────────────────┴──────────────────────────┘
     INFORMATIONS DU MARIAGE  (puces •, en gras)
     DEVIS RETENU
     ARTICLE 1 … ARTICLE 15
     SIGNATURES
     ANNEXE - FORMULAIRE TYPE DE RÉTRACTATION
     ─ pied répété : JoksWed - RAHARISON JOHN - SIRET …

   ⚠️ LE TEXTE NE DOIT JAMAIS ÊTRE COUPÉ ENTRE DEUX PAGES.
   Chaque bloc demande sa place avant d'écrire, et un titre d'article reste
   solidaire de son premier paragraphe : « ARTICLE 7 » seul en bas de page
   serait laid et, sur un contrat, douteux.
   ============================================================================= */

const MARGE = 60;
const UTILE = LARGEUR - MARGE * 2;

export interface InstantaneContrat {
  numero: string | null;
  dateContrat: string;
  prestataire: IdentiteDocument;
  clients: { nom: string; telephone?: string | null }[];
  emailClient?: string | null;
  adresseClient?: string | null;
  mariage: {
    date: string;
    ceremonie?: string | null;
    reception?: string | null;
    formule: string;
    duree: string;
  };
  devisReference?: string | null;
  totalTtc: string;
  detailTva: string;
  acompte: string;
  solde: string;
  echeances: { libelle: string; montant: string }[];
  inclusions: string[];
  contexte: ContexteClause;
  mediateurNom: string;
  mediateurUrl: string;
  brouillon?: boolean;
}

function titreSection(doc: DocumentPdf, texte: string) {
  doc.assurer(34);
  doc.page().texte(MARGE, doc.y, texte, { taille: 9.5, police: "grasse", couleur: ENCRE });
  doc.sauter(14);
}

/* Relevé sur le modèle : interligne 1,34 et 3,5 pt entre deux paragraphes.
   À 1,45 / 6 pt, le contrat respirait trop et poussait deux articles sur la
   page suivante — même texte, mais une densité qui n'était pas la sienne. */
const INTERLIGNE = 1.34;
const ESPACE_PARAGRAPHE = 3.5;

function paragraphe(doc: DocumentPdf, texte: string, options: { taille?: number } = {}) {
  const taille = options.taille ?? 8.2;
  /* On mesure la hauteur AVANT d'écrire : si le paragraphe ne tient pas, il
     part entier à la page suivante plutôt que d'être coupé au milieu. */
  const lignes = doc.page().paragraphe(MARGE, -10000, UTILE, texte,
    { taille, interligne: INTERLIGNE });
  doc.assurer(lignes + ESPACE_PARAGRAPHE);
  doc.sauter(doc.page().paragraphe(MARGE, doc.y, UTILE, texte, {
    taille, couleur: ENCRE, interligne: INTERLIGNE,
  }) + ESPACE_PARAGRAPHE);
}

export function dessinerContrat(d: InstantaneContrat): Buffer {
  const pied = [
    d.prestataire.nomCommercial,
    d.prestataire.responsable,
    d.prestataire.siret ? `SIRET ${d.prestataire.siret}` : null,
  ].filter(Boolean).join(" - ");

  const doc = new DocumentPdf({ margeHaut: 58, margeBas: 58, pied });

  if (d.brouillon) {
    doc.page().rectangle(0, 0, LARGEUR, 20, [0.96, 0.91, 0.82]);
    doc.page().texte(LARGEUR / 2, 13.5, "BROUILLON — CONTRAT NON ÉMIS, SANS VALEUR", {
      taille: 7, police: "grasse", couleur: [0.55, 0.38, 0.06],
      interlettrage: 1.4, align: "centre",
    });
    doc.sauter(10);
  }

  /* ── En-tête ── */
  doc.sauter(16);
  doc.page().texte(MARGE, doc.y, "CONTRAT", { taille: 38, couleur: ENCRE });
  doc.sauter(36);
  doc.page().texte(MARGE, doc.y, d.prestataire.nomCommercial, { taille: 8.5, couleur: ENCRE });
  doc.sauter(16);
  doc.page().texte(MARGE, doc.y,
    "CONTRAT DE PRESTATION PHOTOGRAPHIQUE & CONDITIONS GÉNÉRALES", {
      taille: 9, police: "grasse", couleur: ENCRE,
    });
  doc.sauter(16);
  doc.page().texte(MARGE, doc.y, "Date du contrat :", {
    taille: 8, police: "grasse", couleur: ENCRE,
  });
  doc.page().texte(MARGE + 74, doc.y, d.dateContrat, { taille: 8, couleur: ENCRE });
  if (d.numero) {
    doc.page().texte(LARGEUR - MARGE, doc.y, d.numero, {
      taille: 8, couleur: GRIS, align: "droite",
    });
  }
  doc.sauter(22);
  doc.page().filet(MARGE, doc.y, UTILE, 0.7, BORDURE);
  doc.sauter(18);

  /* ── Les parties, dans une boîte grise ── */
  titreSection(doc, "ENTRE LES SOUSSIGNÉS");

  const p = d.prestataire;
  const colGauche = [
    `${p.responsable ?? ""} - ${p.nomCommercial}`.replace(/^ - /, ""),
    p.telephone, p.email,
    [p.adresse, p.codePostal && p.ville ? `${p.codePostal} ${p.ville}` : p.ville]
      .filter(Boolean).join(", "),
    [p.siret ? `SIRET : ${p.siret}` : null, p.codeApe ? `Code APE : ${p.codeApe}` : null]
      .filter(Boolean).join(" - "),
  ].filter(Boolean) as string[];

  const colDroite = [
    ...d.clients.map((c) => c.telephone ? `${c.nom} - ${c.telephone}` : c.nom),
    d.emailClient ? `E-mail de contact : ${d.emailClient}` : null,
    d.adresseClient ? `Adresse postale : ${d.adresseClient}` : null,
  ].filter(Boolean) as string[];

  const largeurCol = UTILE / 2 - 18;
  const lignesG = colGauche.flatMap((l) => doc.page().paragraphe(MARGE, -10000, largeurCol, l, { taille: 8 }) / 11.6);
  const hauteurBoite = Math.max(colGauche.length, colDroite.length) * 12 + 34;
  doc.assurer(hauteurBoite + 10);

  doc.page().rectangle(MARGE, doc.y, UTILE, hauteurBoite, GRIS_BOITE);
  doc.page().texte(MARGE + 16, doc.y + 16, "LE PHOTOGRAPHE", {
    taille: 8.5, police: "grasse", couleur: ENCRE,
  });
  doc.page().texte(MARGE + UTILE / 2 + 6, doc.y + 16, "LES CLIENTS", {
    taille: 8.5, police: "grasse", couleur: ENCRE,
  });
  colGauche.forEach((l, i) =>
    doc.page().texte(MARGE + 16, doc.y + 30 + i * 12, l, { taille: 8, couleur: ENCRE }));
  colDroite.forEach((l, i) =>
    doc.page().texte(MARGE + UTILE / 2 + 6, doc.y + 30 + i * 12, l, {
      taille: 8, police: "grasse", couleur: ENCRE,
    }));
  doc.sauter(hauteurBoite + 18);

  /* ── Informations du mariage, en puces ── */
  titreSection(doc, "INFORMATIONS DU MARIAGE");
  const puces = [
    `Date : ${d.mariage.date}.`,
    d.mariage.ceremonie ? `Cérémonie : ${d.mariage.ceremonie}.` : null,
    d.mariage.reception ? `Réception : ${d.mariage.reception}.` : null,
    `Formule retenue : ${d.mariage.formule} - jusqu'à ${d.mariage.duree} de présence.`,
    `Les horaires exacts de début et de fin de présence du Photographe seront arrêtés ` +
      `par écrit avec le planning définitif, dans la limite de ${d.mariage.duree}.`,
  ].filter(Boolean) as string[];

  for (const puce of puces) {
    const hauteur = doc.page().paragraphe(MARGE + 14, -10000, UTILE - 14, puce,
      { taille: 8, interligne: INTERLIGNE });
    doc.assurer(hauteur + 4);
    doc.page().texte(MARGE + 4, doc.y, "•", { taille: 8, couleur: ENCRE });
    doc.sauter(doc.page().paragraphe(MARGE + 14, doc.y, UTILE - 14, puce, {
      taille: 8, police: "grasse", couleur: ENCRE, interligne: INTERLIGNE,
    }) + 3);
  }
  doc.sauter(10);

  /* ── Devis retenu ── */
  titreSection(doc, "DEVIS RETENU");
  const echeancesTexte = d.echeances
    .map((e) => `${e.montant} TTC ${e.libelle}`)
    .join(", ");
  paragraphe(doc,
    `${d.devisReference ? `${d.devisReference} - ` : "Devis final - "}` +
    `${d.mariage.formule} - ${d.totalTtc} TTC - ` +
    `Paiement en ${d.echeances.length} fois : ${echeancesTexte}.`);
  paragraphe(doc,
    "Le devis signé fait partie intégrante du présent contrat. En cas de contradiction, " +
    "le devis signé prévaut pour le prix, l'échéancier et les éléments particuliers de la " +
    "prestation ; le présent contrat et les présentes conditions générales régissent les " +
    "autres conditions d'exécution.");
  doc.sauter(6);

  /* ── Les articles ──
     Chaque titre reste solidaire de son premier paragraphe. */
  const variables: Record<string, string> = {
    formule: d.mariage.formule,
    formuleCourte: d.mariage.formule,
    totalTtc: d.totalTtc,
    detailTva: d.detailTva,
    duree: d.mariage.duree,
    dateMariage: d.mariage.date,
    inclusions: d.inclusions.map(initialeMinuscule).join(", "),
    lieuxPhrase: d.mariage.reception ? ` et à ${d.mariage.reception.split(",")[0]}` : "",
    acompte: d.acompte,
    solde: d.solde,
    versementsIntermediaires: d.echeances.length > 2
      ? `Le deuxième versement de ${d.echeances[1].montant} TTC est exigible à une ` +
        `échéance convenue par écrit avant le mariage.`
      : "",
    conditionSolde: d.contexte.apercuAvantSolde
      ? "après mise à disposition de l'aperçu prévu à l'article 7 et avant le déblocage " +
        "de la galerie complète HD"
      : "à la livraison de la galerie complète",
    phraseApercu: d.contexte.apercuAvantSolde
      ? "Avant règlement du solde, les Clients reçoivent un accès en consultation à un " +
        "aperçu représentant environ un tiers de la totalité des photographies finales. " +
        "Le téléchargement en haute définition est désactivé à ce stade."
      : "",
    descriptionAlbum: decrireAlbum(d.inclusions),
    mentionCleUsb: d.contexte.cleUsbIncluse ? ", ainsi qu'une clé USB personnalisée" : "",
    prestataireNom: d.prestataire.nomCommercial,
    prestataireEmail: d.prestataire.email ?? "",
    mediateurNom: d.mediateurNom,
    mediateurUrl: d.mediateurUrl,
  };

  for (const clause of clausesApplicables(d.contexte)) {
    const corps = clause.corps(variables).filter((c) => c && c.trim());
    if (corps.length === 0) continue;

    /* Le titre ET le premier paragraphe demandent leur place ensemble. */
    const hauteurPremier = doc.page().paragraphe(MARGE, -10000, UTILE, corps[0],
      { taille: 8.2, interligne: INTERLIGNE });
    doc.assurer(hauteurPremier + 30);

    doc.page().texte(MARGE, doc.y, clause.titre, {
      taille: 9, police: "grasse", couleur: ENCRE,
    });
    doc.sauter(13);
    for (const bloc of corps) paragraphe(doc, bloc);
    doc.sauter(5);
  }

  /* ── Signatures ── */
  doc.assurer(190);
  doc.page().texte(MARGE, doc.y, "SIGNATURES", { taille: 9.5, police: "grasse", couleur: ENCRE });
  doc.sauter(16);
  paragraphe(doc,
    "Le devis signé et le présent contrat/CGV forment un ensemble contractuel. Les " +
    "signatures ci-dessous valent acceptation des conditions prévues dans ces documents.");
  doc.sauter(6);
  doc.page().texte(MARGE, doc.y,
    "Fait à : ____________________________________________        Le : ____ / ____ / ________",
    { taille: 8, couleur: ENCRE });
  doc.sauter(26);

  const signataires = [
    ...d.clients.map((c) => c.nom),
    `${d.prestataire.responsable ?? ""} - ${d.prestataire.nomCommercial}`.replace(/^ - /, ""),
  ];
  for (const nom of signataires) {
    doc.assurer(46);
    doc.page().texte(MARGE, doc.y, nom, { taille: 8, police: "grasse", couleur: ENCRE });
    doc.sauter(12);
    doc.page().texte(MARGE, doc.y, "Mention « Lu et approuvé - Bon pour accord »", {
      taille: 8, couleur: ENCRE,
    });
    doc.sauter(12);
    doc.page().texte(MARGE, doc.y,
      "Signature : ________________________________________________", {
        taille: 8, couleur: ENCRE,
      });
    doc.sauter(22);
  }

  /* ── Annexe : formulaire de rétractation ── */
  doc.assurer(220);
  doc.page().texte(MARGE, doc.y, "ANNEXE - FORMULAIRE TYPE DE RÉTRACTATION", {
    taille: 9.5, police: "grasse", couleur: ENCRE,
  });
  doc.sauter(16);
  paragraphe(doc,
    "À utiliser uniquement si un droit légal de rétractation s'applique au contrat et si " +
    "les Clients souhaitent l'exercer.");
  paragraphe(doc,
    `À l'attention de : ${[p.responsable, p.nomCommercial].filter(Boolean).join(" - ")}, ` +
    `${[p.adresse, p.codePostal, p.ville].filter(Boolean).join(" ")} - ${p.email ?? ""}`);
  paragraphe(doc,
    "Je / Nous (*) vous notifie / notifions (*) par la présente ma / notre (*) " +
    "rétractation du contrat portant sur la prestation photographique de mariage " +
    "suivante :");
  for (const ligne of [
    "________________________________________________________________________________",
    "________________________________________________________________________________",
    "Contrat / devis signé le : ____ / ____ / ________",
    "Nom(s) du / des consommateur(s) : ________________________________________________",
    "Adresse : ______________________________________________________________________",
    "Date : ____ / ____ / ________",
    "Signature du / des consommateur(s) : _____________________________________________",
  ]) {
    doc.assurer(18);
    doc.page().texte(MARGE, doc.y, ligne, { taille: 8, couleur: ENCRE });
    doc.sauter(16);
  }
  doc.assurer(16);
  doc.page().texte(MARGE, doc.y, "(*) Rayez la mention inutile.", { taille: 7.5, couleur: GRIS });

  return doc.rendre();
}

/* ⚠️ NE PAS PASSER UN LIBELLÉ DE CATALOGUE AU TOUT-MINUSCULE.
   « Clé USB personnalisée » devenait « clé usb personnalisée » et
   « Déplacements en France métropolitaine » perdait sa majuscule à France.
   On ne touche donc QUE l'initiale, et seulement si le premier mot n'est pas
   un sigle. */
export function initialeMinuscule(texte: string): string {
  const premier = texte.split(" ")[0] ?? "";
  if (premier.length > 1 && premier === premier.toUpperCase()) return texte;
  return texte.charAt(0).toLowerCase() + texte.slice(1);
}

/** Énumère en français : « a, b et c ». */
function enumerer(morceaux: string[]): string {
  if (morceaux.length <= 1) return morceaux[0] ?? "";
  return `${morceaux.slice(0, -1).join(", ")} et ${morceaux[morceaux.length - 1]}`;
}

/**
 * Décrit les supports album réellement compris, sans en inventer.
 *
 * Les déterminants sont posés support par support — « l'album premium …, sa
 * couverture …, la clé USB … » — comme dans le contrat modèle. Un support
 * absent du catalogue n'apparaît tout simplement pas dans la phrase.
 */
function decrireAlbum(inclusions: readonly string[]): string {
  const album = inclusions.find((i) => /album/i.test(i));
  const couverture = inclusions.find((i) => /couverture/i.test(i));
  const coffret = inclusions.find((i) => /coffret/i.test(i));
  const cle = inclusions.find((i) => /cl[ée] usb/i.test(i));
  if (!album && !couverture && !coffret && !cle) return "Les supports livrés";

  const morceaux = [
    album ? `l'${initialeMinuscule(album)}` : null,
    couverture ? `${album ? "sa" : "la"} ${initialeMinuscule(couverture)}` : null,
    coffret ? `le ${initialeMinuscule(coffret)}` : null,
    cle ? `la ${initialeMinuscule(cle)}` : null,
  ].filter(Boolean) as string[];

  const phrase = enumerer(morceaux);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
