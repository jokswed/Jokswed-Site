import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { notFound } from "next/navigation";
import { avecAuth } from "@/lib/db/client";
import { hacherMotDePasse } from "@/lib/auth/secrets";

export const metadata = { title: "Amorçage", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/* =============================================================================
   AMORÇAGE — CRÉATION DU PREMIER COMPTE PROPRIÉTAIRE
   -----------------------------------------------------------------------------
   ⚠️ TROIS VERROUS, ET IL FAUT LES TROIS.

     1. `JOKSWED_AMORCAGE` doit exister dans l'environnement, et le secret
        fourni dans l'URL doit lui correspondre — comparaison en temps
        constant. Absent : 404, pas 401, qui confirmerait l'existence.
     2. La base ne doit contenir AUCUN utilisateur. Pas « aucun
        propriétaire » : aucun compte du tout. Une base en service n'est
        plus en amorçage.
     3. La fonction PostgreSQL revérifie la condition 2 de son côté. La page
        pourrait mentir ; la base, non.

   Dès le premier compte créé, cette page refuse — même avec le bon secret,
   même si la variable est restée. Il faut quand même la retirer après usage :
   un secret qui traîne est un secret qui fuit.

   ⚠️ AUCUN MOT DE PASSE N'EST CHOISI ICI PAR LA MACHINE.
   C'est John qui le saisit, dans son navigateur. Rien n'est journalisé,
   rien n'est affiché, rien n'est transmis ailleurs.
   ============================================================================= */
function secretAttendu() {
  return process.env.JOKSWED_AMORCAGE?.trim() || null;
}
function memeSecret(fourni, attendu) {
  const a = Buffer.from(fourni ?? "", "utf8");
  const b = Buffer.from(attendu, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function Amorcage({ searchParams }) {
  const sp = await searchParams;
  const attendu = secretAttendu();
  if (!attendu || !memeSecret(String(sp?.cle ?? ""), attendu)) notFound();

  const possible = await avecAuth(async (q) => {
    const { rows } = await q("SELECT app.auth_amorcage_possible() AS x");
    return rows[0]?.x === true;
  });

  async function amorcer(formulaire) {
    "use server";
    const attendu2 = secretAttendu();
    const cle = String(formulaire.get("cle") ?? "");
    if (!attendu2 || !memeSecret(cle, attendu2)) notFound();

    const email = String(formulaire.get("email") ?? "").trim().toLowerCase();
    const motDePasse = String(formulaire.get("mot_de_passe") ?? "");
    const confirmation = String(formulaire.get("confirmation") ?? "");
    const url = `/admin/amorcage?cle=${encodeURIComponent(cle)}`;

    if (!email.includes("@")) redirect(`${url}&erreur=email`);
    /* 12 caractères : le minimum qu'on impose aussi aux collaborateurs.
       Plus bas serait incohérent, et plus haut n'ajoute rien si l'on
       recommande un gestionnaire de mots de passe. */
    if (motDePasse.length < 12) redirect(`${url}&erreur=court`);
    if (motDePasse !== confirmation) redirect(`${url}&erreur=different`);

    const empreinte = await hacherMotDePasse(motDePasse);
    try {
      await avecAuth((q) => q(
        "SELECT app.auth_amorcer_proprietaire($1::citext,$2,$3,$4,$5,$6)",
        [email,
         String(formulaire.get("prenom") ?? "").trim() || "Propriétaire",
         String(formulaire.get("nom") ?? "").trim() || "",
         empreinte,
         String(formulaire.get("slug") ?? "jokswed").trim() || "jokswed",
         String(formulaire.get("entreprise") ?? "JoksWed").trim() || "JoksWed"]));
    } catch {
      redirect(`${url}&erreur=refuse`);
    }
    redirect("/admin/connexion?amorcage=1");
  }

  if (!possible) {
    return (
      <main className="admin-connexion">
        <div className="admin-connexion__carte">
          <h1 className="display t-carte">Amorçage déjà effectué</h1>
          <p className="recap__note">
            Cette base contient déjà des comptes : la création du premier
            propriétaire n&apos;est plus possible, et ce lien n&apos;a plus
            d&apos;effet.
          </p>
          <p className="recap__note">
            <strong>Retirez maintenant <code>JOKSWED_AMORCAGE</code></strong> de
            l&apos;environnement, puis redéployez. Un secret qui traîne est un
            secret qui fuit.
          </p>
        </div>
      </main>
    );
  }

  const ERREURS = {
    email: "Adresse e-mail invalide.",
    court: "Le mot de passe doit faire au moins 12 caractères.",
    different: "Les deux saisies ne correspondent pas.",
    refuse: "La base a refusé : des comptes existent déjà.",
  };

  return (
    <main className="admin-connexion">
      <div className="admin-connexion__carte">
        <p className="label label--nu">JoksWed</p>
        <h1 className="display t-carte">Créer le compte propriétaire</h1>
        <p className="recap__note">
          Première et unique utilisation. Choisissez un mot de passe unique,
          idéalement généré par votre gestionnaire — personne d&apos;autre ne le
          connaîtra, et il n&apos;est inscrit nulle part.
        </p>
        {sp?.erreur ? (
          <p role="alert" className="admin-alerte">
            {ERREURS[sp.erreur] ?? "Saisie refusée."}
          </p>
        ) : null}

        <form action={amorcer} className="formulaire" style={{ marginTop: "1.2rem" }}>
          <input type="hidden" name="cle" value={String(sp.cle)} />
          <div className="admin-grille-champs">
            <div className="champ">
              <label htmlFor="prenom">Prénom</label>
              <input id="prenom" name="prenom" type="text" defaultValue="John" />
            </div>
            <div className="champ">
              <label htmlFor="nom">Nom</label>
              <input id="nom" name="nom" type="text" defaultValue="Raharison" />
            </div>
            <div className="champ">
              <label htmlFor="entreprise">Nom commercial</label>
              <input id="entreprise" name="entreprise" type="text" defaultValue="JoksWed" />
            </div>
            <div className="champ">
              <label htmlFor="slug">Identifiant court</label>
              <input id="slug" name="slug" type="text" defaultValue="jokswed" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" required
              autoComplete="username" />
          </div>
          <div className="champ">
            <label htmlFor="mot_de_passe">Mot de passe (12 caractères minimum)</label>
            <input id="mot_de_passe" name="mot_de_passe" type="password"
              autoComplete="new-password" minLength={12} required />
          </div>
          <div className="champ">
            <label htmlFor="confirmation">Confirmer</label>
            <input id="confirmation" name="confirmation" type="password"
              autoComplete="new-password" minLength={12} required />
          </div>
          <button type="submit" className="btn btn--bloc">Créer mon compte</button>
        </form>

        <p className="recap__note" style={{ marginTop: "1.2rem" }}>
          Après création, retirez <code>JOKSWED_AMORCAGE</code> de
          l&apos;environnement et redéployez. Vous pourrez ensuite activer la
          double authentification depuis Paramètres → Mon compte.
        </p>
      </div>
    </main>
  );
}
