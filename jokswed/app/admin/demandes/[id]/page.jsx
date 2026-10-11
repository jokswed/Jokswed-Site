import Link from "next/link";
import { dechiffrer } from "@/lib/auth/secrets";
import { validerSignature } from "@/lib/documents/signature-trace";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { tracer } from "@/lib/auth/acces";
import { formaterDateSql } from "@/lib/dates";
import { formaterPrix, formules } from "@/content/offres";
import { tarifsSurDemande } from "@/lib/email/gabarits";
import { envoyer, adresseDeReponse } from "@/lib/email/fournisseur";
import {
  genererDevisDepuisDemande, genererContratDepuisDevis,
  genererFactureDepuisDevis, genererAvoir, rendrePdf,
} from "@/lib/documents/generer";
import { createHash } from "node:crypto";
import { LIBELLES_STATUT } from "../page";

export const dynamic = "force-dynamic";

const STATUTS = [
  "non_lue", "a_traiter", "attente_client", "attente_collaborateur",
  "en_cours_devis", "devis_envoye", "confirmee", "refusee", "archivee",
];

export default async function FicheDemande({ params, searchParams }) {
  const { id } = await params;
  const retourEnvoi = (await searchParams)?.tarifs;
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
    };
  });

  if (!vue) notFound();
  const { demande, lignes, consentements, notes, proposition, documents,
          motifsBlocage, motifsContrat, situation, paiements, partenaires,
          propositions, enAttente } = vue;
  const devisEmis = documents.find((d) => d.type === "devis" && d.statut !== "brouillon");
  const devisDisponible = devisEmis ?? documents.find((d) => d.type === "devis");
  const peutEcrire = acces.permissions.has("dossier.ecrire");

  async function changerStatut(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const nouveau = String(formulaire.get("statut") ?? "");
    if (!STATUTS.includes(nouveau)) return;
    await a.executer(async (q) => {
      const { rows } = await q(
        "UPDATE demandes SET statut = $1 WHERE id = $2 RETURNING statut", [nouveau, id]);
      if (rows[0]) {
        await tracer(q, s.utilisateurId, e.id, "demande.statut", "demande", id,
          { statut: demande.statut }, { statut: nouveau });
      }
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function completer(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const champs = {
      contact_nom: String(formulaire.get("contact_nom") ?? "").trim(),
      contact_email: String(formulaire.get("contact_email") ?? "").trim().toLowerCase(),
      contact_telephone: String(formulaire.get("telephone") ?? "") || null,
      contact_prefere: ["email", "telephone", "sms"].includes(String(formulaire.get("contact_prefere")))
        ? String(formulaire.get("contact_prefere")) : null,
      date_mariage: String(formulaire.get("date_mariage") ?? "").trim() || null,
      date_incertaine: !String(formulaire.get("date_mariage") ?? "").trim(),
      ville: String(formulaire.get("ville") ?? "") || null,
      departement: String(formulaire.get("departement") ?? "") || null,
      lieu: String(formulaire.get("lieu") ?? "") || null,
      horaires: String(formulaire.get("horaires") ?? "") || null,
      invites_estimes: Number.parseInt(String(formulaire.get("invites") ?? ""), 10) || null,
      complements: String(formulaire.get("complements") ?? "") || null,
    };
    if (!champs.contact_nom || champs.contact_nom.length > 200) {
      throw new Error("Nom du couple invalide");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(champs.contact_email)
      || champs.contact_email.length > 254) {
      throw new Error("Adresse e-mail invalide");
    }
    if (champs.date_mariage && !/^\d{4}-\d{2}-\d{2}$/.test(champs.date_mariage)) {
      throw new Error("Date de mariage invalide");
    }
    const champsValeurs = Object.values(champs);
    await a.executer(async (q) => {
      const { rows: avant } = await q(
        `SELECT entreprise_destinataire_id, mariage_id, date_mariage, contact_nom, contact_email
           FROM demandes WHERE id = $1 FOR UPDATE`, [id]);
      if (!avant[0] || avant[0].entreprise_destinataire_id !== e.id) {
        throw new Error("Dossier non autorisé");
      }
      await q(
        `UPDATE demandes SET contact_nom=$1, contact_email=$2, contact_telephone=$3,
          contact_prefere=$4, date_mariage=$5, date_incertaine=$6,
          ville=$7, departement=$8, lieu=$9, horaires=$10,
          invites_estimes=$11, complements=$12 WHERE id=$13`,
        [...champsValeurs, id]);
      /* Si le mariage est déjà partagé, seule l'entreprise pilote met à jour
         les données communes. Les devis déjà émis ne sont jamais modifiés. */
      if (avant[0].mariage_id) {
        /* Sync sécurisée via SQL : le pilote seulement, puis notification aux
           partenaires ayant réellement un dossier sur ce mariage. */
        await q("SELECT app.actualiser_mariage_pilote($1)", [id]);
      }

      /* ⚠️ `instantane` N'EST PAS TOUCHÉ : il garde ce que le client a
         réellement soumis. Ces champs-ci sont des compléments de l'équipe. */
      await tracer(q, s.utilisateurId, e.id, "demande.completee", "demande", id, null, champs);
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function modifierFormule(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const cle = String(formulaire.get("formule_cle") ?? "");
    const formule = formules.find((f) => f.cle === cle);
    if (!formule) throw new Error("Formule inconnue");
    const autre = String(formulaire.get("prix_personnalise") ?? "").trim().replace(",", ".");
    const prix = autre === "" ? formule.prixCents : Math.round(Number(autre) * 100);
    if (!Number.isSafeInteger(prix) || prix < 0 || prix > 100000000) {
      throw new Error("Prix invalide");
    }
    await a.executer((q) => q("SELECT app.modifier_formule_demande($1,$2,$3,$4)",
      [id, cle, `${formule.nom} — ${formule.surnom}`, prix]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function modifierOption(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const libelle = String(formulaire.get("libelle") ?? "").trim();
    const brut = String(formulaire.get("prix") ?? "").trim().replace(",", ".");
    const prix = brut === "" ? null : Math.round(Number(brut) * 100);
    if (libelle.length < 3 || libelle.length > 250 ||
       (prix !== null && (!Number.isSafeInteger(prix) || prix < 0 || prix > 100000000))) {
      throw new Error("Option invalide");
    }
    await a.executer((q) => q("SELECT app.modifier_option_manuelle($1,$2,$3,$4)",
      [id,String(formulaire.get("ligne") ?? ""),libelle,prix]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function ajouterOption(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const libelle = String(formulaire.get("option_libelle") ?? "").trim();
    const brut = String(formulaire.get("option_prix") ?? "").trim().replace(",", ".");
    const cents = brut ? Math.round(Number(brut) * 100) : null;
    if (libelle.length < 3 || libelle.length > 250
        || (cents !== null && (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000))) {
      throw new Error("Option ou tarif invalide");
    }
    const partenaire = String(formulaire.get("option_partenaire") ?? "");
    await a.executer((q) => q("SELECT app.ajouter_option_demande($1,$2,$3,$4,$5)",
      [id, libelle, cents, partenaire || null, partenaire ? "video" : "autre"]));
    revalidatePath(`/admin/demandes/${id}`);
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

  /* ── Envoi explicite des tarifs, jamais automatique ──
     La permission et la propriété de la demande sont revérifiées AU CLIC.
     Aucun contact client n'est transmis au navigateur pour cette opération.
     En mode dry run, la réponse "inhibe" est affichée sans envoyer d'e-mail. */
  async function envoyerTarifs(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const nature = String(formulaire.get("nature") ?? "");
    if (nature !== "photo" && nature !== "video") throw new Error("Type de tarifs invalide");
    const cible = await a.executer(async (q) => {
      const { rows } = await q(
        `SELECT d.contact_nom, d.contact_email, d.reference, d.video_demandee
           FROM demandes d WHERE d.id = $1 AND d.entreprise_destinataire_id = $2`,
        [id, e.id]);
      if (!rows[0]) return null;
      const { rows: consentements } = await q(
        `SELECT 1 FROM consentements WHERE demande_id = $1
           AND finalite = 'reponse_demande' AND accorde = true`, [id]);
      if (!consentements.length) return null;
      if (nature === "video" && !rows[0].video_demandee) return null;
      return rows[0];
    });
    if (!cible) throw new Error("Demande, prestation ou consentement non autorisé");
    const modele = tarifsSurDemande({
      nom: cible.contact_nom, reference: cible.reference, nature,
    });
    const reponseVideo = process.env.JOKSWED_EMAIL_VIDEASTE_REPONSE?.trim();
    if (nature === "video" && (!reponseVideo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reponseVideo))) {
      throw new Error("Adresse de réponse du vidéaste non configurée : JOKSWED_EMAIL_VIDEASTE_REPONSE");
    }
    const resultat = await envoyer({
      destinataire: cible.contact_email,
      destinataireNom: cible.contact_nom,
      sujet: modele.sujet,
      html: modele.html,
      texte: modele.texte,
      repondreA: nature === "video" ? reponseVideo : adresseDeReponse(),
      etiquettes: ["jokswed", `tarifs-${nature}`],
    });
    await a.executer((q) => tracer(q, s.utilisateurId, e.id,
      "tarifs.envoi", "demande", id, null,
      { nature, statut: resultat.statut, fournisseur: resultat.fournisseur }));
    if (resultat.statut === "echoue") throw new Error("L'envoi Brevo a échoué ; aucun tarif n'a été confirmé au client.");
    redirect(`/admin/demandes/${id}?tarifs=${resultat.statut}`);
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

    await a.executer((q) => q(
      "SELECT app.enregistrer_paiement($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, cents, String(formulaire.get("moyen") ?? "virement"), type,
       String(formulaire.get("reference") ?? "").trim() || null,
       String(formulaire.get("recu_le") ?? "") || null,
       /* Clé d'idempotence : un double-clic ne crée pas deux versements. */
       `saisie:${id}:${cents}:${String(formulaire.get("recu_le") ?? "")}:${type}`,
       motif,
       String(formulaire.get("corrige") ?? "") || null]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function confirmerPaiement(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["finance.confirmer_paiement"]);
    await a.executer((q) =>
      q("SELECT app.confirmer_paiement($1)", [String(formulaire.get("paiement"))]));
    revalidatePath(`/admin/demandes/${id}`);
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

  async function apposerSignature(formulaire) {
    "use server";
    if (process.env.JOKSWED_SIGNATURES_ENABLED !== "1") throw new Error("Signatures non activées");
    const { entreprise: e, session: se } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.rediger"]);
    const documentId = String(formulaire.get("document") ?? "");
    await a.executer(async (q) => {
      const { rows: profil } = await q(
        "SELECT trace_chiffree FROM signatures_profils WHERE entreprise_id=$1 AND utilisateur_id=app.acteur()",
        [e.id]);
      if (!profil[0]) throw new Error("Enregistrez d'abord votre signature dans Mon compte");
      const { rows: docs } = await q(
        `SELECT id, instantane FROM documents WHERE id=$1 AND entreprise_id=$2
         AND statut='brouillon' AND type IN ('devis','contrat','facture') FOR UPDATE`,
        [documentId, e.id]);
      if (!docs[0]) throw new Error("Brouillon inaccessible ou déjà émis");
      const traces = validerSignature(JSON.parse(dechiffrer(Buffer.from(profil[0].trace_chiffree))));
      const { rows: utilisateurs } = await q(
        "SELECT prenom, nom FROM utilisateurs WHERE id=app.acteur()");
      const u = utilisateurs[0];
      const signataire = {
        traces,
        nom: [u?.prenom,u?.nom].filter(Boolean).join(" "),
        date: new Date().toISOString(),
      };
      const instantane = { ...docs[0].instantane, signaturePrestataire: signataire };
      await q(`UPDATE documents SET instantane=$1::jsonb WHERE id=$2 AND entreprise_id=$3
               AND statut='brouillon'`,[JSON.stringify(instantane), documentId, e.id]);
      await q(`INSERT INTO journal_audit(acteur_id,entreprise_id,action,ressource_type,ressource_id)
               VALUES($1,$2,'document.signature_prestataire','document',$3)`,
              [se.utilisateurId,e.id,documentId]);
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

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
        <Link href="/admin/demandes" className="btn btn--fantome">Retour</Link>
      </header>

      <div className="admin-colonnes">
        <div className="admin-colonne">
          <section className="admin-bloc">
            <h2 className="display t-carte">Le couple</h2>
            <dl className="admin-dl">
              <dt>Nom</dt><dd>{demande.contact_nom}</dd>
              <dt>E-mail</dt>
              <dd><a className="lien" href={`mailto:${demande.contact_email}`}>{demande.contact_email}</a></dd>
              <dt>Téléphone</dt>
              <dd>{demande.contact_telephone
                ? <a className="lien" href={`tel:${demande.contact_telephone.replace(/\s/g, "")}`}>{demande.contact_telephone}</a>
                : "—"}</dd>
              <dt>Contact préféré</dt><dd>{demande.contact_prefere ?? "—"}</dd>
            </dl>
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Le mariage</h2>
            <dl className="admin-dl">
              <dt>Date</dt>
              <dd>{demande.date_incertaine && !demande.date_mariage
                ? "À définir" : formaterDateSql(demande.date_mariage)}</dd>
              <dt>Lieu</dt><dd>{demande.lieu ?? "—"}</dd>
              <dt>Ville</dt><dd>{demande.ville ?? "—"}</dd>
              <dt>Département</dt><dd>{demande.departement ?? "—"}</dd>
              <dt>Invités</dt><dd>{demande.invites_estimes ?? "—"}</dd>
              <dt>Horaires</dt><dd>{demande.horaires ?? "—"}</dd>
            </dl>
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
            {peutEcrire ? <form action={modifierFormule} className="formulaire" style={{marginTop:"1.2rem"}}>
              <p className="label label--nu">Changer de formule / ajuster le tarif</p>
              <div className="champ"><label htmlFor="formule_cle">Formule</label>
                <select id="formule_cle" name="formule_cle" defaultValue={demande.formule_cle ?? ""}>
                  {formules.map(f => <option value={f.cle} key={f.cle}>
                    {f.nom} — {formaterPrix(f.prixCents)}
                  </option>)}
                </select>
              </div>
              <div className="champ"><label htmlFor="prix_personnalise">Prix personnalisé TTC (€) — facultatif</label>
                <input id="prix_personnalise" name="prix_personnalise" type="number" min="0" step="0.01"
                  placeholder="Laisser vide pour le tarif de la formule" /></div>
              <button type="submit" className="btn btn--fantome">Modifier la formule pour les futurs documents</button>
            </form> : null}
            {peutEcrire && lignes.some(l=>l.cle?.startsWith("ajout-")) ? (
              <div style={{marginTop:"1.2rem"}}>
                <p className="label label--nu">Corriger les options ajoutées</p>
                {lignes.filter(l=>l.cle?.startsWith("ajout-")).map(l=>(
                  <form action={modifierOption} key={l.id} className="formulaire"
                    style={{padding:"0.8rem 0",borderBottom:"1px solid var(--bordure,#e8e5df)"}}>
                    <input type="hidden" name="ligne" value={l.id}/>
                    <div className="champ"><label>Intitulé / livrable</label>
                      <input name="libelle" required defaultValue={l.libelle}/></div>
                    <div className="champ"><label>Prix TTC (€), vide pour sur devis</label>
                      <input name="prix" type="number" min="0" step="0.01"
                        defaultValue={l.prix_cents===null ? "" : (l.prix_cents/100).toFixed(2)}/></div>
                    <button type="submit" className="btn btn--fantome">Enregistrer la correction</button>
                  </form>))}
              </div>
            ) : null}

            {/* ⚠️ L'instantané fige ce que le client a vu : si un tarif change
                demain, cette fiche continue d'afficher le prix du jour de la
                demande. */}
            <p className="recap__note" style={{ marginTop: "0.9rem" }}>
              Les choix initiaux restent conservés. Les options ajoutées ensuite
              sont tracées séparément et n'altèrent aucun document déjà émis.
            </p>
            {peutEcrire ? (
              <form action={ajouterOption} className="formulaire" style={{ marginTop: "1rem" }}>
                <p className="label label--nu">Ajouter une option après échange avec le client</p>
                <div className="champ">
                  <label htmlFor="option_libelle">Prestation / livrable</label>
                  <input id="option_libelle" name="option_libelle" required maxLength={250}
                    placeholder="Ex. film des mariés, galerie supplémentaire…" />
                </div>
                <div className="champ">
                  <label htmlFor="option_prix">Prix TTC (€), vide si sur devis</label>
                  <input id="option_prix" name="option_prix" type="number" min="0" step="0.01" />
                </div>
                <div className="champ">
                  <label htmlFor="option_partenaire">Confier à un partenaire (facultatif)</label>
                  <select id="option_partenaire" name="option_partenaire" defaultValue="">
                    <option value="">Aucun — mon entreprise</option>
                    {partenaires.map((p) => <option key={p.id} value={p.id}>{p.nom_commercial}</option>)}
                  </select>
                </div>
                <p className="recap__note">Si vous choisissez un partenaire, il reçoit une proposition
                  dans son espace (sans coordonnées client). Le prix reste à valider avec lui.</p>
                <button type="submit" className="btn btn--fantome">Ajouter et notifier le partenaire</button>
              </form>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Message du client</h2>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{demande.message}</p>
          </section>

          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Compléter le dossier</h2>
              <p className="recap__note">
                Ce que vous apprenez au téléphone se note ici. Les informations
                soumises par le client restent conservées à part, intactes.
              </p>
              <form action={completer} className="formulaire" style={{ marginTop: "1rem" }}>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="contact_nom">Nom du couple</label>
                    <input id="contact_nom" name="contact_nom" type="text"
                      required maxLength={200} defaultValue={demande.contact_nom} />
                  </div>
                  <div className="champ">
                    <label htmlFor="contact_email">E-mail client</label>
                    <input id="contact_email" name="contact_email" type="email"
                      required maxLength={254} defaultValue={demande.contact_email} />
                  </div>
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="contact_prefere">Contact préféré</label>
                    <select id="contact_prefere" name="contact_prefere" defaultValue={demande.contact_prefere ?? ""}>
                      <option value="">Non défini</option>
                      <option value="email">E-mail</option>
                      <option value="telephone">Téléphone</option>
                      <option value="sms">SMS</option>
                    </select>
                  </div>
                  <div className="champ">
                    <label htmlFor="date_mariage">Date du mariage</label>
                    <input id="date_mariage" name="date_mariage" type="date"
                      defaultValue={demande.date_mariage ? String(demande.date_mariage).slice(0, 10) : ""} />
                    <p className="recap__note">Laissez vide si la date est encore incertaine.</p>
                  </div>
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="telephone">Téléphone</label>
                    <input id="telephone" name="telephone" type="tel"
                           defaultValue={demande.contact_telephone ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="invites">Nombre d&apos;invités</label>
                    <input id="invites" name="invites" type="number" min="0"
                           defaultValue={demande.invites_estimes ?? ""} />
                  </div>
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="ville">Ville</label>
                    <input id="ville" name="ville" type="text" defaultValue={demande.ville ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="departement">Département</label>
                    <input id="departement" name="departement" type="text"
                           defaultValue={demande.departement ?? ""} />
                  </div>
                </div>
                <div className="champ">
                  <label htmlFor="lieu">Lieux</label>
                  <input id="lieu" name="lieu" type="text" defaultValue={demande.lieu ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="horaires">Horaires connus</label>
                  <input id="horaires" name="horaires" type="text"
                         defaultValue={demande.horaires ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="complements">Informations complémentaires</label>
                  <textarea id="complements" name="complements"
                            defaultValue={demande.complements ?? ""} />
                </div>
                <button type="submit" className="btn">Enregistrer</button>
              </form>
            </section>
          ) : null}
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

            {acces.permissions.has("collaboration.proposer")
              && partenaires.length === 0 ? (
              <div className="admin-alerte" style={{ marginTop: "1rem" }}>
                <p>
                  Aucun partenaire disponible pour le moment.
                  Vous pouvez créer une entreprise partenaire indépendante,
                  puis lui transmettre cette prestation.
                </p>
                <Link href="/admin/collaborateurs#nouveau-partenaire"
                  className="btn btn--fantome">
                  Créer un partenaire
                </Link>
                <p className="recap__note" style={{ marginTop: "0.7rem" }}>
                  Les coordonnées du couple restent protégées :
                  leur partage nécessite une autorisation.
                </p>
              </div>
            ) : null}

            {acces.permissions.has("collaboration.proposer") && partenaires.length > 0 ? (
              <form action={proposerPrestation} className="formulaire"
                style={{ marginTop: "1.2rem" }}>
                <div className="admin-grille-champs">
                  <div className="champ">
                    <label htmlFor="partenaire">Partenaire</label>
                    <select id="partenaire" name="partenaire" required>
                      {partenaires.map((p) => (
                        <option key={p.id} value={p.id}>{p.nom_commercial}</option>
                      ))}
                    </select>
                  </div>
                  <div className="champ">
                    <label htmlFor="prestation">Prestation</label>
                    <select id="prestation" name="prestation" defaultValue="video">
                      <option value="video">Vidéo</option>
                      <option value="photo">Photo</option>
                      <option value="autre">Autre</option>
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

          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Envoyer les tarifs</h2>
              <p className="recap__note">
                E-mail HTML JoksWed, avec réponse dirigée vers la boîte de contact actuelle.
                Les tarifs vidéo de DON YC sont présentés à part ; le vidéaste facture sa prestation.
              </p>
              {retourEnvoi === "inhibe" ? (
                <p className="admin-alerte">Simulation effectuée : EMAIL_DRY_RUN est actif, aucun e-mail n'est parti.</p>
              ) : retourEnvoi === "envoye" ? (
                <p className="admin-pastille admin-pastille--emis">E-mail accepté par le fournisseur (livraison non garantie).</p>
              ) : null}
              <div className="admin-actions" style={{ marginTop: "1rem" }}>
                <form action={envoyerTarifs}>
                  <input type="hidden" name="nature" value="photo" />
                  <button type="submit" className="btn btn--fantome">Envoyer les tarifs photo</button>
                </form>
                {demande.video_demandee ? (
                  <form action={envoyerTarifs}>
                    <input type="hidden" name="nature" value="video" />
                    <button type="submit" className="btn btn--fantome">Envoyer les tarifs de DON YC</button>
                  </form>
                ) : null}
              </div>
            </section>
          ) : null}

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
                    {process.env.JOKSWED_SIGNATURES_ENABLED === "1"
                      && doc.statut === "brouillon"
                      && acces.permissions.has("document.rediger") ? (
                      <form action={apposerSignature}>
                        <input type="hidden" name="document" value={doc.id} />
                        <button type="submit" className="btn btn--fantome btn--petit">Apposer ma signature</button>
                      </form>
                    ) : null}
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
                <p className="recap__ligne">
                  <span>Prestation (devis émis)</span>
                  <span>{formaterPrix(situation.total_prestation_cents)}</span>
                </p>
                <p className="recap__ligne">
                  <span>Facturé</span>
                  <span>{formaterPrix(situation.facture_cents - situation.avoirs_cents)}</span>
                </p>
                <p className="recap__ligne">
                  <span>Encaissé (paiements confirmés)</span>
                  <span>{formaterPrix(situation.encaisse_cents)}</span>
                </p>
                <p className="recap__ligne recap__ligne--total">
                  <span>Reste dû</span>
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
        </div>
      </div>
    </main>
  );
}
