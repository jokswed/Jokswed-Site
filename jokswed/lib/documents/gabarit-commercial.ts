import "server-only";
import {
  Page, assembler, decouper, largeurTexte, LARGEUR, HAUTEUR,
  BLANC, CREME, ENCRE, GRIS, NOIR, BORDURE, type Couleur,
} from "./pdf";

/* =============================================================================
   GABARIT COMMERCIAL — DEVIS, FACTURES ET AVOIRS
   -----------------------------------------------------------------------------
   Reproduit `Devis Kimberly & Jeremy.pdf`. Les mesures ne sont pas estimées :
   elles ont été relevées sur un rendu du modèle original, au pixel.

     · fond crème          RGB(248, 247, 244)
     · marges              47 pt à gauche comme à droite
     · bandeau noir        pleine largeur entre marges, 26 pt de haut
     · tableau             grille BORDÉE, en-têtes et contenu centrés
     · inclusions          encadré, DEUX colonnes, puces « - »

   ⚠️ UNE SEULE MISE EN PAGE POUR TROIS TYPES DE DOCUMENT.

   Une facture n'est pas un devis redessiné : c'est le MÊME document, avec un
   autre titre et deux lignes de plus au récapitulatif. C'est exactement ce
   que tu demandais — qu'un client reconnaisse immédiatement qu'ils viennent
   de la même entreprise.
   ============================================================================= */

export const MARGE = 47;
const UTILE = LARGEUR - MARGE * 2;

export interface IdentiteDocument {
  nomCommercial: string;
  responsable?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  telephone?: string | null;
  email?: string | null;
  siret?: string | null;
  codeApe?: string | null;
  tvaNumero?: string | null;
  mentionTva?: string | null;
}

export interface CelluleTableau {
  description: string;
  livraison?: string | null;
  lieu?: string | null;
  prix: string;
  quantite?: string | null;
  duree?: string | null;
  date?: string | null;
}

export interface EcheanceDocument {
  libelle: string;
  montantCents: number;
}

export interface InstantaneCommercial {
  /** « DEVIS », « FACTURE D'ACOMPTE », « FACTURE DE SOLDE », « FACTURE », « AVOIR ». */
  titre: string;
  numero: string | null;
  dateEmission: string;
  validite?: string | null;
  /** Date de la prestation : mention obligatoire sur une facture. */
  datePrestation?: string | null;
  prestataire: IdentiteDocument;
  /** Signature de l'émetteur explicitement apposée avant émission du PDF. */
  signaturePrestataire?: { traces: number[][][]; nom: string; date: string } | null;
  client: {
    nom: string;
    nom2?: string | null;
    email?: string | null;
    telephone?: string | null;
    adresse?: string | null;
  };
  formuleNom: string;
  lignes: CelluleTableau[];
  inclusions: string[];
  totalHtCents: number;
  totalTvaCents: number;
  totalTtcCents: number;
  tauxTvaBp: number;
  /** Factures : montants déjà réglés, pour en déduire le reste à payer. */
  dejaRegleCents?: number | null;
  /** Avoirs : document d'origine. */
  referenceOrigine?: string | null;
  echeances: EcheanceDocument[];
  conditions: string;
  mentionsLegales?: string[];
  noteBasDePage?: string | null;
  mentionFin?: string | null;
  brouillon?: boolean;
}

