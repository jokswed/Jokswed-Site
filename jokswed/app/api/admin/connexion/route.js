import { NextResponse } from "next/server";
import { connecter, NOM_COOKIE, optionsCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =============================================================================
   CONNEXION — ROUTE HTTP, PAS SERVER ACTION
   -----------------------------------------------------------------------------
   ⚠️ POURQUOI UNE ROUTE PLUTÔT QU'UNE ACTION SERVEUR.

   Trois raisons, dans cet ordre :

     1. le formulaire fonctionne SANS JavaScript — on ne se retrouve pas
        enfermé dehors parce qu'un script n'a pas chargé ;
     2. elle est éprouvable par un simple POST, sans reproduire le protocole
        interne des actions serveur (une première version du banc le tentait
        et échouait sur l'identifiant d'action) ;
     3. la vérification d'origine ci-dessous est explicite et lisible.
   ============================================================================= */

function origineAutorisee(requete) {
  const brut = requete.headers.get("origin") ?? requete.headers.get("referer");
  if (!brut) return false;
  let hote;
  try { hote = new URL(brut).host; } catch { return false; }

  const attendus = new Set();
  for (const v of [process.env.SITE_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    if (v) { try { attendus.add(new URL(v).host); } catch { /* ignoré */ } }
  }
  if (process.env.VERCEL_URL) attendus.add(process.env.VERCEL_URL);
  attendus.add(requete.headers.get("host") ?? "");
  return attendus.has(hote) || hote.endsWith(".vercel.app");
}

/** Une destination interne, jamais une URL fournie par l'appelant. */
function suiteSure(valeur) {
  const s = String(valeur ?? "/admin");
  return s.startsWith("/admin") && !s.startsWith("//") ? s : "/admin";
}

export async function POST(requete) {
  /* ⚠️ CSRF DE CONNEXION : sans ce contrôle, un site tiers pourrait soumettre
     ce formulaire et connecter un visiteur au compte de l'attaquant, qui
     verrait ensuite ce que la victime y dépose. */
  if (!origineAutorisee(requete)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const formulaire = await requete.formData();
  const suite = suiteSure(formulaire.get("suite"));
  const resultat = await connecter(
    String(formulaire.get("email") ?? ""),
    String(formulaire.get("motDePasse") ?? ""),
  );

  /* ⚠️ REDIRECTION RELATIVE, PAS CONSTRUITE DEPUIS `requete.url`.

     Next normalise `requete.url` sur son hôte canonique. Observé : une page
     ouverte sur 127.0.0.1 posait son cookie, puis la redirection pointait sur
     localhost — autre origine pour le navigateur, cookie non renvoyé, et
     l'utilisateur retombait sur l'écran de connexion sans message d'erreur.

     Un `Location` relatif reste sur l'origine que le visiteur utilise
     réellement, quelle qu'elle soit. */
  const rediriger = (vers) => {
    const r = new NextResponse(null, { status: 303, headers: { Location: vers } });
    return r;
  };

  if (!resultat.ok) {
    const motif =
      resultat.motif === "trop_de_tentatives" ? "trop"
      : resultat.motif === "compte_desactive" ? "desactive"
      : "refus";
    return rediriger(`/admin/connexion?erreur=${motif}&suite=${encodeURIComponent(suite)}`);
  }
  const reponse = rediriger(resultat.mfaRequise ? "/admin/second-facteur" : suite);
  /* Le cookie est posé sur LA réponse retournée — pas via `cookies()`, dont
     l'écriture ne survivait pas à la construction d'une redirection. */
  reponse.cookies.set(NOM_COOKIE, resultat.jeton, optionsCookie(resultat.maxAge));
  return reponse;
}
