import { NextResponse } from "next/server";
import { exigerSession, mesEntreprises } from "@/lib/auth/acces";

/* =============================================================================
   CHOISIR L'ENTREPRISE ACTIVE
   -----------------------------------------------------------------------------
   ⚠️ CE COOKIE N'OUVRE AUCUN ACCÈS.

   Il ne fait que mémoriser, parmi les entreprises dont la BASE a établi que
   l'acteur est membre actif, laquelle afficher. La route refuse tout
   identifiant absent de cette liste — et même si elle l'acceptait,
   `contexteAdmin()` retomberait sur la première, et la RLS ne rendrait
   aucune ligne.
   ============================================================================= */
export async function POST(requete) {
  const session = await exigerSession().catch(() => null);
  if (!session) {
    return new NextResponse(null, { status: 303, headers: { Location: "/admin/connexion" } });
  }

  const formulaire = await requete.formData();
  const voulue = String(formulaire.get("entreprise") ?? "");
  const entreprises = await mesEntreprises(session);
  const trouvee = entreprises.find((e) => e.id === voulue);

  /* ⚠️ REDIRECTION RELATIVE, ET SUITE INTERNE UNIQUEMENT.
     Construire l'URL depuis `requete.url` ferait basculer l'hôte
     (127.0.0.1 ↔ localhost) et perdrait le cookie ; accepter une `suite`
     absolue ferait de cette route un tremplin de redirection ouverte. */
  const demandee = String(formulaire.get("suite") ?? "/admin");
  const suite = /^\/admin(\/|$|\?)/.test(demandee) ? demandee : "/admin";

  const reponse = new NextResponse(null, { status: 303, headers: { Location: suite } });
  if (trouvee) {
    reponse.cookies.set("jokswed_entreprise", trouvee.id, {
      httpOnly: true, sameSite: "lax", path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return reponse;
}
