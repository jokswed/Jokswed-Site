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
  { cle: "closes", titre: "Closes", statuts: ["close", "annulee", "refusee", "archivee"] },
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
  annulee: "Annulée",
  close: "Terminée",
  archivee: "Archivée",
};

export default async function Demandes({ searchParams }) {
  const params = await searchParams;
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["dossier.lire"]);
  const filtre = typeof params?.groupe === "string" ? params.groupe : "toutes";

  const demandes = await acces.executer(async (q) => {
    const { rows } = await q(
      /* ⚠️ PAR DATE DE MARIAGE, PAS PAR DATE DE RÉCEPTION.
         Un carnet se lit par la journée qui approche. L'ordre exact :
         les mariages À VENIR du plus proche au plus lointain, puis les
         mariages PASSÉS du plus récent au plus ancien, puis ceux qui n'ont
         pas encore de date. `reference` ferme l'ordre : deux mariages le
         même jour sortent toujours dans la même suite, jamais dans celle
         que PostgreSQL trouve la moins coûteuse ce jour-là. */
      `SELECT d.id, d.reference, d.statut, d.contact_nom, d.contact_nom_2,
              d.ville, d.lieu, d.date_mariage, d.formule_nom,
              d.formule_prix_cents, d.prix_total_cents, d.origine,
              d.video_demandee, d.photobooth_360, d.cree_le, d.lue_le,
              d.mariage_id,
              (SELECT count(*)::int FROM notes_internes n WHERE n.demande_id = d.id) AS notes
         FROM demandes d
        WHERE d.entreprise_destinataire_id = $1
        ORDER BY (d.date_mariage IS NULL),
                 (d.date_mariage < current_date),
                 CASE WHEN d.date_mariage >= current_date THEN d.date_mariage END ASC,
                 CASE WHEN d.date_mariage <  current_date THEN d.date_mariage END DESC,
                 d.reference
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
        <div className="admin-actions">
          <Link href="/admin/demandes/nouveau" className="btn">+ Nouveau dossier</Link>
          <Link href="/admin" className="btn btn--fantome">Retour</Link>
        </div>
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
                  <strong>
                    {d.contact_nom}
                    {d.contact_nom_2 ? ` & ${d.contact_nom_2}` : ""}
                  </strong>
                  <span className={`admin-pastille admin-pastille--${d.statut}`}>
                    {LIBELLES_STATUT[d.statut] ?? d.statut}
                  </span>
                </span>
                <span className="admin-carte__ligne">
                  {d.reference} ·{" "}
                  {d.date_mariage ? formaterDateSql(d.date_mariage) : "date à définir"}
                  {d.ville ? ` · ${d.ville}` : ""}
                </span>
                <span className="admin-carte__ligne">
                  {d.formule_nom ?? "Formule à définir"}
                  {/* Le prix convenu prime : c'est lui qui pilote l'échéancier. */}
                  {d.prix_total_cents ?? d.formule_prix_cents
                    ? ` — ${formaterPrix(d.prix_total_cents ?? d.formule_prix_cents)} TTC`
                    : ""}
                </span>
                <span className="admin-carte__bas">
                  {d.origine === "manuel" ? <span className="admin-jeton">Manuel</span> : null}
                  {d.video_demandee ? <span className="admin-jeton">Vidéo</span> : null}
                  {d.photobooth_360 ? <span className="admin-jeton">Photobooth 360</span> : null}
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
