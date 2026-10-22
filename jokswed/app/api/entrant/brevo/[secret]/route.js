import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sansIdentite } from "@/lib/db/client";
import { jetonDepuisDestinataires, adressesDUnePayload } from "@/lib/messagerie/adresses";
import { envoyerPushReponseClient } from "@/lib/push/envoyer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* =============================================================================
   RÉCEPTION DES RÉPONSES — WEBHOOK BREVO « inboundEmailProcessed »
   -----------------------------------------------------------------------------
   ⚠️ BREVO NE SIGNE PAS SES WEBHOOKS.

   Sa documentation d'« inbound parsing » ne décrit aucun mécanisme de
   signature ni d'authentification. N'importe qui connaissant l'URL peut donc
   poster une charge utile. Trois défenses, et il faut les trois :

     1. UN SECRET DANS L'URL. Le chemin contient une valeur aléatoire que
        seul Brevo connaît, comparée en temps constant. Sans elle : 404 —
        pas 401, qui confirmerait l'existence de l'endpoint.
     2. LE JETON DE CONVERSATION. Même authentifié, un message ne se
        rattache qu'à la conversation dont il porte l'adresse de réponse.
        `app.recevoir_message` met tout le reste en quarantaine.
     3. L'EXPÉDITEUR DOIT ÊTRE PARTICIPANT. Connaître une adresse de réponse
        ne suffit pas : un courrier transféré à un tiers ne lui ouvre pas le
        fil.

   ⚠️ ON RÉPOND 200 MÊME SUR UNE CHARGE INEXPLOITABLE.
   Un 500 ferait réessayer Brevo indéfiniment sur un message qu'on ne saura
   jamais traiter. Ce qu'on ne sait pas rattacher va en quarantaine, et la
   réponse dit combien.
   ============================================================================= */

function secretAttendu() {
  return process.env.JOKSWED_WEBHOOK_ENTRANT?.trim() || null;
}

function memeSecret(fourni, attendu) {
  const a = Buffer.from(fourni ?? "", "utf8");
  const b = Buffer.from(attendu, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function adresseDe(boite) {
  if (!boite) return null;
  if (typeof boite === "string") return boite.trim();
  return (boite.Address ?? "").trim() || null;
}

export async function POST(requete, { params }) {
  const attendu = secretAttendu();
  const { secret } = await params;

  /* ⚠️ PAS DE SECRET CONFIGURÉ = PAS D'ENDPOINT.
     Une réception ouverte par défaut, c'est une boîte aux lettres publique
     branchée sur la base. */
  if (!attendu || !memeSecret(secret, attendu)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let charge;
  try {
    charge = await requete.json();
  } catch {
    return NextResponse.json({ recus: 0, motif: "corps illisible" }, { status: 200 });
  }

  const items = Array.isArray(charge?.items) ? charge.items
    : Array.isArray(charge) ? charge
    : charge ? [charge] : [];

  const bilan = { recus: 0, rattaches: 0, quarantaine: 0, doublons: 0 };

  await sansIdentite(async (q) => {
    for (const item of items) {
      bilan.recus += 1;
      const destinataires = adressesDUnePayload(item);
      const jeton = jetonDepuisDestinataires(destinataires);
      const expediteur = adresseDe(item.From);

      /* ⚠️ `ExtractedMarkdownMessage` EST LA RÉPONSE SANS LA CITATION.
         `RawTextBody` contient tout l'historique recopié par le client de
         messagerie : l'afficher rendrait le fil illisible. On garde
         l'extraction quand elle existe, le brut sinon. */
      const corps = item.ExtractedMarkdownMessage || item.RawTextBody
        || item.RawHtmlBody?.replace(/<[^>]+>/g, " ") || "";

      const { rows } = await q(
        "SELECT * FROM app.recevoir_message($1,$2::citext,$3,$4,$5,$6,$7,$8,$9::text[],$10::jsonb)",
        [
          jeton,
          expediteur,
          adresseDe(item.From) === null ? null : (item.From?.Name ?? null),
          item.MessageId ?? null,
          item.InReplyTo ?? null,
          item.Subject ?? null,
          corps,
          item.RawHtmlBody ?? null,
          destinataires,
          /* ⚠️ ON NE CONSERVE PAS LA CHARGE BRUTE D'UN MESSAGE RATTACHÉ.
             Elle contient les en-têtes complets et parfois des adresses de
             tiers en copie. Seule la quarantaine en a besoin, pour qu'on
             puisse comprendre ce qui n'a pas marché. */
          JSON.stringify({
            sujet: item.Subject ?? null,
            de: expediteur,
            pour: destinataires,
            spam: item.SpamScore ?? item.Spam?.Score ?? null,
          }),
        ]);

      const resultat = rows[0] ?? {};
      if (resultat.motif === "déjà reçu" || resultat.motif === "déjà en quarantaine") {
        bilan.doublons += 1;
      } else if (resultat.orphelin) {
        bilan.quarantaine += 1;
      } else {
        bilan.rattaches += 1;

        /* ⚠️ ICI, ET NULLE PART AILLEURS DANS CETTE BOUCLE.
           Ce `else` est la seule branche atteinte par un message NEUF et
           RATTACHÉ : « déjà reçu » part en doublon, un orphelin part en
           quarantaine. Notifier plus haut aurait sonné à chaque rejeu du
           webhook. Et nos propres messages ne passent pas par là : ils sont
           sortants, et c'est le drain qui les traite. */
        try {
          await envoyerPushReponseClient(q, resultat.conversation_id);
        } catch (erreur) {
          /* Une notification perdue ne doit pas faire échouer la réception :
             le message est déjà enregistré, et Brevo rejouerait l'appel. */
          console.error("[entrant] push impossible :", erreur?.message ?? erreur);
        }

        /* Les pièces jointes arrivent par jeton de téléchargement : on va
           les chercher, dans la limite de taille acceptée par la table. */
        for (const piece of item.Attachments ?? []) {
          if (!piece?.DownloadToken || !process.env.BREVO_API_KEY) continue;
          if ((piece.ContentLength ?? 0) > 8 * 1024 * 1024) continue;
          try {
            const r = await fetch(
              `https://api.brevo.com/v3/inbound/attachments/${piece.DownloadToken}`,
              { headers: { "api-key": process.env.BREVO_API_KEY },
                signal: AbortSignal.timeout(15_000) });
            if (!r.ok) continue;
            const octets = Buffer.from(await r.arrayBuffer());
            if (octets.length > 8 * 1024 * 1024) continue;
            await q("SELECT app.joindre_piece_entrante($1,$2,$3,$4)", [
              resultat.message_id, piece.Name ?? "piece-jointe",
              piece.ContentType ?? "application/octet-stream", octets,
            ]);
          } catch {
            /* Une pièce manquante ne doit pas faire perdre le message. */
          }
        }
      }
    }
  });

  return NextResponse.json(bilan, { status: 200 });
}
