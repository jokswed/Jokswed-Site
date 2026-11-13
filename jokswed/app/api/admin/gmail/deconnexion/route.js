import { NextResponse } from "next/server";
import { contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces } from "@/lib/auth/acces";
import { dechiffrer } from "@/lib/auth/secrets";
import { revoquer } from "@/lib/gmail/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =============================================================================
   SE DÉCONNECTER — CHEZ NOUS ET CHEZ GOOGLE
   -----------------------------------------------------------------------------
   ⚠️ SUPPRIMER LA LIGNE NE SUFFIT PAS.

   Le jeton de rafraîchissement reste valable côté Google : l'autorisation
   figurerait encore dans le compte de la personne, et un ancien exemplaire du
   jeton continuerait de fonctionner. On révoque d'abord, on efface ensuite.
   ============================================================================= */
export async function POST() {
  const { entreprise } = await contexteAdmin();
  const acces = await exigerAcces(entreprise.id, ["message.envoyer"]);

  /* On lit le jeton AVANT de supprimer la ligne : après, il n'existe plus. */
  const { rows } = await acces.executer((q) =>
    q(`SELECT jeton_rafraichissement, jeton_acces FROM gmail_comptes
        WHERE entreprise_id = $1`, [entreprise.id]));
  const ligne = rows[0];

  if (ligne) {
    const jeton = ligne.jeton_rafraichissement ?? ligne.jeton_acces;
    try {
      await revoquer(dechiffrer(jeton));
    } catch {
      /* Jeton illisible ou Google injoignable : on efface quand même. Garder
         une ligne qu'on ne veut plus serait le pire des deux. */
    }
  }

  await acces.executer((q) => q("SELECT app.gmail_deconnecter($1)", [entreprise.id]));

  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/admin/parametres/messagerie?gmail=deconnecte" },
  });
}
