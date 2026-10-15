import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { tracer } from "@/lib/auth/acces";
import { formaterDateSql } from "@/lib/dates";
import { formaterPrix } from "@/content/offres";
import {
  genererDevisDepuisDemande, genererContratDepuisDevis,
  genererFactureDepuisDevis, genererAvoir, rendrePdf,
} from "@/lib/documents/generer";
import { createHash } from "node:crypto";
import { LIBELLES_STATUT } from "../page";

export const dynamic = "force-dynamic";

const STATUTS = [
  "non_lue", "a_traiter", "attente_client", "attente_collaborateur",
  "en_cours_devis", "devis_envoye", "confirmee", "refusee", "annulee",
  "close", "archivee",
];

/* Les catégories de fichiers, telles que la contrainte de la table les
   accepte : une valeur absente d'ici serait refusée EN BASE, pas ici. */
const CATEGORIES_FICHIER = [
  ["planning", "Planning"],
  ["inspirations", "Inspirations"],
  ["contrat", "Contrat"],
  ["devis", "Devis"],
  ["paiement", "Paiement"],
  ["photos", "Photos"],
  ["autre", "Autre"],
];

/* ⚠️ LISTE BLANCHE, ET LA MÊME QUE CELLE DE LA TABLE.
   Le contrôle en base est celui qui compte ; celui-ci sert à refuser tôt et
   à expliquer. Ni HTML ni SVG : servis depuis notre domaine, ils y
   exécuteraient leur script. */
const MIMES_FICHIER = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
]);
const TAILLE_MAX = 8 * 1024 * 1024;

/* Les montants arrivent en euros depuis un champ texte : on arrondit APRÈS
   multiplication, et on ne garde que des centimes entiers. */
