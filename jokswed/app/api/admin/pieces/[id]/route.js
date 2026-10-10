import { NextResponse } from "next/server";
import { exigerSession } from "@/lib/auth/acces";
import { avecActeur } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* =============================================================================
   TÉLÉCHARGEMENT D'UNE PIÈCE JOINTE REÇUE
   -----------------------------------------------------------------------------
   ⚠️ AUCUN CONTRÔLE ÉCRIT ICI, ET C'EST VOULU.

   La politique `piece_visible` ne rend une pièce que si son message
   appartient à une conversation dont l'acteur est participant ET s'il porte
   `message.lire`. Une requête avec l'identifiant d'une pièce d'autrui ne
   rend donc aucune ligne — pas une erreur d'autorisation, rien du tout.
   Réécrire ce contrôle en JavaScript ajouterait un endroit où se tromper.

   ⚠️ `Content-Disposition: attachment` ET `X-Content-Type-Options: nosniff`.
   Une pièce reçue vient d'un tiers : la servir en ligne reviendrait à
   exécuter son HTML sur notre domaine.
   ============================================================================= */
export async function GET(requete, { params }) {
  const { id } = await params;
  const session = await exigerSession().catch(() => null);
  if (!session) return new NextResponse("Non authentifié", { status: 401 });

  const piece = await avecActeur(
    { utilisateurId: session.utilisateurId, jetonHache: session.jetonHache },
    async (q) => {
      const { rows } = await q(
        "SELECT nom, type_mime, contenu FROM pieces_jointes WHERE id = $1 AND origine = 'entrant'",
        [id]);
      return rows[0] ?? null;
    });

  if (!piece?.contenu) return new NextResponse("Introuvable", { status: 404 });

  const nomSur = String(piece.nom ?? "piece").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return new NextResponse(Buffer.from(piece.contenu), {
    status: 200,
    headers: {
      "content-type": piece.type_mime || "application/octet-stream",
      "content-disposition": `attachment; filename="${nomSur}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
