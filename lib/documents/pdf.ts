import "server-only";

/* =============================================================================
   MOTEUR PDF — AUCUNE DÉPENDANCE
   -----------------------------------------------------------------------------
   ⚠️ POURQUOI ÉCRIRE LE PDF À LA MAIN.

   Les bibliothèques disponibles tombent dans deux catégories, et aucune ne
   convient ici :

     · pdfkit, jsPDF — plusieurs mégaoctets et des polices embarquées, qui
       pèsent sur chaque démarrage à froid d'une fonction Vercel ;
     · puppeteer — un navigateur entier pour imprimer une page A4.

   ⚠️ ET SURTOUT : LE MODÈLE FOURNI N'A BESOIN DE RIEN DE PLUS.

   Le devis `Devis Kimberly & Jeremy.pdf` a été produit par Canva, et ses
   ressources de police se résument à `/Helvetica` et `/Helvetica-Bold`, en
   Type1. Ce sont deux des quatorze polices garanties présentes dans tout
   lecteur PDF : rien à embarquer, rien à télécharger, et un rendu identique
   partout. Le contrat, lui, sort de LibreOffice en LiberationSans — dont les
   métriques sont celles d'Helvetica.

   Autrement dit, la fidélité visuelle de tes modèles est atteignable avec
   quelques centaines de lignes et zéro octet de dépendance.

   ⚠️ L'ENCODAGE EST `WinAnsiEncoding`, DONC LATIN-1.

   PDF écrit les chaînes littérales en octets. Les caractères hors Latin-1
   (guillemets typographiques, tirets cadratins, œ…) ont une place dans
   WinAnsi mais à un autre point de code : `encoderWinAnsi` les y envoie.
   Ceux qui n'y existent pas du tout sont translittérés — mieux vaut un « - »
   qu'un carré vide sur un document commercial.
   ============================================================================= */

/** A4 en points typographiques, l'unité du format PDF. */
export const LARGEUR = 595.28;
export const HAUTEUR = 841.89;

export type Police = "normale" | "grasse";

/* ──────────────────────────── MÉTRIQUES HELVETICA ───────────────────────────
   Largeurs d'avance en millièmes de point, pour les codes 32 à 126. Elles
   servent au retour à la ligne et à l'alignement à droite : sans elles, on
   ne saurait pas où un texte se termine.

   Les caractères accentués d'Helvetica ont LA MÊME avance que leur lettre de
   base (é = e = 556) : la table de repli le reflète, et reste donc exacte.
   --------------------------------------------------------------------------- */
const AVANCES_NORMALE = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const AVANCES_GRASSE = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Lettre de base d'un caractère accentué : son avance est identique. */
const BASE_ACCENTUEE: Record<string, string> = {
  à: "a", â: "a", ä: "a", á: "a", ã: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  î: "i", ï: "i", í: "i", ì: "i",
  ô: "o", ö: "o", ò: "o", ó: "o", õ: "o",
  ù: "u", û: "u", ü: "u", ú: "u",
  ÿ: "y", ý: "y", ç: "c", ñ: "n",
  À: "A", Â: "A", Ä: "A", Á: "A", É: "E", È: "E", Ê: "E", Ë: "E",
  Î: "I", Ï: "I", Ô: "O", Ö: "O", Ù: "U", Û: "U", Ü: "U", Ç: "C", Ñ: "N",
};

function avance(caractere: string, police: Police): number {
  const table = police === "grasse" ? AVANCES_GRASSE : AVANCES_NORMALE;
  const base = BASE_ACCENTUEE[caractere] ?? caractere;
  const code = base.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  /* Les symboles monétaires et typographiques courants, mesurés dans Helvetica. */
  if (caractere === "€") return 556;
  if (caractere === "—" || caractere === "–") return 556;
  if (caractere === "’" || caractere === "‘") return 222;
  if (caractere === "«" || caractere === "»") return 556;
  if (caractere === " " || caractere === " ") return 278;
  return 556;
}

/** Largeur d'un texte, en points, pour une taille donnée. */
export function largeurTexte(texte: string, taille: number, police: Police = "normale"): number {
  let total = 0;
  for (const c of texte) total += avance(c, police);
  return (total * taille) / 1000;
}

