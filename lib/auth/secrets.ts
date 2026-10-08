import "server-only";
import {
  createCipheriv, createDecipheriv, createHmac, randomBytes,
  scrypt as scryptCb, timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/* =============================================================================
   PRIMITIVES DE SECRET
   -----------------------------------------------------------------------------
   ⚠️ POURQUOI PAS UN FOURNISSEUR D'IDENTITÉ HÉBERGÉ.

   Le cahier des charges demandait « une solution éprouvée ». Clerk, WorkOS ou
   Auth0 en sont — mais ils placent l'identité HORS de la base, alors que tout
   le cloisonnement RLS repose sur `app.acteur_id` résolu depuis `utilisateurs`
   et `membres`. On aurait deux sources de vérité à synchroniser, un coût
   mensuel par utilisateur actif, et une panne de plus entre le visiteur et son
   dossier.

   ⚠️ CE N'EST PAS POUR AUTANT DE LA CRYPTOGRAPHIE MAISON.

   Rien n'est inventé ici : scrypt (RFC 7914) avec les paramètres recommandés
   par l'OWASP, AES-256-GCM, et TOTP selon la RFC 6238. Ce sont des primitives
   de la bibliothèque standard de Node, assemblées selon leurs spécifications.
   La règle qui tient : on n'invente pas d'algorithme, on en applique.
   ============================================================================= */

/* --- MOTS DE PASSE : scrypt ---------------------------------------------------
   N = 2^17, r = 8, p = 1 : le minimum recommandé par l'OWASP pour scrypt.
   Coût mémoire = 128 × N × r ≈ 134 Mo, d'où `maxmem` relevé — sans quoi Node
   refuse l'opération avec sa limite par défaut de 32 Mo.

   Une vérification prend quelques centaines de millisecondes. C'est voulu :
   c'est ce qui rend une attaque par dictionnaire coûteuse.
   --------------------------------------------------------------------------- */
const SCRYPT_N = 2 ** 17;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const LONGUEUR_CLE = 64;

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  if (motDePasse.length < 12) {
    throw new Error("Le mot de passe doit faire au moins 12 caractères.");
  }
  const sel = randomBytes(16);
  const derive = (await scrypt(motDePasse.normalize("NFKC"), sel, LONGUEUR_CLE, {
    N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
  /* Les paramètres voyagent AVEC l'empreinte : le jour où on les renforce,
     les anciennes empreintes restent vérifiables et peuvent être migrées
     à la volée à la prochaine connexion réussie. */
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${sel.toString("base64")}$${derive.toString("base64")}`;
}

export async function verifierMotDePasse(motDePasse: string, empreinte: string): Promise<boolean> {
  const parties = empreinte.split("$");
  if (parties.length !== 6 || parties[0] !== "scrypt") return false;

  const [, n, r, p, selB64, attenduB64] = parties;
  const sel = Buffer.from(selB64, "base64");
  const attendu = Buffer.from(attenduB64, "base64");

  const derive = (await scrypt(motDePasse.normalize("NFKC"), sel, attendu.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
  })) as Buffer;

  /* Comparaison à durée constante : une comparaison ordinaire s'arrête au
     premier octet différent et laisse mesurer la longueur du préfixe correct. */
  return derive.length === attendu.length && timingSafeEqual(derive, attendu);
}

/* --- JETONS : opaques, et stockés hachés -------------------------------------
   Le jeton en clair n'existe que dans le cookie ou le lien d'invitation. La
   base n'en garde qu'une empreinte SHA-256 : une fuite de table ne permet ni
   d'usurper une session, ni d'utiliser une invitation.

   SHA-256 nu suffit ICI — et seulement ici : le secret fait 256 bits
   d'entropie aléatoire, il n'y a donc rien à deviner par force brute, à la
   différence d'un mot de passe choisi par un humain.
   --------------------------------------------------------------------------- */
export function engendrerJeton(): string {
  return randomBytes(32).toString("base64url");
}

export function hacherJeton(jeton: string): string {
  return createHmac("sha256", "jokswed:jeton:v1").update(jeton).digest("base64url");
}

/* --- CHIFFREMENT AU REPOS : AES-256-GCM --------------------------------------
   Pour les secrets qu'il faut pouvoir RELIRE : graine TOTP, jetons OAuth.
   GCM est authentifié : une altération du chiffré est détectée au
   déchiffrement, elle ne produit pas silencieusement un faux clair.
   --------------------------------------------------------------------------- */
function cleDeChiffrement(): Buffer {
  const brut = process.env.JOKSWED_CHIFFREMENT_CLE;
  if (!brut) {
    throw new Error(
      "JOKSWED_CHIFFREMENT_CLE absente : 32 octets en base64. " +
        "Sans elle, les graines TOTP seraient stockées en clair — on refuse.",
    );
  }
  const cle = Buffer.from(brut, "base64");
  if (cle.length !== 32) throw new Error("JOKSWED_CHIFFREMENT_CLE doit faire 32 octets.");
  return cle;
}

export function chiffrer(clair: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cleDeChiffrement(), iv);
  const chiffre = Buffer.concat([c.update(clair, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), chiffre]);
}

export function dechiffrer(paquet: Buffer): string {
  const iv = paquet.subarray(0, 12);
  const tag = paquet.subarray(12, 28);
  const d = createDecipheriv("aes-256-gcm", cleDeChiffrement(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(paquet.subarray(28)), d.final()]).toString("utf8");
}

/* --- TOTP : RFC 6238 ----------------------------------------------------------
   HMAC-SHA1, pas d'intervalle de 30 s, 6 chiffres — les valeurs par défaut de
   la norme, celles qu'attendent Google Authenticator, 1Password et Bitwarden.
   SHA-1 est ici conforme à la RFC et sans conséquence : il n'est pas utilisé
   comme fonction de résistance aux collisions.
   --------------------------------------------------------------------------- */
const ALPHABET_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function engendrerGraineTotp(): string {
  const octets = randomBytes(20);
  let bits = "";
  for (const o of octets) bits += o.toString(2).padStart(8, "0");
  let sortie = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    sortie += ALPHABET_B32[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return sortie;
}

function base32VersOctets(graine: string): Buffer {
  const propre = graine.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of propre) bits += ALPHABET_B32.indexOf(c).toString(2).padStart(5, "0");
  const octets: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets);
}

export function codeTotp(graine: string, pas = Math.floor(Date.now() / 30000)): string {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const mac = createHmac("sha1", base32VersOctets(graine)).update(compteur).digest();
  const decalage = mac[mac.length - 1] & 0x0f;
  const binaire =
    ((mac[decalage] & 0x7f) << 24) | ((mac[decalage + 1] & 0xff) << 16) |
    ((mac[decalage + 2] & 0xff) << 8) | (mac[decalage + 3] & 0xff);
  return String(binaire % 1_000_000).padStart(6, "0");
}

/**
 * Vérifie un code TOTP avec une fenêtre de ±1 pas.
 *
 * Une fenêtre existe parce que les horloges dérivent et que l'utilisateur met
 * quelques secondes à recopier le code. ±1 pas (90 s au total) est le
 * compromis usuel : au-delà, on allonge inutilement la durée de validité d'un
 * code intercepté.
 */
export function verifierTotp(graine: string, code: string, tolerance = 1): boolean {
  const propre = code.replace(/\D/g, "");
  if (propre.length !== 6) return false;
  const maintenant = Math.floor(Date.now() / 30000);
  for (let d = -tolerance; d <= tolerance; d += 1) {
    const attendu = codeTotp(graine, maintenant + d);
    if (timingSafeEqual(Buffer.from(attendu), Buffer.from(propre))) return true;
  }
  return false;
}

/** IP tronquée : /24 en IPv4, /48 en IPv6. Jamais l'adresse complète. */
export function tronquerIp(brut: string | null | undefined): string {
  const ip = (brut ?? "").split(",")[0]?.trim();
  if (!ip) return "inconnue";
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  const o = ip.split(".");
  return o.length === 4 ? `${o[0]}.${o[1]}.${o[2]}.0/24` : "inconnue";
}
