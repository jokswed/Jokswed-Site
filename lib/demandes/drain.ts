import "server-only";
import { sansIdentite, type Requete } from "@/lib/db/client";
import { envoyer, expediteur, type ResultatEnvoi } from "@/lib/email/fournisseur";
import { accuseReception, alerteAdministrateur } from "@/lib/email/gabarits";
import { formaterDateSql } from "@/lib/dates";

/* =============================================================================
   DRAIN DE LA FILE D'ÉVÉNEMENTS
   -----------------------------------------------------------------------------
   ⚠️ CE QUI EST GARANTI, ET CE QUI NE L'EST PAS.

   Garanti : aucune notification sans demande enregistrée — l'événement naît
   dans la MÊME transaction que la demande. Aucun doublon évitable : les
   notifications et les journaux d'envoi portent une clé d'idempotence.

   NON garanti : « exactement une fois ». Brevo accuse la PRISE EN CHARGE d'un
   message, pas sa remise, et si un appel expire après qu'il l'a accepté, nous
   ne pouvons pas le savoir : la reprise renverra le message. On vise donc
   « au moins une fois, sans doublon évitable ». Prétendre mieux serait faux.

   ⚠️ L'ORDRE DES OPÉRATIONS EST DÉLIBÉRÉ.

   Les notifications internes sont posées AVANT toute tentative d'envoi. Si le
   fournisseur est en panne, l'administrateur voit quand même la demande dans
   son espace — c'est ce qui compte. L'e-mail est un confort, pas le support.
   ============================================================================= */

export interface ResultatDrain {
  pris: number;
  traites: number;
  echoues: number;
  envoyes: number;
  inhibes: number;
  verrouille: boolean;
}

/** Rejoue une notification interne (idempotente) pour tous les destinataires. */
async function notifierEquipe(
  q: Requete,
  entrepriseId: string,
  demandeId: string,
  reference: string,
  videoDemandee: boolean,
): Promise<void> {
  const { rows } = await q("SELECT * FROM app.membres_avec($1,'dossier.lire')", [entrepriseId]);
  for (const d of rows) {
    await q("SELECT app.notifier($1,$2,$3,$4,$5,$6,$7)", [
      d.utilisateur_id,
      entrepriseId,
      "demande.recue",
      `Nouvelle demande ${reference}`,
      /* ⚠️ NI NOM, NI DATE, NI MONTANT : une notification s'affiche sur un
         écran verrouillé. Le détail se consulte dans l'espace authentifié. */
      videoDemandee ? "Prestation vidéo demandée." : null,
      `/admin/demandes/${demandeId}`,
      `demande.recue:${demandeId}`,
    ]);
  }
  return;
}

async function journaliser(
  q: Requete,
  evenementId: string,
  demandeId: string,
  entrepriseId: string,
  gabarit: string,
  destinataire: string,
  sujet: string,
  resultat: ResultatEnvoi,
  cle: string,
): Promise<void> {
  await q(
    "SELECT app.journaliser_envoi($1,$2,$3,$4,$5::citext,$6,$7,$8,$9,$10,$11,$12)",
    [
      evenementId, demandeId, entrepriseId, gabarit, destinataire,
      expediteur().email, sujet, resultat.statut, resultat.fournisseur,
      resultat.messageId ?? null, resultat.erreur ?? null, cle,
    ],
  );
}