export function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} €`;
}

function titreCentre(page: Page, y: number, texte: string, taille = 10) {
  page.texte(LARGEUR / 2, y, texte, {
    taille, police: "grasse", couleur: ENCRE, align: "centre",
  });
}

export function dessinerCommercial(d: InstantaneCommercial): Buffer {
  const page = new Page();
  page.fond(CREME);
  let y = 62;

  /* ⚠️ BANDEAU DE BROUILLON, EN TÊTE ET IMPOSSIBLE À MANQUER.
     Un brouillon qui ressemble à un document émis finit par être envoyé. */
  if (d.brouillon) {
    page.rectangle(0, 0, LARGEUR, 20, [0.96, 0.91, 0.82]);
    page.texte(LARGEUR / 2, 13.5, "BROUILLON — DOCUMENT NON ÉMIS, SANS VALEUR", {
      taille: 7, police: "grasse", couleur: [0.55, 0.38, 0.06],
      interlettrage: 1.4, align: "centre",
    });
  }

  /* ── Titre, relevé à ~46 pt sur le modèle ── */
  page.texte(MARGE, y, d.titre.toUpperCase(), { taille: 44, couleur: ENCRE });
  page.texte(MARGE + 26, y + 20, d.prestataire.nomCommercial, { taille: 7.5, couleur: ENCRE });
  y += 56;

  /* ── Dates : libellé GRAS à gauche, valeur à côté (et non alignées à droite) ── */
  const dates: [string, string][] = [];
  if (d.titre.startsWith("DEVIS")) {
    dates.push(["Date du devis :", d.dateEmission]);
    if (d.validite) dates.push(["Validité du devis :", d.validite]);
  } else {
    dates.push(["Date d'émission :", d.dateEmission]);
    if (d.datePrestation) dates.push(["Date de la prestation :", d.datePrestation]);
  }
  if (d.numero) dates.push([`Numéro :`, d.numero]);
  if (d.referenceOrigine) dates.push(["Facture d'origine :", d.referenceOrigine]);

  /* ⚠️ LA COLONNE DES VALEURS SE MESURE, ELLE NE SE DEVINE PAS.
     Avec un décalage fixe de 104 pt, « Date de la prestation : » (105,9 pt en
     gras 8 pt) venait recouvrir sa propre valeur sur les factures. On prend
     donc la largeur du plus long libellé, plus une gouttière. */
  const xValeur = MARGE + Math.max(
    104, ...dates.map(([libelle]) => largeurTexte(libelle, 8, "grasse") + 10));
  for (const [libelle, valeur] of dates) {
    page.texte(MARGE, y, libelle, { taille: 8, police: "grasse", couleur: ENCRE });
    page.texte(xValeur, y, valeur, { taille: 8, couleur: ENCRE });
    y += 13;
  }

  y += 10;
  page.filet(MARGE, y, UTILE, 0.7, BORDURE);
  y += 18;

  /* ── Les deux identités ── */
  const p = d.prestataire;
  const gauche = [
    p.telephone, p.email,
    [p.adresse, p.codePostal && p.ville ? `${p.ville} ${p.codePostal}` : p.ville]
      .filter(Boolean).join(", "),
    p.siret ? `N° Siret : ${p.siret}` : null,
    p.codeApe ? `Code APE : ${p.codeApe}` : null,
    p.tvaNumero ? `N° TVA : ${p.tvaNumero}` : null,
  ].filter(Boolean) as string[];

  page.texte(MARGE, y, (p.responsable ?? p.nomCommercial).toUpperCase(), {
    taille: 9.5, police: "grasse", couleur: ENCRE,
  });
  gauche.forEach((l, i) => page.texte(MARGE, y + 15 + i * 12, l, { taille: 8, couleur: ENCRE }));

  const xDroite = LARGEUR - MARGE;
  page.texte(xDroite, y, "À L'ATTENTION DE", {
    taille: 9, police: "grasse", couleur: ENCRE, align: "droite",
  });
  const droite = [
    { texte: d.client.nom, gras: true },
    { texte: d.client.telephone, gras: false },
    { texte: d.client.nom2, gras: true },
    { texte: d.client.email, gras: false },
    { texte: d.client.adresse, gras: false },
  ].filter((l) => l.texte);
  droite.forEach((l, i) =>
    page.texte(xDroite, y + 15 + i * 12, l.texte as string, {
      taille: 8, police: l.gras ? "grasse" : "normale", couleur: ENCRE, align: "droite",
    }));

  y += Math.max(gauche.length, droite.length) * 12 + 34;

  /* ── Nom de la formule, centré ── */
  titreCentre(page, y, d.formuleNom.toUpperCase(), 10.5);
  y += 22;

  /* ── Tableau BORDÉ ──
     Le modèle dessine une grille complète : en-tête encadré, puis une ligne
     par prestation, chaque cellule bordée et son contenu centré. */
  const colonnes: { titre: string; part: number }[] = [
    { titre: "Description", part: 0.145 },
    { titre: "Livraison", part: 0.135 },
    { titre: "Lieu", part: 0.215 },
    { titre: "Prix", part: 0.115 },
    { titre: "Quantité", part: 0.14 },
    { titre: "Durée", part: 0.135 },
    { titre: "Date", part: 0.115 },
  ];
  const xs: number[] = [];
  const larg: number[] = [];
  let curseur = MARGE;
  for (const c of colonnes) {
    xs.push(curseur);
    larg.push(c.part * UTILE);
    curseur += c.part * UTILE;
  }

  const HAUTEUR_ENTETE = 26;
  colonnes.forEach((c, i) => {
    page.cadre(xs[i], y, larg[i], HAUTEUR_ENTETE, 0.6, BORDURE);
    page.texte(xs[i] + larg[i] / 2, y + 16, c.titre.toUpperCase(), {
      taille: 6.2, police: "grasse", couleur: ENCRE, interlettrage: 0.5, align: "centre",
    });
  });
  y += HAUTEUR_ENTETE;

  for (const ligne of d.lignes) {
    const cellules = [
      ligne.description, ligne.livraison ?? "", ligne.lieu ?? "",
      ligne.prix, ligne.quantite ?? "", ligne.duree ?? "", ligne.date ?? "",
    ];
    /* On mesure AVANT de dessiner : la hauteur de la ligne est celle de la
       cellule la plus haute, sinon les bordures ne se rejoignent pas. */
    const parCellule = cellules.map((valeur, i) =>
      valeur.split("\n").flatMap((bloc) => decouper(bloc, larg[i] - 10, 7.5)));
    const hauteur = Math.max(44, ...parCellule.map((m) => m.length * 10 + 22));

    parCellule.forEach((morceaux, i) => {
      page.cadre(xs[i], y, larg[i], hauteur, 0.6, BORDURE);
      const depart = y + (hauteur - morceaux.length * 10) / 2 + 7;
      morceaux.forEach((m, j) =>
        page.texte(xs[i] + larg[i] / 2, depart + j * 10, m, {
          taille: 7.5, couleur: ENCRE, align: "centre",
        }));
    });
    y += hauteur;
  }

  y += 24;

  /* ── Prestations incluses : encadré, deux colonnes ── */
  if (d.inclusions.length > 0) {
    titreCentre(page, y, "PRESTATIONS INCLUSES", 9.5);
    y += 16;

    const moitie = Math.ceil(d.inclusions.length / 2);
    const colonnesInc = [d.inclusions.slice(0, moitie), d.inclusions.slice(moitie)];
    /* ⚠️ GOUTTIÈRE RÉELLE ENTRE LES DEUX COLONNES.
       Mesuré : « Photographies sélectionnées et retouchées en haute
       définition » fait 207,2 pt à 7,5 pt. Avec une colonne de 210,6 pt, elle
       tenait sur UNE ligne et venait coller la puce de la colonne de droite —
       le modèle, lui, la coupe en deux. On réserve donc 36 pt de respiration :
       le texte retombe, et les deux colonnes ne se touchent jamais. */
    const largeurTexteCol = UTILE / 2 - 60;
    const lignesParCol = colonnesInc.map((col) =>
      col.map((item) => decouper(item, largeurTexteCol, 7.5)));
    const hauteurBloc =
      Math.max(...lignesParCol.map((col) =>
        col.reduce((s, m) => s + m.length * 10 + 11, 0))) + 20;

    page.cadre(MARGE, y, UTILE, hauteurBloc, 0.6, BORDURE);
    colonnesInc.forEach((col, iCol) => {
      let yItem = y + 14;
      const xCol = MARGE + 16 + iCol * (UTILE / 2);
      col.forEach((item, i) => {
        const morceaux = lignesParCol[iCol][i];
        page.texte(xCol, yItem, "-", { taille: 7.5, couleur: GRIS });
        morceaux.forEach((m, j) =>
          page.texte(xCol + 14, yItem + j * 10, m, { taille: 7.5, couleur: ENCRE }));
        yItem += morceaux.length * 10 + 11;
      });
    });
    y += hauteurBloc + 30;
  }

  /* ── Récapitulatif financier ── */
  const xTotal = LARGEUR - MARGE;
  const lignesTotaux: [string, string][] = [
    ["Sous-total HT :", euros(d.totalHtCents)],
    [`TVA (${(d.tauxTvaBp / 100).toLocaleString("fr-FR")}%) :`, euros(d.totalTvaCents)],
  ];
  for (const [libelle, valeur] of lignesTotaux) {
    page.texte(xTotal - 104, y, libelle, {
      taille: 8.5, police: "grasse", couleur: ENCRE, align: "droite",
    });
    page.texte(xTotal, y, valeur, {
      taille: 8.5, police: "grasse", couleur: ENCRE, align: "droite",
    });
    y += 14;
  }
  y += 4;

  /* ⚠️ LE BANDEAU NOIR : pleine largeur entre marges, 26 pt. Mesuré sur le
     modèle (x 47 → 548, y 623 → 650). C'est sa signature visuelle. */
  page.rectangle(MARGE, y, UTILE, 26, NOIR);
  page.texte(xTotal - 104, y + 17.5, `${titreTotal(d.titre)} :`, {
    taille: 10.5, police: "grasse", couleur: BLANC, align: "droite",
  });
  page.texte(xTotal - 10, y + 17.5, euros(Math.abs(d.totalTtcCents)), {
    taille: 10.5, police: "grasse", couleur: BLANC, align: "droite",
  });
  y += 44;

  /* ── Factures : ce qui a déjà été réglé, et ce qui reste ──
     ⚠️ UNE FACTURE ÉMISE N'EST PAS UN PAIEMENT ENCAISSÉ.
     Les deux lignes ci-dessous les distinguent explicitement : le reste à
     payer se déduit des paiements CONFIRMÉS, jamais des factures émises. */
  if (typeof d.dejaRegleCents === "number") {
    const reste = d.totalTtcCents - d.dejaRegleCents;
    page.texte(xTotal - 104, y, "Déjà réglé :", {
      taille: 8.5, couleur: ENCRE, align: "droite",
    });
    page.texte(xTotal, y, euros(d.dejaRegleCents), {
      taille: 8.5, couleur: ENCRE, align: "droite",
    });
    y += 14;
    page.texte(xTotal - 104, y, "Reste à payer :", {
      taille: 9, police: "grasse", couleur: ENCRE, align: "droite",
    });
    page.texte(xTotal, y, euros(reste), {
      taille: 9, police: "grasse", couleur: ENCRE, align: "droite",
    });
    y += 20;
  }

  /* ── Conditions et signature ── */
  const yConditions = y;
  page.texte(MARGE, y, `Termes et conditions${
    d.echeances.length > 1 ? ` - Paiement en ${d.echeances.length} fois` : ""
  }`, { taille: 8.5, police: "grasse", couleur: ENCRE });

  page.texte(MARGE + UTILE * 0.56, y,
    d.signaturePrestataire ? "Visa de l'émetteur :" : "Bon pour accord : Signature", {
      taille: 8.5, police: "grasse", couleur: ENCRE,
    });
  if (d.signaturePrestataire) {
    page.tracerSignature(d.signaturePrestataire.traces,
      MARGE + UTILE * 0.57, y + 13, UTILE * 0.31, 43);
  }
  page.filet(MARGE + UTILE * 0.56, y + 62, UTILE * 0.40, 0.7, [0.45, 0.44, 0.42]);

  y += 14;
  const texteConditions = [
    ...d.echeances.map((e) => `${e.libelle} : ${euros(e.montantCents)}.`),
    d.conditions,
  ].join(" ");
  y += page.paragraphe(MARGE, y, UTILE * 0.52, texteConditions, {
    taille: 7, couleur: ENCRE, interligne: 1.5,
  });

  for (const mention of d.mentionsLegales ?? []) {
    y += 6;
    y += page.paragraphe(MARGE, y, UTILE * 0.52, mention, {
      taille: 7, police: "grasse", couleur: ENCRE, interligne: 1.4,
    });
  }

  y = Math.max(y, yConditions + 76) + 14;
  if (d.noteBasDePage) {
    page.texte(MARGE, y, d.noteBasDePage, { taille: 6.5, couleur: GRIS });
  }

  /* ── Pied ── */
  const yPied = HAUTEUR - 44;
  page.filet(MARGE, yPied - 14, UTILE, 0.6, BORDURE);
  page.texte(LARGEUR / 2, yPied, (d.mentionFin ?? "Merci de votre confiance").toUpperCase(), {
    taille: 8.5, couleur: ENCRE, align: "centre",
  });

  return assembler([page]);
}

function titreTotal(titre: string): string {
  if (titre.startsWith("AVOIR")) return "TOTAL AVOIR TTC";
  return "TOTAL TTC";
}

/**
 * Répartit un total en N échéances.
 *
 * ⚠️ LA DERNIÈRE ABSORBE LE RESTE.
 *
 * C'est exactement ce que fait le devis fourni : 433,33 + 433,33 + 433,34
 * pour 1 300,00 €. Diviser et arrondir chaque part donnerait 1 299,99 € — un
 * centime manquant sur un document comptable. On calcule donc en CENTIMES
 * ENTIERS et le reliquat tombe sur la dernière échéance.
 */
export function repartir(totalCents: number, parts: number): number[] {
  if (parts < 1) return [totalCents];
  const base = Math.floor(totalCents / parts);
  const montants = Array.from({ length: parts }, () => base);
  montants[parts - 1] += totalCents - base * parts;
  return montants;
}

export { largeurTexte, decouper };
