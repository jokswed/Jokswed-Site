import "server-only";
import {
  Page, assembler, decouper, largeurTexte,
  BLANC, ENCRE, GRIS, LIGNE_CLAIRE, NOIR,
} from "./pdf";

/* =============================================================================
   GABARIT DU DEVIS — REPRODUIT DEPUIS `Devis Kimberly & Jeremy.pdf`
   -----------------------------------------------------------------------------
   Structure relevée sur le modèle fourni, de haut en bas :

     DEVIS (grand titre)            ·  Date du devis / Validité (colonne droite)
     JoksWed
     ─────────────────────────────────────────────────────────────────────────
     identité du prestataire        ·  À L'ATTENTION DE + identité des clients
     ─────────────────────────────────────────────────────────────────────────
     NOM DE LA FORMULE
     tableau : DESCRIPTION · LIVRAISON · LIEU · PRIX · QUANTITÉ · DURÉE · DATE
     PRESTATIONS INCLUSES (liste)
     ─────────────────────────────────────────────────────────────────────────
                                    Sous-total HT / TVA / ████ TOTAL TTC ████
     Termes et conditions
     Bon pour accord : Signature
     MERCI DE VOTRE CONFIANCE

   ⚠️ CE GABARIT NE CONNAÎT NI JOKSWED NI AUCUN CLIENT.

   Il reçoit un instantané et le dessine. C'est ce qui permettra à Yvann
   d'utiliser la même mise en page avec SA raison sociale, SON SIRET et SA
   numérotation — sans qu'on génère jamais un document à son nom portant mes
   mentions légales.
   ============================================================================= */

const MARGE = 44;
const COLONNE_DROITE = 595.28 - MARGE;
const LARGEUR_UTILE = 595.28 - MARGE * 2;

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

export interface LigneDocument {
  designation: string;
  detail?: string | null;
  livraison?: string | null;
  lieu?: string | null;
  quantite?: string | null;
  duree?: string | null;
  date?: string | null;
  prixCents: number | null;
}

export interface EcheanceDocument {
  libelle: string;
  montantCents: number;
}

export interface InstantaneDocument {
  type: "devis" | "facture" | "avoir";
  titre: string;
  numero: string | null;
  dateEmission: string;
  validite?: string | null;
  prestataire: IdentiteDocument;
  client: {
    nom: string;
    nom2?: string | null;
    email?: string | null;
    telephone?: string | null;
    adresse?: string | null;
  };
  formuleNom: string;
  lignes: LigneDocument[];
  inclusions: string[];
  totalHtCents: number;
  totalTvaCents: number;
  totalTtcCents: number;
  tauxTvaBp: number;
  echeances: EcheanceDocument[];
  conditions: string;
  mentionFin?: string | null;
  /** Bandeau d'avertissement pour un brouillon. */
  brouillon?: boolean;
}

