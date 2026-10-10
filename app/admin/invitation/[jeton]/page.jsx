import { redirect } from "next/navigation";
import { avecAuth } from "@/lib/db/client";
import { hacherJeton, hacherMotDePasse } from "@/lib/auth/secrets";

export const metadata = {
  title: "Créer mon accès",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/* =============================================================================
   ACTIVATION D'UN COMPTE COLLABORATEUR
   -----------------------------------------------------------------------------
   ⚠️ PAGE PUBLIQUE, MAIS PAS OUVERTE.

   Elle ne demande aucune session : la personne n'en a pas encore. Son unique
   justificatif est le jeton du lien, dont seule l'empreinte est en base. Tout
   passe par le rôle `jokswed_auth`, qui n'a AUCUN privilège de table et ne
   peut appeler que deux fonctions : lire l'invitation, et l'accepter.

   ⚠️ LE MOT DE PASSE EST CHOISI ICI, PAR SON PROPRIÉTAIRE.
   À aucun moment un mot de passe n'est transmis par e-mail, ni affiché à
   l'administrateur qui invite. Ce qui part dans l'e-mail, c'est un lien.

   ⚠️ UN JETON INVALIDE NE DIT PAS POURQUOI.
   Expiré, révoqué, déjà utilisé, inexistant : même message. Autrement, la
   page deviendrait un oracle permettant d'énumérer les invitations.
   ============================================================================= */
export default async function Invitation({ params, searchParams }) {
  const { jeton } = await params;
  const sp = await searchParams;

  const invitation = await avecAuth(async (q) => {
    const { rows } = await q("SELECT * FROM app.auth_invitation($1)", [hacherJeton(jeton)]);
    return rows[0] ?? null;
  });

  async function activer(formulaire) {
    "use server";
    const motDePasse = String(formulaire.get("mot_de_passe") ?? "");
    const confirmation = String(formulaire.get("confirmation") ?? "");
    const brut = String(formulaire.get("jeton") ?? "");

    if (motDePasse.length < 12) redirect(`/admin/invitation/${brut}?erreur=court`);
    if (motDePasse !== confirmation) redirect(`/admin/invitation/${brut}?erreur=different`);

    const empreinte = await hacherMotDePasse(motDePasse);
    try {
      await avecAuth((q) => q(
        "SELECT app.auth_accepter_invitation($1,$2,$3,$4)",
        [hacherJeton(brut), empreinte,
         String(formulaire.get("prenom") ?? "").trim(),
         String(formulaire.get("nom") ?? "").trim()]));
    } catch {
      redirect(`/admin/invitation/${brut}?erreur=invalide`);
    }
    redirect("/admin/connexion?active=1");
  }

  if (!invitation) {
    return (
      <main className="admin-connexion">
        <div className="admin-connexion__carte">
          <h1 className="display t-carte">Lien non valable</h1>
          <p className="recap__note">
            Ce lien d&apos;invitation n&apos;est plus utilisable. Il a pu expirer,
            être révoqué, ou avoir déjà servi. Demandez-en un nouveau à la
            personne qui vous a invité.
          </p>
        </div>
      </main>
    );
  }

  const ERREURS = {
    court: "Le mot de passe doit faire au moins 12 caractères.",
    different: "Les deux saisies ne correspondent pas.",
    invalide: "Ce lien n'est plus utilisable.",
  };

  return (
    <main className="admin-connexion">
      <div className="admin-connexion__carte">
        <p className="label label--nu">{invitation.entreprise}</p>
        <h1 className="display t-carte">Créer mon accès</h1>
        <p className="recap__note">
          Vous avez été invité pour <strong>{invitation.email}</strong>. Choisissez
          votre mot de passe : personne d&apos;autre ne le connaîtra.
        </p>

        {sp?.erreur ? (
          <p role="alert" className="admin-alerte">{ERREURS[sp.erreur] ?? "Saisie refusée."}</p>
        ) : null}

        <form action={activer} className="formulaire" style={{ marginTop: "1.2rem" }}>
          <input type="hidden" name="jeton" value={jeton} />
          <div className="admin-grille-champs">
            <div className="champ">
              <label htmlFor="prenom">Prénom</label>
              <input id="prenom" name="prenom" type="text"
                defaultValue={invitation.prenom ?? ""} autoComplete="given-name" />
            </div>
            <div className="champ">
              <label htmlFor="nom">Nom</label>
              <input id="nom" name="nom" type="text"
                defaultValue={invitation.nom ?? ""} autoComplete="family-name" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="mot_de_passe">Mot de passe (12 caractères minimum)</label>
            <input id="mot_de_passe" name="mot_de_passe" type="password"
              autoComplete="new-password" minLength={12} required />
          </div>
          <div className="champ">
            <label htmlFor="confirmation">Confirmer le mot de passe</label>
            <input id="confirmation" name="confirmation" type="password"
              autoComplete="new-password" minLength={12} required />
          </div>
          <button type="submit" className="btn btn--bloc">Créer mon accès</button>
        </form>

        <p className="recap__note" style={{ marginTop: "1.2rem" }}>
          Si vous n&apos;attendiez pas cette invitation, fermez simplement cette
          page : rien ne sera créé.
        </p>
      </div>
    </main>
  );
}
