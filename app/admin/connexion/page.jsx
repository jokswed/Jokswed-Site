import { redirect } from "next/navigation";
import { sessionCourante } from "@/lib/auth/session";

export const metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function Connexion({ searchParams }) {
  const params = await searchParams;
  const session = await sessionCourante();
  if (session?.mfaValidee) redirect(params?.suite ?? "/admin");

  const messages = {
    refus: "Identifiants incorrects.",
    trop: "Trop de tentatives. Réessayez dans quelques minutes.",
    desactive: "Ce compte est désactivé.",
  };

  return (
    <main className="admin-connexion">
      <div className="admin-connexion__carte">
        <p className="marque" style={{ fontSize: "1.6rem" }}>Joks<span>Wed</span></p>
        <p className="label label--nu" style={{ marginTop: "0.4rem" }}>Administration</p>

        {params?.erreur ? (
          <p role="alert" className="admin-alerte">{messages[params.erreur] ?? messages.refus}</p>
        ) : null}

        <form method="post" action="/api/admin/connexion" className="formulaire" style={{ marginTop: "1.8rem" }}>
          <input type="hidden" name="suite" value={params?.suite ?? "/admin"} />
          <div className="champ">
            <label htmlFor="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" required autoComplete="username"
                   inputMode="email" autoFocus />
          </div>
          <div className="champ">
            <label htmlFor="motDePasse">Mot de passe</label>
            <input id="motDePasse" name="motDePasse" type="password" required
                   autoComplete="current-password" minLength={12} />
          </div>
          <button type="submit" className="btn btn--bloc">Se connecter</button>
        </form>

        <p className="recap__note" style={{ marginTop: "1.4rem" }}>
          Utilisez un mot de passe unique, généré par votre gestionnaire.
          Personne chez JoksWed ne le connaît ni ne peut le lire.
        </p>
      </div>
    </main>
  );
}
