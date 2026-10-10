import { NextResponse } from "next/server";
import { exigerAcces, AccesRefuse } from "@/lib/auth/acces";
import { contexteAdmin } from "@/lib/admin/garde";
import { rendrePdf } from "@/lib/documents/generer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Téléchargement d'un document. L'autorisation est vérifiée ici ET la
   politique de `documents` filtre la ligne : un identifiant d'une autre
   entreprise ne rend simplement rien. */
export async function GET(_requete, { params }) {
  const { id } = await params;
  try {
    const { entreprise } = await contexteAdmin();
    const acces = await exigerAcces(entreprise.id, ["document.lire"]);

    const document = await acces.executer(async (q) => {
      const { rows } = await q(
        "SELECT id, numero, statut, instantane FROM documents WHERE id = $1", [id]);
      return rows[0] ?? null;
    });
    if (!document) return new NextResponse(null, { status: 404 });

    const { pdf } = rendrePdf(document.instantane, document.statut === "brouillon");

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        /* `inline` : on l'ouvre pour le relire avant de l'émettre. */
        "content-disposition":
          `inline; filename="${document.numero ?? "brouillon"}.pdf"`,
        /* ⚠️ Un document commercial ne se met pas en cache sur un
           intermédiaire : il porte des données personnelles. */
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new NextResponse(null, { status: 403 });
    throw erreur;
  }
}
