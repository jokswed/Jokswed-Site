/**
 * Pièces jointes de la messagerie JoksWed.
 *
 * Les fichiers sont enregistrés par blocs via le rôle PostgreSQL applicatif
 * (fonctions à permission fermée). On ne publie jamais une URL d'accès libre.
 *
 * Le transport HTTP Vercel est limité en taille : chaque bloc est <= 2 MiB,
 * même lorsque le fichier atteint 8 MiB.
 *
 * Les documents actifs (devis, factures, contrats) restent gérés par
 * app.joindre_document, ce module concerne les fichiers locaux de l'admin.
 */
export const TAILLE_FICHIER_MAX = 8 * 1024 * 1024;
export const TAILLE_BLOC_MAX = 2 * 1024 * 1024;
export const TAILLE_ENVOI_MAX = 10 * 1024 * 1024;
export const NOMBRE_FICHIERS_MAX = 4;

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const ACCEPT_FICHIERS = Object.keys(TYPES).map((ext) => "." + ext).join(",");

export function nomFichierSecurise(nom: unknown): string {
  if (typeof nom !== "string") throw new Error("Nom de fichier invalide");
  const n = nom.normalize("NFC").trim();
  if (n.length < 3 || n.length > 120 || /[\x00-\x1f\x7f/\\]/.test(n)
    || n.startsWith(".") || n.includes("..")) {
    throw new Error("Nom de fichier non autorisé");
  }
  return n;
}

export function mimeFichier(nom: string): string {
  const ext = nom.split(".").pop()?.toLowerCase() ?? "";
  const mime = TYPES[ext];
  if (!mime) {
    throw new Error("Format non pris en charge (PDF, images, Office, TXT, CSV)");
  }
  return mime;
}

export function verifierDebut(nom: string, bloc: Buffer): void {
  const ext = nom.split(".").pop()?.toLowerCase() ?? "";
  if (bloc.length < 4) throw new Error("Fichier incomplet ou vide");
  const debut = bloc.subarray(0, 8);
  const texte = debut.toString("latin1");
  const valide =
    ext === "pdf" ? texte.startsWith("%PDF-")
    : ["jpg", "jpeg"].includes(ext) ? debut[0] === 0xff && debut[1] === 0xd8 && debut[2] === 0xff
    : ext === "png" ? debut.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ext === "gif" ? texte.startsWith("GIF87a") || texte.startsWith("GIF89a")
    : ["docx", "xlsx", "pptx"].includes(ext)
      ? debut[0] === 0x50 && debut[1] === 0x4b &&
        ((debut[2] === 3 && debut[3] === 4) || (debut[2] === 5 && debut[3] === 6))
    : ["txt", "csv"].includes(ext)
      ? !bloc.subarray(0, Math.min(1024, bloc.length)).includes(0)
    : false;
  if (!valide) throw new Error("Le contenu ne correspond pas au format du fichier");
}

export function idValide(id: unknown): id is string {
  return typeof id === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}
