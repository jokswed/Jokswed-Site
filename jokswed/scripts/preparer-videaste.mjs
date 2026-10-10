/* =============================================================================
   PRÉPARER L'ACCÈS D'UN VIDÉASTE PARTENAIRE
   -----------------------------------------------------------------------------
   ⚠️ CE SCRIPT N'ENVOIE RIEN. JAMAIS.

   Il crée, dans la base visée :
     · l'entreprise du partenaire, si elle n'existe pas ;
     · ses rôles (copiés des rôles modèles) ;
     · une invitation à son adresse, avec le rôle « vidéaste », valable 7 jours.

   `envoyee_le` reste NUL. L'envoi est un bouton de /admin/collaborateurs, que
   tu cliques quand tu le décides — et c'est le drain qui compose le lien, le
   déchiffre une seule fois, puis l'efface.

   Usage :
     npx tsx scripts/preparer-videaste.mjs                      (base de dev)
     DATABASE_URL_MIGRATEUR=… npx tsx scripts/preparer-videaste.mjs

   Options : --email=…  --entreprise="…"  --prenom=…  --nom=…
   ============================================================================= */
import { createRequire } from "node:module";
const r_ = createRequire(import.meta.url);
const so = r_.resolve("server-only");
r_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

import pg from "pg";

const arg = (cle, defaut) => {
  const t = process.argv.find((a) => a.startsWith(`--${cle}=`));
  return t ? t.slice(cle.length + 3) : defaut;
};

const EMAIL = arg("email", "cretinoiry@gmail.com");
const ENTREPRISE = arg("entreprise", "Yvann Cretinoir — Vidéaste");
const SLUG = arg("slug", "yvann-cretinoir");
const PRENOM = arg("prenom", "Yvann");
const NOM = arg("nom", "Cretinoir");
const JOURS = Number(arg("jours", "7"));

process.env.JOKSWED_CHIFFREMENT_CLE ??= Buffer.alloc(32, 7).toString("base64");
const { engendrerJeton, hacherJeton, chiffrer } = await import("../lib/auth/secrets.ts");

let url = process.env.DATABASE_URL_MIGRATEUR;
let pgdev = null;
if (!url) {
  const { demarrer, urlMigrateur, BASE } = await import("./pg-dev.mjs");
  pgdev = await demarrer();
  url = urlMigrateur(BASE);
  console.log("Base de DÉVELOPPEMENT locale.");
}

const c = new pg.Client({ connectionString: url });
c.on("error", () => {});
await c.connect();
try {
  await c.query("BEGIN");

  const { rows: [jokswed] } = await c.query(
    "SELECT id FROM entreprises WHERE slug = 'jokswed'");
  if (!jokswed) throw new Error("entreprise jokswed introuvable dans cette base");

  /* ⚠️ ON PASSE PAR LES FONCTIONS CONTRÔLÉES, PAS PAR DES INSERT BRUTS.
     Le script pourrait écrire directement : il se connecte en propriétaire de
     la base. Mais alors il ne prouverait rien du chemin que l'interface
     emprunte, et aucune ligne d'audit ne serait posée. On emprunte donc le
     MÊME chemin que l'administration, sous l'identité du propriétaire. */
  const { rows: [proprio] } = await c.query(
    `SELECT u.id FROM membres m JOIN utilisateurs u ON u.id = m.utilisateur_id
      WHERE m.entreprise_id = $1 AND m.retire_le IS NULL
        AND 'membre.inviter' = ANY (app.permissions_de(u.id, $1))
      ORDER BY m.ajoute_le LIMIT 1`, [jokswed.id]);
  if (!proprio) throw new Error("aucun membre de jokswed ne peut inviter");

  const jetonSession = `preparer-videaste-${Date.now()}`;
  await c.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,$2, now() + interval '5 minutes', true)`, [proprio.id, jetonSession]);
  await c.query("SELECT set_config('app.session_jeton',$1,true)", [jetonSession]);

  /* ── L'entreprise du partenaire ──
     ⚠️ UNE ENTREPRISE DISTINCTE, PAS UN RÔLE DANS LA MIENNE.
     C'est ce qui garantit que ses devis portent SON identité, que sa
     numérotation est à elle, et que ses montants n'entrent dans aucun de mes
     totaux. Le mariage est partagé ; le commercial ne l'est jamais.

     Le propriétaire de JoksWed y devient PARRAIN : deux permissions, inviter
     et révoquer. Ni les dossiers du partenaire, ni ses finances. */
  const { rows: [cree] } = await c.query(
    "SELECT app.creer_entreprise_partenaire($1,$2,$3,$4::citext) AS id",
    [jokswed.id, SLUG, ENTREPRISE, EMAIL]);
  const { rows: [ent] } = await c.query(
    "SELECT id, nom_commercial FROM entreprises WHERE id = $1", [cree.id]);

  const { rows: [role] } = await c.query(
    "SELECT id, libelle FROM roles WHERE entreprise_id = $1 AND cle = 'proprietaire'",
    [ent.id]);

  /* ── L'invitation ──
     Le jeton en clair n'est stocké nulle part : son empreinte sert à le
     reconnaître, sa version chiffrée sert à composer l'e-mail le jour de
     l'envoi, puis elle est effacée. */
  const { rows: existante } = await c.query(
    `SELECT id FROM invitations
      WHERE entreprise_id = $1 AND email = $2::citext
        AND utilisee_le IS NULL AND revoquee_le IS NULL`, [ent.id, EMAIL]);

  let invitationId;
  if (existante[0]) {
    invitationId = existante[0].id;
    console.log("Une invitation en cours existe déjà — rien de nouveau créé.");
  } else {
    const jeton = engendrerJeton();
    const { rows: [inv] } = await c.query(
      "SELECT app.admin_creer_invitation($1,$2::citext,$3,$4,$5,ARRAY[$6]::uuid[],$7,$8) AS id",
      [ent.id, EMAIL, PRENOM, NOM, hacherJeton(jeton), role.id, JOURS, chiffrer(jeton)]);
    invitationId = inv.id;
  }

  const { rows: [etat] } = await c.query(
    "SELECT email, expire_le, envoyee_le, utilisee_le FROM invitations WHERE id = $1",
    [invitationId]);

  await c.query("DELETE FROM sessions WHERE jeton_hache = $1", [jetonSession]);

  await c.query("COMMIT");

  console.log("");
  console.log("  Entreprise   :", ent.nom_commercial);
  console.log("  Rôle attribué:", role.libelle);
  console.log("  Invitation   :", etat.email);
  console.log("  Expire le    :", new Date(etat.expire_le).toLocaleString("fr-FR"));
  console.log("  Envoyée      :", etat.envoyee_le ? "OUI" : "NON — rien n'est parti");
  console.log("  Utilisée     :", etat.utilisee_le ? "OUI" : "non");
  console.log("");
  console.log("  Pour l'envoyer :");
  console.log("    1. /admin → « Entreprise active » → " + ent.nom_commercial);
  console.log("    2. /admin/collaborateurs → « Envoyer l'invitation »");
  console.log("  Aucun e-mail ne peut partir tant que BREVO_API_KEY est absente");
  console.log("  et que NODE_ENV n'est pas « production ».");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("échec :", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
  if (pgdev) await pgdev.stop();
}
