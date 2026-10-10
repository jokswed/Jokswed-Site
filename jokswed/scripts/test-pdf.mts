/* Banc du moteur documentaire : on génère, puis on RELIT le PDF produit. */
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const r_ = createRequire(import.meta.url);
const so = r_.resolve("server-only");
r_.cache[so] = { id: so, filename: so, loaded: true, exports: {} } as never;

const { dessinerCommercial, repartir } = await import("../lib/documents/gabarit-commercial.ts");
const { largeurTexte, decouper } = await import("../lib/documents/pdf.ts");

/* ⚠️ CHERCHER UNE PHRASE DANS LES OCTETS BRUTS NE MARCHE PAS.

   Deux raisons, toutes deux rencontrées :

     · le retour à la ligne découpe un paragraphe en plusieurs opérateurs
       `Tj` — « clé USB personnalisée » peut être à cheval sur deux lignes ;
     · WinAnsi encode « € » sur l'octet 0x80 et l'espace insécable sur 0xA0,
       qui ne sont pas les caractères Unicode correspondants.

   On extrait donc les chaînes affichées, on les recolle, et on normalise les
   espaces et le symbole monétaire. C'est ce que LIT un lecteur de PDF. */
function texteDuPdf(pdf: Buffer): string {
  const brut = pdf.toString("latin1");
  const morceaux: string[] = [];
  for (const m of brut.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    morceaux.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return morceaux
    .join(" ")
    .replace(/\u0080/g, "€")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/\s+/g, " ");
}

