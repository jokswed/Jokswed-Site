/* Banc du moteur documentaire : on génère, puis on RELIT le PDF produit. */
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const r_ = createRequire(import.meta.url);
const so = r_.resolve("server-only");
r_.cache[so] = { id: so, filename: so, loaded: true, exports: {} } as never;

const { dessinerDevis, repartir } = await import("../lib/documents/gabarit-devis.ts");
const { largeurTexte, decouper } = await import("../lib/documents/pdf.ts");

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
  type: "devis" as const,
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
    designation: "Photos mariage", livraison: "Galerie : 13-15 jours\nAlbum : ~1 mois",
    lieu: "Château d'Essai", prixCents: 130000,
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

const pdf = dessinerDevis(instantane);
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
const brouillon = dessinerDevis({ ...instantane, numero: null, brouillon: true });
v("Un brouillon porte un bandeau d'avertissement",
  brouillon.toString("latin1").includes("BROUILLON"));
v("Un document émis n'en porte PAS", !texte.includes("BROUILLON"));

/* ── Le gabarit ne connaît aucune identité en dur ── */
const autreEntreprise = dessinerDevis({
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

console.log(`\n${ok}/${ok + ko} vérifications du moteur documentaire.`);
process.exit(ko ? 1 : 0);
