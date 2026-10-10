import Link from "next/link";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";

export const metadata = { title: "Propositions reçues" };
export const dynamic = "force-dynamic";

/* =============================================================================
   ESPACE COLLABORATEUR — PROPOSITIONS REÇUES
   -----------------------------------------------------------------------------
   ⚠️ CE QUE CETTE PAGE NE MONTRE PAS.

   Ni le nom du couple, ni son e-mail, ni son téléphone, ni le montant de la
   prestation photo. Un partenaire décide sur une DATE, un LIEU et une
   PRESTATION — c'est ce qu'il lui faut pour dire oui ou non.

   Les coordonnées n'apparaissent qu'après DEUX conditions : la proposition
   acceptée, et un partage explicite accordé par le pilote du mariage. C'est
   `app.propositions_recues()` qui le décide, en base. La page ne filtre rien
   qu'elle aurait déjà reçu.
   ============================================================================= */
export default async function Propositions() {
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["collaboration.repondre"]);

  const propositions = await acces.executer(async (q) => {
    const { rows } = await q("SELECT * FROM app.propositions_recues($1)", [entreprise.id]);
    return rows;
  });

  async function repondre(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["collaboration.repondre"]);
    await a.executer((q) => q("SELECT app.repondre_proposition($1,$2,$3)",
      [String(formulaire.get("proposition")),
       formulaire.get("reponse") === "oui",
       String(formulaire.get("commentaire") ?? "").trim() || null]));
    revalidatePath("/admin/propositions");
  }

  const aRepondre = propositions.filter((p) => ["proposee", "vue"].includes(p.statut));
  const traitees = propositions.filter((p) => !["proposee", "vue"].includes(p.statut));

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Propositions</h1>
          <p className="recap__note">
            {aRepondre.length} en attente de votre réponse
          </p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      <section className="admin-bloc">
        <h2 className="display t-carte">À traiter</h2>
        {aRepondre.length === 0 ? (
          <p className="recap__note">Aucune proposition en attente.</p>
        ) : (
          <ul className="admin-saison">
            {aRepondre.map((p) => (
              <li key={p.id} className="admin-saison__item">
                <div className="admin-saison__date">
                  <span className="admin-saison__jour">
                    {p.date_mariage ? Number(p.date_mariage.slice(8, 10)) : "?"}
                  </span>
                  <span className="admin-saison__mois">
                    {p.date_mariage ? p.date_mariage.slice(0, 7) : "à confirmer"}
                  </span>
                </div>
                <div className="admin-saison__corps">
                  <p className="admin-saison__nom">Prestation {p.prestation}</p>
                  <p className="admin-saison__meta">
                    {p.date_mariage ? formaterDateSql(p.date_mariage) : "Date à confirmer"}
                    {p.lieu ? ` · ${p.lieu}` : p.ville ? ` · ${p.ville}` : null}
                    {p.invites_estimes ? ` · ~${p.invites_estimes} invités` : null}
                  </p>
                  <p className="admin-saison__meta">Proposée par {p.emetteur}</p>
                  {p.message ? (
                    <p className="admin-saison__meta">« {p.message} »</p>
                  ) : null}
                  {/* ⚠️ ON DIT POURQUOI LES COORDONNÉES MANQUENT.
                      Un champ vide passe pour un bug ; une phrase explique
                      que c'est une règle. */}
                  <p className="recap__note" style={{ marginTop: "0.5rem" }}>
                    Les coordonnées du couple ne vous sont pas communiquées à ce
                    stade. Elles le seront après acceptation, si le photographe
                    les partage.
                  </p>

                  <form action={repondre} className="formulaire" style={{ marginTop: "0.9rem" }}>
                    <input type="hidden" name="proposition" value={p.id} />
                    <div className="champ">
                      <label htmlFor={`c-${p.id}`}>Commentaire (facultatif)</label>
                      <input id={`c-${p.id}`} name="commentaire" type="text"
                        placeholder="Disponible, tarif habituel…" />
                    </div>
                    <div className="admin-paiement__actions">
                      <button type="submit" name="reponse" value="oui" className="btn">
                        Accepter
                      </button>
                      <button type="submit" name="reponse" value="non" className="btn btn--fantome">
                        Refuser
                      </button>
                    </div>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {traitees.length > 0 ? (
        <section className="admin-bloc">
          <h2 className="display t-carte">Historique</h2>
          <ul className="admin-liste">
            {traitees.map((p) => (
              <li key={p.id} style={{ flexWrap: "wrap" }}>
                <strong>
                  {p.date_mariage ? formaterDateSql(p.date_mariage) : "Date à confirmer"}
                </strong>
                <span>{p.prestation}</span>
                <span className={`admin-pastille${
                  p.statut === "acceptee" ? " admin-pastille--emis" : ""}`}>
                  {p.statut}
                </span>
                {p.coordonnees_partagees ? (
                  <span style={{ flexBasis: "100%", color: "var(--encre-douce)" }}>
                    {p.contact_nom} · {p.contact_email}
                    {p.contact_telephone ? ` · ${p.contact_telephone}` : null}
                  </span>
                ) : p.statut === "acceptee" ? (
                  <span style={{ flexBasis: "100%" }}>
                    Coordonnées non partagées.
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
