/* =============================================================================
   FIXTURES DE DÉVELOPPEMENT
   -----------------------------------------------------------------------------
   ⚠️ AUCUN COMPTE RÉEL N'EST CRÉÉ ICI, ET AUCUNE INVITATION N'EST ENVOYÉE.

   Les adresses utilisées sont en `.invalid` — un domaine réservé par la
   RFC 2606, qui ne peut pas exister. Rien ne peut donc partir vers une vraie
   boîte, même par erreur de configuration.

   L'infrastructure d'invitation d'Yvann Cretinoir est PRÊTE (son entreprise,
   son rôle, ses permissions), mais son invitation n'est NI créée NI envoyée :
   cela demande une validation explicite.
   ============================================================================= */
import pg from "pg";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const so = require_.resolve("server-only");
require_.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

const ROLES_MODELES = [
  {
    cle: "proprietaire", libelle: "Propriétaire",
    description: "Accès complet à son entreprise et à la gestion des accès.",
    permissions: [
      "dossier.lire","dossier.ecrire","dossier.affecter","planning.lire","planning.ecrire",
      "client.coordonnees.lire","document.lire","document.rediger","document.emettre",
      "document.envoyer","finance.lire","finance.saisir_paiement","finance.confirmer_paiement",
      "finance.rembourser","catalogue.lire","catalogue.ecrire","collaboration.proposer",
      "collaboration.repondre","message.lire","message.envoyer","note.lire","note.ecrire",
      "membre.inviter","membre.revoquer","role.gerer","entreprise.reglages","audit.lire",
      /* ⚠️ `finance.consolide.lire` N'Y EST PAS, ET C'EST VOLONTAIRE.
         Une vue consolidée agrège des montants appartenant à des entreprises
         juridiquement distinctes. Elle doit rester un choix explicite, accordé
         à la main et tracé — jamais un effet de bord du rôle propriétaire. */
    ],
  },
  {
    cle: "administrateur", libelle: "Administrateur délégué",
    description: "Gestion courante, sans la main sur les rôles ni les remboursements.",
    permissions: [
      "dossier.lire","dossier.ecrire","dossier.affecter","planning.lire","planning.ecrire",
      "client.coordonnees.lire","document.lire","document.rediger","document.emettre",
      "document.envoyer","finance.lire","finance.saisir_paiement","catalogue.lire",
      "collaboration.proposer","collaboration.repondre","message.lire","message.envoyer",
      "note.lire","note.ecrire",
    ],
  },
  {
    cle: "photographe", libelle: "Photographe collaborateur",
    description: "Les dossiers qui lui sont attribués, sans accès aux finances.",
    permissions: [
      "dossier.lire","planning.lire","client.coordonnees.lire","document.lire",
      "message.lire","message.envoyer","note.lire","note.ecrire","catalogue.lire",
    ],
  },
  {
    cle: "videaste", libelle: "Vidéaste collaborateur",
    description: "Ses dossiers, ses documents, ses finances — et rien d'autre.",
    permissions: [
      "dossier.lire","dossier.ecrire","planning.lire","client.coordonnees.lire",
      "document.lire","document.rediger","document.emettre","document.envoyer",
      "finance.lire","finance.saisir_paiement","catalogue.lire","catalogue.ecrire",
      "collaboration.repondre","message.lire","message.envoyer","note.lire","note.ecrire",
    ],
  },
  {
    cle: "assistant", libelle: "Assistant",
    description: "Planning et dossiers affectés. Aucune finance, aucune coordonnée.",
    permissions: ["dossier.lire","planning.lire","message.lire","catalogue.lire"],
  },
  {
    cle: "monteur", libelle: "Monteur",
    description: "Les dossiers affectés, en lecture, pour la post-production.",
    permissions: ["dossier.lire","planning.lire","message.lire"],
  },
];

