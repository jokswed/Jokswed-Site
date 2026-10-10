import Link from "next/link";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";

export const metadata = { title: "Saison des mariages" };
export const dynamic = "force-dynamic";

/* =============================================================================
   ADMINISTRATION — SAISON DES MARIAGES
   -----------------------------------------------------------------------------
   Vue calendrier et vue liste sur une période configurable. Les montants
   viennent de la MÊME fonction que le tableau financier : deux écrans ne
   peuvent pas afficher deux totaux différents pour un même mariage.

   ⚠️ UN COLLABORATEUR SANS `finance.lire` VOIT LES DATES, PAS LES MONTANTS.
   Ce n'est pas le gabarit qui masque une colonne déjà chargée : c'est la
   base qui renvoie zéro. Rien de sensible ne transite jusqu'au navigateur.
   ============================================================================= */

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const JOURS = ["L", "M", "M", "J", "V", "S", "D"];

const STATUTS = [
  ["", "Tous"],
  ["confirmee", "Confirmés"],
  ["devis_envoye", "Devis envoyé"],
  ["a_traiter", "À traiter"],
  ["attente_client", "Attente client"],
];

function euros(cents) {
  return `${((cents ?? 0) / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })} €`;
}

/** Lundi = 0. `Date.getDay()` met dimanche à 0 : on décale. */
function premierJourGrille(annee, mois) {
  const j = new Date(Date.UTC(annee, mois - 1, 1)).getUTCDay();
  return (j + 6) % 7;
}
function nbJours(annee, mois) {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

export default async function Saison({ searchParams }) {
  const params = await searchParams;
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["dossier.lire"]);

  /* ⚠️ LE DÉFAUT N'EST PAS « L'ANNÉE COURANTE ».
     Un carnet de mariages se remplit un à deux ans à l'avance : ouvrir la
     page sur une année vide donne l'impression d'un écran cassé. On part
     donc de l'année du PROCHAIN mariage à venir, et l'année courante n'est
     qu'un repli quand il n'y en a aucun. */
  const anneeDefaut = await acces.executer(async (q) => {
    const { rows } = await q(
      `SELECT min(date_mariage) AS prochaine FROM demandes
        WHERE entreprise_destinataire_id = $1 AND date_mariage >= current_date`,
      [entreprise.id]);
    return rows[0]?.prochaine
      ? Number(String(rows[0].prochaine).slice(0, 4))
      : new Date().getFullYear();
  });
  const annee = Number(params?.annee) || anneeDefaut;
  const vue = params?.vue === "liste" ? "liste" : "calendrier";
  const statut = STATUTS.some(([v]) => v === params?.statut) ? params.statut : "";
  const collaborateur = params?.collaborateur || "";
  /* Par défaut : la saison, juin → septembre. Configurable aux deux bouts. */
  const moisDebut = Number(params?.du) || 6;
  const moisFin = Number(params?.au) || 9;

  const debut = `${annee}-${String(moisDebut).padStart(2, "0")}-01`;
  const fin = moisFin >= 12
    ? `${annee + 1}-01-01`
    : `${annee}-${String(moisFin + 1).padStart(2, "0")}-01`;

  const donnees = await acces.executer(async (q) => {
    const { rows: mariages } = await q(
      "SELECT * FROM app.saison_mariages($1,$2,$3,$4,$5)",
      [entreprise.id, debut, fin, statut || null, collaborateur || null]);
    const { rows: equipe } = await q(
      `SELECT u.id, u.prenom, u.nom FROM membres m
         JOIN utilisateurs u ON u.id = m.utilisateur_id
        WHERE m.entreprise_id = $1 AND m.retire_le IS NULL AND m.suspendu_le IS NULL
        ORDER BY u.nom`, [entreprise.id]);
    return { mariages, equipe };
  });

  const { mariages, equipe } = donnees;
  const voitFinances = acces.permissions.has("finance.lire");
  const lien = (extra = {}) => {
    const p = new URLSearchParams({
      vue, annee: String(annee), du: String(moisDebut), au: String(moisFin),
      ...(statut ? { statut } : {}), ...(collaborateur ? { collaborateur } : {}),
      ...extra,
    });
    return `/admin/saison?${p}`;
  };

  const parJour = new Map();
  for (const m of mariages) {
    const cle = m.date_mariage;
    if (!parJour.has(cle)) parJour.set(cle, []);
    parJour.get(cle).push(m);
  }

  const moisAffiches = [];
  for (let mo = moisDebut; mo <= Math.min(moisFin, 12); mo += 1) moisAffiches.push(mo);

  const total = mariages.reduce((t, m) => t + m.total_cents, 0);
  const encaisse = mariages.reduce((t, m) => t + m.encaisse_cents, 0);

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Saison {annee}</h1>
          <p className="recap__note">
            {mariages.length} mariage(s) de {MOIS[moisDebut - 1].toLowerCase()} à{" "}
            {MOIS[Math.min(moisFin, 12) - 1].toLowerCase()}
            {voitFinances ? ` · ${euros(total)} au total, ${euros(encaisse)} encaissés` : null}
          </p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      <nav className="admin-filtres" aria-label="Affichage et filtres">
        <Link className={`admin-puce${vue === "calendrier" ? " admin-puce--active" : ""}`}
          href={lien({ vue: "calendrier" })}>Calendrier</Link>
        <Link className={`admin-puce${vue === "liste" ? " admin-puce--active" : ""}`}
          href={lien({ vue: "liste" })}>Liste</Link>
        <Link className="admin-puce" href={lien({ annee: String(annee - 1) })}>← {annee - 1}</Link>
        <Link className="admin-puce" href={lien({ annee: String(annee + 1) })}>{annee + 1} →</Link>
        <Link className={`admin-puce${moisDebut === 1 && moisFin === 12 ? " admin-puce--active" : ""}`}
          href={lien({ du: "1", au: "12" })}>Année entière</Link>
        <Link className={`admin-puce${moisDebut === 6 && moisFin === 9 ? " admin-puce--active" : ""}`}
          href={lien({ du: "6", au: "9" })}>Juin → septembre</Link>
      </nav>

      <nav className="admin-filtres" aria-label="Statut et collaborateur">
        {STATUTS.map(([valeur, libelle]) => (
          <Link key={valeur || "tous"}
            className={`admin-puce${statut === valeur ? " admin-puce--active" : ""}`}
            href={lien({ statut: valeur })}>{libelle}</Link>
        ))}
        {equipe.map((u) => (
          <Link key={u.id}
            className={`admin-puce${collaborateur === u.id ? " admin-puce--active" : ""}`}
            href={lien({ collaborateur: collaborateur === u.id ? "" : u.id })}>
            {u.prenom} {u.nom}
          </Link>
        ))}
      </nav>

      {vue === "calendrier" ? (
        <section className="admin-calendrier">
          {moisAffiches.map((mo) => {
            const avant = premierJourGrille(annee, mo);
            const jours = nbJours(annee, mo);
            return (
              <article key={mo} className="admin-mois">
                <h2 className="admin-mois__titre">{MOIS[mo - 1]}</h2>
                <div className="admin-mois__grille" role="grid"
                  aria-label={`${MOIS[mo - 1]} ${annee}`}>
                  {JOURS.map((j, i) => (
                    <span key={`e${i}`} className="admin-mois__entete" aria-hidden="true">{j}</span>
                  ))}
                  {Array.from({ length: avant }, (_, i) => (
                    <span key={`v${i}`} className="admin-mois__vide" />
                  ))}
                  {Array.from({ length: jours }, (_, i) => {
                    const jour = i + 1;
                    const cle = `${annee}-${String(mo).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
                    const evenements = parJour.get(cle) ?? [];
                    return (
                      <span key={cle}
                        className={`admin-mois__jour${evenements.length ? " admin-mois__jour--pris" : ""}`}>
                        <span className="admin-mois__num">{jour}</span>
                        {evenements.map((e) => (
                          <Link key={e.demande_id} href={`/admin/demandes/${e.demande_id}`}
                            className="admin-mois__event"
                            title={`${e.contact_nom} — ${e.formule_nom ?? ""}`}>
                            {e.contact_nom}
                          </Link>
                        ))}
                      </span>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {vue === "liste" || mariages.length > 0 ? (
        <section className="admin-bloc">
          <h2 className="display t-carte">
            {vue === "liste" ? "Mariages" : "Détail"}
          </h2>
          {mariages.length === 0 ? (
            <p className="recap__note">Aucun mariage sur cette période.</p>
          ) : (
            <ul className="admin-saison">
              {mariages.map((m) => (
                <li key={m.demande_id} className="admin-saison__item">
                  <div className="admin-saison__date">
                    <span className="admin-saison__jour">
                      {Number(m.date_mariage.slice(8, 10))}
                    </span>
                    <span className="admin-saison__mois">
                      {MOIS[Number(m.date_mariage.slice(5, 7)) - 1].slice(0, 4)}.
                    </span>
                  </div>
                  <div className="admin-saison__corps">
                    <Link href={`/admin/demandes/${m.demande_id}`} className="admin-saison__nom">
                      {m.contact_nom}
                    </Link>
                    <p className="admin-saison__meta">
                      {m.lieu ?? m.ville ?? "Lieu à confirmer"}
                      {m.formule_nom ? ` · ${m.formule_nom}` : null}
                    </p>
                    <p className="admin-saison__meta">
                      <span className={`admin-pastille${
                        m.statut === "confirmee" ? " admin-pastille--emis" : ""}`}>
                        {m.statut.replace(/_/g, " ")}
                      </span>
                      {m.devis_numero ? (
                        <span className="admin-pastille admin-pastille--emis">
                          devis {m.devis_numero}
                        </span>
                      ) : <span className="admin-pastille">devis à établir</span>}
                      {m.contrat_emis ? (
                        <span className="admin-pastille admin-pastille--emis">contrat</span>
                      ) : null}
                      {m.factures_nb > 0 ? (
                        <span className="admin-pastille">{m.factures_nb} facture(s)</span>
                      ) : null}
                    </p>
                    <p className="admin-saison__meta">
                      Équipe : {m.equipe.length ? m.equipe.join(", ") : "non affectée"}
                      {m.videaste ? ` · Vidéaste : ${m.videaste} (${m.videaste_statut})` : null}
                    </p>
                  </div>
                  {voitFinances ? (
                    <dl className="admin-saison__argent">
                      <div>
                        <dt>Total</dt>
                        <dd>
                          {euros(m.total_cents)}
                          {!m.total_contractualise ? (
                            /* ⚠️ SANS DEVIS ÉMIS, CE N'EST PAS UN ENGAGEMENT.
                               On montre le prix annoncé, et on le dit. */
                            <span className="admin-saison__annonce"> annoncé</span>
                          ) : null}
                        </dd>
                      </div>
                      <div><dt>Acompte</dt><dd>{euros(m.acompte_cents)}</dd></div>
                      <div>
                        <dt>Solde</dt>
                        <dd className={m.solde_restant_cents > 0 ? "num--du" : undefined}>
                          {euros(m.solde_restant_cents)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!voitFinances ? (
        <p className="recap__note" style={{ marginTop: "2rem" }}>
          Les montants ne vous sont pas accessibles : votre rôle ne porte pas la
          permission « Voir les montants de l&apos;entreprise ».
        </p>
      ) : null}
    </main>
  );
}
