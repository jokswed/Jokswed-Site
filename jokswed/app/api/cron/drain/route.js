import { NextResponse } from "next/server";
import { drainer } from "@/lib/demandes/drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* =============================================================================
   TRAITEMENT PÉRIODIQUE DE LA FILE
   -----------------------------------------------------------------------------
   ⚠️ POURQUOI CET ENDPOINT EXISTE.

   Le drain tourne déjà après chaque dépôt. Mais si l'envoi échoue, ou si
   l'instance est coupée en plein traitement, l'événement attend — et sans
   nouvelle demande, personne ne vient le reprendre. Cet endpoint est ce qui
   fait qu'une panne de Brevo à 3 h du matin se rattrape toute seule.

   ⚠️ CE QU'IL FAUT VÉRIFIER SUR TON OFFRE VERCEL.

   Les tâches planifiées existent sur toutes les offres, mais leur FRÉQUENCE
   en dépend : l'offre Hobby les limite à une exécution quotidienne, l'offre
   Pro autorise une granularité fine. Un site commercial ne peut de toute
   façon pas rester en Hobby, dont les conditions l'interdisent — ce point
   était déjà dans l'étude de coûts.

   `vercel.json` demande ici un passage toutes les quinze minutes. Si ton
   offre ne l'autorise pas, Vercel refusera le déploiement et il faudra
   soit passer à une exécution quotidienne, soit déclencher cet endpoint
   depuis un planificateur externe. **À confirmer avant le premier
   déploiement** — je ne peux pas lire ton offre d'ici.

   ⚠️ L'ENDPOINT EST PROTÉGÉ, ET LE DÉFAUT EST LE REFUS.

   Sans `CRON_SECRET` configuré, il répond 503 plutôt que de s'ouvrir. Une
   route de maintenance laissée accessible est une invitation à épuiser la
   base.
   ============================================================================= */

function autorise(requete) {
  const attendu = process.env.CRON_SECRET;
  if (!attendu) return { ok: false, statut: 503, motif: "CRON_SECRET non configuré" };

  const entete = requete.headers.get("authorization") ?? "";
  /* Vercel envoie `Authorization: Bearer <CRON_SECRET>` sur ses tâches
     planifiées. On accepte aussi un en-tête dédié, pour un déclencheur
     externe. */
  const fourni = entete.startsWith("Bearer ")
    ? entete.slice(7)
    : requete.headers.get("x-cron-secret") ?? "";

  /* Comparaison à durée constante : une comparaison ordinaire s'arrête au
     premier octet différent et laisse mesurer le préfixe correct. */
  if (fourni.length !== attendu.length) return { ok: false, statut: 401, motif: "refusé" };
  let diff = 0;
  for (let i = 0; i < attendu.length; i += 1) {
    diff |= fourni.charCodeAt(i) ^ attendu.charCodeAt(i);
  }
  return diff === 0
    ? { ok: true }
    : { ok: false, statut: 401, motif: "refusé" };
}

async function traiter(requete) {
  const verdict = autorise(requete);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, message: verdict.motif }, { status: verdict.statut });
  }

  try {
    const bilan = await drainer(50);
    /* On renvoie le bilan : c'est ce que montrent les journaux Vercel, et
       c'est ce qui permet de voir qu'un événement coince sans aller fouiller
       la base. Aucune donnée personnelle n'y figure. */
    return NextResponse.json({ ok: true, ...bilan });
  } catch (erreur) {
    console.error(
      `[cron/drain] échec : ${erreur instanceof Error ? erreur.name : "inconnue"}`,
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/* Vercel appelle ses tâches planifiées en GET ; un déclencheur externe
   préférera POST. Les deux passent par le même contrôle. */
export const GET = traiter;
export const POST = traiter;
