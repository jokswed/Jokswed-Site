import { NextResponse } from "next/server";
import { exigerSession } from "@/lib/auth/acces";
import { avecActeur } from "@/lib/db/client";
import { idValide, TAILLE_BLOC_MAX, verifierDebut } from "@/lib/messagerie/pieces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function memeOrigine(request) {
  const origine = request.headers.get("origin");
  if (!origine) return true;
  try { return new URL(origine).origin === new URL(request.url).origin; }
  catch { return false; }
}

async function acteur(request, params) {
  const { id, piece } = await params;
  if (!idValide(id) || !idValide(piece) || !memeOrigine(request)) return null;
  const session = await exigerSession().catch(() => null);
  if (!session) return null;
  return { id, piece, session };
}

/** Lire en streaming, pour refuser un client qui envoie une charge excessive
 * sans en-tête Content-Length. Un simple arrayBuffer allouerait tout en
 * mémoire avant de vérifier la limite, ce qui est évitable. */
async function lireBloc(request) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const morceaux = [];
  let taille = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      taille += value.byteLength;
      if (taille > TAILLE_BLOC_MAX) {
        await reader.cancel().catch(() => {});
        throw new Error("Bloc trop volumineux");
      }
      morceaux.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(morceaux, taille);
}

/** Chaque bloc est au plus 2 MiB, sans exposer le PDF au frontend public.
 * La première tranche est vérifiée sur sa signature, tandis que PostgreSQL
 * vérifie en permanence l'auteur, la taille, l'ordre et la conversation.
 */
export async function POST(request, { params }) {
  const a = await acteur(request, params);
  if (!a) return NextResponse.json({ erreur: "Accès refusé" }, { status: 403 });

  const longueur = Number(request.headers.get("content-length") ?? 0);
  if (longueur > TAILLE_BLOC_MAX) {
    return NextResponse.json({ erreur: "Bloc trop volumineux" }, { status: 413 });
  }
  const offset = Number(request.headers.get("x-fichier-offset"));
  if (!Number.isInteger(offset) || offset < 0 || offset > 8 * 1024 * 1024) {
    return NextResponse.json({ erreur: "Position invalide" }, { status: 422 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/octet-stream")) {
    return NextResponse.json({ erreur: "Format du transfert invalide" }, { status: 415 });
  }

  try {
    const contenu = await lireBloc(request);
    if (contenu.length === 0 || contenu.length > TAILLE_BLOC_MAX) {
      return NextResponse.json({ erreur: "Bloc vide ou trop grand" }, { status: 413 });
    }
    const total = await avecActeur(
      { utilisateurId: a.session.utilisateurId, jetonHache: a.session.jetonHache },
      async (q) => {
        if (offset === 0) {
          // Seule la signature des premiers octets peut être contrôlée ici.
          const { rows } = await q(
            `SELECT nom FROM app.fichier_message_a_soi($1,$2)`, [a.id, a.piece]);
          if (!rows[0]?.nom) throw new Error("Fichier introuvable");
          verifierDebut(rows[0].nom, contenu);
        }
        const { rows } = await q(
          "SELECT app.ajouter_bloc_fichier_message($1,$2,$3,$4::bytea) AS taille",
          [a.piece, a.id, offset, contenu],
        );
        return rows[0]?.taille;
      },
    );
    return NextResponse.json({ taille: total });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("contenu ne correspond") || message.includes("Fichier incomplet")) {
      return NextResponse.json({ erreur: message }, { status: 422 });
    }
    console.error("[messagerie/pieces] bloc", e instanceof Error ? e.name : "erreur");
    return NextResponse.json({ erreur: "Transfert interrompu ou non autorisé" },
      { status: 422 });
  }
}

/** Annule seulement une pièce temporaire appartenant à l'utilisateur.
 * Un fichier déjà joint à un message envoyé ne peut jamais être supprimé ici.
 */
export async function DELETE(request, { params }) {
  const a = await acteur(request, params);
  if (!a) return NextResponse.json({ erreur: "Accès refusé" }, { status: 403 });
  try {
    await avecActeur(
      { utilisateurId: a.session.utilisateurId, jetonHache: a.session.jetonHache },
      (q) => q("SELECT app.annuler_fichier_message($1,$2)", [a.id, a.piece]),
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ erreur: "Impossible d'annuler" }, { status: 403 });
  }
}
