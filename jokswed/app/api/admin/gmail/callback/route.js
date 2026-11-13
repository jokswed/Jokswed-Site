import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces } from "@/lib/auth/acces";
import { chiffrer } from "@/lib/auth/secrets";
import { echangerCode, PORTEES } from "@/lib/gmail/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGLAGES = "/admin/parametres/messagerie";

function versReglages(motif) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${REGLAGES}?gmail=${motif}` },
  });
}

/* =============================================================================
   LE RETOUR DE GOOGLE
   -----------------------------------------------------------------------------
   ⚠️ TROIS CHOSES À VÉRIFIER AVANT D'ÉCRIRE QUOI QUE CE SOIT :
   que la personne est bien connectée à l'administration, que le `state`
   correspond à celui qu'on a posé, et que Google a bien accordé l'envoi.
   ============================================================================= */
export async function GET(requete) {
  const url = new URL(requete.url);

  /* Google signale un refus de consentement par `error`, pas par un code. */
  const refus = url.searchParams.get("error");
  if (refus) return versReglages(refus === "access_denied" ? "refuse" : "erreur");

  const { entreprise } = await contexteAdmin();
  await exigerAcces(entreprise.id, ["message.envoyer"]);

  const attendu = (await cookies()).get("jokswed_gmail_etat")?.value ?? "";
  const recu = url.searchParams.get("state") ?? "";
  /* Comparaison à durée constante, par habitude de la maison : un `===` sur un
     secret enseigne sa longueur et son préfixe. */
  const memeTaille = attendu.length === recu.length && attendu.length > 0;
  if (!memeTaille || !timingSafeEqual(Buffer.from(attendu), Buffer.from(recu))) {
    return versReglages("etat-invalide");
  }

  const code = url.searchParams.get("code");
  if (!code) return versReglages("sans-code");

  let jetons;
  try {
    jetons = await echangerCode(code);
  } catch {
    /* ⚠️ AUCUN DÉTAIL DANS L'URL. Le motif de Google peut contenir le début
       d'un jeton ou l'identifiant du client ; il reste côté serveur. */
    return versReglages("echange-refuse");
  }

  /* ⚠️ GOOGLE PEUT N'ACCORDER QU'UNE PARTIE DE CE QU'ON DEMANDE.
     L'écran de consentement laisse décocher. Sans `gmail.send`, le compte
     serait enregistré comme actif et chaque envoi échouerait ensuite. */
  if (!jetons.portees.includes(PORTEES[0])) {
    return versReglages("envoi-non-accorde");
  }

  const acces = await exigerAcces(entreprise.id, ["message.envoyer"]);
  await acces.executer((q) =>
    q("SELECT app.gmail_enregistrer($1,$2::citext,$3,$4,$5,$6::text[])", [
      entreprise.id,
      jetons.adresse ?? "",
      chiffrer(jetons.acces),
      jetons.rafraichissement ? chiffrer(jetons.rafraichissement) : null,
      jetons.expireLe.toISOString(),
      jetons.portees,
    ]));

  const reponse = versReglages(jetons.rafraichissement ? "connecte" : "sans-renouvellement");
  reponse.cookies.set("jokswed_gmail_etat", "", {
    httpOnly: true, path: "/api/admin/gmail", maxAge: 0,
  });
  return reponse;
}
