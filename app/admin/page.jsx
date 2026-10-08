import Link from "next/link";
import { contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";
import { exigerAcces } from "@/lib/auth/acces";

export const metadata = { title: "Tableau de bord" };
export const dynamic = "force-dynamic";

export default async function TableauDeBord({ searchParams }) {
  const params = await searchParams;
  const { session, entreprises, entreprise } = await contexteAdmin();
  const acces = await exigerAcces(entreprise.id);

  const chiffres = await acces.executer(async (q) => {
    const { rows: [d] } = await q(
      `SELECT count(*) FILTER (WHERE statut = 'nouvelle_demande')::int AS nouvelles,
              count(*) FILTER (WHERE statut = 'reserve')::int AS reserves,
              count(*)::int AS total
         FROM dossiers WHERE entreprise_id = $1`, [entreprise.id]);
    const { rows: [m] } = await q(
      "SELECT count(*)::int AS n FROM membres WHERE entreprise_id = $1 AND retire_le IS NULL",
      [entreprise.id]);
    const { rows: prochains } = await q(
      `SELECT d.reference, m.date_mariage, m.ville
         FROM dossiers d JOIN mariages m ON m.id = d.mariage_id
        WHERE d.entreprise_id = $1 AND m.date_mariage >= current_date
        ORDER BY m.date_mariage LIMIT 5`, [entreprise.id]);
    return { ...d, membres: m.n, prochains };
  });

  const peut = (p) => acces.permissions.has(p);

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Tableau de bord</h1>
          <p className="recap__note">{entreprise.roles}</p>
        </div>
        <form method="post" action="/api/admin/deconnexion">
          <button type="submit" className="btn btn--fantome">Se déconnecter</button>
        </form>
      </header>

      {params?.refus ? (
        <p role="alert" className="admin-alerte">
          Accès refusé : {params.refus}.
        </p>
      ) : null}

      {entreprises.length > 1 ? (
        <p className="recap__note">
          Vous êtes membre de {entreprises.length} entreprises :{" "}
          {entreprises.map((e) => e.nom_commercial).join(", ")}.
        </p>
      ) : null}

      <section className="admin-chiffres">
        {[
          ["Demandes non traitées", chiffres.nouvelles],
          ["Mariages réservés", chiffres.reserves],
          ["Dossiers au total", chiffres.total],
          ["Membres actifs", chiffres.membres],
        ].map(([libelle, valeur]) => (
          <div key={libelle} className="admin-chiffre">
            <p className="admin-chiffre__valeur">{valeur}</p>
            <p className="label label--nu">{libelle}</p>
          </div>
        ))}
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <h2 className="display t-carte">Prochains mariages</h2>
        {chiffres.prochains.length === 0 ? (
          <p className="recap__note">Aucun mariage à venir dans cette entreprise.</p>
        ) : (
          <ul className="admin-liste">
            {chiffres.prochains.map((p) => (
              <li key={p.reference}>
                <strong>{p.reference}</strong>
                <span>{formaterDateSql(p.date_mariage)}</span>
                <span>{p.ville ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="admin-nav" aria-label="Sections de l'administration">
        {/* ⚠️ MASQUER UN LIEN N'EST PAS UNE PROTECTION.
            Chaque page cible rappelle `exigerAcces()` avec ses propres
            permissions ; ce filtrage-ci ne sert qu'à ne pas proposer une
            porte fermée. */}
        {peut("membre.inviter") ? (
          <Link href="/admin/collaborateurs" className="btn btn--fantome">Collaborateurs</Link>
        ) : null}
        {peut("entreprise.reglages") ? (
          <Link href="/admin/entreprise" className="btn btn--fantome">Mon entreprise</Link>
        ) : null}
      </nav>

      <p className="recap__note" style={{ marginTop: "2.5rem" }}>
        Les demandes envoyées depuis le site public ne sont pas encore reliées à cette
        administration : elles arrivent par e-mail. C&apos;est l&apos;objet de la V4.
      </p>
    </main>
  );
}
