import "server-only";
import { engendrerJetonConversation } from "@/lib/messagerie/adresses";
import type { Requete } from "@/lib/db/client";

/**
 * Ouvre la conversation d'une demande depuis un écran administrateur.
 *
 * L'appelant doit déjà être dans une transaction avec acteur et autorisé à
 * message.envoyer. Le contrôle entreprise est répété sur la demande, puis la
 * fonction SQL app.ouvrir_conversation vérifie elle-même la permission.
 */
export async function ouvrirConversationDemande(
  q: Requete,
  entrepriseId: string,
  demandeId: string,
): Promise<string | null> {
  if (!demandeId) return null;

  const { rows: demandes } = await q(
    `SELECT contact_nom, contact_email, reference FROM demandes
      WHERE id = $1 AND entreprise_destinataire_id = $2`,
    [demandeId, entrepriseId],
  );
  const demande = demandes[0];
  if (!demande?.contact_email) return null;

  // Même verrou pour la création manuelle et la migration 069.
  await q(
    "SELECT pg_advisory_xact_lock(hashtext('demande-fil-jokswed'), hashtext($1::text))",
    [demandeId],
  );

  const { rows: existantes } = await q(
    `SELECT c.id FROM conversations c
      JOIN conversation_participants cp
        ON cp.conversation_id = c.id AND cp.role = 'client'
       AND cp.retire_le IS NULL AND cp.contact_email = $3::citext
     WHERE c.entreprise_id = $1 AND c.demande_id = $2 AND c.nature = 'client'
     ORDER BY (c.statut = 'ouverte') DESC, c.derniere_activite_le DESC
     LIMIT 1`,
    [entrepriseId, demandeId, demande.contact_email],
  );

  if (existantes[0]?.id) {
    // On rouvre sans jamais réécrire l'adresse de réponse du fil existant.
    await q("SELECT app.archiver_conversation($1,false)", [existantes[0].id]);
    return existantes[0].id;
  }

  const { rows } = await q(
    "SELECT app.ouvrir_conversation($1,$2,$3,$4,$5,NULL,$6::citext,$7) AS id",
    [
      entrepriseId, "client",
      `Votre demande de mariage ${demande.reference} — JoksWed`,
      engendrerJetonConversation(), demandeId,
      demande.contact_email, demande.contact_nom,
    ],
  );
  return rows[0]?.id ?? null;
}