export async function semer(urlMigrateur, { silencieux = false } = {}) {
  process.env.JOKSWED_CHIFFREMENT_CLE ??= Buffer.alloc(32, 7).toString("base64");
  const { hacherMotDePasse } = await import("../lib/auth/secrets.ts");

  const c = new pg.Client({ connectionString: urlMigrateur });
  await c.connect();
  const dire = (m) => { if (!silencieux) console.log(m); };

  try {
    await c.query("BEGIN");

    /* ── Rôles modèles (entreprise_id NULL) ── */
    for (const r of ROLES_MODELES) {
      const { rows } = await c.query(
        `INSERT INTO roles (entreprise_id, cle, libelle, description, systeme)
         VALUES (NULL, $1, $2, $3, true)
         ON CONFLICT DO NOTHING RETURNING id`, [r.cle, r.libelle, r.description]);
      if (rows[0]) {
        for (const p of r.permissions) {
          await c.query(
            "INSERT INTO roles_permissions (role_id, permission_cle) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [rows[0].id, p]);
        }
      }
    }
    dire(`  ✓ ${ROLES_MODELES.length} rôles modèles`);

    /* ── Entreprise 1 : JoksWed ── */
    const { rows: [jokswed] } = await c.query(
      `INSERT INTO entreprises (slug, nom_commercial, raison_sociale, forme_juridique,
                                siret, code_ape, adresse_ligne1, code_postal, ville,
                                email, telephone)
       VALUES ('jokswed','JoksWed','RAHARISON John','Entrepreneur individuel',
               '93760042700010','74201','7 rue Emmanuel Rain','95500','Gonesse',
               'jokswed@exemple.invalid','07 00 00 00 00')
       ON CONFLICT (slug) DO UPDATE SET maj_le = now() RETURNING id`);

    /* ⚠️ LE RÉGIME DE TVA N'EST PAS RENSEIGNÉ.
       Le devis fourni applique 20 % sans numéro intracommunautaire : soit le
       numéro manque, soit le taux est l'anomalie. Seul le comptable tranche.
       Tant que `regimes_tva` est vide pour cette entreprise, la garde
       d'émission documentaire (V5) refusera tout document définitif. */

    /* ── Entreprise 2 : celle du vidéaste partenaire ── */
    const { rows: [videoEnt] } = await c.query(
      `INSERT INTO entreprises (slug, nom_commercial, email)
       VALUES ('videaste-partenaire','Entreprise du vidéaste partenaire',
               'videaste@exemple.invalid')
       ON CONFLICT (slug) DO UPDATE SET maj_le = now() RETURNING id`);

    /* ── Copie des rôles modèles dans chaque entreprise ── */
    for (const ent of [jokswed.id, videoEnt.id]) {
      await c.query(
        `INSERT INTO roles (entreprise_id, cle, libelle, description, systeme)
         SELECT $1, cle, libelle, description, true FROM roles WHERE entreprise_id IS NULL
         ON CONFLICT DO NOTHING`, [ent]);
      await c.query(
        `INSERT INTO roles_permissions (role_id, permission_cle)
         SELECT r2.id, rp.permission_cle
           FROM roles r1
           JOIN roles_permissions rp ON rp.role_id = r1.id
           JOIN roles r2 ON r2.cle = r1.cle AND r2.entreprise_id = $1
          WHERE r1.entreprise_id IS NULL
         ON CONFLICT DO NOTHING`, [ent]);
    }
    dire("  ✓ 2 entreprises, rôles copiés");

    /* ── Utilisateurs de développement ── */
    const empreinte = await hacherMotDePasse("mot-de-passe-de-developpement");
    const creerUtilisateur = async (email, prenom, nom) => {
      const { rows } = await c.query(
        `INSERT INTO utilisateurs (email, prenom, nom, email_verifie_le)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (email) DO UPDATE SET maj_le = now() RETURNING id`, [email, prenom, nom]);
      await c.query(
        `INSERT INTO identifiants (utilisateur_id, type, secret_hache)
         VALUES ($1,'mot_de_passe',$2)
         ON CONFLICT (utilisateur_id) WHERE type = 'mot_de_passe' DO NOTHING`,
        [rows[0].id, empreinte]).catch(async () => {
          await c.query(
            `INSERT INTO identifiants (utilisateur_id, type, secret_hache)
             SELECT $1,'mot_de_passe',$2
              WHERE NOT EXISTS (SELECT 1 FROM identifiants
                                 WHERE utilisateur_id = $1 AND type='mot_de_passe')`,
            [rows[0].id, empreinte]);
        });
      return rows[0].id;
    };

    const proprietaire = await creerUtilisateur("proprietaire@exemple.invalid", "John", "Raharison");
    const videaste     = await creerUtilisateur("videaste@exemple.invalid", "Vidéaste", "Partenaire");
    const assistant    = await creerUtilisateur("assistant@exemple.invalid", "Assistant", "Essai");
    /* Un second membre de JoksWed qui n'est jamais révoqué : les bancs ont
       besoin d'une cible stable pour éprouver le CHEMIN LÉGITIME, et non
       seulement les refus. Une protection qui bloque aussi l'usage normal
       n'est pas une protection, c'est une panne. */
    const photographe  = await creerUtilisateur("photographe@exemple.invalid", "Photographe", "Essai");

    const rattacher = async (utilisateur, entreprise, cleRole) => {
      const { rows: [m] } = await c.query(
        `INSERT INTO membres (entreprise_id, utilisateur_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING RETURNING id`, [entreprise, utilisateur]);
      const membreId = m?.id ?? (await c.query(
        "SELECT id FROM membres WHERE entreprise_id=$1 AND utilisateur_id=$2 AND retire_le IS NULL",
        [entreprise, utilisateur])).rows[0].id;
      const { rows: [r] } = await c.query(
        "SELECT id FROM roles WHERE entreprise_id=$1 AND cle=$2", [entreprise, cleRole]);
      await c.query(
        "INSERT INTO membres_roles (membre_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [membreId, r.id]);
      return membreId;
    };

    await rattacher(proprietaire, jokswed.id, "proprietaire");
    await rattacher(videaste, videoEnt.id, "proprietaire");
    await rattacher(assistant, jokswed.id, "assistant");
    await rattacher(photographe, jokswed.id, "photographe");
    dire("  ✓ 4 utilisateurs de développement");

    /* ── Deux mariages : un partagé, un propre à JoksWed ── */
    const { rows: [mPartage] } = await c.query(
      `INSERT INTO mariages (reference, date_mariage, ville, departement)
       VALUES ('MAR-2027-0001','2027-07-24','Dangu','27')
       ON CONFLICT (reference) DO UPDATE SET maj_le = now() RETURNING id`);
    const { rows: [mPrive] } = await c.query(
      `INSERT INTO mariages (reference, date_mariage, ville, departement)
       VALUES ('MAR-2027-0002','2027-09-11','Paris','75')
       ON CONFLICT (reference) DO UPDATE SET maj_le = now() RETURNING id`);

    await c.query(
      `INSERT INTO contacts (mariage_id, role, prenom, nom, email, principal)
       VALUES ($1,'marie_1','Prénom','Fictif','maries@exemple.invalid', true)
       ON CONFLICT DO NOTHING`, [mPartage.id]);
    await c.query(
      `INSERT INTO contacts (mariage_id, role, prenom, nom, email, principal)
       VALUES ($1,'marie_1','Autre','Fictif','autres@exemple.invalid', true)
       ON CONFLICT DO NOTHING`, [mPrive.id]);

    const dossier = async (mariage, entreprise, ref, prestation, pilote) => {
      const { rows } = await c.query(
        `INSERT INTO dossiers (mariage_id, entreprise_id, reference, prestation, pilote)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (mariage_id, entreprise_id, prestation) DO UPDATE SET maj_le = now()
         RETURNING id`, [mariage, entreprise, ref, prestation, pilote]);
      return rows[0].id;
    };

    const dJokswedPartage = await dossier(mPartage.id, jokswed.id, "D-2027-0001", "photo", true);
    const dVideoPartage   = await dossier(mPartage.id, videoEnt.id, "D-V-0001", "video", false);
    const dJokswedPrive   = await dossier(mPrive.id, jokswed.id, "D-2027-0002", "photo", true);

    /* Le vidéaste voit le planning et les lieux, PAS encore les coordonnées :
       c'est une catégorie de partage distincte, accordée séparément. */
    for (const cat of ["planning", "lieux"]) {
      await c.query(
        `INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [mPartage.id, videoEnt.id, cat]);
    }
    for (const cat of ["planning", "lieux", "coordonnees_clients"]) {
      await c.query(
        `INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [mPartage.id, jokswed.id, cat]);
      await c.query(
        `INSERT INTO partages_mariage (mariage_id, entreprise_id, categorie)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [mPrive.id, jokswed.id, cat]);
    }
    dire("  ✓ 2 mariages, 3 dossiers, partages posés");

    await c.query("COMMIT");
    return {
      entreprises: { jokswed: jokswed.id, video: videoEnt.id },
      utilisateurs: { proprietaire, videaste, assistant, photographe },
      mariages: { partage: mPartage.id, prive: mPrive.id },
      dossiers: { jokswedPartage: dJokswedPartage, videoPartage: dVideoPartage, jokswedPrive: dJokswedPrive },
      motDePasse: "mot-de-passe-de-developpement",
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { demarrer, urlMigrateur } = await import("./pg-dev.mjs");
  const pgdev = await demarrer();
  try {
    const r = await semer(urlMigrateur());
    console.log("\nFixtures posées. Identifiants de DÉVELOPPEMENT uniquement :");
    console.log("  proprietaire@ · videaste@ · assistant@ · photographe@ (exemple.invalid)");
    console.log(`  mot de passe : ${r.motDePasse}`);
  } finally {
    await pgdev.stop();
  }
}