export async function drainer(max = 20): Promise<ResultatDrain> {
  const bilan: ResultatDrain = {
    pris: 0, traites: 0, echoues: 0, envoyes: 0, inhibes: 0, verrouille: false,
  };

  await sansIdentite(async (q: Requete) => {
    /* ⚠️ UN SEUL DRAIN À LA FOIS.
       `FOR UPDATE SKIP LOCKED` empêche déjà deux drains de prendre le MÊME
       événement. Ce verrou évite en plus que dix exécutions concurrentes se
       marchent dessus sans rien apporter. Il se libère à la fin de la
       transaction, même si le processus meurt — c'est ce qui le rend sûr sur
       une plateforme où une fonction peut être coupée à tout instant. */
    const { rows: verrou } = await q("SELECT app.verrou_drain() AS pris");
    if (!verrou[0].pris) {
      bilan.verrouille = true;
      return;
    }

    const { rows } = await q("SELECT * FROM app.evenements_a_traiter($1)", [max]);
    bilan.pris = rows.length;

    for (const evenement of rows) {
      try {
        if (evenement.type === "demande.recue") {
          const { demande_id, reference, entreprise_id, video_demandee } =
            evenement.charge_utile;

          await notifierEquipe(q, entreprise_id, demande_id, reference, video_demandee);

          /* ⚠️ PAR UNE FONCTION, PAS PAR UN SELECT ORDINAIRE.
             Le drain n'a pas d'acteur : la politique de `demandes` lui rendait
             zéro ligne, le bloc d'envoi était sauté en silence et l'événement
             marqué « traité ». Aucun e-mail n'était jamais composé, sans la
             moindre erreur. `app.demande_pour_envoi` ne rend que les cinq
             champs nécessaires — ni le message du client, ni l'instantané. */
          const { rows: demande } = await q(
            "SELECT * FROM app.demande_pour_envoi($1)", [demande_id]);

          const site = process.env.SITE_URL ?? "https://jokswed.com";
          const d = demande[0];

          if (d) {
            /* 1. Accusé de réception au couple. */
            const accuse = accuseReception({
              prenoms: d.contact_nom,
              reference,
              dateMariage: d.date_mariage ? formaterDateSql(d.date_mariage) : null,
              formule: d.formule_nom,
            });
            const r1 = await envoyer({
              destinataire: d.contact_email,
              destinataireNom: d.contact_nom,
              sujet: accuse.sujet,
              html: accuse.html,
              texte: accuse.texte,
              etiquettes: ["jokswed", "accuse-reception"],
            });
            await journaliser(q, evenement.id, demande_id, entreprise_id,
              "accuse_reception", d.contact_email, accuse.sujet, r1,
              `accuse:${demande_id}`);
            if (r1.statut === "envoye") bilan.envoyes += 1;
            else if (r1.statut === "inhibe") bilan.inhibes += 1;
            else throw new Error(`accusé de réception : ${r1.erreur}`);

            /* 2. Alerte à l'équipe. */
            const { rows: equipe } = await q(
              "SELECT * FROM app.membres_avec($1,'dossier.lire')", [entreprise_id]);
            const alerte = alerteAdministrateur({
              reference,
              ville: d.ville,
              dateMariage: d.date_mariage ? formaterDateSql(d.date_mariage) : null,
              videoDemandee: video_demandee,
              lien: `${site}/admin/demandes/${demande_id}`,
            });
            for (const membre of equipe) {
              const r2 = await envoyer({
                destinataire: membre.email,
                destinataireNom: membre.prenom,
                sujet: alerte.sujet,
                html: alerte.html,
                texte: alerte.texte,
                etiquettes: ["jokswed", "alerte-admin"],
              });
              await journaliser(q, evenement.id, demande_id, entreprise_id,
                "alerte_administrateur", membre.email, alerte.sujet, r2,
                `alerte:${demande_id}:${membre.utilisateur_id}`);
              if (r2.statut === "envoye") bilan.envoyes += 1;
              else if (r2.statut === "inhibe") bilan.inhibes += 1;
              else throw new Error(`alerte administrateur : ${r2.erreur}`);
            }
          }

          /* ⚠️ RIEN N'EST ENVOYÉ AU VIDÉASTE, MÊME SI LA VIDÉO EST DEMANDÉE.
             Son compte n'est pas activé et ses permissions ne sont pas
             opérationnelles. La proposition est enregistrée, `envoyee_le`
             reste nul, et aucune coordonnée ne sort. Le gabarit existe
             (`propositionCollaborateur`) pour le jour où tu l'autoriseras. */
        }

        await q("SELECT app.evenement_traite($1)", [evenement.id]);
        bilan.traites += 1;
      } catch (erreur) {
        bilan.echoues += 1;
        /* ⚠️ LE MESSAGE D'ERREUR EST TRONQUÉ ET SANS DONNÉE PERSONNELLE.
           L'événement revient avec un report exponentiel : une panne du
           fournisseur retarde l'envoi, elle ne le perd pas. */
        await q("SELECT app.evenement_echoue($1,$2)", [
          evenement.id,
          erreur instanceof Error ? erreur.message.slice(0, 200) : "erreur inconnue",
        ]);
      }
    }
  });

  return bilan;
}
