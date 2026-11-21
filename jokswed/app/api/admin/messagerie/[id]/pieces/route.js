import { NextResponse } from "next/server";
import { exigerSession } from "@/lib/auth/acces";
import { avecActeur } from "@/lib/db/client";
import {
  idValide, nomFichierSecurise, mimeFichier,
  TAILLE_FICHIER_MAX,
} from "@/lib/messagerie/pieces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function memeOrigine(request) {
  const origine = request.headers.get("origin");
  if (!origine) return true;
  try {
    return new URL(origine).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** Initialise un dépôt temporaire. Aucune donnée binaire n'est reçue ici.
 * Le serveur calcule le MIME depuis une extension en liste blanche, et la
 * fonction SQL vérifie la permission de l'utilisateur pour CETTE discussion.
 */
export async function POST(request, { params }) {
  const { id } = await params;
  if (!memeOrigine(request)) return NextResponse.json({ erreur: "Origine refusée" }, { status: 403 });
  if (!idValide(id)) return NextResponse.json({ erreur: "Discussion invalide" }, { status: 422 });
  const longueur = Number(request.headers.get("content-length") ?? 0);
  if (longueur > 4096) return NextResponse.json({ erreur: "Requête trop volumineuse" }, { status: 413 });

  const session = await exigerSession().catch(() => null);
  if (!session) return NextResponse.json({ erreur: "Connexion requise" }, { status: 401 });

  try {
    /* Plafond réellement imposé, même si le client omet Content-Length. */
    const brut = await request.text();
    if (brut.length > 4096) {
      return NextResponse.json({ erreur: "Requête trop volumineuse" }, { status: 413 });
    }
    const body = JSON.parse(brut);
    const nom = nomFichierSecurise(body?.nom);
    const mime = mimeFichier(nom);
    const taille = Number(body?.taille);
    if (!Number.isInteger(taille) || taille < 1 || taille > TAILLE_FICHIER_MAX) {
      return NextResponse.json({ erreur: "8 Mo maximum par fichier" }, { status: 422 });
    }
    const identifiant = await avecActeur(
      { utilisateurId: session.utilisateurId, jetonHache: session.jetonHache },
      async (q) => {
        const { rows } = await q(
          "SELECT app.preparer_fichier_message($1,$2,$3,$4) AS id",
          [id, nom, mime, taille],
        );
        return rows[0]?.id;
      },
    );
    if (!identifiant) throw new Error("Préparation du fichier impossible");
    return NextResponse.json({ id: identifiant });
  } catch (e) {
    if (String(e?.message ?? "").includes("limite")
      || String(e?.message ?? "").includes("maximum")
      || String(e?.message ?? "").includes("format")
      || String(e?.message ?? "").includes("fichier")) {
      return NextResponse.json({ erreur: String(e.message).slice(0, 140) }, { status: 422 });
    }
    console.error("[messagerie/pieces] préparation", e instanceof Error ? e.name : "erreur");
    return NextResponse.json({ erreur: "Fichier refusé ou accès non autorisé" }, { status: 403 });
  }
}
