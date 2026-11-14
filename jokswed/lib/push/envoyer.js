import "server-only";
import webpush from "web-push";
import { extraitNotification } from "@/lib/messagerie/markdown";

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
export async function envoyerPushReponseClient(q, conversationId, texteRecu = "", messageId = null) {
  if (!configurer()) return { envoyes: 0, inhibe: true };

  // Ces fonctions SQL ne rendent que les abonnements des membres autorisés
  // à lire les messages de CETTE conversation. Aucune liste d'e-mails n'est
  // renvoyée et aucun aperçu n'est écrit dans les journaux.
  const { rows: sujets } = await q(
    "SELECT * FROM app.push_sujet_conversation($1)", [conversationId]);
  const s = sujets[0];
  if (!s) return { envoyes: 0, inhibe: false };

  const { rows: abonnements } = await q(
    "SELECT * FROM app.push_cible_conversation($1)", [conversationId]);

  const nom = String(s.expediteur ?? "Un client")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim().slice(0, 72) || "Un client";
  const apercu = extraitNotification(texteRecu, 150);
  // L'application iOS affiche aussi son nom natif : le corps précise
  // "JoksWed" en première ligne, suivi de l'extrait du message.
  const corps = `JoksWed\n${apercu}`;
  const url = `/admin/messagerie/${conversationId}`;

  let envoyes = 0;
  for (const abonnement of abonnements) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abonnement.endpoint,
          keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
        },
        JSON.stringify({
          title: nom,
          body: corps,
          icon: "/apple-icon.png",
          badge: "/apple-icon.png",
          url,
          // Un tag par message : chaque réponse peut produire sa propre alerte,
          // sans rejouer un même message grâce à la déduplication du webhook.
          tag: messageId ? `message-${messageId}` : `conversation-${conversationId}`,
        }),
        { TTL: 86400, urgency: "high" },
      );
      envoyes += 1;
    } catch (erreur) {
      const code = erreur?.statusCode ?? erreur?.status ?? "inconnu";
      console.error(`[push] envoi impossible (HTTP ${code})`);
    }
  }
  return { envoyes, inhibe: false };
}


/** Test réel, exclusivement pour l'abonnement courant du membre connecté.
 * Le endpoint est croisé avec app.acteur() (RLS) : personne ne peut utiliser
 * ce contrôle pour envoyer un push à un autre collaborateur ou à un client. */
export async function envoyerPushTestPersonnel(q, endpoint) {
  if (!configurer()) return { envoyes: 0, inhibe: true };
  if (!endpoint || !endpoint.startsWith("https://")) {
    return { envoyes: 0, inhibe: false };
  }

  const { rows } = await q(
    `SELECT endpoint, p256dh, auth FROM push_abonnements
      WHERE utilisateur_id = app.acteur() AND endpoint = $1 LIMIT 1`,
    [endpoint],
  );
  if (!rows.length) return { envoyes: 0, inhibe: false };

  const ab = rows[0];
  try {
    await webpush.sendNotification(
      {
        endpoint: ab.endpoint,
        keys: { p256dh: ab.p256dh, auth: ab.auth },
      },
      JSON.stringify({
        title: "Notification de test",
        body: "JoksWed\nLes alertes de messages sont activées sur cet appareil.",
        icon: "/apple-icon.png",
        badge: "/apple-icon.png",
        url: "/admin/notifications",
        tag: `test-jokswed-${Date.now()}`,
      }),
      { TTL: 600, urgency: "high" },
    );
    return { envoyes: 1, inhibe: false };
  } catch (erreur) {
    const code = erreur?.statusCode ?? erreur?.status ?? "inconnu";
    console.error(`[push/test] échec (HTTP ${code})`);
    return { envoyes: 0, inhibe: false };
  }
}
