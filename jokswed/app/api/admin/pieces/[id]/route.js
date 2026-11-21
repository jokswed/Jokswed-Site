import { NextResponse } from "next/server";
import { exigerSession } from "@/lib/auth/acces";
import { avecActeur } from "@/lib/db/client";
import { idValide } from "@/lib/messagerie/pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APERCUS_AUTORISES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/gif",
]);

/**
 * Téléchargement des fichiers reçus OU envoyés depuis une discussion.
 *
 * AUCUN lien public n'est créé. La politique RLS piece_visible n'affiche
 * que les pièces des conversations que l'utilisateur a le droit de consulter.
 * Seules les images et les PDF peuvent être affichés inline ; tout autre
 * format sera téléchargé, même si un navigateur prétend pouvoir l'afficher.
 */
export async function GET(requete, { params }) {
  const { id } = await params;
  if (!idValide(id)) return new NextResponse("Introuvable", { status: 404 });
  const session = await exigerSession().catch(() => null);
  if (!session) return new NextResponse("Non authentifié", { status: 401 });

  const piece = await avecActeur(
    { utilisateurId: session.utilisateurId, jetonHache: session.jetonHache },
    async (q) => {
      const { rows } = await q(
        `SELECT nom, type_mime, taille_octets, contenu FROM pieces_jointes
          WHERE id = $1 AND origine IN ('entrant','fichier')`, [id]);
      return rows[0] ?? null;
    },
  );
  if (!piece?.contenu) return new NextResponse("Introuvable", { status: 404 });

  const octets = Buffer.from(piece.contenu);
  const nom = String(piece.nom || "piece-jointe");
  const nomAscii = nom.replace(/[^a-zA-Z0-9 ._()-]+/g, "_").replaceAll('"', "_").slice(0, 120);
  const apercu = requete.nextUrl.searchParams.get("apercu") === "1"
    && APERCUS_AUTORISES.has(piece.type_mime);

  // La réponse est diffusée par blocs, y compris pour les fichiers >4,5 Mo.
  // Elle n'est jamais stockée dans un cache CDN/intermédiaire.
  const flux = new ReadableStream({
    start(controller) {
      for (let i = 0; i < octets.length; i += 256 * 1024) {
        controller.enqueue(octets.subarray(i, i + 256 * 1024));
      }
      controller.close();
    },
  });
  return new NextResponse(flux, {
    status: 200,
    headers: {
      "content-type": piece.type_mime || "application/octet-stream",
      "content-disposition": `${apercu ? "inline" : "attachment"}; filename="${nomAscii}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
      "content-length": String(octets.length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
