import Link from "next/link";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";

export const metadata = { title: "Finances" };
export const dynamic = "force-dynamic";

/* =============================================================================
   ADMINISTRATION — FINANCES
   -----------------------------------------------------------------------------
   ⚠️ QUATRE MESURES, JAMAIS MÉLANGÉES.

     · CONTRACTUALISÉ — ce à quoi le client s'est engagé (devis émis) ;
     · FACTURÉ        — ce qui a fait l'objet d'une facture, moins les avoirs ;
     · EXIGIBLE       — ce qui est facturé ET dont l'échéance est passée ;
     · ENCAISSÉ       — ce qui est réellement arrivé (paiements confirmés).

   Exemple : prestation 1 300 €, facture d'acompte de 433,33 € non réglée.
   Contractualisé restant = 1 300 €. Facturé = 433,33 €. Encaissé = 0 €.
   Les trois chiffres coexistent ; les additionner n'a aucun sens.

   Tous les calculs viennent de PostgreSQL, qui vérifie `finance.lire` à
   l'entrée de chaque fonction. La page ne recalcule rien.
   ============================================================================= */

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function euros(cents) {
  return `${((cents ?? 0) / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} €`;
}
function eurosCourts(cents) {
  const v = (cents ?? 0) / 100;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10} k€`;
  return `${Math.round(v)} €`;
}

export default async function Finances({ searchParams }) {
  const params = await searchParams;
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["finance.lire"]);

  const maintenant = new Date();
  const annee = Number(params?.annee) || maintenant.getFullYear();
  const vue = params?.vue === "annee" ? "annee" : "mois";
  const moisChoisi = Number(params?.mois) || maintenant.getMonth() + 1;

  const debut = vue === "annee"
    ? `${annee}-01-01`
    : `${annee}-${String(moisChoisi).padStart(2, "0")}-01`;
  const fin = vue === "annee"
    ? `${annee + 1}-01-01`
    : moisChoisi === 12
      ? `${annee + 1}-01-01`
      : `${annee}-${String(moisChoisi + 1).padStart(2, "0")}-01`;

  const donnees = await acces.executer(async (q) => {
    const { rows: [resume] } = await q(
      "SELECT * FROM app.finances_resume($1,$2,$3)", [entreprise.id, debut, fin]);
    const { rows: mensuel } = await q(
      "SELECT * FROM app.finances_mensuelles($1,$2,$3)",
      [entreprise.id, `${annee}-01-01`, `${annee + 1}-01-01`]);
    const { rows: parMariage } = await q(
      `SELECT * FROM app.finances_par_demande($1)
        ORDER BY date_mariage NULLS LAST`, [entreprise.id]);
    return { resume, mensuel, parMariage };
  });

  const { resume, mensuel, parMariage } = donnees;
  const plafond = Math.max(
    1, ...mensuel.flatMap((m) => [m.encaisse_cents, m.facture_cents, m.previsionnel_cents]));

  const cartes = [
    { libelle: vue === "annee" ? `Encaissé en ${annee}` : "Encaissé ce mois-ci",
      valeur: resume.encaisse_cents, fort: true,
      note: "Paiements confirmés, remboursements déduits." },
    { libelle: "Acomptes reçus", valeur: resume.acomptes_cents },
    { libelle: "Soldes reçus", valeur: resume.soldes_cents },
    { libelle: "Facturé sur la période", valeur: resume.facture_cents,
      note: "Factures émises, avoirs déduits. Ce n'est pas de l'encaissé." },
    { libelle: "Facturé non réglé", valeur: resume.facture_non_regle_cents, alerte: true,
      note: "Factures émises dont le règlement n'est pas arrivé." },
    { libelle: "Paiements attendus", valeur: resume.attendu_cents,
      note: "Contractualisé moins encaissé, tous dossiers confondus." },
    { libelle: "Encaissements prévisionnels", valeur: resume.previsionnel_cents,
      note: "Échéances non réglées des documents émis." },
  ];

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Finances</h1>
          <p className="recap__note">
            {vue === "annee" ? `Année ${annee}` : `${MOIS[moisChoisi - 1]} ${annee}`}
          </p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      {/* ── Période ── */}
      <nav className="admin-filtres" aria-label="Période">
        <Link className={`admin-puce${vue === "mois" ? " admin-puce--active" : ""}`}
          href={`/admin/finances?vue=mois&annee=${annee}&mois=${moisChoisi}`}>Ce mois</Link>
        <Link className={`admin-puce${vue === "annee" ? " admin-puce--active" : ""}`}
          href={`/admin/finances?vue=annee&annee=${annee}`}>Année</Link>
        <Link className="admin-puce" href={`/admin/finances?vue=${vue}&annee=${annee - 1}&mois=${moisChoisi}`}>
          ← {annee - 1}
        </Link>
        <Link className="admin-puce" href={`/admin/finances?vue=${vue}&annee=${annee + 1}&mois=${moisChoisi}`}>
          {annee + 1} →
        </Link>
      </nav>

      <section className="admin-cartes-fin">
        {cartes.map((c) => (
          <article key={c.libelle}
            className={`admin-carte-fin${c.fort ? " admin-carte-fin--fort" : ""}${
              c.alerte && c.valeur > 0 ? " admin-carte-fin--alerte" : ""}`}>
            <p className="label label--nu">{c.libelle}</p>
            <p className="admin-carte-fin__valeur">{euros(c.valeur)}</p>
            {c.note ? <p className="admin-carte-fin__note">{c.note}</p> : null}
          </article>
        ))}
        <article className="admin-carte-fin">
          <p className="label label--nu">Mariages réservés</p>
          <p className="admin-carte-fin__valeur">{resume.reserves_nb}</p>
          <p className="admin-carte-fin__note">
            Valeur totale : {euros(resume.reserves_valeur_cents)}
          </p>
        </article>
      </section>

      {/* ── Évolution mois par mois ──
          Un graphique en barres, en CSS pur : pas de bibliothèque, pas de
          script, et il reste lisible sur un iPhone. */}
      <section className="admin-bloc">
        <h2 className="display t-carte">Évolution {annee}</h2>
        <p className="recap__note">
          Encaissé, facturé et prévisionnel, mois par mois. Les trois ne
          s&apos;additionnent pas : ils mesurent trois choses différentes.
        </p>
        <ol className="admin-graph" role="list">
          {mensuel.map((m, i) => (
            <li key={m.mois} className="admin-graph__col">
              <div className="admin-graph__barres">
                {[
                  ["encaisse", m.encaisse_cents, "Encaissé"],
                  ["facture", m.facture_cents, "Facturé"],
                  ["prevu", m.previsionnel_cents, "Prévisionnel"],
                ].map(([cle, valeur, titre]) => (
                  <span key={cle}
                    className={`admin-graph__barre admin-graph__barre--${cle}`}
                    style={{ height: `${Math.max(valeur > 0 ? 3 : 0, (valeur / plafond) * 100)}%` }}
                    title={`${titre} — ${euros(valeur)}`} />
                ))}
              </div>
              <span className="admin-graph__mois">{MOIS[i]}</span>
              <span className="admin-graph__valeur">{eurosCourts(m.encaisse_cents)}</span>
            </li>
          ))}
        </ol>
        <p className="admin-legende">
          <span className="admin-legende__puce admin-legende__puce--encaisse" /> Encaissé
          <span className="admin-legende__puce admin-legende__puce--facture" /> Facturé
          <span className="admin-legende__puce admin-legende__puce--prevu" /> Prévisionnel
        </p>
      </section>

      {/* ── Par mariage ── */}
      <section className="admin-bloc">
        <h2 className="display t-carte">Par mariage</h2>
        {parMariage.length === 0 ? (
          <p className="recap__note">Aucun dossier pour l&apos;instant.</p>
        ) : (
          <div className="admin-tableau-enroule">
            <table className="admin-tableau">
              <caption className="admin-tableau__legende">
                Prix total, encaissé et solde par mariage. « Facturé » n&apos;est
                pas « encaissé » : les deux colonnes restent séparées.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Mariage</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">Contractualisé</th>
                  <th scope="col" className="num">Facturé</th>
                  <th scope="col" className="num">Encaissé</th>
                  <th scope="col" className="num">Solde</th>
                </tr>
              </thead>
              <tbody>
                {parMariage.map((m) => (
                  <tr key={m.demande_id}>
                    <th scope="row">
                      <Link href={`/admin/demandes/${m.demande_id}`}>{m.contact_nom}</Link>
                      <span className="admin-tableau__sous">{m.reference}</span>
                    </th>
                    <td data-libelle="Date">
                      {m.date_mariage ? formaterDateSql(m.date_mariage) : "—"}
                    </td>
                    <td data-libelle="Contractualisé" className="num">
                      {euros(m.contractualise_cents)}
                    </td>
                    <td data-libelle="Facturé" className="num">{euros(m.facture_cents)}</td>
                    <td data-libelle="Encaissé" className="num">{euros(m.encaisse_cents)}</td>
                    <td data-libelle="Solde"
                      className={`num${m.solde_a_percevoir_cents > 0 ? " num--du" : ""}`}>
                      {euros(m.solde_a_percevoir_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="recap__note" style={{ marginTop: "2rem" }}>
        Les montants sont tenus en centimes entiers. Un paiement n&apos;entre dans
        l&apos;encaissé qu&apos;une fois <strong>confirmé</strong> ; une facture émise
        n&apos;encaisse rien.
      </p>
    </main>
  );
}
