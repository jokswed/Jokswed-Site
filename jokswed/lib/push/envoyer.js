import "server-only";
import webpush from "web-push";

let configure = false;

function configurer() {
  if (configure) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:contact@jokswed.com",
    publicKey,
    privateKey,
  );
  configure = true;
  return true;
}

/* ⚠️ ON PASSE L'ÉVÉNEMENT, PAS L'ENTREPRISE — VOIR LE PALIER 062.
   La fonction en base déduit l'entreprise de l'événement qu'elle reçoit, et
   n'accepte qu'un événement réclamé et non traité. Le drain ne peut donc plus
   désigner les abonnements push d'une entreprise quelconque. */
export async function envoyerPushNouvelleDemande(q, evenementId, demandeId, reference) {
  if (!configurer()) return { envoyes: 0, inhibe: true };

  const { rows } = await q(
    "SELECT * FROM app.push_abonnements_evenement($1)",
    [evenementId],
  );

  let envoyes = 0;
  for (const abonnement of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abonnement.endpoint,
          keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
        },
        JSON.stringify({
          title: "Nouvelle demande JoksWed",
          body: `Une nouvelle demande (${reference}) vient d’arriver.`,
          url: `/admin/demandes/${demandeId}`,
          tag: `demande-${demandeId}`,
        }),
        { TTL: 600, urgency: "high" },
      );
      envoyes += 1;
    } catch (erreur) {
      const code = erreur?.statusCode ?? erreur?.status ?? "inconnu";
      console.error(`[push] envoi impossible (HTTP ${code})`);
    }
  }
  return { envoyes, inhibe: false };
}

/* ⚠️ ON PASSE LA CONVERSATION, PAS L'ENTREPRISE — MÊME RAISON QU'AU-DESSUS.
   `app.push_cible_conversation` déduit l'entreprise de la conversation, et ne
   retient que ses membres actifs portant `message.lire` et n'ayant pas coupé
   `message.recu`.

   ⚠️ APPELÉ UNIQUEMENT POUR UN MESSAGE RÉELLEMENT ENREGISTRÉ, ET ENTRANT.
   `app.recevoir_message` déduplique par `message_id_rfc` et rend « déjà reçu »
   sur un webhook rejoué : l'appelant ne doit déclencher cet envoi que sur un
   message neuf et rattaché. Nos propres envois, eux, ne passent jamais par ce
   chemin — ils sont `sortant`, et c'est le drain qui les traite. */
export async function envoyerPushReponseClient(q, conversationId) {
  if (!configurer()) return { envoyes: 0, inhibe: true };

  const { rows: sujet } = await q(
    "SELECT * FROM app.push_sujet_conversation($1)", [conversationId]);
  const s = sujet[0];
  if (!s) return { envoyes: 0, inhibe: false };

  const { rows } = await q(
    "SELECT * FROM app.push_cible_conversation($1)", [conversationId]);

  /* Le prénom suffit : le corps du message ne doit pas s'afficher sur un
     écran verrouillé. */
  const qui = String(s.expediteur ?? "Un client").split(/\s+/)[0];
  const quand = s.date_mariage
    ? ` concernant son mariage du ${new Date(`${s.date_mariage}T12:00:00Z`)
        .toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`
    : "";
  const url = s.demande_id
    ? `/admin/demandes/${s.demande_id}`
    : `/admin/messagerie/${conversationId}`;

  let envoyes = 0;
  for (const abonnement of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abonnement.endpoint,
          keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
        },
        JSON.stringify({
          title: "JoksWed — Nouvelle réponse client",
          body: `${qui} vient de répondre à votre message${quand}.`,
          url,
          /* Le `tag` est la conversation : deux réponses d'affilée remplacent
             la notification au lieu de s'empiler. */
          tag: `conversation-${conversationId}`,
        }),
        { TTL: 600, urgency: "high" },
      );
      envoyes += 1;
    } catch (erreur) {
      const code = erreur?.statusCode ?? erreur?.status ?? "inconnu";
      console.error(`[push] envoi impossible (HTTP ${code})`);
    }
  }
  return { envoyes, inhibe: false };
}
