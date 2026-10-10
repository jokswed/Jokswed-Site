import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";
import {
  genererDevisDepuisDossier, genererContratDepuisDevis,
  genererFactureDepuisDevis, rendrePdf,
} from "@/lib/documents/generer";

export const metadata = { title: "Mes dossiers" };
export const dynamic = "force-dynamic";

/* =============================================================================
   ESPACE COLLABORATEUR — SES DOSSIERS, SES DOCUMENTS, SES PAIEMENTS
   -----------------------------------------------------------------------------
   ⚠️ TOUT CE QUI EST ICI LUI APPARTIENT.

   Sa numérotation, son régime de TVA, ses montants. Il ne voit ni le prix de
   la prestation photo, ni les encaissements de JoksWed, ni les dossiers
   auxquels il n'a pas été associé — la RLS s'en charge, et la page n'y peut
   rien changer même si elle le voulait.

   ⚠️ ET IL NE VOIT LE COUPLE QUE SI ON LE LUI A PARTAGÉ.
   Sans partage, ses documents portent la référence du dossier à la place du
   nom. Un document incomplet, plutôt qu'un contournement de la règle.
   ============================================================================= */
/* NULL = « accès restreint », pas « zéro euro ». */
function euros(cents) {
  if (cents === null || cents === undefined) return "—";
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} €`;
}

export default async function MesDossiers({ searchParams }) {
  const params = await searchParams;
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["dossier.lire"]);

  const donnees = await acces.executer(async (q) => {
    const { rows: dossiers } = await q(
      "SELECT * FROM app.mes_dossiers($1)", [entreprise.id]);
    const { rows: documents } = await q(
      `SELECT id, dossier_id, type, role_facture, numero, statut, total_ttc_cents
         FROM documents WHERE entreprise_id = $1 AND dossier_id IS NOT NULL
        ORDER BY cree_le`, [entreprise.id]);
    const { rows: paiements } = await q(
      `SELECT id, dossier_id, montant_cents, type_paiement, statut, moyen, recu_le
         FROM paiements WHERE entreprise_id = $1 AND dossier_id IS NOT NULL
        ORDER BY recu_le DESC`, [entreprise.id]);
    const { rows: [verdict] } = await q(
      "SELECT * FROM app.verdict_emission($1,'devis')", [entreprise.id]);
    return { dossiers, documents, paiements, verdict };
  });

  async function creerDevis(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.rediger"]);

    /* Jusqu'à quatre lignes saisies. Les montants arrivent en euros depuis un
       champ texte ; on arrondit APRÈS multiplication, en centimes entiers. */
    const lignes = [];
    for (let i = 0; i < 4; i += 1) {
      const libelle = String(formulaire.get(`libelle-${i}`) ?? "").trim();
      const brut = String(formulaire.get(`prix-${i}`) ?? "").replace(",", ".").trim();
      const cents = Math.round(Number.parseFloat(brut) * 100);
      if (libelle && Number.isFinite(cents) && cents >= 0) {
        lignes.push({ libelle, prixCents: cents });
      }
    }
    if (lignes.length === 0) return;

    await a.executer((q) => genererDevisDepuisDossier(
      q, String(formulaire.get("dossier")), e.id, s.utilisateurId,
      {
        lignes,
        nombreEcheances: Number(formulaire.get("echeances")) || 2,
        inclusions: String(formulaire.get("inclusions") ?? "")
          .split("\n").map((l) => l.trim()).filter(Boolean),
      }));
    revalidatePath("/admin/dossiers");
  }

  async function emettre(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.emettre"]);
    const documentId = String(formulaire.get("document"));
    /* ⚠️ ÉMETTRE, RENDRE, SCELLER — UNE SEULE TRANSACTION.
       Le numéro n'existe qu'à l'émission et doit figurer SUR le PDF. */
    await a.executer(async (q) => {
      const { rows } = await q("SELECT * FROM app.emettre_document($1)", [documentId]);
      if (!rows[0]?.emis) return;
      const { rows: d } = await q(
        "SELECT instantane FROM documents WHERE id = $1", [documentId]);
      const { pdf } = rendrePdf(d[0].instantane, false);
      await q("SELECT app.sceller_document($1,$2)",
        [documentId, createHash("sha256").update(pdf).digest("hex")]);
    });
    revalidatePath("/admin/dossiers");
  }

  async function genererDerive(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["document.rediger"]);
    const devis = String(formulaire.get("devis"));
    const quoi = String(formulaire.get("quoi"));
    await a.executer((q) =>
      quoi === "contrat"
        ? genererContratDepuisDevis(q, devis, e.id, s.utilisateurId)
        : genererFactureDepuisDevis(q, devis, quoi, e.id, s.utilisateurId));
    revalidatePath("/admin/dossiers");
  }

  async function saisirPaiement(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["finance.saisir_paiement"]);
    const brut = String(formulaire.get("montant") ?? "").replace(",", ".").trim();
    const cents = Math.round(Number.parseFloat(brut) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    const dossier = String(formulaire.get("dossier"));
    await a.executer((q) => q(
      "SELECT app.enregistrer_paiement_dossier($1,$2,$3,$4,NULL,$5,$6,NULL)",
      [dossier, cents, String(formulaire.get("moyen") ?? "virement"),
       String(formulaire.get("type") ?? "acompte"),
       String(formulaire.get("recu_le") ?? "") || null,
       `dossier:${dossier}:${cents}:${String(formulaire.get("recu_le") ?? "")}`]));
    revalidatePath("/admin/dossiers");
  }

  async function confirmerPaiement(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["finance.confirmer_paiement"]);
    await a.executer((q) =>
      q("SELECT app.confirmer_paiement($1)", [String(formulaire.get("paiement"))]));
    revalidatePath("/admin/dossiers");
  }

  const { dossiers, documents, paiements, verdict } = donnees;
  const ouvert = params?.dossier;
  const peutRediger = acces.permissions.has("document.rediger");
  const voitFinances = acces.permissions.has("finance.lire");

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Mes dossiers</h1>
          <p className="recap__note">{dossiers.length} dossier(s)</p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      {verdict.motifs.length > 0 ? (
        <div className="admin-alerte">
          <strong>Vos documents resteront des brouillons :</strong>
          <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
            {verdict.motifs.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
            Renseignez votre entreprise dans{" "}
            <Link href="/admin/entreprise">Mon entreprise</Link>.
          </p>
        </div>
      ) : null}

      {dossiers.length === 0 ? (
        <p className="recap__note">
          Aucun dossier pour l&apos;instant. Un dossier apparaît ici lorsque vous
          acceptez une <Link href="/admin/propositions">proposition</Link>.
        </p>
      ) : (
        <ul className="admin-saison">
          {dossiers.map((d) => {
            const docs = documents.filter((x) => x.dossier_id === d.dossier_id);
            const devis = docs.find((x) => x.type === "devis");
            const mouvements = paiements.filter((x) => x.dossier_id === d.dossier_id);
            const estOuvert = ouvert === d.dossier_id;
            return (
              <li key={d.dossier_id} className="admin-saison__item">
                <div className="admin-saison__date">
                  <span className="admin-saison__jour">
                    {d.date_mariage ? Number(d.date_mariage.slice(8, 10)) : "?"}
                  </span>
                  <span className="admin-saison__mois">
                    {d.date_mariage ? d.date_mariage.slice(0, 7) : "—"}
                  </span>
                </div>
                <div className="admin-saison__corps">
                  <p className="admin-saison__nom">{d.reference} · {d.prestation}</p>
                  <p className="admin-saison__meta">
                    {d.date_mariage ? formaterDateSql(d.date_mariage) : "Date à confirmer"}
                    {d.ville ? ` · ${d.ville}` : null}
                  </p>
                  <p className="admin-saison__meta">
                    {d.coordonnees_partagees
                      ? `${d.contact_nom ?? "Couple"}${d.contact_email ? ` · ${d.contact_email}` : ""}`
                      : "Coordonnées du couple non partagées."}
                  </p>
                  <p className="admin-saison__meta">
                    {docs.length === 0 ? (
                      <span className="admin-pastille">aucun document</span>
                    ) : docs.map((x) => (
                      <span key={x.id}
                        className={`admin-pastille${x.statut !== "brouillon" ? " admin-pastille--emis" : ""}`}>
                        {x.type}{x.role_facture ? ` ${x.role_facture}` : ""}
                        {x.numero ? ` ${x.numero}` : " (brouillon)"}
                      </span>
                    ))}
                  </p>

                  {!estOuvert ? (
                    <p className="admin-saison__meta">
                      <Link href={`/admin/dossiers?dossier=${d.dossier_id}`} className="btn btn--fantome btn--petit">
                        Ouvrir
                      </Link>
                    </p>
                  ) : (
                    <>
                      {/* ── Documents ── */}
                      <div className="admin-paiement__actions" style={{ marginTop: "0.8rem" }}>
                        {docs.map((x) => (
                          <span key={x.id} className="admin-paiement__actions">
                            <a className="btn btn--fantome btn--petit"
                              href={`/api/admin/documents/${x.id}/pdf`}>
                              PDF {x.type}
                            </a>
                            {x.statut === "brouillon"
                              && acces.permissions.has("document.emettre") ? (
                              <form action={emettre}>
                                <input type="hidden" name="document" value={x.id} />
                                <button type="submit" className="btn btn--petit">Émettre</button>
                              </form>
                            ) : null}
                          </span>
                        ))}
                      </div>

                      {devis && peutRediger ? (
                        <form action={genererDerive} className="admin-ligne-actions"
                          style={{ marginTop: "0.8rem" }}>
                          <input type="hidden" name="devis" value={devis.id} />
                          <select name="quoi" defaultValue="acompte" aria-label="Document à générer">
                            <option value="contrat">Contrat</option>
                            <option value="acompte">Facture d&apos;acompte</option>
                            <option value="solde">Facture de solde</option>
                            <option value="totale">Facture complète</option>
                          </select>
                          <button type="submit" className="btn btn--fantome">Générer</button>
                        </form>
                      ) : null}

                      {/* ── Nouveau devis ── */}
                      {peutRediger ? (
                        <form action={creerDevis} className="formulaire" style={{ marginTop: "1rem" }}>
                          <input type="hidden" name="dossier" value={d.dossier_id} />
                          <p className="label label--nu">Nouveau devis</p>
                          {[0, 1, 2, 3].map((i) => (
                            <div className="admin-grille-champs" key={i}>
                              <div className="champ">
                                <label htmlFor={`l${d.dossier_id}${i}`}>
                                  Prestation {i + 1}
                                </label>
                                <input id={`l${d.dossier_id}${i}`} name={`libelle-${i}`}
                                  type="text"
                                  placeholder={i === 0 ? "Film de mariage, 10 h de présence" : ""} />
                              </div>
                              <div className="champ">
                                <label htmlFor={`p${d.dossier_id}${i}`}>Prix TTC (€)</label>
                                <input id={`p${d.dossier_id}${i}`} name={`prix-${i}`}
                                  type="text" inputMode="decimal" />
                              </div>
                            </div>
                          ))}
                          <div className="admin-grille-champs">
                            <div className="champ">
                              <label htmlFor={`e${d.dossier_id}`}>Nombre d&apos;échéances</label>
                              <select id={`e${d.dossier_id}`} name="echeances" defaultValue="2">
                                <option value="1">Paiement unique</option>
                                <option value="2">2 fois</option>
                                <option value="3">3 fois</option>
                              </select>
                            </div>
                            <div className="champ">
                              <label htmlFor={`i${d.dossier_id}`}>Inclusions (une par ligne)</label>
                              <textarea id={`i${d.dossier_id}`} name="inclusions" rows={2} />
                            </div>
                          </div>
                          <button type="submit" className="btn btn--bloc">
                            Préparer mon devis
                          </button>
                        </form>
                      ) : null}

                      {/* ── Paiements ── */}
                      {voitFinances ? (
                        <div style={{ marginTop: "1.2rem" }}>
                          <p className="label label--nu">Mes paiements</p>
                          {mouvements.length === 0 ? (
                            <p className="recap__note">Aucun mouvement.</p>
                          ) : (
                            <ul className="admin-paiements">
                              {mouvements.map((p) => (
                                <li key={p.id} className={`admin-paiement admin-paiement--${p.statut}`}>
                                  <div className="admin-paiement__haut">
                                    <span className="admin-paiement__montant">
                                      {euros(p.montant_cents)}
                                    </span>
                                    <span className="admin-pastille">{p.type_paiement}</span>
                                    <span className={`admin-pastille${
                                      p.statut === "confirme" ? " admin-pastille--emis" : ""}`}>
                                      {p.statut}
                                    </span>
                                  </div>
                                  <p className="admin-paiement__meta">
                                    {formaterDateSql(p.recu_le)} · {p.moyen}
                                  </p>
                                  {p.statut === "declare"
                                    && acces.permissions.has("finance.confirmer_paiement") ? (
                                    <form action={confirmerPaiement}>
                                      <input type="hidden" name="paiement" value={p.id} />
                                      <button type="submit" className="btn btn--petit">Confirmer</button>
                                    </form>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          {acces.permissions.has("finance.saisir_paiement") ? (
                            <form action={saisirPaiement} className="formulaire"
                              style={{ marginTop: "0.8rem" }}>
                              <input type="hidden" name="dossier" value={d.dossier_id} />
                              <div className="admin-grille-champs">
                                <div className="champ">
                                  <label htmlFor={`m${d.dossier_id}`}>Montant (€)</label>
                                  <input id={`m${d.dossier_id}`} name="montant" type="text"
                                    inputMode="decimal" required />
                                </div>
                                <div className="champ">
                                  <label htmlFor={`t${d.dossier_id}`}>Nature</label>
                                  <select id={`t${d.dossier_id}`} name="type" defaultValue="acompte">
                                    <option value="acompte">Acompte</option>
                                    <option value="versement">Versement</option>
                                    <option value="solde">Solde</option>
                                    <option value="partiel">Partiel</option>
                                  </select>
                                </div>
                                <div className="champ">
                                  <label htmlFor={`y${d.dossier_id}`}>Mode</label>
                                  <select id={`y${d.dossier_id}`} name="moyen" defaultValue="virement">
                                    <option value="virement">Virement</option>
                                    <option value="cheque">Chèque</option>
                                    <option value="especes">Espèces</option>
                                    <option value="carte">Carte</option>
                                  </select>
                                </div>
                                <div className="champ">
                                  <label htmlFor={`r${d.dossier_id}`}>Reçu le</label>
                                  <input id={`r${d.dossier_id}`} name="recu_le" type="date" />
                                </div>
                              </div>
                              <button type="submit" className="btn btn--fantome btn--bloc">
                                Enregistrer
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {voitFinances ? (
                  <dl className="admin-saison__argent">
                    <div><dt>Devis</dt><dd>{euros(d.total_cents)}</dd></div>
                    <div><dt>Encaissé</dt><dd>{euros(d.encaisse_cents)}</dd></div>
                    <div>
                      <dt>Reste</dt>
                      <dd className={(d.reste_du_cents ?? 0) > 0 ? "num--du" : undefined}>
                        {euros(d.reste_du_cents)}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
