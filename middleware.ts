import { NextResponse, type NextRequest } from "next/server";

/* =============================================================================
   MIDDLEWARE — PREMIÈRE BARRIÈRE, PAS LA SEULE
   -----------------------------------------------------------------------------
   ⚠️ IL NE VÉRIFIE QUE LA PRÉSENCE DU COOKIE, ET C'EST ASSUMÉ.

   Le middleware tourne sur le runtime Edge : pas de connexion PostgreSQL,
   donc aucun moyen de savoir si la session est valide, révoquée ou dépourvue
   de second facteur. Il écarte simplement les visiteurs qui n'ont aucun
   cookie — ce qui évite de faire tourner une page serveur pour rien.

   LA VRAIE VÉRIFICATION EST AILLEURS : chaque page et chaque action d'admin
   appelle `exigerSession()` puis `exigerAcces()`, qui interrogent la base,
   contrôlent la révocation, le second facteur, l'appartenance et la
   permission. Un banc vérifie qu'aucune route d'admin n'y échappe.

   Traiter ce fichier comme la sécurité du projet serait l'erreur classique :
   un contournement du middleware (il y en a eu, CVE-2025-29927) rendrait
   alors toute l'administration accessible.
   ============================================================================= */

const COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-jokswed_session" : "jokswed_session";

export function middleware(requete: NextRequest) {
  const { pathname } = requete.nextUrl;

  if (pathname === "/admin/connexion" || pathname.startsWith("/admin/invitation")) {
    return NextResponse.next();
  }

  if (!requete.cookies.get(COOKIE)?.value) {
    const vers = requete.nextUrl.clone();
    vers.pathname = "/admin/connexion";
    vers.search = `?suite=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(vers);
  }

  const reponse = NextResponse.next();
  /* L'administration ne doit jamais être mise en cache par un intermédiaire,
     ni indexée, ni affichée dans un cadre. */
  reponse.headers.set("Cache-Control", "no-store, max-age=0");
  reponse.headers.set("X-Robots-Tag", "noindex, nofollow");
  reponse.headers.set("X-Frame-Options", "DENY");
  reponse.headers.set("Referrer-Policy", "same-origin");
  return reponse;
}

export const config = { matcher: ["/admin/:path*"] };