function centimes(brut) {
  const net = String(brut ?? "").replace(/\s/g, "").replace(",", ".").trim();
  if (!net) return null;
  const cents = Math.round(Number.parseFloat(net) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

export default async function FicheDemande({ params }) {
  const { id } = await params;
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["dossier.lire"]);

  const vue = await acces.executer(async (q) => {
    /* ⚠️ AUCUN FILTRE `entreprise_id` ÉCRIT À LA MAIN ICI.
       La politique de `demandes` s'en charge : un identifiant appartenant à
       une autre entreprise ne rend simplement aucune ligne. C'est vérifié par
       un banc, en attaquant la route directement. */
    const { rows } = await q("SELECT * FROM demandes WHERE id = $1", [id]);
    if (rows.length === 0) return null;

    /* ⚠️ SÉQUENTIEL, PAS `Promise.all`.
       Ces requêtes partagent UNE connexion, celle de la transaction qui porte
       l'identité de l'acteur. `pg` avertit explicitement qu'appeler `query()`
       pendant qu'une autre s'exécute est déprécié et sera retiré en 9.0 — et
       en attendant, l'ordre des réponses n'est pas garanti. Le gain d'un
       parallélisme qui n'en est pas un ne vaut pas ce risque. */
    const lignes = await q(
      "SELECT * FROM demande_lignes WHERE demande_id = $1 ORDER BY ordre", [id]);
    const consentements = await q(
      "SELECT * FROM consentements WHERE demande_id = $1 ORDER BY finalite", [id]);
    const notes = await q(
      `SELECT n.*, u.prenom, u.nom FROM notes_internes n
           JOIN utilisateurs u ON u.id = n.auteur_id
          WHERE n.demande_id = $1 ORDER BY n.cree_le DESC`, [id]);
    /* ⚠️ PAS DE JOINTURE VERS `entreprises`.
       Sa politique ne rend que les entreprises dont l'acteur est membre : la
       jointure vidait la proposition et faisait disparaître tout le bloc
       « prestation vidéo » de la fiche, sans la moindre erreur. Le nom du
       partenaire est dénormalisé sur la proposition (palier 012), ce qui
       évite aussi d'exposer le reste de sa fiche — RLS filtre des lignes,
       pas des colonnes. */
    const proposition = await q(
      "SELECT * FROM propositions WHERE demande_id = $1", [id]);
    const documents = await q(
      `SELECT id, type, numero, statut, total_ttc_cents, cree_le, emis_le
         FROM documents WHERE demande_id = $1 ORDER BY cree_le DESC`, [id]);
    /* Les motifs qui empêcheraient une émission définitive : on les affiche
       AVANT que l'utilisateur clique, pas après. */
    const verdict = await q(
      "SELECT * FROM app.verdict_emission($1,'devis')", [entreprise.id]);
    /* ⚠️ LES PRÉREQUIS DIFFÈRENT SELON LE TYPE DE DOCUMENT.
       Le médiateur n'est exigé que pour un contrat : une facture peut être
       émise sans lui. On interroge donc la garde pour chaque type plutôt que
       d'appliquer le verdict du devis à tout. */
    const verdictContrat = await q(
      "SELECT * FROM app.verdict_emission($1,'contrat')", [entreprise.id]);
    const situation = await q(
      "SELECT * FROM app.situation_financiere($1)", [id]);
    /* Les mouvements financiers du dossier, saisies non confirmées comprises :
       c'est le journal que l'on relit quand un chiffre surprend. */
    const paiements = await q(
      `SELECT p.id, p.montant_cents, p.montant_signe_cents, p.moyen, p.type_paiement,
              p.statut, p.reference, p.recu_le, p.motif, p.corrige_id,
              u.prenom AS saisi_prenom
         FROM paiements p LEFT JOIN utilisateurs u ON u.id = p.saisi_par
        WHERE p.demande_id = $1 ORDER BY p.recu_le DESC, p.saisi_le DESC`, [id]);
    /* ⚠️ PAS DE `SELECT … FROM entreprises` ICI.
       La politique `entreprise_membre` ne rend que SES propres entreprises :
       la jointure supprimait la proposition et la fiche affichait « aucune
       proposition » alors qu'il y en avait une. Deux fonctions contrôlées
       rendent le SEUL champ utile — la raison commerciale du partenaire. */
    const partenaires = acces.permissions.has("collaboration.proposer")
      ? await q("SELECT * FROM app.partenaires_disponibles($1)", [entreprise.id])
      : { rows: [] };
    const propositions = await q("SELECT * FROM app.propositions_emises($1)", [id]);
    /* Pourquoi une proposition n'est pas partie toute seule. Un écran qui
       dit « en attente » sans dire pourquoi oblige à deviner. */
    const enAttente = acces.permissions.has("collaboration.proposer")
      ? await q("SELECT * FROM app.propositions_en_attente($1)", [entreprise.id])
      : { rows: [] };

    /* L'échéancier du dossier, avec l'état DÉDUIT des paiements rattachés :
       « à recevoir », « déclaré », « reçu ». Aucune colonne d'état en double. */
    const echeancier = await q("SELECT * FROM app.echeancier_demande($1)", [id]);
    const planning = await q(
      `SELECT id, ordre, heure, titre, lieu, notes
         FROM etapes_planning WHERE demande_id = $1 ORDER BY ordre`, [id]);
    /* ⚠️ SANS `contenu` : un octet de plus que nécessaire traverserait le
       réseau à chaque affichage de la fiche. Le contenu ne sort que par la
       route de téléchargement. */
    const fichiers = await q(
      `SELECT id, nom, categorie, type_mime, taille_octets, partage, cree_le
         FROM fichiers_dossier WHERE demande_id = $1
        ORDER BY cree_le DESC`, [id]);
    /* Les collaborateurs affectés au dossier, s'il existe. */
    const affectes = rows[0].dossier_id
      ? await q(
          `SELECT a.id, a.mission, u.prenom, u.nom
             FROM affectations a JOIN utilisateurs u ON u.id = a.utilisateur_id
            WHERE a.dossier_id = $1 AND a.retiree_le IS NULL
            ORDER BY u.nom`, [rows[0].dossier_id])
      : { rows: [] };

    /* Première ouverture : on marque la demande lue et on la sort de « non
       lue ». C'est une lecture qui change l'état, donc on la trace. */
    if (!rows[0].lue_le) {
      await q(
        `UPDATE demandes SET lue_le = now(),
                statut = CASE WHEN statut = 'non_lue' THEN 'a_traiter' ELSE statut END
          WHERE id = $1`, [id]);
      await tracer(q, session.utilisateurId, entreprise.id, "demande.lue", "demande", id);
    }

    return {
      demande: rows[0],
      lignes: lignes.rows,
      consentements: consentements.rows,
      notes: notes.rows,
      proposition: proposition.rows[0] ?? null,
      documents: documents.rows,
      motifsBlocage: verdict.rows[0]?.motifs ?? [],
      motifsContrat: verdictContrat.rows[0]?.motifs ?? [],
      situation: situation.rows[0] ?? null,
      paiements: paiements.rows,
      partenaires: partenaires.rows,
      propositions: propositions.rows,
      enAttente: enAttente.rows.filter((p) => p.demande_id === id),
      echeancier: echeancier.rows,
      planning: planning.rows,
      fichiers: fichiers.rows,
      affectes: affectes.rows,
    };
  });

  if (!vue) notFound();
  const { demande, lignes, consentements, notes, proposition, documents,
          motifsBlocage, motifsContrat, situation, paiements, partenaires,
          propositions, enAttente, echeancier, planning, fichiers,
          affectes } = vue;
  const devisEmis = documents.find((d) => d.type === "devis" && d.statut !== "brouillon");
  const devisDisponible = devisEmis ?? documents.find((d) => d.type === "devis");
  const peutEcrire = acces.permissions.has("dossier.ecrire");

  /* ⚠️ PAR LA FONCTION MÉTIER, PAS PAR UN `UPDATE` LIBRE.
     Un `UPDATE demandes SET statut = 'confirmee'` écrivait l'état sans créer
     le mariage ni le dossier : le carnet annonçait une date que rien ne
     portait — ni planning, ni affectation, ni flux de calendrier.
     `app.definir_statut_demande` renvoie « confirmee » vers
     `app.confirmer_demande`, qui crée l'objet ou refuse faute de date. Une
     seule transition, et elle est cohérente. */
  async function changerStatut(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const nouveau = String(formulaire.get("statut") ?? "");
    if (!STATUTS.includes(nouveau)) return;
    await a.executer((q) =>
      q("SELECT app.definir_statut_demande($1,$2)", [id, nouveau]));
    revalidatePath(`/admin/demandes/${id}`);
    revalidatePath("/admin");
  }

  /* ⚠️ UNE MODIFICATION SE RÉPERCUTE PARTOUT, OU ELLE N'A PAS LIEU.
     `app.maj_demande` écrit la demande ET le mariage dans la même
     transaction : le tableau de bord, la saison, le flux Apple et l'espace
     d'un collaborateur lisent donc tous la nouvelle date. Il n'existe pas de
     copie à resynchroniser plus tard.

     ⚠️ ET `instantane` N'EST JAMAIS TOUCHÉ.
     Il garde ce que le client a réellement soumis — c'est la preuve de ce
     qu'il a vu et demandé, pas un brouillon de travail. */
  async function modifier(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);

    const texte = (nom) => String(formulaire.get(nom) ?? "").trim();
    const prix = centimes(formulaire.get("prix_total"));
    const nombre = Number.parseInt(String(formulaire.get("echeances") ?? ""), 10);

    /* Seules les clés PRÉSENTES sont modifiées : la fonction distingue une
       clé absente (on ne touche pas) d'une clé vide (on efface). */
    const champs = {
      contact_nom: texte("nom_1"),
      contact_nom_2: texte("nom_2"),
      contact_email: texte("email"),
      contact_telephone: texte("telephone"),
      contact_adresse: texte("adresse"),
      date_mariage: texte("date_mariage"),
      heure_debut: texte("heure_debut"),
      heure_fin: texte("heure_fin"),
      lieu_mairie: texte("mairie"),
      lieu_ceremonie: texte("ceremonie"),
      lieu_reception: texte("domaine"),
      lieu: texte("lieu"),
      ville: texte("ville"),
      departement: texte("departement"),
      invites_estimes: texte("invites"),
      horaires: texte("horaires"),
      formule_nom: texte("formule_nom"),
      photobooth_360: formulaire.get("photobooth") === "1",
      photobooth_prix_cents: (() => {
        const c = centimes(formulaire.get("photobooth_prix"));
        return c === null ? "" : String(c);
      })(),
      complements: texte("complements"),
    };
    /* Le prix et l'échéancier ne passent QUE s'ils sont fournis : une fiche
       enregistrée avec le champ vide ne doit pas effacer un prix convenu. */
    if (prix !== null) champs.prix_total_cents = String(prix);
    if ([1, 2, 3].includes(nombre)) champs.nombre_echeances = String(nombre);

    await a.executer((q) =>
      q("SELECT app.maj_demande($1,$2::jsonb)", [id, JSON.stringify(champs)]));
    revalidatePath(`/admin/demandes/${id}`);
    revalidatePath("/admin");
    revalidatePath("/admin/saison");
  }

  /* ── L'échéancier : 1×, 2× ou 3× ──
     ⚠️ LE PARTAGE SE FAIT EN CENTIMES ENTIERS, EN BASE.
     1300 € en 3× donne 433,33 / 433,33 / 433,34 — le centime restant va sur
     la dernière échéance, sinon la somme des trois est inférieure d'un
     centime au total et le dossier ne se solde jamais. Aucun flottant. */
  async function definirEcheancier(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const total = centimes(formulaire.get("total"));
    const nombre = Number.parseInt(String(formulaire.get("nombre") ?? "1"), 10);
    if (total === null || ![1, 2, 3].includes(nombre)) return;
    await a.executer((q) =>
      q("SELECT app.definir_echeancier($1,$2,$3)", [id, total, nombre]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ── Le planning de la journée ── */
  async function enregistrerEtape(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["planning.ecrire"]);
    const titre = String(formulaire.get("titre") ?? "").trim();
    if (!titre) return;
    const etape = String(formulaire.get("etape") ?? "");
    const ordre = Number.parseInt(String(formulaire.get("ordre") ?? ""), 10);
    const valeurs = [
      String(formulaire.get("heure") ?? "") || null,
      titre.slice(0, 200),
      String(formulaire.get("lieu") ?? "").trim() || null,
      String(formulaire.get("notes") ?? "").trim() || null,
    ];
    await a.executer(async (q) => {
      if (etape) {
        await q(
          `UPDATE etapes_planning SET heure = $1, titre = $2, lieu = $3, notes = $4
            WHERE id = $5 AND demande_id = $6`, [...valeurs, etape, id]);

        /* ⚠️ LE RANG SE CHANGE PAR UNE FONCTION, PAS PAR UN `UPDATE`.
           `etape_ordre_unique` refuse deux étapes au même rang : écrire « 2 »
           là où une autre se trouve déjà levait une violation de contrainte,
           donc une 500. `app.reordonner_etape` échange les deux rangs dans
           une seule transaction, en passant par une valeur temporaire. */
        if (Number.isFinite(ordre) && ordre > 0) {
          await q("SELECT app.reordonner_etape($1,$2)", [etape, ordre]);
        }
        return;
      }
      /* Le rang suivant, calculé en base : deux ajouts simultanés ne se
         retrouvent pas au même ordre — la contrainte d'unicité le refuserait. */
      await q(
        `INSERT INTO etapes_planning (demande_id, entreprise_id, ordre, heure,
                                      titre, lieu, notes)
         SELECT $1, $2,
                coalesce((SELECT max(ordre) FROM etapes_planning WHERE demande_id = $1), 0) + 1,
                $3, $4, $5, $6`,
        [id, e.id, ...valeurs]);
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function supprimerEtape(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["planning.ecrire"]);
    await a.executer((q) => q(
      "DELETE FROM etapes_planning WHERE id = $1 AND demande_id = $2",
      [String(formulaire.get("etape")), id]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ── Les fichiers du dossier ──
     ⚠️ TROIS CONTRÔLES, ET LE DERNIER EST EN BASE.
     Type MIME en liste blanche, taille bornée, nom assaini. La contrainte de
     la table refuse de toute façon un type absent de la liste : ce qui est
     écrit ici explique, ce qui est écrit là-bas protège. */
  async function deposerFichier(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const fichier = formulaire.get("fichier");
    if (!fichier || typeof fichier === "string" || fichier.size === 0) return;
    if (!MIMES_FICHIER.has(fichier.type) || fichier.size > TAILLE_MAX) return;
    const categorie = String(formulaire.get("categorie") ?? "autre");
    if (!CATEGORIES_FICHIER.some(([c]) => c === categorie)) return;

    /* Le nom d'origine est une chaîne venue du poste du client : on ne garde
       que ce qui ne peut pas tromper un en-tête ou un chemin. */
    const nom = (fichier.name || "fichier")
      .replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const octets = Buffer.from(await fichier.arrayBuffer());

    await a.executer((q) => q(
      `INSERT INTO fichiers_dossier (demande_id, entreprise_id, categorie, nom,
                                     type_mime, taille_octets, contenu,
                                     partage, depose_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, e.id, categorie, nom, fichier.type, octets.length, octets,
       formulaire.get("partage") === "1", s.utilisateurId]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function basculerPartageFichier(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    await a.executer((q) => q(
      "UPDATE fichiers_dossier SET partage = $1 WHERE id = $2 AND demande_id = $3",
      [formulaire.get("partage") === "1", String(formulaire.get("fichier")), id]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function supprimerFichier(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    await a.executer((q) => q(
      "DELETE FROM fichiers_dossier WHERE id = $1 AND demande_id = $2",
      [String(formulaire.get("fichier")), id]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ── Suppression définitive ──
     ⚠️ ELLE EXIGE DE RECOPIER LA RÉFÉRENCE.
     Un bouton seul se clique par accident. Et la fonction en base refuse de
     toute façon dès qu'il existe un encaissement confirmé ou un document
     émis : une recette et un numéro de facture ne se suppriment pas. */
  async function supprimerDossier(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    if (String(formulaire.get("confirmation") ?? "").trim() !== demande.reference) return;
    await a.executer((q) => q("SELECT app.supprimer_demande($1)", [id]));
    revalidatePath("/admin/demandes");
    revalidatePath("/admin");
    redirect("/admin/demandes");
  }

  async function ajouterNote(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["note.ecrire"]);
    const corps = String(formulaire.get("corps") ?? "").trim();
    if (!corps) return;
    await a.executer((q) =>
      q(`INSERT INTO notes_internes (entreprise_id, demande_id, auteur_id, corps)
         VALUES ($1,$2,$3,$4)`, [e.id, id, s.utilisateurId, corps.slice(0, 5000)]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ── Confirmation : la demande devient un mariage et un dossier ── */
  async function confirmerDemande() {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    await a.executer((q) => q("SELECT app.confirmer_demande($1)", [id]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ── Paiements ──
     ⚠️ LA SAISIE ET LA CONFIRMATION SONT DEUX GESTES.
     Un montant tapé dans un formulaire n'est pas un virement reçu. Tant qu'il
     n'est pas confirmé, il n'entre dans aucun total. */
  async function saisirPaiement(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const type = String(formulaire.get("type") ?? "partiel");
    const a = await accesPage(e.id,
      [type === "remboursement" ? "finance.rembourser" : "finance.saisir_paiement"]);

    /* ⚠️ EN CENTIMES ENTIERS, DEPUIS UNE SAISIE HUMAINE.
       « 433,33 » comme « 433.33 » doivent donner 43333, et jamais 43332,99…
       On arrondit APRÈS multiplication, sur un nombre déjà en centimes. */
    const brut = String(formulaire.get("montant") ?? "").replace(",", ".").trim();
    const cents = Math.round(Number.parseFloat(brut) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;

    const motif = String(formulaire.get("motif") ?? "").trim() || null;
    if (type === "remboursement" && !motif) return;

    /* ⚠️ DEUX FONCTIONS, SELON QU'ON RATTACHE OU NON UNE ÉCHÉANCE.
       `enregistrer_paiement` à neuf paramètres gère les régularisations et
       les remboursements ; `enregistrer_paiement_echeance` rattache un
       versement à SON échéance et vérifie qu'elle appartient bien à cette
       demande. Un nom distinct plutôt qu'une surcharge : avec deux fonctions
       de même nom, un paramètre nul non typé rend l'appel ambigu. */
    const echeance = String(formulaire.get("echeance") ?? "") || null;
    const cle = `saisie:${id}:${cents}:${String(formulaire.get("recu_le") ?? "")}:${type}`;
    await a.executer((q) => (echeance && type !== "remboursement"
      ? q("SELECT app.enregistrer_paiement_echeance($1,$2,$3,$4,$5,$6,$7,$8)",
          [id, echeance, cents, String(formulaire.get("moyen") ?? "virement"), type,
           String(formulaire.get("reference") ?? "").trim() || null,
           String(formulaire.get("recu_le") ?? "") || null, cle])
      : q("SELECT app.enregistrer_paiement($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [id, cents, String(formulaire.get("moyen") ?? "virement"), type,
           String(formulaire.get("reference") ?? "").trim() || null,
           String(formulaire.get("recu_le") ?? "") || null,
           /* Clé d'idempotence : un double-clic ne crée pas deux versements. */
           cle, motif,
           String(formulaire.get("corrige") ?? "") || null])));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ⚠️ C'EST L'ARGENT REÇU QUI RÉSERVE LA DATE.
     Confirmer un acompte ouvre le mariage et le dossier dans LA MÊME
     transaction : on n'a plus à cliquer « confirmer la demande » ensuite, et
     il ne peut plus exister un acompte encaissé sur un dossier qui n'est pas
     au carnet. Sans date de mariage, le paiement est quand même confirmé —
     l'argent est arrivé, c'est un fait — et la fonction dit ce qui manque. */
  async function confirmerPaiement(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["finance.confirmer_paiement"]);
    await a.executer((q) =>
      q("SELECT * FROM app.confirmer_paiement_et_dossier($1)",
        [String(formulaire.get("paiement"))]));
    revalidatePath(`/admin/demandes/${id}`);
    revalidatePath("/admin");
    revalidatePath("/admin/saison");
  }

  async function annulerPaiement(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["finance.saisir_paiement"]);
    await a.executer((q) => q("SELECT app.annuler_paiement($1,$2)",
      [String(formulaire.get("paiement")), "Saisie erronée"]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  /* ── Collaboration ── */
  /* ⚠️ UN SEUL GESTE : CRÉER, TRANSMETTRE, ET DIRE CE QU'ON PARTAGE.
     Un couple demande parfois un vidéaste des jours après sa demande
     initiale. Trois boutons successifs — proposer, transmettre, partager —
     laissaient le dossier à mi-chemin dès qu'on en oubliait un. */
  async function proposerPrestation(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["collaboration.proposer"]);
    const destinataire = String(formulaire.get("partenaire") ?? "");
    if (!destinataire) return;
    const categories = formulaire.getAll("partage").map(String).filter(Boolean);
    await a.executer((q) => q("SELECT app.transmettre_a_partenaire($1,$2,$3,$4,$5::text[])",
      [id, destinataire, String(formulaire.get("prestation") ?? "video"),
       String(formulaire.get("message") ?? "").trim() || null, categories]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function transmettreProposition(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["collaboration.proposer"]);
    await a.executer((q) => q("SELECT app.transmettre_proposition($1)",
      [String(formulaire.get("proposition"))]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function basculerPartage(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["collaboration.proposer", "client.coordonnees.lire"]);
    await a.executer((q) => q("SELECT app.partager_coordonnees($1,$2,$3)",
      [id, String(formulaire.get("beneficiaire")),
       formulaire.get("partager") === "1"]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  const consentement = (finalite) =>
    consentements.find((c) => c.finalite === finalite)?.accorde === true;

  async function genererDevis() {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.rediger"]);
    await a.executer((q) => genererDevisDepuisDemande(q, id, e.id, s.utilisateurId));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function genererContrat(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.rediger"]);
    const devis = String(formulaire.get("devis") ?? "");
    await a.executer((q) => genererContratDepuisDevis(q, devis, e.id, s.utilisateurId));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function genererFacture(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.rediger"]);
    const devis = String(formulaire.get("devis") ?? "");
    const role = String(formulaire.get("role") ?? "acompte");
    if (!["acompte", "solde", "totale"].includes(role)) return;
    await a.executer((q) => genererFactureDepuisDevis(q, devis, role, e.id, s.utilisateurId));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function emettreDocument(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.emettre"]);
    const documentId = String(formulaire.get("document") ?? "");
    await a.executer(async (q) => {
      /* ⚠️ L'ORDRE COMPTE : ÉMETTRE, PUIS RENDRE, PUIS SCELLER.
         Le numéro n'existe qu'à l'émission, et il doit figurer SUR le PDF.
         Calculer l'empreinte avant scellait un document sans son numéro. */
      const { rows: emission } = await q(
        "SELECT * FROM app.emettre_document($1)", [documentId]);
      if (!emission[0]?.emis) return;

      const { rows } = await q(
        "SELECT instantane FROM documents WHERE id = $1", [documentId]);
      const { pdf } = rendrePdf(rows[0].instantane, false);
      /* L'empreinte scelle le PDF EXACT qui est émis : c'est elle qui
         prouvera plus tard ce qui a été accepté. */
      await q("SELECT app.sceller_document($1,$2)",
        [documentId, createHash("sha256").update(pdf).digest("hex")]);
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{demande.reference}</p>
          <h1 className="display t-section">{demande.contact_nom}</h1>
          <p className="recap__note">
            Reçue le {new Date(demande.cree_le).toLocaleString("fr-FR")} ·{" "}
            {LIBELLES_STATUT[demande.statut] ?? demande.statut}
          </p>
        </div>
        <div className="admin-actions">
          {acces.permissions.has("message.envoyer") ? (
            <Link href={`/admin/messagerie?demande=${id}`} className="btn">
              Répondre au client
            </Link>
          ) : null}
          <Link href="/admin/demandes" className="btn btn--fantome">Retour</Link>
        </div>
      </header>

      <div className="admin-colonnes">
        <div className="admin-colonne">
          <section className="admin-bloc">
            <h2 className="display t-carte">Le couple</h2>
            <dl className="admin-dl">
              <dt>Personne 1</dt><dd>{demande.contact_nom}</dd>
              <dt>Personne 2</dt><dd>{demande.contact_nom_2 ?? "—"}</dd>
              <dt>E-mail</dt>
              <dd>{String(demande.contact_email).endsWith("@jokswed.invalid")
                ? <span className="recap__note">adresse à renseigner</span>
                : <a className="lien" href={`mailto:${demande.contact_email}`}>{demande.contact_email}</a>}</dd>
              <dt>Téléphone</dt>
              <dd>{demande.contact_telephone
                ? <a className="lien" href={`tel:${demande.contact_telephone.replace(/\s/g, "")}`}>{demande.contact_telephone}</a>
                : "—"}</dd>
              <dt>Contact préféré</dt><dd>{demande.contact_prefere ?? "—"}</dd>
              <dt>Adresse</dt><dd>{demande.contact_adresse ?? "—"}</dd>
            </dl>
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Le mariage</h2>
            <dl className="admin-dl">
              <dt>Date</dt>
              <dd>{demande.date_incertaine && !demande.date_mariage
                ? "À définir" : formaterDateSql(demande.date_mariage)}</dd>
              <dt>Horaires</dt>
              <dd>{demande.heure_debut || demande.heure_fin
                ? `${String(demande.heure_debut ?? "?").slice(0, 5)} → ${String(demande.heure_fin ?? "?").slice(0, 5)}`
                : demande.horaires ?? "—"}</dd>
              <dt>Mairie</dt><dd>{demande.lieu_mairie ?? "—"}</dd>
              <dt>Cérémonie</dt><dd>{demande.lieu_ceremonie ?? "—"}</dd>
              <dt>Domaine / salle</dt><dd>{demande.lieu_reception ?? "—"}</dd>
              <dt>Lieu (texte libre)</dt><dd>{demande.lieu ?? "—"}</dd>
              <dt>Ville</dt><dd>{demande.ville ?? "—"}</dd>
              <dt>Département</dt><dd>{demande.departement ?? "—"}</dd>
              <dt>Invités</dt><dd>{demande.invites_estimes ?? "—"}</dd>
              <dt>Source</dt>
              <dd>{demande.origine === "manuel" ? "Saisie manuelle" : "Formulaire du site"}</dd>
              <dt>Photobooth 360</dt>
              <dd>{demande.photobooth_360
                ? (demande.photobooth_prix_cents === null
                    ? "Oui — sur devis"
                    : `Oui — ${formaterPrix(demande.photobooth_prix_cents)} TTC`)
                : "Non"}</dd>
            </dl>

            {/* ⚠️ UNE OPTION VENDUE SANS PERSONNE POUR L'EXÉCUTER EST UN
                OUBLI QUI SE VOIT LE JOUR DU MARIAGE. On le dit ici, pas le
                matin même. La transmission reste manuelle et n'a lieu
                qu'après confirmation du dossier. */}
            {demande.photobooth_360
              && !propositions.some((pr) => pr.statut === "acceptee") ? (
              <p className="admin-alerte" style={{ marginTop: "0.9rem" }}>
                Photobooth sélectionné — collaborateur à assigner.
                {!demande.mariage_id
                  ? " Le dossier doit d'abord être confirmé."
                  : null}
              </p>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Prestations demandées</h2>
            {lignes.length === 0 ? (
              <p className="recap__note">Aucune formule ni supplément sélectionné.</p>
            ) : (
              <ul className="admin-liste">
                {lignes.map((l) => (
                  <li key={l.id}>
                    <strong>{l.libelle}</strong>
                    <span>
                      {l.compatibilite === "inclus"
                        ? "Incluse dans la formule — non facturée"
                        : l.prix_cents === null
                          ? "Sur devis"
                          : `${formaterPrix(l.prix_cents)} TTC`}
                    </span>
                    {l.executant_partenaire ? <span className="admin-jeton">Partenaire</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {/* ⚠️ L'instantané fige ce que le client a vu : si un tarif change
                demain, cette fiche continue d'afficher le prix du jour de la
                demande. */}
            <p className="recap__note" style={{ marginTop: "0.9rem" }}>
              Tarifs figés au moment de la demande.
            </p>
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Message du client</h2>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{demande.message}</p>
          </section>

          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Modifier le dossier</h2>
              <p className="recap__note">
                Tout se modifie ici — noms, date, horaires, lieux, prix,
                échéancier. La date écrite ici est celle que verront le tableau
                de bord, la saison, Apple Calendar et vos collaborateurs : il
                n&apos;existe pas de copie à resynchroniser. Ce que le client a
                soumis reste conservé à part, intact.
              </p>
              <form action={modifier} className="formulaire" style={{ marginTop: "1rem" }}>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="nom_1">Personne 1</label>
                    <input id="nom_1" name="nom_1" type="text"
                           defaultValue={demande.contact_nom ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="nom_2">Personne 2</label>
                    <input id="nom_2" name="nom_2" type="text"
                           defaultValue={demande.contact_nom_2 ?? ""} />
                  </div>
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="email">E-mail</label>
                    <input id="email" name="email" type="email"
                           defaultValue={String(demande.contact_email).endsWith("@jokswed.invalid")
                             ? "" : demande.contact_email} />
                  </div>
                  <div className="champ">
                    <label htmlFor="telephone">Téléphone</label>
                    <input id="telephone" name="telephone" type="tel"
                           defaultValue={demande.contact_telephone ?? ""} />
                  </div>
                </div>
                <div className="champ">
                  <label htmlFor="adresse">Adresse</label>
                  <input id="adresse" name="adresse" type="text"
                         defaultValue={demande.contact_adresse ?? ""} />
                </div>

                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="date_mariage">Date du mariage</label>
                    <input id="date_mariage" name="date_mariage" type="date"
                           defaultValue={demande.date_mariage ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="invites">Nombre d&apos;invités</label>
                    <input id="invites" name="invites" type="number" min="0"
                           defaultValue={demande.invites_estimes ?? ""} />
                  </div>
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="heure_debut">Heure de début</label>
                    <input id="heure_debut" name="heure_debut" type="time"
                           defaultValue={String(demande.heure_debut ?? "").slice(0, 5)} />
                  </div>
                  <div className="champ">
                    <label htmlFor="heure_fin">Heure de fin</label>
                    <input id="heure_fin" name="heure_fin" type="time"
                           defaultValue={String(demande.heure_fin ?? "").slice(0, 5)} />
                  </div>
                </div>
                <div className="champ">
                  <label htmlFor="mairie">Mairie — adresse</label>
                  <input id="mairie" name="mairie" type="text"
                         defaultValue={demande.lieu_mairie ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="ceremonie">Cérémonie / église — adresse</label>
                  <input id="ceremonie" name="ceremonie" type="text"
                         defaultValue={demande.lieu_ceremonie ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="domaine">Domaine / salle — adresse</label>
                  <input id="domaine" name="domaine" type="text"
                         defaultValue={demande.lieu_reception ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="lieu">Lieu (texte libre)</label>
                  <input id="lieu" name="lieu" type="text"
                         defaultValue={demande.lieu ?? ""} />
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="ville">Ville</label>
                    <input id="ville" name="ville" type="text"
                           defaultValue={demande.ville ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="departement">Département</label>
                    <input id="departement" name="departement" type="text"
                           defaultValue={demande.departement ?? ""} />
                  </div>
                </div>
                <div className="champ">
                  <label htmlFor="horaires">Horaires connus (texte libre)</label>
                  <input id="horaires" name="horaires" type="text"
                         defaultValue={demande.horaires ?? ""} />
                </div>

                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="formule_nom">Formule / libellé du tarif</label>
                    <input id="formule_nom" name="formule_nom" type="text"
                           defaultValue={demande.formule_nom ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="prix_total">Prix total convenu (€ TTC)</label>
                    <input id="prix_total" name="prix_total" type="text"
                           inputMode="decimal"
                           defaultValue={demande.prix_total_cents === null ? ""
                             : (demande.prix_total_cents / 100).toFixed(2).replace(".", ",")} />
                  </div>
                </div>
                <div className="champ">
                  <label htmlFor="echeances-modif">Échéancier</label>
                  <select id="echeances-modif" name="echeances"
                          defaultValue={String(demande.nombre_echeances ?? 1)}>
                    <option value="1">Paiement unique</option>
                    <option value="2">2 fois</option>
                    <option value="3">3 fois</option>
                  </select>
                </div>

                <fieldset className="champ">
                  <legend>Photobooth 360</legend>
                  <label className="admin-case">
                    <input type="checkbox" name="photobooth" value="1"
                           defaultChecked={demande.photobooth_360} />
                    Photobooth 360 retenu
                  </label>
                  <label htmlFor="photobooth_prix">Prix convenu (€ TTC)</label>
                  <input id="photobooth_prix" name="photobooth_prix" type="text"
                         inputMode="decimal"
                         defaultValue={demande.photobooth_prix_cents === null ? ""
                           : (demande.photobooth_prix_cents / 100).toFixed(2).replace(".", ",")} />
                  {/* ⚠️ VIDE = « SUR DEVIS », PAS « GRATUIT ».
                      Aucun tarif Photobooth n'a été arrêté : rien n'est
                      pré-rempli, et l'affichage dit « sur devis » tant que ce
                      champ reste vide. */}
                  <p className="recap__note">
                    Laissé vide, le Photobooth reste affiché « sur devis ».
                  </p>
                </fieldset>

                <div className="champ">
                  <label htmlFor="complements">Informations complémentaires</label>
                  <textarea id="complements" name="complements" rows={3}
                            defaultValue={demande.complements ?? ""} />
                </div>

                {/* ⚠️ « ENREGISTRER » N'ENVOIE RIEN AU CLIENT.
                    Écrire au couple est un geste distinct, en haut de page. */}
                <button type="submit" className="btn">Enregistrer</button>
                <p className="recap__note">
                  Enregistrer ne prévient personne. Pour écrire au couple,
                  utilisez « Répondre au client ».
                </p>
              </form>
            </section>
          ) : null}

          {/* ═══ PLANNING ═══ */}
          <section className="admin-bloc">
            <h2 className="display t-carte">Planning</h2>
            {planning.length === 0 ? (
              <p className="recap__note">Aucune étape. Préparatifs, mairie, cocktail…</p>
            ) : (
              <ul className="admin-liste">
                {planning.map((e) => (
                  <li key={e.id} style={{ flexWrap: "wrap" }}>
                    {acces.permissions.has("planning.ecrire") ? (
                      /* ⚠️ MODIFIER SUR PLACE, SANS SECOND ÉCRAN.
                         Une étape se corrige au téléphone, en même temps qu'on
                         parle au couple. Le rang se saisit : c'est le
                         réordonnancement, avec les champs que la page a déjà,
                         plutôt qu'un glisser-déposer à écrire et à maintenir. */
                      <form action={enregistrerEtape} className="admin-ligne-actions"
                        style={{ flexBasis: "100%", flexWrap: "wrap" }}>
                        <input type="hidden" name="etape" value={e.id} />
                        <input type="number" name="ordre" min="1" defaultValue={e.ordre}
                          aria-label={`Rang de l'étape ${e.titre}`} style={{ width: "4.5rem" }} />
                        <input type="time" name="heure"
                          defaultValue={String(e.heure ?? "").slice(0, 5)}
                          aria-label={`Heure de l'étape ${e.titre}`} />
                        <input type="text" name="titre" defaultValue={e.titre} required
                          aria-label="Intitulé de l'étape" style={{ flex: "1 1 9rem" }} />
                        <input type="text" name="lieu" defaultValue={e.lieu ?? ""}
                          aria-label="Lieu de l'étape" style={{ flex: "1 1 9rem" }} />
                        <input type="text" name="notes" defaultValue={e.notes ?? ""}
                          aria-label="Notes de l'étape" style={{ flex: "1 1 9rem" }} />
                        <button type="submit" className="btn btn--fantome btn--petit">
                          Enregistrer
                        </button>
                      </form>
                    ) : (
                      <>
                        <strong>{e.heure ? String(e.heure).slice(0, 5) : "—"}</strong>
                        <span>{e.titre}</span>
                        {e.lieu ? <span>{e.lieu}</span> : null}
                        {e.notes ? (
                          <span style={{ flexBasis: "100%", color: "var(--encre-douce)" }}>
                            {e.notes}
                          </span>
                        ) : null}
                      </>
                    )}
                    {acces.permissions.has("planning.ecrire") ? (
                      <form action={supprimerEtape} style={{ marginLeft: "auto" }}>
                        <input type="hidden" name="etape" value={e.id} />
                        <button type="submit" className="btn btn--fantome btn--petit">
                          Retirer
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {acces.permissions.has("planning.ecrire") ? (
              <form action={enregistrerEtape} className="formulaire"
                style={{ marginTop: "1rem" }}>
                <div className="admin-grille-champs">
                  <div className="champ">
                    <label htmlFor="etape-heure">Heure</label>
                    <input id="etape-heure" name="heure" type="time" />
                  </div>
                  <div className="champ">
                    <label htmlFor="etape-titre">Étape</label>
                    <input id="etape-titre" name="titre" type="text"
                           placeholder="Préparatifs" required />
                  </div>
                  <div className="champ">
                    <label htmlFor="etape-lieu">Lieu / adresse</label>
                    <input id="etape-lieu" name="lieu" type="text" />
                  </div>
                  <div className="champ">
                    <label htmlFor="etape-ordre">Rang</label>
                    <input id="etape-ordre" name="ordre" type="number" min="1"
                           placeholder="auto" />
                  </div>
                  <div className="champ pleine">
                    <label htmlFor="etape-notes">Notes</label>
                    <input id="etape-notes" name="notes" type="text" />
                  </div>
                </div>
                <button type="submit" className="btn btn--fantome">
                  Ajouter l&apos;étape
                </button>
                <p className="recap__note">
                  Le planning est ce qu&apos;un collaborateur affecté peut voir,
                  si vous le lui avez partagé. Jamais les montants.
                </p>
              </form>
            ) : null}
          </section>

          {/* ═══ FICHIERS ═══ */}
          <section className="admin-bloc">
            <h2 className="display t-carte">Fichiers / Documents</h2>
            {fichiers.length === 0 ? (
              <p className="recap__note">Aucun fichier déposé.</p>
            ) : (
              <ul className="admin-liste">
                {fichiers.map((f) => (
                  <li key={f.id} style={{ flexWrap: "wrap" }}>
                    <strong>
                      <a className="lien" href={`/api/admin/fichiers/${f.id}`}>{f.nom}</a>
                    </strong>
                    <span className="admin-jeton">
                      {CATEGORIES_FICHIER.find(([c]) => c === f.categorie)?.[1]
                        ?? f.categorie}
                    </span>
                    <span>{f.type_mime}</span>
                    <span>{Math.max(1, Math.round(f.taille_octets / 1024))} Ko</span>
                    <span>{new Date(f.cree_le).toLocaleDateString("fr-FR")}</span>
                    <span className={`admin-pastille${f.partage ? " admin-pastille--emis" : ""}`}>
                      {f.partage ? "partagé" : "privé"}
                    </span>
                    {peutEcrire ? (
                      <>
                        <form action={basculerPartageFichier}>
                          <input type="hidden" name="fichier" value={f.id} />
                          <input type="hidden" name="partage" value={f.partage ? "0" : "1"} />
                          <button type="submit" className="btn btn--fantome btn--petit">
                            {f.partage ? "Ne plus partager" : "Partager"}
                          </button>
                        </form>
                        <form action={supprimerFichier}>
                          <input type="hidden" name="fichier" value={f.id} />
                          <button type="submit" className="btn btn--fantome btn--petit">
                            Supprimer
                          </button>
                        </form>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {peutEcrire ? (
              <form action={deposerFichier} className="formulaire"
                style={{ marginTop: "1rem" }}>
                <div className="admin-grille-champs">
                  <div className="champ">
                    <label htmlFor="fichier">Fichier</label>
                    <input id="fichier" name="fichier" type="file" required
                           accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" />
                  </div>
                  <div className="champ">
                    <label htmlFor="categorie">Catégorie</label>
                    <select id="categorie" name="categorie" defaultValue="autre">
                      {CATEGORIES_FICHIER.map(([c, libelle]) => (
                        <option key={c} value={c}>{libelle}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="admin-case">
                  <input type="checkbox" name="partage" value="1" />
                  Visible des collaborateurs affectés
                </label>
                <button type="submit" className="btn btn--fantome">Déposer</button>
                <p className="recap__note">
                  PDF, JPEG, PNG, WebP ou HEIC, 8 Mio au plus. Par défaut, un
                  fichier reste privé : le partage est un geste explicite.
                </p>
              </form>
            ) : null}
          </section>
        </div>

        <div className="admin-colonne">
          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Statut</h2>
              <form action={changerStatut} className="formulaire">
                <div className="champ">
                  <label htmlFor="statut">État du dossier</label>
                  <select id="statut" name="statut" defaultValue={demande.statut}>
                    {STATUTS.map((s) => (
                      <option key={s} value={s}>{LIBELLES_STATUT[s] ?? s}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn--bloc">Mettre à jour</button>
              </form>

              {/* ⚠️ CONFIRMER N'EST PAS UN CHANGEMENT DE STATUT COMME UN AUTRE.
                  C'est l'acte qui transforme une demande en MARIAGE : il crée
                  l'objet commun, partageable avec un collaborateur, et le
                  dossier commercial de JoksWed, qui ne l'est jamais. Il est
                  idempotent — un double clic ne dédouble pas le carnet. */}
              {!demande.mariage_id ? (
                <form action={confirmerDemande} style={{ marginTop: "0.8rem" }}>
                  <button type="submit" className="btn btn--fantome btn--bloc"
                    disabled={!demande.date_mariage}>
                    Confirmer et créer le mariage
                  </button>
                  {!demande.date_mariage ? (
                    <p className="recap__note" style={{ marginTop: "0.5rem" }}>
                      Une date est nécessaire pour inscrire le mariage au carnet.
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="recap__note" style={{ marginTop: "0.8rem" }}>
                  Mariage inscrit au carnet · <a href="/admin/saison">voir la saison</a>
                </p>
              )}
            </section>
          ) : null}

          <section className="admin-bloc">
            <h2 className="display t-carte">Collaboration</h2>
            {propositions.length === 0 ? (
              <p className="recap__note">
                {demande.video_demandee
                  ? "Vidéo demandée, aucune proposition enregistrée."
                  : "Aucune prestation confiée à un partenaire."}
              </p>
            ) : (
              <ul className="admin-liste">
                {propositions.map((pr) => (
                  <li key={pr.id} style={{ flexWrap: "wrap" }}>
                    <strong>{pr.destinataire}</strong>
                    <span>{pr.prestation}</span>
                    <span className={`admin-pastille${
                      pr.statut === "acceptee" ? " admin-pastille--emis" : ""}`}>
                      {pr.envoyee_le ? pr.statut : "préparée — non transmise"}
                    </span>
                    <span>{pr.origine === "manuelle" ? "manuelle" : "automatique"}</span>
                    {pr.commentaire ? (
                      <span style={{ flexBasis: "100%", color: "var(--encre-douce)" }}>
                        « {pr.commentaire} »
                      </span>
                    ) : null}
                    {!pr.envoyee_le && acces.permissions.has("collaboration.proposer") ? (
                      <form action={transmettreProposition} style={{ marginLeft: "auto" }}>
                        <input type="hidden" name="proposition" value={pr.id} />
                        <button type="submit" className="btn btn--fantome">Transmettre</button>
                      </form>
                    ) : null}
                    {pr.statut === "acceptee"
                      && acces.permissions.has("collaboration.proposer")
                      && acces.permissions.has("client.coordonnees.lire") ? (
                      <form action={basculerPartage} style={{ marginLeft: "auto" }}>
                        <input type="hidden" name="beneficiaire"
                          value={pr.entreprise_destinataire_id} />
                        <input type="hidden" name="partager"
                          value={pr.coordonnees_partagees ? "0" : "1"} />
                        <button type="submit" className="btn btn--fantome">
                          {pr.coordonnees_partagees
                            ? "Retirer les coordonnées"
                            : "Partager les coordonnées"}
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {/* ⚠️ LA TRANSMISSION EST AUTOMATIQUE, SAUF EMPÊCHEMENT.
                Depuis la V6.1, une proposition part seule dès le dépôt si le
                partenaire a un compte opérationnel et si le couple a
                consenti au partage. Quand elle reste là, on dit POURQUOI. */}
            {enAttente.length > 0 ? (
              <div className="admin-alerte" style={{ marginTop: "1rem" }}>
                <strong>Transmission en attente :</strong>
                <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
                  {enAttente.map((p) => (
                    <li key={p.id}>{p.destinataire} — {p.motif}</li>
                  ))}
                </ul>
                <p style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
                  Les demandes déposées avant l&apos;activation d&apos;un compte ne
                  sont pas transmises rétroactivement : le bouton
                  « Transmettre » permet de le faire après avoir revu le
                  périmètre du partage.
                </p>
              </div>
            ) : null}

            {/* ⚠️ TRANSMETTRE RESTE POSSIBLE À LA MAIN.
                Une proposition préparée reste invisible du partenaire tant
                qu'on ne l'a pas transmise : aucune donnée ne part toute seule.
                Et même transmise, elle ne porte ni nom, ni e-mail, ni
                téléphone du couple — seulement la date, le lieu et la
                prestation. Les coordonnées demandent un second geste, après
                acceptation. */}
            {acces.permissions.has("collaboration.proposer") && partenaires.length > 0 ? (
              <form action={proposerPrestation} className="formulaire"
                style={{ marginTop: "1.2rem" }}>
                <div className="admin-grille-champs">
                  <div className="champ">
                    <label htmlFor="partenaire">Partenaire</label>
                    <select id="partenaire" name="partenaire" required>
                      {partenaires.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nom_commercial}
                          {p.service_partenaire ? ` — ${p.service_partenaire}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="champ">
                    <label htmlFor="prestation">Prestation</label>
                    {/* ⚠️ TROIS VALEURS, PAS QUATRE.
                        `dossiers.prestation` n'accepte que `photo`, `video` ou
                        `autre` : c'est la nature COMMERCIALE du dossier, dont
                        dépendent les gabarits et les totaux. Le photobooth est
                        donc une prestation « autre » — le métier du
                        prestataire, lui, est déclaré sur sa structure. */}
                    <select id="prestation" name="prestation" defaultValue="video">
                      <option value="video">Vidéo</option>
                      <option value="photo">Photo</option>
                      <option value="autre">Photobooth / autre</option>
                    </select>
                  </div>
                  <div className="champ pleine">
                    <label htmlFor="message-collab">Message (facultatif)</label>
                    <input id="message-collab" name="message" type="text" />
                  </div>
                </div>

                {/* ⚠️ ON CHOISIT CE QU'ON PARTAGE, CASE PAR CASE.
                    Transmettre une prestation n'est pas ouvrir le dossier :
                    la date et le lieu suffisent à décider. Les coordonnées
                    du couple sont un geste à part — et la base les refuse
                    si le couple n'a pas consenti au partage, quelle que
                    soit la case cochée ici. */}
                <fieldset className="champ">
                  <legend>Informations à partager</legend>
                  <label className="admin-case">
                    <input type="checkbox" name="partage" value="planning" defaultChecked />
                    Planning du mariage
                  </label>
                  <label className="admin-case">
                    <input type="checkbox" name="partage" value="lieux" defaultChecked />
                    Lieux
                  </label>
                  <label className="admin-case">
                    <input type="checkbox" name="partage" value="coordonnees_clients"
                      disabled={!consentement("partage_partenaire_video")} />
                    Coordonnées du couple
                    {!consentement("partage_partenaire_video") ? (
                      <span className="recap__note">
                        {" "}— le couple n&apos;y a pas consenti
                      </span>
                    ) : null}
                  </label>
                </fieldset>

                <button type="submit" className="btn btn--bloc">
                  Transmettre au partenaire
                </button>
              </form>
            ) : null}

            {demande.video_demandee && !consentement("partage_partenaire_video") ? (
              <p className="admin-alerte" style={{ marginTop: "0.9rem" }}>
                Vidéo demandée sans consentement au partage : les coordonnées du
                couple ne peuvent pas être transmises en l&apos;état.
              </p>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Consentements</h2>
            <ul className="admin-liste">
              <li>
                <strong>Traitement de la demande</strong>
                <span>{consentement("reponse_demande") ? "Accordé" : "Refusé"}</span>
              </li>
              <li>
                <strong>Partage avec le vidéaste</strong>
                <span>{consentement("partage_partenaire_video") ? "Accordé" : "Non accordé"}</span>
              </li>
            </ul>
            {demande.video_demandee && !consentement("partage_partenaire_video") ? (
              <p className="admin-alerte" style={{ marginTop: "0.9rem" }}>
                Vidéo demandée sans consentement au partage : ses coordonnées ne
                peuvent pas être transmises en l&apos;état.
              </p>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Notes internes</h2>
            <p className="recap__note">
              Visibles de votre seule entreprise. Elles ne peuvent pas partir dans un e-mail.
            </p>
            {acces.permissions.has("note.ecrire") ? (
              <form action={ajouterNote} className="formulaire" style={{ marginTop: "1rem" }}>
                <div className="champ">
                  <label htmlFor="corps">Nouvelle note</label>
                  <textarea id="corps" name="corps" required />
                </div>
                <button type="submit" className="btn btn--fantome">Ajouter</button>
              </form>
            ) : null}
            {notes.length > 0 ? (
              <ul className="admin-liste" style={{ marginTop: "1rem" }}>
                {notes.map((n) => (
                  <li key={n.id}>
                    <strong>{n.prenom} {n.nom}</strong>
                    <span>{new Date(n.cree_le).toLocaleString("fr-FR")}</span>
                    <span style={{ flexBasis: "100%", color: "var(--encre-douce)" }}>{n.corps}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Documents</h2>

            {documents.length === 0 ? (
              <p className="recap__note">Aucun document pour cette demande.</p>
            ) : (
              <ul className="admin-liste">
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <strong>{doc.numero ?? "Brouillon"}</strong>
                    <span>{doc.type}</span>
                    <span>{formaterPrix(doc.total_ttc_cents)} TTC</span>
                    <span className={`admin-pastille admin-pastille--${doc.statut}`}>
                      {doc.statut === "brouillon" ? "Brouillon" : "Émis"}
                    </span>
                    <a className="btn btn--fantome btn--petit"
                       href={`/api/admin/documents/${doc.id}/pdf`}
                       target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>
                    {doc.statut === "brouillon"
                      && acces.permissions.has("document.emettre")
                      && motifsBlocage.length === 0 ? (
                      <form action={emettreDocument}>
                        <input type="hidden" name="document" value={doc.id} />
                        <button type="submit" className="btn btn--petit">Émettre</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {acces.permissions.has("document.rediger") ? (
              <div className="admin-actions" style={{ marginTop: "1.2rem" }}>
                <form action={genererDevis}>
                  <button type="submit" className="btn btn--bloc">Générer un devis</button>
                </form>

                {devisDisponible ? (
                  <>
                    <form action={genererContrat}>
                      <input type="hidden" name="devis" value={devisDisponible.id} />
                      <button type="submit" className="btn btn--fantome btn--bloc">
                        Générer le contrat
                      </button>
                    </form>
                    <form action={genererFacture} className="admin-ligne-actions">
                      <input type="hidden" name="devis" value={devisDisponible.id} />
                      <select name="role" defaultValue="acompte" aria-label="Type de facture">
                        <option value="acompte">Facture d&apos;acompte</option>
                        <option value="solde">Facture de solde</option>
                        <option value="totale">Facture complète</option>
                      </select>
                      <button type="submit" className="btn btn--fantome">Générer</button>
                    </form>
                  </>
                ) : (
                  /* ⚠️ PAS DE BOUTON CONTRAT NI FACTURE SANS DEVIS.
                     Le contrat se génère DEPUIS un devis — c'est ce qui garantit
                     qu'ils ne se contredisent pas sur le prix ou l'échéancier. */
                  <p className="recap__note">
                    Le contrat et les factures se génèrent depuis un devis.
                    Commencez par en créer un.
                  </p>
                )}
              </div>
            ) : null}

            {situation ? (
              <div className="recap" style={{ marginTop: "1.2rem" }}>
                <p className="label label--nu">Situation financière</p>
                {/* ⚠️ TROIS MESURES DISTINCTES, JAMAIS CONFONDUES.
                    Émettre une facture n'encaisse rien ; encaisser ne facture
                    rien. Les afficher séparément évite de facturer deux fois. */}
                {/* ⚠️ LE TOTAL N'EST PLUS « LE DEVIS » MAIS « LE TOTAL ».
                    Un dossier saisi à la main n'a pas de devis émis : son
                    total est le prix convenu. Sans ce repli, le total sortait
                    à 0 €, le reste dû devenait négatif à chaque encaissement,
                    et le garde-fou qui refuse d'encaisser plus que dû était
                    désactivé par sa propre condition. */}
                <p className="recap__ligne">
                  <span>Total</span>
                  <span>{formaterPrix(situation.total_prestation_cents)}</span>
                </p>
                <p className="recap__ligne">
                  <span>Facturé</span>
                  <span>{formaterPrix(situation.facture_cents - situation.avoirs_cents)}</span>
                </p>
                <p className="recap__ligne">
                  <span>Payé (paiements confirmés)</span>
                  <span>{formaterPrix(situation.encaisse_cents)}</span>
                </p>
                <p className="recap__ligne recap__ligne--total">
                  <span>Reste</span>
                  <span>{formaterPrix(situation.reste_du_cents)}</span>
                </p>
              </div>
            ) : null}

            {/* ⚠️ LES MOTIFS DE BLOCAGE SONT AFFICHÉS AVANT LE CLIC.
                Un bouton « Émettre » qui échoue après coup fait perdre du
                temps et de la confiance. Tant qu'il reste un motif, le
                brouillon se prépare mais ne devient jamais définitif. */}
            {motifsBlocage.length > 0 || motifsContrat.length > 0 ? (
              <div className="admin-alerte" style={{ marginTop: "1.2rem" }}>
                <strong>Émission définitive bloquée :</strong>
                <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
                  {motifsBlocage.map((m) => <li key={m}>{m}</li>)}
                  {motifsContrat
                    .filter((m) => !motifsBlocage.includes(m))
                    .map((m) => <li key={m}>{m} <em>(contrats uniquement)</em></li>)}
                </ul>
                <p style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
                  Les brouillons restent possibles : vous pouvez préparer, relire
                  et corriger. Seul le passage au définitif attend.
                </p>
              </div>
            ) : null}

          {/* ═══ ÉCHÉANCIER ═══ */}
          {acces.permissions.has("finance.lire") ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Échéancier</h2>
              {echeancier.length === 0 ? (
                <p className="recap__note">
                  Aucun échéancier. Saisissez le prix total et le nombre de
                  versements : la répartition se fait en centimes entiers.
                </p>
              ) : (
                <ul className="admin-paiements">
                  {echeancier.map((e) => (
                    <li key={e.echeance_id} className={`admin-paiement admin-paiement--${
                      e.etat === "recu" ? "confirme" : "declare"}`}>
                      <div className="admin-paiement__haut">
                        <span className="admin-paiement__montant">
                          {formaterPrix(e.montant_cents)}
                        </span>
                        <span className="admin-pastille">{e.nature}</span>
                        <span className={`admin-pastille${
                          e.etat === "recu" ? " admin-pastille--emis" : ""}`}>
                          {{ a_recevoir: "à recevoir", declare: "déclaré",
                             partiel: "partiellement reçu", recu: "reçu" }[e.etat]}
                        </span>
                      </div>
                      <p className="admin-paiement__meta">
                        {e.libelle}
                        {e.recu_cents > 0 ? ` · reçu ${formaterPrix(e.recu_cents)}` : null}
                        {e.declare_cents > 0 ? ` · déclaré ${formaterPrix(e.declare_cents)}` : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {peutEcrire ? (
                <form action={definirEcheancier} className="formulaire"
                  style={{ marginTop: "1rem" }}>
                  <div className="admin-grille-champs">
                    <div className="champ">
                      <label htmlFor="ech-total">Prix total (€ TTC)</label>
                      <input id="ech-total" name="total" type="text" inputMode="decimal"
                             required placeholder="1300"
                             defaultValue={demande.prix_total_cents === null ? ""
                               : (demande.prix_total_cents / 100).toFixed(2).replace(".", ",")} />
                    </div>
                    <div className="champ">
                      <label htmlFor="ech-nombre">Nombre de versements</label>
                      <select id="ech-nombre" name="nombre"
                              defaultValue={String(demande.nombre_echeances ?? 1)}>
                        <option value="1">1 fois</option>
                        <option value="2">2 fois</option>
                        <option value="3">3 fois</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="btn btn--fantome btn--bloc">
                    Définir l&apos;échéancier
                  </button>
                  {/* ⚠️ UN ENCAISSEMENT NE SE RECALCULE JAMAIS.
                      Si le prix change après un acompte reçu, les échéances
                      déjà couvertes gardent leur montant : seul le restant
                      est réparti à nouveau. */}
                  {/* Aucun montant d'exemple ici : un prix écrit dans une
                      page finit par être lu comme un tarif. Le contrôle de
                      cohérence le refuse, et il a raison. */}
                  <p className="recap__note">
                    La répartition se fait en centimes entiers ; le centime
                    restant va sur la dernière échéance, pour que la somme des
                    versements fasse exactement le total. Une échéance déjà
                    encaissée n&apos;est jamais recalculée.
                  </p>
                </form>
              ) : null}
            </section>
          ) : null}

          {/* ═══ PAIEMENTS ═══ */}
          {acces.permissions.has("finance.lire") ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Paiements</h2>
              <p className="recap__note">
                Un montant saisi n&apos;est pas un montant reçu : il reste
                <strong> déclaré</strong> jusqu&apos;à confirmation, et n&apos;entre
                dans aucun total avant.
              </p>

              {paiements.length > 0 ? (
                <ul className="admin-paiements">
                  {paiements.map((p) => (
                    <li key={p.id}
                      className={`admin-paiement admin-paiement--${p.statut}${
                        p.type_paiement === "remboursement" ? " admin-paiement--remboursement" : ""}`}>
                      <div className="admin-paiement__haut">
                        <span className="admin-paiement__montant">
                          {p.type_paiement === "remboursement" ? "− " : null}
                          {formaterPrix(p.montant_cents)}
                        </span>
                        <span className="admin-pastille">{p.type_paiement}</span>
                        <span className={`admin-pastille${
                          p.statut === "confirme" ? " admin-pastille--emis" : ""}`}>
                          {p.statut}
                        </span>
                      </div>
                      <p className="admin-paiement__meta">
                        {formaterDateSql(p.recu_le)} · {p.moyen}
                        {p.reference ? ` · ${p.reference}` : null}
                        {p.saisi_prenom ? ` · saisi par ${p.saisi_prenom}` : null}
                        {p.corrige_id ? " · régularisation" : null}
                      </p>
                      {p.motif ? (
                        <p className="admin-paiement__meta">« {p.motif} »</p>
                      ) : null}
                      {p.statut === "declare" ? (
                        <div className="admin-paiement__actions">
                          {acces.permissions.has("finance.confirmer_paiement")
                            || (p.type_paiement === "remboursement"
                                && acces.permissions.has("finance.rembourser")) ? (
                            <form action={confirmerPaiement}>
                              <input type="hidden" name="paiement" value={p.id} />
                              <button type="submit" className="btn">Confirmer</button>
                            </form>
                          ) : null}
                          {acces.permissions.has("finance.saisir_paiement") ? (
                            <form action={annulerPaiement}>
                              <input type="hidden" name="paiement" value={p.id} />
                              <button type="submit" className="btn btn--fantome">
                                Abandonner la saisie
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="recap__note">Aucun mouvement enregistré.</p>
              )}

              {/* ⚠️ ON NE SUPPRIME PAS UN MOUVEMENT CONFIRMÉ.
                  Une erreur se corrige par un remboursement, qui désigne
                  l&apos;opération d&apos;origine. Les deux restent au journal. */}
              {acces.permissions.has("finance.saisir_paiement") ? (
                <form action={saisirPaiement} className="formulaire" style={{ marginTop: "1.2rem" }}>
                  <div className="admin-grille-champs">
                    <div className="champ">
                      <label htmlFor="montant">Montant (€)</label>
                      <input id="montant" name="montant" type="text" inputMode="decimal"
                        placeholder="433,33" required />
                    </div>
                    <div className="champ">
                      <label htmlFor="type-p">Nature</label>
                      <select id="type-p" name="type" defaultValue="acompte">
                        <option value="acompte">Acompte</option>
                        <option value="versement">Deuxième versement</option>
                        <option value="solde">Solde</option>
                        <option value="partiel">Paiement partiel</option>
                        {acces.permissions.has("finance.rembourser") ? (
                          <option value="remboursement">Remboursement</option>
                        ) : null}
                      </select>
                    </div>
                    <div className="champ">
                      <label htmlFor="moyen">Mode</label>
                      <select id="moyen" name="moyen" defaultValue="virement">
                        <option value="virement">Virement</option>
                        <option value="cheque">Chèque</option>
                        <option value="especes">Espèces</option>
                        <option value="carte">Carte</option>
                        <option value="stripe">Stripe</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div className="champ">
                      <label htmlFor="recu_le">Date de réception</label>
                      <input id="recu_le" name="recu_le" type="date" />
                    </div>
                    {/* ⚠️ RATTACHER L'ÉCHÉANCE, C'EST CE QUI FAIT L'ÉTAT.
                        « reçu » ou « à recevoir » se déduit des paiements
                        rattachés : sans ce lien, l'échéancier resterait
                        éternellement « à recevoir » malgré l'argent encaissé. */}
                    <div className="champ">
                      <label htmlFor="echeance">Échéance</label>
                      <select id="echeance" name="echeance" defaultValue="">
                        <option value="">Aucune</option>
                        {echeancier.map((e) => (
                          <option key={e.echeance_id} value={e.echeance_id}>
                            {e.libelle} — {formaterPrix(e.montant_cents)}
                            {e.etat === "recu" ? " (reçu)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="champ">
                      <label htmlFor="reference">Référence</label>
                      <input id="reference" name="reference" type="text" />
                    </div>
                    <div className="champ">
                      <label htmlFor="motif-p">Motif (obligatoire si remboursement)</label>
                      <input id="motif-p" name="motif" type="text" />
                    </div>
                  </div>
                  <button type="submit" className="btn btn--bloc">Enregistrer le mouvement</button>
                </form>
              ) : null}
            </section>
          ) : null}

          </section>

          {/* ═══ COLLABORATEURS AFFECTÉS ═══ */}
          {demande.dossier_id ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Collaborateurs affectés</h2>
              {affectes.length === 0 ? (
                <p className="recap__note">
                  Personne n&apos;est affecté à cette journée.
                </p>
              ) : (
                <ul className="admin-liste">
                  {affectes.map((a) => (
                    <li key={a.id}>
                      <strong>{a.prenom} {a.nom}</strong>
                      <span className="admin-jeton">{a.mission}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="recap__note">
                Un prestataire extérieur — vidéaste, photobooth — passe par
                « Collaboration » ci-dessus : il reçoit son propre dossier, et
                ne voit ni les autres mariages, ni les montants.
              </p>
            </section>
          ) : null}

          {/* ═══ SUPPRESSION ═══ */}
          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Clore ou supprimer</h2>
              <p className="recap__note">
                Annuler et archiver se font par le statut, en haut de cette
                colonne : le dossier reste consultable. La suppression
                définitive, elle, ne se rattrape pas.
              </p>
              {/* ⚠️ IL FAUT RECOPIER LA RÉFÉRENCE.
                  Un bouton seul se clique par accident, et un carnet de
                  mariages ne se répare pas d'un Ctrl-Z. La base refuse de
                  toute façon dès qu'il existe un encaissement confirmé ou un
                  document émis : une recette et un numéro de facture ne se
                  suppriment pas. */}
              <form action={supprimerDossier} className="formulaire"
                style={{ marginTop: "1rem" }}>
                <div className="champ">
                  <label htmlFor="confirmation">
                    Pour supprimer définitivement, recopiez{" "}
                    <strong>{demande.reference}</strong>
                  </label>
                  <input id="confirmation" name="confirmation" type="text"
                         autoComplete="off" placeholder={demande.reference} />
                </div>
                <button type="submit" className="btn btn--fantome">
                  Supprimer définitivement
                </button>
              </form>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