function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} €`;
}

/** Étiquette en capitales espacées : la signature typographique de JoksWed. */
function etiquette(page: Page, x: number, y: number, texte: string, align: "gauche" | "droite" = "gauche") {
  page.texte(x, y, texte.toUpperCase(), {
    taille: 6.5, police: "grasse", couleur: GRIS, interlettrage: 1.2, align,
  });
}

export function dessinerDevis(d: InstantaneDocument): Buffer {
  const page = new Page();
  let y = MARGE + 14;

  /* ⚠️ BANDEAU DE BROUILLON, EN TÊTE ET IMPOSSIBLE À MANQUER.
     Un brouillon qui ressemble à un document émis finit par être envoyé. */
  if (d.brouillon) {
    page.rectangle(0, 0, 595.28, 22, [0.98, 0.95, 0.9]);
    page.texte(595.28 / 2, 14.5, "BROUILLON — DOCUMENT NON ÉMIS, SANS VALEUR", {
      taille: 7.5, police: "grasse", couleur: [0.6, 0.42, 0.1],
      interlettrage: 1.6, align: "centre",
    });
    y += 16;
  }

  /* ── Titre et colonne de droite ── */
  page.texte(MARGE, y + 26, d.titre.toUpperCase(), {
    taille: 34, police: "grasse", couleur: ENCRE, interlettrage: 1.5,
  });
  page.texte(MARGE, y + 46, d.prestataire.nomCommercial, { taille: 12, couleur: ENCRE });

  const droite: [string, string][] = [
    [`${d.titre === "DEVIS" ? "Date du devis" : "Date d'émission"} :`, d.dateEmission],
  ];
  if (d.validite) droite.push(["Validité du devis :", d.validite]);
  if (d.numero) droite.push([`Numéro :`, d.numero]);

  droite.forEach(([libelle, valeur], i) => {
    const ligneY = y + 14 + i * 13;
    page.texte(COLONNE_DROITE, ligneY, `${libelle} ${valeur}`, {
      taille: 8.5, couleur: ENCRE, align: "droite",
    });
  });

  y += 66;
  page.filet(MARGE, y, LARGEUR_UTILE, 0.8, ENCRE);
  y += 16;

  /* ── Les deux identités, côte à côte ── */
  const colonne2 = MARGE + LARGEUR_UTILE / 2 + 10;
  const p = d.prestataire;
  const blocPrestataire = [
    p.responsable ?? p.nomCommercial,
    p.telephone, p.email,
    [p.adresse, p.codePostal && p.ville ? `${p.codePostal} ${p.ville}` : p.ville]
      .filter(Boolean).join(", "),
    p.siret ? `N° Siret : ${p.siret}` : null,
    p.codeApe ? `Code APE : ${p.codeApe}` : null,
    p.tvaNumero ? `TVA : ${p.tvaNumero}` : null,
  ].filter(Boolean) as string[];

  const blocClient = [
    d.client.nom, d.client.nom2, d.client.telephone, d.client.email, d.client.adresse,
  ].filter(Boolean) as string[];

  etiquette(page, colonne2, y, "À l'attention de");
  blocPrestataire.forEach((ligne, i) =>
    page.texte(MARGE, y + 2 + i * 12, ligne, { taille: 8.5, couleur: ENCRE }));
  blocClient.forEach((ligne, i) =>
    page.texte(colonne2, y + 14 + i * 12, ligne, { taille: 8.5, couleur: ENCRE }));

  y += Math.max(blocPrestataire.length, blocClient.length + 1) * 12 + 22;
  page.filet(MARGE, y, LARGEUR_UTILE);
  y += 20;

  /* ── Nom de la formule ── */
  page.texte(MARGE, y, d.formuleNom.toUpperCase(), {
    taille: 11, police: "grasse", couleur: ENCRE, interlettrage: 1,
  });
  y += 20;

  /* ── Tableau ──
     Les sept colonnes du modèle. Les largeurs suivent les proportions
     relevées : la description prend le tiers, le reste se partage. */
  const colonnes: { titre: string; largeur: number; align: "gauche" | "droite" }[] = [
    { titre: "Description", largeur: 0.26, align: "gauche" },
    { titre: "Livraison", largeur: 0.15, align: "gauche" },
    { titre: "Lieu", largeur: 0.17, align: "gauche" },
    { titre: "Prix", largeur: 0.11, align: "droite" },
    { titre: "Quantité", largeur: 0.12, align: "gauche" },
    { titre: "Durée", largeur: 0.11, align: "gauche" },
    { titre: "Date", largeur: 0.08, align: "gauche" },
  ];
  const xs: number[] = [];
  let curseur = MARGE;
  for (const c of colonnes) { xs.push(curseur); curseur += c.largeur * LARGEUR_UTILE; }

  colonnes.forEach((c, i) =>
    etiquette(page, c.align === "droite" ? xs[i] + c.largeur * LARGEUR_UTILE - 6 : xs[i],
      y, c.titre, c.align === "droite" ? "droite" : "gauche"));
  y += 8;
  page.filet(MARGE, y, LARGEUR_UTILE, 0.5, ENCRE);
  y += 12;

  for (const ligne of d.lignes) {
    const cellules = [
      ligne.designation,
      ligne.livraison ?? "",
      ligne.lieu ?? "",
      ligne.prixCents === null ? "Sur devis" : euros(ligne.prixCents),
      ligne.quantite ?? "",
      ligne.duree ?? "",
      ligne.date ?? "",
    ];
    let hauteurLigne = 0;
    cellules.forEach((valeur, i) => {
      const largeurCol = colonnes[i].largeur * LARGEUR_UTILE - 8;
      const morceaux = decouper(valeur, largeurCol, 8);
      morceaux.forEach((m, j) =>
        page.texte(
          colonnes[i].align === "droite" ? xs[i] + largeurCol + 2 : xs[i],
          y + j * 11, m,
          { taille: 8, couleur: ENCRE, align: colonnes[i].align },
        ));
      hauteurLigne = Math.max(hauteurLigne, morceaux.length * 11);
    });
    y += hauteurLigne + 8;
    page.filet(MARGE, y - 4, LARGEUR_UTILE);
  }

  y += 16;

  /* ── Prestations incluses ── */
  if (d.inclusions.length > 0) {
    etiquette(page, MARGE, y, "Prestations incluses");
    y += 14;
    const largeurListe = LARGEUR_UTILE * 0.56;
    for (const item of d.inclusions) {
      const morceaux = decouper(item, largeurListe - 12, 8.5);
      page.texte(MARGE, y, "—", { taille: 8.5, couleur: GRIS });
      morceaux.forEach((m, j) =>
        page.texte(MARGE + 12, y + j * 11, m, { taille: 8.5, couleur: ENCRE }));
      y += morceaux.length * 11 + 2;
    }
  }

  /* ── Récapitulatif financier, aligné à droite ── */
  let yTotaux = y - (d.inclusions.length * 13 + 14);
  const xTotaux = COLONNE_DROITE;
  const largeurBande = LARGEUR_UTILE * 0.4;

  page.texte(xTotaux, yTotaux, `Sous-total HT :  ${euros(d.totalHtCents)}`, {
    taille: 9, couleur: ENCRE, align: "droite",
  });
  yTotaux += 14;
  page.texte(
    xTotaux,
    yTotaux,
    `TVA (${(d.tauxTvaBp / 100).toLocaleString("fr-FR")} %) :  ${euros(d.totalTvaCents)}`,
    { taille: 9, couleur: ENCRE, align: "droite" },
  );
  yTotaux += 16;

  /* ⚠️ LE BANDEAU NOIR DU TOTAL : la signature visuelle du modèle. */
  page.rectangle(COLONNE_DROITE - largeurBande, yTotaux, largeurBande, 26, NOIR);
  page.texte(COLONNE_DROITE - 10, yTotaux + 17, `TOTAL TTC : ${euros(d.totalTtcCents)}`, {
    taille: 10.5, police: "grasse", couleur: BLANC, align: "droite",
  });

  y = Math.max(y, yTotaux + 26) + 24;
  page.filet(MARGE, y, LARGEUR_UTILE);
  y += 16;

  /* ── Conditions de paiement ── */
  etiquette(page, MARGE, y, `Termes et conditions${
    d.echeances.length > 1 ? ` — Paiement en ${d.echeances.length} fois` : ""
  }`);
  y += 14;

  if (d.echeances.length > 0) {
    for (const e of d.echeances) {
      page.texte(MARGE, y, `${e.libelle} : ${euros(e.montantCents)}`, {
        taille: 8.5, couleur: ENCRE,
      });
      y += 12;
    }
    y += 4;
  }
  y += page.paragraphe(MARGE, y, LARGEUR_UTILE * 0.78, d.conditions, {
    taille: 8, couleur: GRIS, interligne: 1.5,
  });

  y += 24;
  page.texte(MARGE, y, "Bon pour accord :", { taille: 9, couleur: ENCRE });
  page.texte(MARGE + 90, y, "Signature", { taille: 9, couleur: GRIS });
  page.filet(MARGE + 88, y + 5, 170, 0.5, LIGNE_CLAIRE);

  /* ── Pied ── */
  const yPied = 841.89 - MARGE - 10;
  page.filet(MARGE, yPied - 16, LARGEUR_UTILE);
  page.texte(595.28 / 2, yPied, (d.mentionFin ?? "Merci de votre confiance").toUpperCase(), {
    taille: 8, police: "grasse", couleur: ENCRE, interlettrage: 2, align: "centre",
  });

  return assembler([page]);
}

/**
 * Répartit un total en N échéances.
 *
 * ⚠️ LA DERNIÈRE ABSORBE LE RESTE.
 *
 * C'est exactement ce que fait le devis fourni : 433,33 + 433,33 + 433,34
 * pour 1 300,00 €. Diviser et arrondir chaque part donnerait 1 299,99 € — un
 * centime manquant sur un document comptable, et une somme qui ne tombe pas
 * juste. On calcule donc en CENTIMES ENTIERS et on verse le reliquat sur la
 * dernière échéance.
 */
export function repartir(totalCents: number, parts: number): number[] {
  if (parts < 1) return [totalCents];
  const base = Math.floor(totalCents / parts);
  const montants = Array.from({ length: parts }, () => base);
  montants[parts - 1] += totalCents - base * parts;
  return montants;
}

export { largeurTexte };