/**
 * Découpe un texte pour tenir dans une largeur.
 *
 * ⚠️ ON COUPE AUX ESPACES, JAMAIS AU MILIEU D'UN MOT.
 * Un mot plus long que la colonne déborde volontairement : mieux vaut une
 * ligne un peu large qu'une adresse e-mail coupée en deux sur un devis.
 */
export function decouper(
  texte: string, largeurMax: number, taille: number, police: Police = "normale",
): string[] {
  const lignes: string[] = [];
  for (const paragraphe of String(texte ?? "").split("\n")) {
    let courante = "";
    for (const mot of paragraphe.split(/\s+/).filter(Boolean)) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (largeurTexte(essai, taille, police) <= largeurMax) {
        courante = essai;
      } else {
        if (courante) lignes.push(courante);
        courante = mot;
      }
    }
    lignes.push(courante);
  }
  return lignes;
}

/* ──────────────────────────── ENCODAGE WinAnsi ──────────────────────────── */
const WINANSI_SPECIAUX: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Translittérations de dernier recours : un « - » vaut mieux qu'un carré vide. */
const REPLI: Record<string, string> = {
  " ": " ", " ": " ", " ": " ", "⚠": "!", "✓": "x", "✕": "x",
  "🤍": "", "✨": "", "👑": "", "→": "->", "·": "-",
};

function encoderWinAnsi(texte: string): Buffer {
  const octets: number[] = [];
  for (const c of texte) {
    if (WINANSI_SPECIAUX[c] !== undefined) { octets.push(WINANSI_SPECIAUX[c]); continue; }
    const remplace = REPLI[c];
    if (remplace !== undefined) {
      for (const r of remplace) octets.push(r.charCodeAt(0));
      continue;
    }
    const code = c.codePointAt(0) ?? 63;
    if (code <= 0xff) octets.push(code);
    else {
      /* Hors Latin-1 et hors table : on retombe sur la lettre de base, ou '?'. */
      const base = BASE_ACCENTUEE[c];
      octets.push(base ? base.charCodeAt(0) : 63);
    }
  }
  return Buffer.from(octets);
}

function echapperChaine(texte: string): Buffer {
  const brut = encoderWinAnsi(texte);
  const sortie: number[] = [];
  for (const o of brut) {
    if (o === 0x28 || o === 0x29 || o === 0x5c) sortie.push(0x5c); // ( ) \
    sortie.push(o);
  }
  return Buffer.from(sortie);
}

/* ──────────────────────────── CONSTRUCTION ──────────────────────────── */

export type Couleur = [number, number, number]; // 0..1
export const NOIR: Couleur = [0, 0, 0];
/* ⚠️ COULEURS RELEVÉES AU PIXEL SUR LES MODÈLES FOURNIS, pas estimées.
   Le devis Canva est sur un fond crème (248,247,244) ; le contrat
   LibreOffice est sur blanc, avec un encadré gris (245,244,241). */
export const CREME: Couleur = [248 / 255, 247 / 255, 244 / 255];
export const GRIS_BOITE: Couleur = [245 / 255, 244 / 255, 241 / 255];
export const BORDURE: Couleur = [0.72, 0.71, 0.69];
export const ENCRE: Couleur = [0.078, 0.075, 0.071];
export const GRIS: Couleur = [0.545, 0.529, 0.506];
export const LIGNE_CLAIRE: Couleur = [0.91, 0.898, 0.875];
export const BLANC: Couleur = [1, 1, 1];

export interface OptionsTexte {
  taille?: number;
  police?: Police;
  couleur?: Couleur;
  align?: "gauche" | "droite" | "centre";
  interlettrage?: number;
}

/**
 * Une page A4 en construction.
 *
 * ⚠️ L'ORIGINE PDF EST EN BAS À GAUCHE. Compter depuis le haut est tellement
 * plus naturel pour une mise en page qu'on expose `y` DEPUIS LE HAUT et qu'on
 * convertit ici. Toutes les coordonnées de `gabarits.ts` sont donc lisibles
 * comme sur une feuille posée devant soi.
 */
export class Page {
  private flux: string[] = [];

