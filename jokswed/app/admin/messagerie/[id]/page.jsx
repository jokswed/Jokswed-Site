import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { adresseReponse, domaineReponse } from "@/lib/messagerie/adresses";
import { substituer, tableDeSubstitution, texteVersHtml } from "@/lib/messagerie/modeles";

export const metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

/* =============================================================================
   MESSAGERIE — UNE CONVERSATION
   -----------------------------------------------------------------------------
   ⚠️ L'APERÇU EST OBLIGATOIRE AVANT TOUT ENVOI.

   Un modèle contient des variables. Si l'une d'elles manque — un dossier
   sans date, un devis pas encore émis — le marqueur `{{date_mariage}}`
   reste visible. L'écran le signale et refuse l'envoi tant qu'il en reste
   un : mieux vaut un aller-retour qu'un e-mail troué chez le client.

   ⚠️ LE BOUTON « ENVOYER » N'EXISTE PAS SUR UNE CONVERSATION INTERNE.
   Et s'il y était, la base refuserait : contrainte de table, puis contrôle
   dans `composer_message`, puis filtre dans `message_pour_envoi`. Trois
   verrous, parce qu'une note interne partie au client ne se rattrape pas.
   ============================================================================= */
function euros(cents) {
  if (cents === null || cents === undefined) return null;
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} €`;
}

export default async function Conversation({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["message.lire"]);

  const vue = await acces.executer(async (q) => {
    const { rows: conv } = await q(
      `SELECT c.*, d.reference, d.contact_nom
         FROM conversations c LEFT JOIN demandes d ON d.id = c.demande_id
        WHERE c.id = $1`, [id]);
    if (conv.length === 0) return null;
    const { rows: fil } = await q("SELECT * FROM app.fil_conversation($1)", [id]);
    /* ⚠️ PAS DE JOINTURE DIRECTE SUR `entreprises`.
       Sa politique ne rend que les siennes : un co-participant s'affichait
       « null ». La fonction rend la raison commerciale, et rien d'autre. */
    const { rows: participants } = await q(
      "SELECT * FROM app.participants_conversation($1)", [id]);
    const { rows: invitables } = await q(
      "SELECT * FROM app.partenaires_invitables($1)", [id]);
    const { rows: modeles } = await q(
      `SELECT id, cle, libelle, sujet, corps FROM modeles_reponse
        WHERE entreprise_id = $1 ORDER BY ordre, libelle`, [entreprise.id]);
    const { rows: [variables] } = await q(
      "SELECT app.variables_conversation($1) AS v", [id]);
    /* Les documents joignables : ceux du dossier, et leur statut, pour que
       l'écran puisse refuser un brouillon AVANT le clic. */
    const { rows: documents } = conv[0].demande_id
      ? await q(
          `SELECT id, type, role_facture, numero, statut FROM documents
            WHERE demande_id = $1 AND entreprise_id = $2 ORDER BY cree_le`,
          [conv[0].demande_id, entreprise.id])
      : { rows: [] };
    const { rows: identites } = await q(
      `SELECT adresse, nom_affiche, statut FROM identites_messagerie
        WHERE entreprise_id = $1 AND statut = 'active'
          AND (utilisateur_id IS NULL OR utilisateur_id = app.acteur())
        ORDER BY utilisateur_id NULLS LAST`, [entreprise.id]);
    await q("SELECT app.marquer_lue($1)", [id]);
    return { conv: conv[0], fil, participants, invitables, modeles, documents,
             identites, variables: variables?.v ?? {} };
  });

  if (!vue) notFound();

  async function envoyer(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["message.envoyer"]);
    const corps = String(formulaire.get("corps") ?? "").trim();
    if (!corps) return;
    const interne = formulaire.get("interne") === "1";
    const sujet = String(formulaire.get("sujet") ?? "").trim() || null;
    const identite = String(formulaire.get("identite") ?? "") || null;
    const documents = formulaire.getAll("document").map(String).filter(Boolean);

    await a.executer(async (q) => {
      const { rows } = await q(
        "SELECT app.composer_message($1,$2,$3,$4,$5,$6,$7::citext,$8) AS id",
        [id, interne ? "interne" : "sortant", corps,
         interne ? null : texteVersHtml(corps), sujet,
         /* Clé d'idempotence : un double envoi du formulaire ne crée qu'un
            message. Le corps en fait partie — deux messages identiques à la
            seconde près sont, en pratique, un double clic. */
         `compose:${Math.floor(Date.now() / 10000)}:${corps.length}`,
         identite, null]);
      const messageId = rows[0]?.id;
      if (!messageId) return;
      for (const doc of documents) {
        await q("SELECT app.joindre_document($1,$2)", [messageId, doc]);
      }
    });
    revalidatePath(`/admin/messagerie/${id}`);
  }

  async function inviter(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["message.envoyer"]);
    const partenaire = String(formulaire.get("partenaire") ?? "");
    if (!partenaire) return;
    await a.executer((q) => q(
      "SELECT app.ajouter_participant($1,'prestataire',$2,NULL,NULL)", [id, partenaire]));
    revalidatePath(`/admin/messagerie/${id}`);
  }

  async function archiver(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["message.envoyer"]);
    await a.executer((q) => q("SELECT app.archiver_conversation($1,$2)",
      [id, formulaire.get("archiver") === "1"]));
    revalidatePath(`/admin/messagerie/${id}`);
  }

  const { conv, fil, participants, invitables, modeles, documents, identites,
          variables } = vue;
  const estClient = conv.nature === "client";
  const peutEcrire = acces.permissions.has("message.envoyer");
  const repondreA = adresseReponse(conv.jeton_reponse);

  /* Aperçu d'un modèle choisi. La substitution se fait ICI, côté serveur :
     le navigateur ne reçoit jamais la table des variables. */
  const modeleChoisi = modeles.find((m) => m.cle === sp?.modele);
  const table = tableDeSubstitution({
    ...variables,
    signature: `${session.prenom ?? ""} — ${entreprise.nom_commercial}`.trim(),
  });
  const apercu = modeleChoisi ? substituer(modeleChoisi.corps, table) : null;
  const apercuSujet = modeleChoisi ? substituer(modeleChoisi.sujet, table) : null;
  const manquantes = [...new Set([...(apercu?.manquantes ?? []), ...(apercuSujet?.manquantes ?? [])])];

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">
            <Link href="/admin/messagerie">Messagerie</Link>
            {conv.reference ? ` · ${conv.reference}` : null}
          </p>
          <h1 className="display t-section">{conv.sujet}</h1>
          <p className="recap__note">
            {participants.map((p) =>
              p.role === "client"
                ? `${p.nom ?? p.contact_email} (client)`
                : `${p.entreprise ?? "prestataire"}${p.est_moi ? " (vous)" : ""}`)
              .join(" · ")}
          </p>
        </div>
        <form action={archiver}>
          <input type="hidden" name="archiver" value={conv.statut === "ouverte" ? "1" : "0"} />
          <button type="submit" className="btn btn--fantome">
            {conv.statut === "ouverte" ? "Archiver" : "Rouvrir"}
          </button>
        </form>
      </header>

      {!estClient ? (
        <div className="admin-alerte admin-alerte--neutre">
          <strong>
            Conversation {conv.nature === "interne" ? "interne" : "entre prestataires"}.
          </strong>{" "}
          Aucun message n&apos;en sort. Le client n&apos;y a pas accès et ne peut
          pas y être ajouté — pour lui écrire, ouvrez une conversation client.
        </div>
      ) : null}

      <ol className="admin-fil">
        {fil.map((m) => (
          <li key={m.id}
            className={`admin-bulle admin-bulle--${m.sens}${m.lu ? "" : " admin-bulle--neuve"}`}>
            <p className="admin-bulle__entete">
              <strong>{m.auteur_nom ?? m.auteur_email ?? "—"}</strong>
              {m.auteur_entreprise ? <span> · {m.auteur_entreprise}</span> : null}
              <span className="admin-bulle__quand">
                {new Date(m.cree_le).toLocaleString("fr-FR")}
              </span>
            </p>
            <div className="admin-bulle__corps">
              {m.corps_texte.split("\n").map((ligne, i) => (
                <p key={i}>{ligne || " "}</p>
              ))}
            </div>
            {m.pieces?.length > 0 ? (
              <p className="admin-bulle__pieces">
                {m.pieces.map((p) => (
                  <a key={p.id} className="admin-pastille"
                    href={p.origine === "document"
                      ? `/api/admin/documents/${p.document_id}/pdf`
                      : `/api/admin/pieces/${p.id}`}>
                    {p.nom}
                  </a>
                ))}
              </p>
            ) : null}
            <p className="admin-bulle__pied">
              <span className={`admin-pastille${m.statut === "envoye" ? " admin-pastille--emis" : ""}`}>
                {m.sens === "entrant" ? "reçu"
                  : m.sens === "interne" ? "note interne"
                  : m.statut}
              </span>
              {m.erreur ? <span className="admin-bulle__erreur">{m.erreur}</span> : null}
            </p>
          </li>
        ))}
        {fil.length === 0 ? (
          <li className="recap__note">Aucun message pour l&apos;instant.</li>
        ) : null}
      </ol>

      {/* ⚠️ ON N'AJOUTE PAS UN CLIENT ICI.
          Seuls des prestataires : ajouter un client à une conversation qui
          n'en a pas changerait sa nature, et la base le refuse. Pour écrire
          au couple, on ouvre une conversation client. */}
      {peutEcrire && invitables.length > 0 && conv.statut === "ouverte" ? (
        <section className="admin-bloc">
          <h2 className="display t-carte">Inviter un prestataire</h2>
          <form action={inviter} className="admin-ligne-actions">
            <select name="partenaire" aria-label="Partenaire à inviter">
              {invitables.map((p) => (
                <option key={p.id} value={p.id}>{p.nom_commercial}</option>
              ))}
            </select>
            <button type="submit" className="btn btn--fantome">Ajouter</button>
          </form>
          <p className="recap__note">
            Il verra tout l&apos;historique de cette conversation, y compris les
            notes internes qui s&apos;y trouvent déjà.
          </p>
        </section>
      ) : null}

      {peutEcrire && conv.statut === "ouverte" ? (
        <section className="admin-bloc">
          <h2 className="display t-carte">Répondre</h2>

          <nav className="admin-filtres" aria-label="Modèles de réponse">
            <Link className={`admin-puce${!modeleChoisi ? " admin-puce--active" : ""}`}
              href={`/admin/messagerie/${id}`}>Message libre</Link>
            {modeles.map((m) => (
              <Link key={m.id}
                className={`admin-puce${modeleChoisi?.cle === m.cle ? " admin-puce--active" : ""}`}
                href={`/admin/messagerie/${id}?modele=${m.cle}`}>{m.libelle}</Link>
            ))}
          </nav>

          {/* ⚠️ UN MARQUEUR NON REMPLACÉ EST UN BLOCAGE, PAS UN AVERTISSEMENT. */}
          {manquantes.length > 0 ? (
            <div className="admin-alerte">
              <strong>Informations manquantes :</strong>{" "}
              {manquantes.map((c) => `{{${c}}}`).join(", ")}.
              Complétez le dossier avant d&apos;envoyer — ces marqueurs
              partiraient tels quels.
            </div>
          ) : null}

          <form action={envoyer} className="formulaire">
            {identites.length > 0 && estClient ? (
              <div className="champ">
                <label htmlFor="identite">Expéditeur</label>
                <select id="identite" name="identite" defaultValue={identites[0].adresse}>
                  {identites.map((i) => (
                    <option key={i.adresse} value={i.adresse}>
                      {i.nom_affiche} &lt;{i.adresse}&gt;
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="champ">
              <label htmlFor="sujet">Sujet</label>
              <input id="sujet" name="sujet" type="text"
                defaultValue={apercuSujet?.texte ?? conv.sujet} />
            </div>

            <div className="champ">
              <label htmlFor="corps">Message</label>
              <textarea id="corps" name="corps" rows={10} required
                defaultValue={apercu?.texte ?? ""} />
            </div>

            {estClient && documents.length > 0 ? (
              <fieldset className="champ">
                <legend>Joindre un document</legend>
                {documents.map((d) => (
                  <label key={d.id} className="admin-case">
                    <input type="checkbox" name="document" value={d.id}
                      disabled={d.statut === "brouillon"} />
                    {d.type}{d.role_facture ? ` ${d.role_facture}` : ""}
                    {d.numero ? ` ${d.numero}` : ""}
                    {d.statut === "brouillon" ? (
                      /* ⚠️ UN BROUILLON NE S'ENVOIE PAS. Il n'a pas de numéro,
                         porte « SANS VALEUR », et n'engage personne. */
                      <span className="recap__note"> — brouillon, à émettre d&apos;abord</span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
            ) : null}

            <div className="admin-paiement__actions">
              {estClient ? (
                <button type="submit" className="btn" disabled={manquantes.length > 0}>
                  Envoyer au client
                </button>
              ) : null}
              <button type="submit" name="interne" value="1" className="btn btn--fantome">
                {estClient ? "Ajouter une note interne" : "Publier"}
              </button>
            </div>

            {estClient ? (
              <p className="recap__note">
                {repondreA
                  ? <>Les réponses reviendront ici, via <code>{repondreA}</code>.</>
                  : <><strong>Réception non configurée :</strong> la réponse du
                      client arrivera dans votre boîte habituelle, pas dans
                      JoksWed.</>}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </main>
  );
}
