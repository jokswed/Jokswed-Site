import "server-only";
import { avecActeur, type Requete } from "@/lib/db/client";

/* =============================================================================
   DRAIN DE LA FILE D'ÉVÉNEMENTS
   -----------------------------------------------------------------------------
   ⚠️ CE QUI EST GARANTI, ET CE QUI NE L'EST PAS.

   Garanti : aucune notification sans demande enregistrée — l'événement naît
   dans la MÊME transaction que la demande — et aucun doublon, grâce à la clé
   d'idempotence portée par la notification.

   Non garanti : l'instantanéité. Si un traitement échoue, l'événement revient
   avec un report exponentiel (1, 2, 4… minutes). Le drain est appelé après
   chaque dépôt ; il devra aussi l'être par une tâche périodique pour reprendre
   les événements d'une instance arrêtée en cours de route. C'est la pièce qui
   reste à poser, et elle est signalée comme telle.
   ============================================================================= */

const ACTEUR_SYSTEME = "00000000-0000-0000-0000-000000000000";

/**
 * `true` tant qu'aucun envoi réel ne doit partir.
 *
 * ⚠️ LE DÉFAUT EST L'INHIBITION, PAS L'ENVOI.
 * Hors production, rien ne part — même avec une clé d'API valide configurée
 * par erreur. C'est l'inverse d'une variable qu'on penserait à poser : ici,
 * il faut explicitement être en production pour qu'un e-mail puisse partir.
 */
function envoiInhibe(): boolean {
  return process.env.EMAIL_DRY_RUN === "1" || process.env.NODE_ENV !== "production";
}

export interface ResultatDrain {
  traites: number;
  echoues: number;
  envoisInhibes: number;
}

export async function drainer(max = 20): Promise<ResultatDrain> {
  let traites = 0;
  let echoues = 0;
  let envoisInhibes = 0;

  await avecActeur({ utilisateurId: ACTEUR_SYSTEME }, async (q: Requete) => {
    /* `FOR UPDATE SKIP LOCKED` côté SQL : deux drains concurrents ne prennent
       jamais le même événement, et aucun des deux n'attend l'autre. */
    const { rows } = await q("SELECT * FROM app.evenements_a_traiter($1)", [max]);

    for (const evenement of rows) {
      try {
        if (evenement.type === "demande.recue") {
          const { demande_id, reference, entreprise_id, video_demandee } =
            evenement.charge_utile;

          const { rows: destinataires } = await q(
            "SELECT * FROM app.membres_avec($1,'dossier.lire')",
            [entreprise_id],
          );

          for (const d of destinataires) {
            await q("SELECT app.notifier($1,$2,$3,$4,$5,$6,$7)", [
              d.utilisateur_id,
              entreprise_id,
              "demande.recue",
              `Nouvelle demande ${reference}`,
              /* ⚠️ NI NOM, NI DATE, NI MONTANT dans le corps : une
                 notification s'affiche sur un écran verrouillé. Le détail se
                 consulte dans l'espace authentifié. */
              video_demandee ? "Prestation vidéo demandée." : null,
              `/admin/demandes/${demande_id}`,
              `demande.recue:${demande_id}`,
            ]);
          }

          /* ⚠️ AUCUN E-MAIL N'EST ENVOYÉ POUR L'INSTANT.

             L'accusé de réception au client et l'alerte à l'administrateur
             passeront ici, par Brevo. Tant que ce n'est pas branché, on
             compte l'inhibition plutôt que de la taire : un e-mail manquant
             se voit, un e-mail parti sans qu'on l'ait voulu ne se rattrape
             pas. Les notifications internes, elles, sont bien posées. */
          envoisInhibes += envoiInhibe() ? 1 : 1;
        }

        await q("SELECT app.evenement_traite($1)", [evenement.id]);
        traites += 1;
      } catch (erreur) {
        echoues += 1;
        /* On journalise le NOM de l'erreur, jamais son message : il peut
           contenir une valeur de paramètre, donc une donnée personnelle. */
        await q("SELECT app.evenement_echoue($1,$2)", [
          evenement.id,
          erreur instanceof Error ? erreur.name : "erreur inconnue",
        ]);
      }
    }
  });

  return { traites, echoues, envoisInhibes };
}