  texte(x: number, yDepuisHaut: number, contenu: string, options: OptionsTexte = {}): void {
    const {
      taille = 9, police = "normale", couleur = ENCRE,
      align = "gauche", interlettrage = 0,
    } = options;
    if (!contenu) return;

    const largeur = largeurTexte(contenu, taille, police)
      + interlettrage * Math.max(0, [...contenu].length - 1);
    const xReel = align === "droite" ? x - largeur : align === "centre" ? x - largeur / 2 : x;
    const y = HAUTEUR - yDepuisHaut;

    this.flux.push(
      `BT /${police === "grasse" ? "FB" : "FN"} ${taille} Tf ` +
      /* ⚠️ `Tc` FAIT PARTIE DE L'ÉTAT DE TEXTE, ET BT/ET NE LE RÉINITIALISE PAS.
         On l'écrivait seulement quand il était non nul : le `1.4 Tc` du
         bandeau de brouillon restait alors actif pour TOUT le reste de la
         page, qui sortait lettre-espacée et débordait de ses colonnes. On
         l'émet donc systématiquement, y compris à zéro. */
      `${interlettrage} Tc ` +
      `${couleur.map((c) => c.toFixed(3)).join(" ")} rg ` +
      `1 0 0 1 ${xReel.toFixed(2)} ${y.toFixed(2)} Tm ` +
      `(${echapperChaine(contenu).toString("latin1")}) Tj ET`,
    );
  }

  /** Retourne la hauteur consommée : l'appelant enchaîne sans recalculer. */
  paragraphe(
    x: number, yDepuisHaut: number, largeurMax: number, contenu: string,
    options: OptionsTexte & { interligne?: number } = {},
  ): number {
    const { taille = 9, police = "normale", interligne = 1.45 } = options;
    const lignes = decouper(contenu, largeurMax, taille, police);
    const pas = taille * interligne;
    lignes.forEach((ligne, i) => this.texte(x, yDepuisHaut + i * pas, ligne, options));
    return lignes.length * pas;
  }

  rectangle(
    x: number, yDepuisHaut: number, largeur: number, hauteur: number, couleur: Couleur,
  ): void {
    const y = HAUTEUR - yDepuisHaut - hauteur;
    this.flux.push(
      `${couleur.map((c) => c.toFixed(3)).join(" ")} rg ` +
      `${x.toFixed(2)} ${y.toFixed(2)} ${largeur.toFixed(2)} ${hauteur.toFixed(2)} re f`,
    );
  }

  filet(
    x: number, yDepuisHaut: number, largeur: number,
    epaisseur = 0.6, couleur: Couleur = LIGNE_CLAIRE,
  ): void {
    this.rectangle(x, yDepuisHaut, largeur, epaisseur, couleur);
  }

  /** Rectangle en CONTOUR : les cellules bordées du tableau du modèle. */
  cadre(
    x: number, yDepuisHaut: number, largeur: number, hauteur: number,
    epaisseur = 0.6, couleur: Couleur = BORDURE,
  ): void {
    this.rectangle(x, yDepuisHaut, largeur, epaisseur, couleur);
    this.rectangle(x, yDepuisHaut + hauteur - epaisseur, largeur, epaisseur, couleur);
    this.rectangle(x, yDepuisHaut, epaisseur, hauteur, couleur);
    this.rectangle(x + largeur - epaisseur, yDepuisHaut, epaisseur, hauteur, couleur);
  }

  /** Fond de page. Doit être le PREMIER appel : il recouvre ce qui précède. */
  fond(couleur: Couleur): void {
    this.flux.unshift(
      `${couleur.map((c) => c.toFixed(3)).join(" ")} rg 0 0 ${LARGEUR} ${HAUTEUR} re f`,
    );
  }

  contenu(): string {
    return this.flux.join("\n");
  }
}

