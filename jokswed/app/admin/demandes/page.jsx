import Link from "next/link";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";
import { formaterPrix } from "@/content/offres";

export const metadata = { title: "Demandes" };
export const dynamic = "force-dynamic";

/* Les statuts regroupés en colonnes de travail. L'ordre est celui du flux
   commercial, pas l'ordre alphabétique. */
const GROUPES = [
  { cle: "nouvelles", titre: "Nouvelles", statuts: ["non_lue"] },
  { cle: "encours", titre: "En cours", statuts: ["a_traiter", "en_cours_devis"] },
  {
    cle: "attente", titre: "En attente",
    statuts: ["attente_client", "attente_collaborateur", "devis_envoye"],
  },
  { cle: "confirmees", titre: "Confirmées", statuts: ["confirmee"] },
];

export const LIBELLES_STATUT = {
  non_lue: "Non lue",
  a_traiter: "À traiter",
  attente_client: "Attente client",
  attente_collaborateur: "Attente collaborateur",
  en_cours_devis: "Devis en préparation",
  devis_envoye: "Devis envoyé",
  confirmee: "Confirmée",
  refusee: "Refusée",
  archivee: "Archivée",
};

export default async function Demandes({ searchParams }) {
  const params = await searchParams;
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["dossier.lire"]);
  const filtre = typeof params?.groupe === "string" ? params.groupe : "toutes";

  const demandes = await acces.executer(async (q) => {
    const { rows } = await q(
      `SELECT d.id, d.reference, d.statut, d.contact_nom, d.ville, d.lieu,
              d.date_mariage, d.formule_nom, d.formule_prix_cents,
              d.video_demandee, d.cree_le, d.lue_le,
              (SELECT count(*)::int FROM notes_internes n WHERE n.demande_id = d.id) AS notes
         FROM demandes d
        WHERE d.entreprise_destinataire_id = $1
        ORDER BY d.cree_le DESC
        LIMIT 200`,
      [entreprise.id],
    );
    return rows;
  });

  const parGroupe = (cle) => {
    if (cle === "toutes") return demandes;
    const g = GROUPES.find((x) => x.cle === cle);
    return g ? demandes.filter((d) => g.statuts.includes(d.statut)) : demandes;
  };
  const visibles = parGroupe(filtre);

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Demandes</h1>
          <p className="recap__note">{demandes.length} demande(s) reçue(s)</p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      <nav className="admin-filtres" aria-label="Filtrer par état">
        {[{ cle: "toutes", titre: "Toutes" }, ...GROUPES].map((g) => {
          const n = parGroupe(g.cle).length;
          return (
            <Link
              key={g.cle}
              href={g.cle === "toutes" ? "/admin/demandes" : `/admin/demandes?groupe=${g.cle}`}
              className={`admin-filtre ${filtre === g.cle ? "est-actif" : ""}`}
              aria-current={filtre === g.cle ? "true" : undefined}
            >
              {g.titre} <span>{n}</span>
            </Link>
          );
        })}
      </nav>

      {visibles.length === 0 ? (
        <p className="recap__note">
          Aucune demande dans cette vue. Les demandes envoyées depuis le site
          public apparaissent ici immédiatement, avant tout e-mail.
        </p>
      ) : (
        <ul className="admin-cartes">
          {visibles.map((d) => (
            <li key={d.id}>
              <Link href={`/admin/demandes/${d.id}`} className="admin-carte">
                <span className="admin-carte__haut">
                  <strong>{d.contact_nom}</strong>
                  <span className={`admin-pastille admin-pastille--${d.statut}`}>
                    {LIBELLES_STATUT[d.statut] ?? d.statut}
                  </span>
                </span>
                <span className="admin-carte__ligne">
                  {d.reference} · {formaterDateSql(d.date_mariage)}
                  {d.ville ? ` · ${d.ville}` : ""}
                </span>
                <span className="admin-carte__ligne">
                  {d.formule_nom ?? "Formule à définir"}
                  {d.formule_prix_cents ? ` — ${formaterPrix(d.formule_prix_cents)} TTC` : ""}
                </span>
                <span className="admin-carte__bas">
                  {d.video_demandee ? <span className="admin-jeton">Vidéo</span> : null}
                  {d.notes > 0 ? <span className="admin-jeton">{d.notes} note(s)</span> : null}
                  {!d.lue_le ? <span className="admin-jeton admin-jeton--vif">Non lue</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
