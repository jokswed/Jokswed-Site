import { NextResponse } from "next/server";
import { sansIdentite } from "@/lib/db/client";
import { hacherJeton } from "@/lib/auth/secrets";
import { construireIcs } from "@/lib/calendrier/ics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* =============================================================================
   LE FLUX PRIVÉ DU CARNET — POUR APPLE CALENDAR
   -----------------------------------------------------------------------------
   ⚠️ AUCUNE SESSION, ET C'EST LE PROPRE D'UN FLUX.

   Apple Calendar relit cette URL depuis un Mac, un iPhone, un réveil à 4 h du
   matin : il n'a pas de cookie et n'en aura jamais. L'autorisation est donc le
   JETON lui-même — 256 bits aléatoires — et rien d'autre.

   Ce qui le rend acceptable :

     · la base ne garde que l'EMPREINTE du jeton (HMAC-SHA-256), comme pour
       une session : lire la table ne rend le flux de personne ;
     · `app.calendrier_entreprise` ne prend que cette empreinte, ne rend que
       les mariages réellement au carnet, et AUCUN montant ;
     · régénérer le jeton depuis l'administration écrase l'empreinte : l'URL
       précédente cesse immédiatement de servir.

   ⚠️ `noindex` ET `no-store`.
   Une URL de flux finit par circuler — dans les réglages d'un appareil, dans
   une sauvegarde. Elle ne doit au moins pas finir dans un index.
   ============================================================================= */
export async function GET(requete, { params }) {
  const { jeton } = await params;
  /* Apple Calendar s'accommode mieux d'une URL qui finit par `.ics` : on
     l'accepte avec ou sans, c'est le même flux. */
  const brut = String(jeton ?? "").replace(/\.ics$/i, "");
  if (brut.length < 20) return new NextResponse("Introuvable", { status: 404 });

  const evenements = await sansIdentite(async (q) => {
    const { rows } = await q("SELECT * FROM app.calendrier_entreprise($1)",
      [hacherJeton(brut)]);
    return rows;
  }).catch(() => null);

  if (evenements === null) return new NextResponse("Indisponible", { status: 503 });

  /* ⚠️ JETON INCONNU ET SAISON VIDE RENDENT LA MÊME CHOSE : UN CALENDRIER VIDE.
     Les distinguer — 404 d'un côté, calendrier de l'autre — ferait de cette
     route un oracle : on saurait, jeton par jeton, lequel est valide. Et un
     404 casserait l'abonnement légitime d'un photographe entre deux saisons :
     Apple Calendar désactive un flux qui répond en erreur. */
  if (evenements.length === 0) {
    return reponseIcs(construireIcs([], { nom: "JoksWed — Carnet" }));
  }
  return reponseIcs(construireIcs(evenements, {
    nom: "JoksWed — Carnet de mariages",
    site: process.env.SITE_URL ?? "https://jokswed.com",
  }));
}

function reponseIcs(corps) {
  return new NextResponse(corps, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="jokswed.ics"',
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
    },
  });
}