/* =============================================================================
   DOCUMENT MULTIPAGE
   -----------------------------------------------------------------------------
   ⚠️ LE CONTRAT FAIT QUATRE PAGES, ET LE TEXTE NE DOIT JAMAIS ÊTRE COUPÉ.

   Écrire page par page en comptant les lignes à la main, c'est la garantie
   qu'un article décalera tout le reste au premier mot ajouté. Le document
   tient donc un CURSEUR : chaque bloc demande la place dont il a besoin, et
   si elle manque, une nouvelle page s'ouvre avec son fond et son pied.

   `garderEnsemble` existe pour les titres : un « ARTICLE 7 » seul en bas de
   page, son texte à la page suivante, c'est laid et c'est évitable.
   ============================================================================= */
export interface OptionsDocument {
  margeHaut?: number;
  margeBas?: number;
  fond?: Couleur;
  /** Pied de page répété, centré. */
  pied?: string;
}

export class DocumentPdf {
  private pages: Page[] = [];
  private courante: Page;
  public y: number;
  private readonly margeHaut: number;
  private readonly margeBas: number;
  private readonly couleurFond?: Couleur;
  private readonly pied?: string;

  constructor(options: OptionsDocument = {}) {
    this.margeHaut = options.margeHaut ?? 54;
    this.margeBas = options.margeBas ?? 54;
    this.couleurFond = options.fond;
    this.pied = options.pied;
    this.courante = this.ouvrirPage();
    this.y = this.margeHaut;
  }

  private ouvrirPage(): Page {
    const page = new Page();
    if (this.couleurFond) page.fond(this.couleurFond);
    if (this.pied) {
      page.texte(LARGEUR / 2, HAUTEUR - this.margeBas + 24, this.pied, {
        taille: 6.5, couleur: GRIS, align: "centre",
      });
    }
    this.pages.push(page);
    return page;
  }

  page(): Page {
    return this.courante;
  }

  /** Place restante avant le pied de page. */
  restant(): number {
    return HAUTEUR - this.margeBas - this.y;
  }

  /** Ouvre une page si `hauteur` ne tient pas. Rend `true` si on a changé. */
  assurer(hauteur: number): boolean {
    if (this.restant() >= hauteur) return false;
    this.courante = this.ouvrirPage();
    this.y = this.margeHaut;
    return true;
  }

  sauter(hauteur: number): void {
    this.y += hauteur;
  }

  nombreDePages(): number {
    return this.pages.length;
  }

  rendre(): Buffer {
    return assembler(this.pages);
  }
}

/**
 * Assemble les pages en un fichier PDF.
 *
 * Structure minimale et conforme : catalogue, arbre de pages, deux polices
 * base-14, un flux de contenu par page, et une table de références croisées.
 */
export function assembler(pages: Page[]): Buffer {
  const objets: Buffer[] = [];
  const ajouter = (contenu: string | Buffer) => {
    objets.push(Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, "latin1"));
    return objets.length; // numéro de l'objet (1-indexé)
  };

  const premierePage = 4; // 1 catalogue, 2 pages, 3 polices (FN), 4+ pages
  const nPages = pages.length;
  const idsPages: number[] = [];
  for (let i = 0; i < nPages; i += 1) idsPages.push(premierePage + i * 2);

  ajouter("<< /Type /Catalog /Pages 2 0 R >>");
  ajouter(
    `<< /Type /Pages /Kids [${idsPages.map((n) => `${n} 0 R`).join(" ")}] /Count ${nPages} >>`,
  );
  ajouter(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  const idGrasse = premierePage + nPages * 2;
  for (const page of pages) {
    const flux = Buffer.from(page.contenu(), "latin1");
    const idContenu = objets.length + 2;
    ajouter(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGEUR} ${HAUTEUR}] ` +
      `/Resources << /Font << /FN 3 0 R /FB ${idGrasse} 0 R >> >> ` +
      `/Contents ${idContenu} 0 R >>`,
    );
    ajouter(
      Buffer.concat([
        Buffer.from(`<< /Length ${flux.length} >>\nstream\n`, "latin1"),
        flux,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
  }
  ajouter(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  const morceaux: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const decalages: number[] = [];
  let position = morceaux[0].length;

  objets.forEach((objet, i) => {
    decalages.push(position);
    const bloc = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      objet,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    morceaux.push(bloc);
    position += bloc.length;
  });

  const debutXref = position;
  let xref = `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const d of decalages) xref += `${String(d).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`;
  morceaux.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(morceaux);
}
