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
