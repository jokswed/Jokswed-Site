import { NextResponse } from "next/server";
import { exigerSession } from "@/lib/auth/acces";
import { avecActeur } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* =============================================================================
   TÉLÉCHARGEMENT D'UN FICHIER DE DOSSIER
   -----------------------------------------------------------------------------
   ⚠️ DEUX CHEMINS, DEUX AUTORISATIONS — ET AUCUNE ÉCRITE ICI.

   · SANS `?dossier=` : c'est le propriétaire du dossier qui lit. La politique
     de `fichiers_dossier` exige le bon tenant ET `dossier.lire` ou
     `dossier.ecrire`. L'identifiant d'un fichier d'autrui ne rend aucune
     ligne — pas une erreur d'autorisation, rien du tout.

   · AVEC `?dossier=` : c'est un collaborateur qui lit au nom du dossier qu'on
     lui a confié. `app.fichier_du_dossier` vérifie qu'il a bien un dossier
     sur CE mariage, que la catégorie « documents partagés » lui a été
     partagée, et que le fichier porte `partage = true`. L'identifiant du
     fichier seul ne suffit donc pas : c'est ce qui ferme l'IDOR.

   Réécrire ces contrôles en JavaScript ajouterait un endroit où se tromper.

   ⚠️ `attachment` ET `nosniff`.
   Un fichier déposé vient d'un tiers : le servir en ligne reviendrait à
   exécuter son contenu sur notre domaine. La liste blanche de types de la
   table l'interdit déjà ; ces deux en-têtes sont la seconde serrure.
   ============================================================================= */
export async function GET(requete, { params }) {
  const { id } = await params;
  const dossier = new URL(requete.url).searchParams.get("dossier");

  const session = await exigerSession().catch(() => null);
  if (!session) return new NextResponse("Non authentifié", { status: 401 });

  const fichier = await avecActeur(
    { utilisateurId: session.utilisateurId, jetonHache: session.jetonHache },
    async (q) => {
      const { rows } = dossier
        ? await q("SELECT * FROM app.fichier_du_dossier($1,$2)", [id, dossier])
        : await q(
            "SELECT nom, type_mime, contenu FROM fichiers_dossier WHERE id = $1",
            [id]);
      return rows[0] ?? null;
    }).catch(() => null);

  if (!fichier?.contenu) return new NextResponse("Introuvable", { status: 404 });

  const nomSur = String(fichier.nom ?? "fichier").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return new NextResponse(Buffer.from(fichier.contenu), {
    status: 200,
    headers: {
      "content-type": fichier.type_mime || "application/octet-stream",
      "content-disposition": `attachment; filename="${nomSur}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
