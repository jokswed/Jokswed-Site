import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { tracer } from "@/lib/auth/acces";
import { formaterDateSql } from "@/lib/dates";
import { formaterPrix } from "@/content/offres";
import { LIBELLES_STATUT } from "../page";

export const dynamic = "force-dynamic";

const STATUTS = [
  "non_lue", "a_traiter", "attente_client", "attente_collaborateur",
  "en_cours_devis", "devis_envoye", "confirmee", "refusee", "archivee",
];

export default async function FicheDemande({ params }) {
  const { id } = await params;
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["dossier.lire"]);

  const vue = await acces.executer(async (q) => {
    /* ⚠️ AUCUN FILTRE `entreprise_id` ÉCRIT À LA MAIN ICI.
       La politique de `demandes` s'en charge : un identifiant appartenant à
       une autre entreprise ne rend simplement aucune ligne. C'est vérifié par
       un banc, en attaquant la route directement. */
    const { rows } = await q("SELECT * FROM demandes WHERE id = $1", [id]);
    if (rows.length === 0) return null;

    /* ⚠️ SÉQUENTIEL, PAS `Promise.all`.
       Ces requêtes partagent UNE connexion, celle de la transaction qui porte
       l'identité de l'acteur. `pg` avertit explicitement qu'appeler `query()`
       pendant qu'une autre s'exécute est déprécié et sera retiré en 9.0 — et
       en attendant, l'ordre des réponses n'est pas garanti. Le gain d'un
       parallélisme qui n'en est pas un ne vaut pas ce risque. */
    const lignes = await q(
      "SELECT * FROM demande_lignes WHERE demande_id = $1 ORDER BY ordre", [id]);
    const consentements = await q(
      "SELECT * FROM consentements WHERE demande_id = $1 ORDER BY finalite", [id]);
    const notes = await q(
      `SELECT n.*, u.prenom, u.nom FROM notes_internes n
           JOIN utilisateurs u ON u.id = n.auteur_id
          WHERE n.demande_id = $1 ORDER BY n.cree_le DESC`, [id]);
    /* ⚠️ PAS DE JOINTURE VERS `entreprises`.
       Sa politique ne rend que les entreprises dont l'acteur est membre : la
       jointure vidait la proposition et faisait disparaître tout le bloc
       « prestation vidéo » de la fiche, sans la moindre erreur. Le nom du
       partenaire est dénormalisé sur la proposition (palier 012), ce qui
       évite aussi d'exposer le reste de sa fiche — RLS filtre des lignes,
       pas des colonnes. */
    const proposition = await q(
      "SELECT * FROM propositions WHERE demande_id = $1", [id]);

    /* Première ouverture : on marque la demande lue et on la sort de « non
       lue ». C'est une lecture qui change l'état, donc on la trace. */
    if (!rows[0].lue_le) {
      await q(
        `UPDATE demandes SET lue_le = now(),
                statut = CASE WHEN statut = 'non_lue' THEN 'a_traiter' ELSE statut END
          WHERE id = $1`, [id]);
      await tracer(q, session.utilisateurId, entreprise.id, "demande.lue", "demande", id);
    }

    return {
      demande: rows[0],
      lignes: lignes.rows,
      consentements: consentements.rows,
      notes: notes.rows,
      proposition: proposition.rows[0] ?? null,
    };
  });

  if (!vue) notFound();
  const { demande, lignes, consentements, notes, proposition } = vue;
  const peutEcrire = acces.permissions.has("dossier.ecrire");

  async function changerStatut(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const nouveau = String(formulaire.get("statut") ?? "");
    if (!STATUTS.includes(nouveau)) return;
    await a.executer(async (q) => {
      const { rows } = await q(
        "UPDATE demandes SET statut = $1 WHERE id = $2 RETURNING statut", [nouveau, id]);
      if (rows[0]) {
        await tracer(q, s.utilisateurId, e.id, "demande.statut", "demande", id,
          { statut: demande.statut }, { statut: nouveau });
      }
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function completer(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);
    const champs = {
      contact_telephone: String(formulaire.get("telephone") ?? "") || null,
      ville: String(formulaire.get("ville") ?? "") || null,
      departement: String(formulaire.get("departement") ?? "") || null,
      lieu: String(formulaire.get("lieu") ?? "") || null,
      horaires: String(formulaire.get("horaires") ?? "") || null,
      invites_estimes: Number.parseInt(String(formulaire.get("invites") ?? ""), 10) || null,
      complements: String(formulaire.get("complements") ?? "") || null,
    };
    await a.executer(async (q) => {
      await q(
        `UPDATE demandes SET contact_telephone = $1, ville = $2, departement = $3,
                lieu = $4, horaires = $5, invites_estimes = $6, complements = $7
          WHERE id = $8`,
        [...Object.values(champs), id]);
      /* ⚠️ `instantane` N'EST PAS TOUCHÉ : il garde ce que le client a
         réellement soumis. Ces champs-ci sont des compléments de l'équipe. */
      await tracer(q, s.utilisateurId, e.id, "demande.completee", "demande", id, null, champs);
    });
    revalidatePath(`/admin/demandes/${id}`);
  }

  async function ajouterNote(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["note.ecrire"]);
    const corps = String(formulaire.get("corps") ?? "").trim();
    if (!corps) return;
    await a.executer((q) =>
      q(`INSERT INTO notes_internes (entreprise_id, demande_id, auteur_id, corps)
         VALUES ($1,$2,$3,$4)`, [e.id, id, s.utilisateurId, corps.slice(0, 5000)]));
    revalidatePath(`/admin/demandes/${id}`);
  }

  const consentement = (finalite) =>
    consentements.find((c) => c.finalite === finalite)?.accorde === true;

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{demande.reference}</p>
          <h1 className="display t-section">{demande.contact_nom}</h1>
          <p className="recap__note">
            Reçue le {new Date(demande.cree_le).toLocaleString("fr-FR")} ·{" "}
            {LIBELLES_STATUT[demande.statut] ?? demande.statut}
          </p>
        </div>
        <Link href="/admin/demandes" className="btn btn--fantome">Retour</Link>
      </header>

      <div className="admin-colonnes">
        <div className="admin-colonne">
          <section className="admin-bloc">
            <h2 className="display t-carte">Le couple</h2>
            <dl className="admin-dl">
              <dt>Nom</dt><dd>{demande.contact_nom}</dd>
              <dt>E-mail</dt>
              <dd><a className="lien" href={`mailto:${demande.contact_email}`}>{demande.contact_email}</a></dd>
              <dt>Téléphone</dt>
              <dd>{demande.contact_telephone
                ? <a className="lien" href={`tel:${demande.contact_telephone.replace(/\s/g, "")}`}>{demande.contact_telephone}</a>
                : "—"}</dd>
              <dt>Contact préféré</dt><dd>{demande.contact_prefere ?? "—"}</dd>
            </dl>
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Le mariage</h2>
            <dl className="admin-dl">
              <dt>Date</dt>
              <dd>{demande.date_incertaine && !demande.date_mariage
                ? "À définir" : formaterDateSql(demande.date_mariage)}</dd>
              <dt>Lieu</dt><dd>{demande.lieu ?? "—"}</dd>
              <dt>Ville</dt><dd>{demande.ville ?? "—"}</dd>
              <dt>Département</dt><dd>{demande.departement ?? "—"}</dd>
              <dt>Invités</dt><dd>{demande.invites_estimes ?? "—"}</dd>
              <dt>Horaires</dt><dd>{demande.horaires ?? "—"}</dd>
            </dl>
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Prestations demandées</h2>
            {lignes.length === 0 ? (
              <p className="recap__note">Aucune formule ni supplément sélectionné.</p>
            ) : (
              <ul className="admin-liste">
                {lignes.map((l) => (
                  <li key={l.id}>
                    <strong>{l.libelle}</strong>
                    <span>
                      {l.compatibilite === "inclus"
                        ? "Incluse dans la formule — non facturée"
                        : l.prix_cents === null
                          ? "Sur devis"
                          : `${formaterPrix(l.prix_cents)} TTC`}
                    </span>
                    {l.executant_partenaire ? <span className="admin-jeton">Partenaire</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {/* ⚠️ L'instantané fige ce que le client a vu : si un tarif change
                demain, cette fiche continue d'afficher le prix du jour de la
                demande. */}
            <p className="recap__note" style={{ marginTop: "0.9rem" }}>
              Tarifs figés au moment de la demande.
            </p>
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Message du client</h2>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{demande.message}</p>
          </section>

          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Compléter le dossier</h2>
              <p className="recap__note">
                Ce que vous apprenez au téléphone se note ici. Les informations
                soumises par le client restent conservées à part, intactes.
              </p>
              <form action={completer} className="formulaire" style={{ marginTop: "1rem" }}>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="telephone">Téléphone</label>
                    <input id="telephone" name="telephone" type="tel"
                           defaultValue={demande.contact_telephone ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="invites">Nombre d&apos;invités</label>
                    <input id="invites" name="invites" type="number" min="0"
                           defaultValue={demande.invites_estimes ?? ""} />
                  </div>
                </div>
                <div className="formulaire__deux">
                  <div className="champ">
                    <label htmlFor="ville">Ville</label>
                    <input id="ville" name="ville" type="text" defaultValue={demande.ville ?? ""} />
                  </div>
                  <div className="champ">
                    <label htmlFor="departement">Département</label>
                    <input id="departement" name="departement" type="text"
                           defaultValue={demande.departement ?? ""} />
                  </div>
                </div>
                <div className="champ">
                  <label htmlFor="lieu">Lieux</label>
                  <input id="lieu" name="lieu" type="text" defaultValue={demande.lieu ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="horaires">Horaires connus</label>
                  <input id="horaires" name="horaires" type="text"
                         defaultValue={demande.horaires ?? ""} />
                </div>
                <div className="champ">
                  <label htmlFor="complements">Informations complémentaires</label>
                  <textarea id="complements" name="complements"
                            defaultValue={demande.complements ?? ""} />
                </div>
                <button type="submit" className="btn">Enregistrer</button>
              </form>
            </section>
          ) : null}
        </div>

        <div className="admin-colonne">
          {peutEcrire ? (
            <section className="admin-bloc">
              <h2 className="display t-carte">Statut</h2>
              <form action={changerStatut} className="formulaire">
                <div className="champ">
                  <label htmlFor="statut">État du dossier</label>
                  <select id="statut" name="statut" defaultValue={demande.statut}>
                    {STATUTS.map((s) => (
                      <option key={s} value={s}>{LIBELLES_STATUT[s] ?? s}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn--bloc">Mettre à jour</button>
              </form>
            </section>
          ) : null}

          <section className="admin-bloc">
            <h2 className="display t-carte">Prestation vidéo</h2>
            {!demande.video_demandee ? (
              <p className="recap__note">Non demandée.</p>
            ) : proposition ? (
              <>
                <p className="recap__note">
                  Collaboration enregistrée pour <strong>{proposition.destinataire_nom ?? "le partenaire vidéo"}</strong>.
                </p>
                <p className="admin-jeton" style={{ marginTop: "0.7rem" }}>
                  {proposition.envoyee_le ? "Transmise" : "Préparée — non transmise"}
                </p>
                {/* ⚠️ PAS DE BOUTON « TRANSMETTRE ».
                    Son compte n'est pas activé et ses permissions ne sont pas
                    opérationnelles : afficher un bouton qui ne ferait rien, ou
                    pire qui enverrait des coordonnées clients hors de tout
                    cadre, serait une fausse fonctionnalité. */}
                <p className="recap__note" style={{ marginTop: "0.8rem" }}>
                  La transmission s&apos;activera une fois son compte configuré et ses
                  permissions en place. Aucune coordonnée ne lui a été envoyée.
                </p>
              </>
            ) : (
              <p className="recap__note">Vidéo demandée, aucun partenaire configuré.</p>
            )}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Consentements</h2>
            <ul className="admin-liste">
              <li>
                <strong>Traitement de la demande</strong>
                <span>{consentement("reponse_demande") ? "Accordé" : "Refusé"}</span>
              </li>
              <li>
                <strong>Partage avec le vidéaste</strong>
                <span>{consentement("partage_partenaire_video") ? "Accordé" : "Non accordé"}</span>
              </li>
            </ul>
            {demande.video_demandee && !consentement("partage_partenaire_video") ? (
              <p className="admin-alerte" style={{ marginTop: "0.9rem" }}>
                Vidéo demandée sans consentement au partage : ses coordonnées ne
                peuvent pas être transmises en l&apos;état.
              </p>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Notes internes</h2>
            <p className="recap__note">
              Visibles de votre seule entreprise. Elles ne peuvent pas partir dans un e-mail.
            </p>
            {acces.permissions.has("note.ecrire") ? (
              <form action={ajouterNote} className="formulaire" style={{ marginTop: "1rem" }}>
                <div className="champ">
                  <label htmlFor="corps">Nouvelle note</label>
                  <textarea id="corps" name="corps" required />
                </div>
                <button type="submit" className="btn btn--fantome">Ajouter</button>
              </form>
            ) : null}
            {notes.length > 0 ? (
              <ul className="admin-liste" style={{ marginTop: "1rem" }}>
                {notes.map((n) => (
                  <li key={n.id}>
                    <strong>{n.prenom} {n.nom}</strong>
                    <span>{new Date(n.cree_le).toLocaleString("fr-FR")}</span>
                    <span style={{ flexBasis: "100%", color: "var(--encre-douce)" }}>{n.corps}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="admin-bloc">
            <h2 className="display t-carte">Suite du parcours</h2>
            {/* ⚠️ AUCUN BOUTON ICI. Devis, contrat et facture n'ont pas encore
                de moteur : un bouton qui ne produit rien est pire qu'une
                absence de bouton. */}
            <p className="recap__note">
              Devis, contrat et facture s&apos;ajouteront en V5. Les informations de
              cette fiche les prérempliront : rien ne sera à ressaisir.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
