/* Banc des primitives de secret : comportement réel, pas inspection statique. */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

/* ⚠️ `server-only` LÈVE DÈS QU'IL EST ÉVALUÉ HORS D'UN BUNDLE REACT.
   C'est exactement son rôle : garantir qu'un module serveur ne parte jamais
   dans le paquet client. Pour l'éprouver depuis Node, on pré-remplit son
   entrée de cache afin qu'il ne s'exécute pas — sans modifier la source,
   qui doit continuer de porter la garde en production. */
const require_ = createRequire(import.meta.url);
const cheminServerOnly = require_.resolve("server-only");
require_.cache[cheminServerOnly] = {
  id: cheminServerOnly, filename: cheminServerOnly, loaded: true, exports: {},
} as never;

process.env.JOKSWED_CHIFFREMENT_CLE = randomBytes(32).toString("base64");

const m = await import("../lib/auth/secrets.ts");
let ok = 0, ko = 0;
const v = (nom: string, c: boolean, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${nom}${c ? "" : " — " + d}`);
  c ? ok++ : ko++;
};

const t0 = Date.now();
const emp = await m.hacherMotDePasse("un-mot-de-passe-assez-long");
const duree = Date.now() - t0;
v("Empreinte au format scrypt paramétré", emp.startsWith("scrypt$131072$8$1$"), emp.slice(0, 30));
v("Le mot de passe n'apparaît pas dans l'empreinte", !emp.includes("un-mot-de-passe"));
v("Deux empreintes du même mot de passe diffèrent (sel aléatoire)",
  emp !== (await m.hacherMotDePasse("un-mot-de-passe-assez-long")));
v("Le bon mot de passe est accepté", await m.verifierMotDePasse("un-mot-de-passe-assez-long", emp));
v("Un mot de passe faux est refusé", !(await m.verifierMotDePasse("un-mot-de-passe-assez-lonh", emp)));
v("Une empreinte malformée est refusée sans exception", !(await m.verifierMotDePasse("x", "nimporte")));
v(`Le hachage coûte assez cher (${duree} ms)`, duree > 80, `${duree} ms, trop rapide`);
try {
  await m.hacherMotDePasse("court");
  v("Un mot de passe trop court est refusé", false, "accepté");
} catch { v("Un mot de passe trop court est refusé", true); }

const j = m.engendrerJeton();
v("Jeton de 32 octets en base64url", j.length >= 42 && /^[A-Za-z0-9_-]+$/.test(j), j);
v("L'empreinte du jeton ne contient pas le jeton", !m.hacherJeton(j).includes(j));
v("Le hachage de jeton est déterministe", m.hacherJeton(j) === m.hacherJeton(j));

const secret = "graine-totp-secrete";
const paquet = m.chiffrer(secret);
v("Le chiffré ne contient pas le clair", !paquet.toString("utf8").includes(secret));
v("Le déchiffrement restitue le clair", m.dechiffrer(paquet) === secret);
const altere = Buffer.from(paquet); altere[altere.length - 1] ^= 1;
try { m.dechiffrer(altere); v("Une altération du chiffré est détectée (GCM)", false, "acceptée"); }
catch { v("Une altération du chiffré est détectée (GCM)", true); }

const graine = m.engendrerGraineTotp();
v("Graine TOTP en base32 de 32 caractères", /^[A-Z2-7]{32}$/.test(graine), graine);
const code = m.codeTotp(graine);
v("Code TOTP à 6 chiffres", /^\d{6}$/.test(code), code);
v("Le code courant est accepté", m.verifierTotp(graine, code));
v("Le code du pas précédent est accepté (tolérance ±1)",
  m.verifierTotp(graine, m.codeTotp(graine, Math.floor(Date.now() / 30000) - 1)));
v("Un code hors fenêtre est refusé",
  !m.verifierTotp(graine, m.codeTotp(graine, Math.floor(Date.now() / 30000) - 5)));
v("Un code à 5 chiffres est refusé", !m.verifierTotp(graine, "12345"));
/* Vecteur RFC 6238 : graine « 12345678901234567890 » en base32. */
v("Vecteur de test RFC 6238 (T=59)",
  m.codeTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", Math.floor(59 / 30)) === "287082",
  m.codeTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", Math.floor(59 / 30)));

v("IPv4 tronquée en /24", m.tronquerIp("203.0.113.42") === "203.0.113.0/24", m.tronquerIp("203.0.113.42"));
v("IPv6 tronquée en /48", m.tronquerIp("2001:db8:85a3:1:2:3:4:5").endsWith("::/48"));
v("Adresse absente gérée", m.tronquerIp(null) === "inconnue");

console.log(`\n${ok}/${ok + ko} vérifications passées.`);
process.exit(ko ? 1 : 0);
