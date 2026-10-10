import Link from "next/link";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";

export const metadata = { title: "Mon entreprise" };
export const dynamic = "force-dynamic";

/* =============================================================================
   RÉGLAGES DE L'ENTREPRISE
   -----------------------------------------------------------------------------
   Chaque entreprise configure SES coordonnées professionnelles, SON SIRET,
   SON régime fiscal et SON médiateur. Ce sont ces informations-là qui
   figureront sur ses documents — un collaborateur qui émet un devis émet le
   SIEN, avec sa propre identité et sa propre numérotation.

   ⚠️ LE RÉGIME DE TVA N'EST PAS UNE COLONNE DE L'ENTREPRISE.
   C'est une période datée (`regimes_tva`) : passer de la franchise en base au
   régime réel ne doit pas réécrire la mention portée par les documents déjà
   émis. On ajoute une période, on n'édite pas la précédente.
   ============================================================================= */
const CHAMPS = [
  ["nom_commercial", "Nom commercial", "text", true],
  ["raison_sociale", "Raison sociale", "text", false],
  ["siret", "SIRET (14 chiffres)", "text", false],
  ["code_ape", "Code APE", "text", false],
  ["adresse_ligne1", "Adresse", "text", false],
  ["code_postal", "Code postal", "text", false],
  ["ville", "Ville", "text", false],
  ["email", "E-mail professionnel", "email", false],
  ["telephone", "Téléphone", "tel", false],
  ["mediateur_nom", "Médiateur de la consommation", "text", false],
  ["mediateur_url", "Site du médiateur", "url", false],
];

