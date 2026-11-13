import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces } from "@/lib/auth/acces";
import { gmailConfigure, urlAutorisation } from "@/lib/gmail/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =============================================================================
   PARTIR VERS GOOGLE
   -----------------------------------------------------------------------------
   ⚠️ LE `state` N'EST PAS DÉCORATIF.

   Sans lui, n'importe quel site pourrait amener un visiteur connecté sur
   l'adresse de retour avec un code d'autorisation obtenu pour SON compte
   Google : la boîte d'un inconnu se retrouverait branchée sur l'entreprise.
   On tire donc une valeur aléatoire, on la pose dans un cookie `httpOnly`, et
   le retour exige que les deux correspondent.
   ============================================================================= */
export async function POST() {
  const { entreprise } = await contexteAdmin();
  /* Connecter une boîte, c'est se donner le moyen d'écrire aux clientes. */
  await exigerAcces(entreprise.id, ["message.envoyer"]);

  if (!gmailConfigure()) {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: "/admin/parametres/messagerie?gmail=non-configure" },
    });
  }

  const etat = randomBytes(24).toString("base64url");
  const reponse = new NextResponse(null, {
    status: 303,
    headers: { Location: urlAutorisation(etat) },
  });
  reponse.cookies.set("jokswed_gmail_etat", etat, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/admin/gmail",
    secure: process.env.NODE_ENV === "production",
    /* Dix minutes : le temps de consentir, pas davantage. */
    maxAge: 600,
  });
  return reponse;
}