let ok = 0, ko = 0;
const v = (nom: string, c: boolean, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${nom}${c ? "" : " — " + d}`);
  c ? ok++ : ko++;
};

/* ── Métriques ── */
v("Largeur Helvetica d'un espace", Math.abs(largeurTexte(" ", 1000) - 278) < 0.01,
  String(largeurTexte(" ", 1000)));
v("Les accents ont l'avance de leur lettre de base",
  largeurTexte("é", 100) === largeurTexte("e", 100));
v("Le gras est plus large que le normal",
  largeurTexte("Formule", 10, "grasse") > largeurTexte("Formule", 10, "normale"));
v("Le découpage respecte la largeur",
  decouper("un texte assez long pour devoir passer à la ligne plusieurs fois", 80, 9)
    .every((l) => largeurTexte(l, 9) <= 80));

/* ── Répartition : le cas exact du devis fourni ── */
const trois = repartir(130000, 3);
v("1 300,00 € en trois fois = 433,33 / 433,33 / 433,34",
  JSON.stringify(trois) === JSON.stringify([43333, 43333, 43334]), JSON.stringify(trois));
v("La somme des échéances fait EXACTEMENT le total",
  trois.reduce((s, m) => s + m, 0) === 130000);
const deux = repartir(130000, 2);
v("1 300,00 € en deux fois = 650,00 / 650,00",
  JSON.stringify(deux) === JSON.stringify([65000, 65000]), JSON.stringify(deux));
v("Un total indivisible tombe juste quand même",
  repartir(100001, 3).reduce((s, m) => s + m, 0) === 100001);

/* ── Génération d'un devis complet ── */
const instantane = {
  titre: "DEVIS",
  numero: "DEV-2026-0001",
  dateEmission: "09/10/2026",
  validite: "30 jours",
  prestataire: {
    nomCommercial: "JoksWed",
    responsable: "RAHARISON JOHN",
    adresse: "7 rue Emmanuel Rain",
    codePostal: "95500", ville: "Gonesse",
    telephone: "07 69 90 25 99", email: "jokswed@exemple.invalid",
    siret: "93760042700010", codeApe: "74201",
  },
  client: { nom: "Prénom FICTIF", nom2: "Second FICTIF", email: "couple@exemple.invalid" },
  formuleNom: "Formule 2 - Signature",
  lignes: [{
    description: "Photos mariage", livraison: "Galerie : 13-15 jours\nAlbum : ~1 mois",
    lieu: "Château d'Essai", prix: "1 300,00 €\nTTC",
    quantite: "Minimum 800 photos retouchées", duree: "Jusqu'à 12 h", date: "24 juillet 2027",
  }],
  inclusions: [
    "Reportage photographique complet de la journée",
    "Galerie privée en ligne",
    "Photographies sélectionnées et retouchées en haute définition",
    "Séance couple le jour J", "Clé USB personnalisée",
    "Album premium 25 x 25 cm", "Couverture en cuir personnalisée",
    "Déplacements en France métropolitaine inclus",
  ],
  totalHtCents: 108333, totalTvaCents: 21667, totalTtcCents: 130000, tauxTvaBp: 2000,
  echeances: [
    { libelle: "1er versement / acompte", montantCents: 43333 },
    { libelle: "2e versement", montantCents: 43333 },
    { libelle: "Solde", montantCents: 43334 },
  ],
  conditions:
    "Le premier versement est exigible à la signature. Les autres conditions figurent " +
    "au contrat de prestation et aux CGV.",
};

const pdf = dessinerCommercial(instantane);
await writeFile(new URL("../.pgdev/devis-essai.pdf", import.meta.url), pdf);

v("Le PDF commence par l'en-tête de format", pdf.subarray(0, 5).toString() === "%PDF-");
v("Le PDF se termine par %%EOF", pdf.subarray(-6).toString().trim() === "%%EOF");
v("Le PDF pèse moins de 20 Ko", pdf.length < 20480, `${pdf.length} octets`);

const texte = pdf.toString("latin1");
v("Il déclare Helvetica et Helvetica-Bold",
  texte.includes("/BaseFont /Helvetica") && texte.includes("/BaseFont /Helvetica-Bold"));
v("Il déclare l'encodage WinAnsi", texte.includes("/WinAnsiEncoding"));
v("Il porte une table de références croisées", texte.includes("xref") && texte.includes("trailer"));
v("Le bandeau noir du total est tracé", /0\.000 0\.000 0\.000 rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f/.test(texte));

/* Le contenu : on vérifie ce que le lecteur affichera. */
for (const attendu of ["DEVIS", "JoksWed", "RAHARISON JOHN", "93760042700010",
                       "FORMULE 2 - SIGNATURE", "PRESTATIONS INCLUSES",
                       "TOTAL TTC", "MERCI DE VOTRE CONFIANCE"]) {
  v(`Le PDF contient « ${attendu} »`, texte.includes(attendu));
}
v("Les montants sont au format français",
  texte.includes("1 300,00") || texte.includes("1 300,00") || /1.300,00/.test(texte));
v("Les trois échéances figurent",
  texte.includes("433,33") && texte.includes("433,34"));

/* ── Brouillon : le bandeau d'avertissement ── */
const brouillon = dessinerCommercial({ ...instantane, numero: null, brouillon: true });
v("Un brouillon porte un bandeau d'avertissement",
  brouillon.toString("latin1").includes("BROUILLON"));
v("Un document émis n'en porte PAS", !texte.includes("BROUILLON"));

/* ── Le gabarit ne connaît aucune identité en dur ── */
const autreEntreprise = dessinerCommercial({
  ...instantane,
  prestataire: {
    nomCommercial: "Entreprise du vidéaste", responsable: "AUTRE PRESTATAIRE",
    siret: "11122233344455", adresse: "1 rue d'Essai", codePostal: "75000", ville: "Paris",
  },
  numero: "DEV-V-2026-0001",
}).toString("latin1");
v("Le même gabarit sert une AUTRE entreprise",
  autreEntreprise.includes("AUTRE PRESTATAIRE") && autreEntreprise.includes("11122233344455"));
v("…sans reprendre les mentions légales de JoksWed",
  !autreEntreprise.includes("93760042700010") && !autreEntreprise.includes("RAHARISON"));



/* ═══════════ CONTRATS — LES TROIS FORMULES ET LEURS CLAUSES ═══════════ */
const { dessinerContrat } = await import("../lib/documents/gabarit-contrat.ts");
const { contexteDepuisInclusions, clausesApplicables } =
  await import("../lib/documents/clauses.ts");
const { formules } = await import("../content/offres.ts");
const pdfium = null; // rendu assuré par le banc Python

const eur = (c: number) =>
  `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

v("Le catalogue porte bien trois formules", formules.length === 3);
v("Les prix du catalogue sont 1 000 / 1 300 / 1 600 €",
  formules.map((f) => f.prixCents).join(",") === "100000,130000,160000",
  formules.map((f) => f.prixCents).join(","));
v("Les durées sont 8 / 12 / 14 heures",
  formules.map((f) => f.dureeMinutes / 60).join(",") === "8,12,14",
  formules.map((f) => f.dureeMinutes / 60).join(","));

/* ⚠️ LA VÉRIFICATION QUI COMPTE : les clauses suivent les inclusions RÉELLES. */
const ctx1 = contexteDepuisInclusions(formules[0].inclus, 3);
const ctx2 = contexteDepuisInclusions(formules[1].inclus, 3);
const ctx3 = contexteDepuisInclusions(formules[2].inclus, 3);

v("Formule 1 : AUCUN album dans le catalogue", ctx1.albumInclus === false);
v("Formule 2 : album présent", ctx2.albumInclus === true);
v("Formule 3 : album ET coffret présents",
  ctx3.albumInclus === true && ctx3.coffretInclus === true);
v("Formule 3 : séance engagement incluse", ctx3.seanceEngagementIncluse === true);
v("Formules 1 et 2 : pas de séance engagement",
  !ctx1.seanceEngagementIncluse && !ctx2.seanceEngagementIncluse);

const cles = (c: never) => clausesApplicables(c).map((x) => x.cle);
v("Formule 1 : la clause « album » est ABSENTE",
  !cles(ctx1 as never).includes("album") && cles(ctx1 as never).includes("supports-sans-album"));
v("Formule 2 : la clause « album » est PRÉSENTE",
  cles(ctx2 as never).includes("album") && !cles(ctx2 as never).includes("supports-sans-album"));
v("Formule 3 : clause « séance engagement » présente",
  cles(ctx3 as never).includes("seance-engagement"));
v("Formules 1 et 2 : clause « séance engagement » absente",
  !cles(ctx1 as never).includes("seance-engagement")
    && !cles(ctx2 as never).includes("seance-engagement"));

const contratPour = (f: (typeof formules)[number], echeances = 3) => {
  const parts = repartir(f.prixCents, echeances);
  return dessinerContrat({
    numero: null, dateContrat: "06/10/2026",
    prestataire: instantane.prestataire,
    clients: [{ nom: "PRÉNOM Fictif", telephone: "06 00 00 00 00" }],
    emailClient: "couple@exemple.invalid",
    adresseClient: "1 rue d'Essai, 95100 Argenteuil",
    mariage: {
      date: "24 juillet 2027",
      ceremonie: "église à Gisors",
      reception: "Château de Dangu, 27720 Dangu",
      formule: f.nom, duree: `${Math.round(f.dureeMinutes / 60)} heures`,
    },
    devisReference: "Devis final",
    totalTtc: eur(f.prixCents), detailTva: "",
    acompte: eur(parts[0]), solde: eur(parts[parts.length - 1]),
    echeances: parts.map((m) => ({ libelle: "", montant: eur(m) })),
    inclusions: [...f.inclus],
    contexte: contexteDepuisInclusions(f.inclus, echeances),
    mediateurNom: "À COMPLÉTER AVANT SIGNATURE",
    mediateurUrl: "À COMPLÉTER AVANT SIGNATURE",
  } as never);
};

for (const f of formules) {
  const pdf = contratPour(f);
  const texte = pdf.toString("latin1");
  v(`Contrat ${f.nom} : PDF valide`, pdf.subarray(0, 5).toString() === "%PDF-");
  v(`Contrat ${f.nom} : mentionne sa durée`,
    texte.includes(`${Math.round(f.dureeMinutes / 60)} heures`));
  const lisible = texteDuPdf(pdf);
  v(`Contrat ${f.nom} : mentionne son prix`,
    lisible.includes(eur(f.prixCents).replace(/[\u00a0\u202f]/g, " ")),
    `attendu ${eur(f.prixCents)} — extrait : ${lisible.slice(lisible.indexOf('montant total'), lisible.indexOf('montant total') + 60)}`);
  /* ⚠️ AUCUN MOT NE DOIT ÊTRE COUPÉ ENTRE DEUX PAGES. */
  v(`Contrat ${f.nom} : aucun mot tronqué en fin de page`,
    !/\b[a-zà-ÿ]{2,}-\s[a-zà-ÿ]/.test(lisible), "un mot semble coupé");
  v(`Contrat ${f.nom} : articles 1 à 15 présents`,
    [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15].every((n) =>
      texte.includes(`ARTICLE ${n} -`)));
  v(`Contrat ${f.nom} : annexe de rétractation présente`,
    texte.includes("ANNEXE - FORMULAIRE TYPE DE RÉTRACTATION"));
  v(`Contrat ${f.nom} : signale le médiateur manquant`,
    texte.includes("À COMPLÉTER AVANT SIGNATURE"));
}

/* ⚠️ LE TEST QUI VALIDE TOUTE LA MÉCANIQUE DE CLAUSES. */
const c1 = texteDuPdf(contratPour(formules[0]));
const c2 = texteDuPdf(contratPour(formules[1]));
v("Formule 1 : le contrat NE PROMET PAS d'album",
  c1.includes("ne comprend pas d'album") && !c1.includes("ARTICLE 9 - ALBUM ET SUPPORTS"));
v("Formule 2 : le contrat décrit l'album inclus",
  c2.includes("ARTICLE 9 - ALBUM ET SUPPORTS") && /25\s*[x×]\s*25/.test(c2),
  c2.slice(c2.indexOf("ARTICLE 9"), c2.indexOf("ARTICLE 9") + 160));
v("Formule 1 : la clé USB reste mentionnée", c1.includes("clé USB personnalisée"));

/* Aperçu avant solde : seulement s'il reste un solde. */
const enUneFois = texteDuPdf(contratPour(formules[1], 1));
v("Paiement en une fois : pas de clause d'aperçu avant solde",
  !enUneFois.includes("aperçu représentant environ un tiers"));
v("Paiement en trois fois : la clause d'aperçu est présente",
  c2.includes("aperçu représentant environ un tiers"));

/* ═══════════ FACTURES ET AVOIRS ═══════════ */
const facture = texteDuPdf(dessinerCommercial({
  ...instantane, titre: "FACTURE D'ACOMPTE", numero: "FACT-2026-0001",
  validite: null, datePrestation: "24 juillet 2027",
  totalHtCents: 43333, totalTvaCents: 0, totalTtcCents: 43333, tauxTvaBp: 0,
  dejaRegleCents: 0, echeances: [],
  conditions: "Facture d'acompte. Le solde fera l'objet d'une facture distincte.",
  brouillon: false,
} as never));
v("La facture d'acompte porte son titre", facture.includes("FACTURE D'ACOMPTE"));
v("La facture porte la date de la prestation", facture.includes("Date de la prestation"));
v("La facture affiche « Reste à payer »", facture.includes("Reste à payer"));
v("La facture garde le bandeau noir du devis",
  /0\.000 0\.000 0\.000 rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f/.test(
    dessinerCommercial({
      ...instantane, titre: "FACTURE D'ACOMPTE", totalTtcCents: 43333,
      tauxTvaBp: 0, echeances: [], brouillon: false,
    } as never).toString("latin1")));

const avoir = texteDuPdf(dessinerCommercial({
  ...instantane, titre: "AVOIR", numero: "AV-2026-0001", validite: null,
  referenceOrigine: "FACT-2026-0001",
  totalHtCents: 43333, totalTvaCents: 0, totalTtcCents: 43333, tauxTvaBp: 0,
  echeances: [], conditions: "Avoir en rectification.", brouillon: false,
} as never));
v("L'avoir porte son titre et sa facture d'origine",
  avoir.includes("AVOIR") && avoir.includes("FACT-2026-0001"));
v("L'avoir affiche TOTAL AVOIR TTC", avoir.includes("TOTAL AVOIR TTC"));

/* ═══════════ ARRONDIS SUR LES TROIS FORMULES ═══════════ */
for (const f of formules) {
  for (const parts of [2, 3]) {
    const r = repartir(f.prixCents, parts);
    v(`${f.nom} en ${parts} fois : la somme tombe juste`,
      r.reduce((s, m) => s + m, 0) === f.prixCents,
      `${r.join("+")} = ${r.reduce((s, m) => s + m, 0)} au lieu de ${f.prixCents}`);
  }
}
/* Échéancier personnalisé : 5 fois sur un montant indivisible. */
const cinq = repartir(100001, 5);
v("Échéancier personnalisé (5 fois) : somme exacte",
  cinq.reduce((s, m) => s + m, 0) === 100001, cinq.join("+"));
v("…et le reliquat est bien sur la dernière",
  cinq[4] > cinq[0], cinq.join("+"));

/* ═══════════ LIBELLÉS DE CATALOGUE ═══════════
   Le contrat reprend les inclusions en milieu de phrase. Les passer au
   tout-minuscule écrivait « clé usb personnalisée » et « en france
   métropolitaine » : on ne doit toucher que l'initiale. */
for (const f of formules) {
  const texte = texteDuPdf(contratPour(f, 3));
  if (f.inclus.some((i: string) => /cl[ée] usb/i.test(i))) {
    v(`${f.nom} : le sigle USB reste en capitales dans le contrat`,
      texte.includes("clé USB") && !texte.includes("clé usb"));
  }
  if (f.inclus.some((i: string) => /France/.test(i))) {
    v(`${f.nom} : « France » garde sa majuscule dans le contrat`,
      !texte.includes("en france"));
  }
}

/* ═══════════ FUITE D'ÉTAT DE TEXTE ═══════════
   `Tc` (interlettrage) survit à BT/ET. Le bandeau « BROUILLON » l'écrivait à
   1.4 et tout le reste de la page sortait lettre-espacée : « Date de la
   prestation : » recouvrait sa propre valeur. On vérifie donc que CHAQUE bloc
   de texte redéclare son interlettrage, et que le brouillon ne décale rien. */
function blocsSansTc(pdf: Buffer): number {
  const brut = pdf.toString("latin1");
  let sans = 0;
  for (const m of brut.matchAll(/BT (?:(?!ET).)*?ET/gs)) {
    if (!/[\d.]+ Tc /.test(m[0])) sans++;
  }
  return sans;
}
const commun = { ...instantane, titre: "FACTURE D'ACOMPTE",
  validite: null, datePrestation: "26 août 2028" } as never;
const sansBrouillon = dessinerCommercial({ ...commun, brouillon: false } as never);
const avecBrouillon = dessinerCommercial({ ...commun, brouillon: true } as never);
v("Chaque bloc de texte redéclare son interlettrage",
  blocsSansTc(avecBrouillon) === 0, `${blocsSansTc(avecBrouillon)} bloc(s) sans Tc`);

function positions(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/1 0 0 1 ([\d.]+) [\d.]+ Tm \((.*?)\) Tj/g)]
    .map((m) => `${m[2]}@${m[1]}`);
}
const pSans = positions(sansBrouillon);
const pAvec = positions(avecBrouillon).filter((t) => !t.startsWith("BROUILLON"));
v("Le bandeau de brouillon ne déplace aucun autre texte",
  pSans.length === pAvec.length && pSans.every((t, i) => t === pAvec[i]),
  pSans.find((t, i) => t !== pAvec[i]) ?? `${pSans.length} vs ${pAvec.length}`);

/* La valeur d'une date ne doit jamais chevaucher son libellé. */
{
  const brut = avecBrouillon.toString("latin1");
  const lab = brut.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm \(Date de la prestation :\) Tj/);
  const val = lab && brut.match(
    new RegExp(`1 0 0 1 ([\\d.]+) ${lab[2].replace(".", "\\.")} Tm \\(26 ao`));
  v("La valeur d'une date ne recouvre pas son libellé",
    !!lab && !!val && Number(val[1]) >= Number(lab[1]) + largeurTexte(
      "Date de la prestation :", 8, "grasse") + 4,
    `libellé @${lab?.[1]} + ${largeurTexte("Date de la prestation :", 8, "grasse").toFixed(1)} vs valeur @${val?.[1]}`);
}

console.log(`\n${ok}/${ok + ko} vérifications du moteur documentaire.`);
process.exit(ko ? 1 : 0);