export default async function MonEntreprise() {
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["entreprise.reglages"]);

  const donnees = await acces.executer(async (q) => {
    const { rows: [e] } = await q("SELECT * FROM entreprises WHERE id = $1", [entreprise.id]);
    const { rows: regimes } = await q(
      `SELECT regime, tva_numero, mention_legale, debut_le, fin_le
         FROM regimes_tva WHERE entreprise_id = $1 ORDER BY debut_le DESC`, [entreprise.id]);
    const { rows: [verdict] } = await q(
      "SELECT * FROM app.verdict_emission($1,'contrat')", [entreprise.id]);
    return { e, regimes, verdict };
  });

  async function enregistrer(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["entreprise.reglages"]);
    const champs = {};
    for (const [cle] of CHAMPS) {
      const valeur = String(formulaire.get(cle) ?? "").trim();
      if (valeur) champs[cle] = valeur;
    }
    await a.executer((q) =>
      q("SELECT app.admin_maj_entreprise($1,$2::jsonb)", [e.id, JSON.stringify(champs)]));
    revalidatePath("/admin/entreprise");
  }

  async function definirRegime(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["entreprise.reglages"]);
    const regime = String(formulaire.get("regime") ?? "");
    if (!["franchise_base", "assujetti", "exonere"].includes(regime)) return;
    const numero = String(formulaire.get("tva_numero") ?? "").trim() || null;
    const mention = String(formulaire.get("mention_legale") ?? "").trim() || null;
    const debut = String(formulaire.get("debut_le") ?? "") || null;

    await a.executer(async (q) => {
      /* ⚠️ ON CLÔT LA PÉRIODE PRÉCÉDENTE, ON NE L'ÉCRASE PAS.
         Les documents déjà émis portent la mention de LEUR époque ; la
         réécrire changerait rétroactivement des pièces comptables. */
      await q(
        `UPDATE regimes_tva SET fin_le = $2::date
          WHERE entreprise_id = $1 AND fin_le IS NULL`, [e.id, debut ?? null]);
      await q(
        `INSERT INTO regimes_tva (entreprise_id, regime, tva_numero, mention_legale, debut_le)
         VALUES ($1,$2,$3,$4,coalesce($5::date, current_date))`,
        [e.id, regime, numero, mention, debut]);
    });
    revalidatePath("/admin/entreprise");
  }

  const { e, regimes, verdict } = donnees;
  const actuel = regimes.find((r) => !r.fin_le);

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{e.nom_commercial}</p>
          <h1 className="display t-section">Mon entreprise</h1>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      {verdict.motifs.length > 0 ? (
        <div className="admin-alerte">
          <strong>Émission de documents définitifs bloquée :</strong>
          <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
            {verdict.motifs.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      ) : null}

      <section className="admin-bloc">
        <h2 className="display t-carte">Coordonnées professionnelles</h2>
        <p className="recap__note">
          Ce sont ces informations qui figurent sur vos devis, contrats et
          factures.
        </p>
        <form action={enregistrer} className="formulaire" style={{ marginTop: "1rem" }}>
          <div className="admin-grille-champs">
            {CHAMPS.map(([cle, libelle, type, requis]) => (
              <div className="champ" key={cle}>
                <label htmlFor={cle}>{libelle}</label>
                <input id={cle} name={cle} type={type} required={requis}
                  defaultValue={e[cle] ?? ""} />
              </div>
            ))}
          </div>
          <button type="submit" className="btn btn--bloc">Enregistrer</button>
        </form>
      </section>

      <section className="admin-bloc">
        <h2 className="display t-carte">Régime de TVA</h2>
        {actuel ? (
          <p className="recap__note">
            Régime actuel : <strong>{actuel.regime}</strong>
            {actuel.tva_numero ? ` · n° ${actuel.tva_numero}` : null}
            {actuel.mention_legale ? ` · « ${actuel.mention_legale} »` : null}
          </p>
        ) : (
          <p className="admin-alerte">
            Aucun régime qualifié. Tant qu&apos;il manque, les brouillons restent
            possibles mais aucun document ne devient définitif.
          </p>
        )}

        <form action={definirRegime} className="formulaire" style={{ marginTop: "1rem" }}>
          <div className="admin-grille-champs">
            <div className="champ">
              <label htmlFor="regime">Régime</label>
              <select id="regime" name="regime" defaultValue="franchise_base">
                <option value="franchise_base">Franchise en base (art. 293 B du CGI)</option>
                <option value="assujetti">Assujetti à la TVA</option>
                <option value="exonere">Exonéré</option>
              </select>
            </div>
            <div className="champ">
              <label htmlFor="debut_le">Applicable à partir du</label>
              <input id="debut_le" name="debut_le" type="date" />
            </div>
            <div className="champ">
              <label htmlFor="tva_numero">N° de TVA intracommunautaire</label>
              <input id="tva_numero" name="tva_numero" type="text" />
            </div>
            <div className="champ">
              <label htmlFor="mention_legale">Mention à porter sur les documents</label>
              <input id="mention_legale" name="mention_legale" type="text"
                placeholder="TVA non applicable, article 293 B du CGI" />
            </div>
          </div>
          {/* ⚠️ L'OBLIGATION D'AFFICHER UN NUMÉRO N'EST PAS GÉNÉRALE.
              En franchise en base, c'est la MENTION qui est obligatoire, pas
              le numéro. En régime assujetti, le numéro du vendeur figure
              parmi les mentions de l'article 242 nonies A, annexe II du CGI.
              On ne réclame donc pas le même champ dans les deux cas. */}
          <p className="recap__note">
            En franchise en base, la mention suffit : le numéro
            intracommunautaire n&apos;est pas exigé. Déclarer un nouveau régime
            clôt le précédent sans réécrire les documents déjà émis.
          </p>
          <button type="submit" className="btn btn--bloc">Déclarer ce régime</button>
        </form>

        {regimes.length > 0 ? (
          <ul className="admin-liste" style={{ marginTop: "1.2rem" }}>
            {regimes.map((r) => (
              <li key={`${r.debut_le}-${r.regime}`}>
                <strong>{r.regime}</strong>
                <span>du {r.debut_le}{r.fin_le ? ` au ${r.fin_le}` : " (en cours)"}</span>
                <span>{r.mention_legale ?? "—"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
