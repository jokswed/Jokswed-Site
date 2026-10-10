import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { avecAuth } from "@/lib/db/client";
import { NOM_COOKIE } from "@/lib/auth/session";
import { dechiffrer, hacherJeton, verifierTotp } from "@/lib/auth/secrets";

export const metadata = { title: "Second facteur", robots: { index: false } };
export const dynamic = "force-dynamic";

/* =============================================================================
   SECOND FACTEUR
   -----------------------------------------------------------------------------
   ⚠️ CETTE PAGE MANQUAIT, ET SON ABSENCE ÉTAIT UN PIÈGE.

   La connexion redirigeait ici dès qu'un facteur TOTP confirmé existait.
   Sans la page : 404, session jamais validée, propriétaire enfermé dehors
   par la protection qu'il venait d'activer.

   ⚠️ ELLE PASSE PAR `jokswed_auth`, PAS PAR LE RÔLE MÉTIER.
   À ce stade la session existe mais n'a franchi aucun second facteur :
   `app.acteur()` rend NULL et aucune politique ne rendrait quoi que ce soit.
   C'est exactement le même raisonnement que pour la connexion.
   ============================================================================= */
export default async function SecondFacteur({ searchParams }) {
  const sp = await searchParams;
  const jeton = (await cookies()).get(NOM_COOKIE)?.value;
  if (!jeton) redirect("/admin/connexion");

  const facteur = await avecAuth(async (q) => {
    const { rows } = await q("SELECT * FROM app.auth_mfa_de_session($1)", [hacherJeton(jeton)]);
    return rows[0] ?? null;
  });
  /* Session inconnue, expirée, ou aucun facteur confirmé : il n'y a rien à
     valider ici. On renvoie à la connexion plutôt que d'afficher un
     formulaire qui ne mènerait nulle part. */
  if (!facteur) redirect("/admin/connexion");

  async function valider(formulaire) {
    "use server";
    const brut = (await cookies()).get(NOM_COOKIE)?.value;
    if (!brut) redirect("/admin/connexion");
    const code = String(formulaire.get("code") ?? "").replace(/\s+/g, "");

    const ok = await avecAuth(async (q) => {
      const { rows } = await q("SELECT * FROM app.auth_mfa_de_session($1)", [hacherJeton(brut)]);
      if (!rows[0]) return false;
      /* La tolérance d'un pas couvre une horloge décalée de 30 secondes,
         sans ouvrir une fenêtre de rejeu significative. */
      if (!verifierTotp(dechiffrer(Buffer.from(rows[0].secret_chiffre)), code, 1)) return false;
      await q("SELECT app.auth_valider_mfa($1)", [rows[0].session_id]);
      return true;
    });

    if (!ok) redirect("/admin/second-facteur?erreur=1");
    redirect("/admin");
  }

  return (
    <main className="admin-connexion">
      <div className="admin-connexion__carte">
        <p className="label label--nu">JoksWed</p>
        <h1 className="display t-carte">Second facteur</h1>
        <p className="recap__note">
          Saisissez le code à six chiffres affiché par votre application
          d&apos;authentification.
        </p>
        {sp?.erreur ? (
          <p role="alert" className="admin-alerte">
            Code incorrect ou expiré. Un code n&apos;est valable que trente
            secondes.
          </p>
        ) : null}
        <form action={valider} className="formulaire" style={{ marginTop: "1.2rem" }}>
          <div className="champ">
            <label htmlFor="code">Code</label>
            <input id="code" name="code" type="text" inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9 ]{6,9}" required autoFocus />
          </div>
          <button type="submit" className="btn btn--bloc">Valider</button>
        </form>
        <form method="post" action="/api/admin/deconnexion" style={{ marginTop: "1rem" }}>
          <button type="submit" className="btn btn--fantome btn--bloc">Annuler</button>
        </form>
      </div>
    </main>
  );
}
