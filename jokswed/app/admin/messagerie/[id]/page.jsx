import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { adresseReponse, domaineReponse } from "@/lib/messagerie/adresses";
import { substituer, tableDeSubstitution, texteVersHtml } from "@/lib/messagerie/modeles";
import { drainer } from "@/lib/demandes/drain";
import Retour from "@/components/admin/Retour";
import ActualiserMessagerie from "@/components/admin/ActualiserMessagerie";
import SaisieMessagerie from "@/components/admin/SaisieMessagerie";

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
function jourParis(instant) {
  return new Date(instant).toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris", weekday: "long", day: "numeric",
    month: "long", year: "numeric",
  });
}
function heureParis(instant) {
  return new Date(instant).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit",
  });
}
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
    const { rows: discussions } = await q(
      "SELECT * FROM app.mes_conversations($1,false,NULL)", [entreprise.id]);
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
    return { conv: conv[0], fil, discussions, participants, invitables, modeles, documents,
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

    if (!interne) {
      after(async () => {
        try {
          await drainer();
        } catch (erreur) {
          console.error(
            `[messagerie] drain différé : ${erreur instanceof Error ? erreur.name : "erreur"}`,
          );
        }
      });
    }
    revalidatePath(`/admin/messagerie/${id}`);
    revalidatePath("/admin/messagerie");
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

  const { conv, fil, discussions, participants, invitables, modeles, documents, identites,
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
    <main className="admin-page admin-chat-page">
      <div className="admin-chat-layout">
        <aside className="admin-chat-sidebar" aria-label="Discussions">
          <Link href="/admin/messagerie" className="admin-chat-sidebar__retour">Discussions</Link>
          <ul className="admin-chat-contacts">
            {discussions.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/messagerie/${c.id}`}
                  aria-current={c.id === id ? "page" : undefined}
                  className={`admin-chat-contact${c.id === id ? " admin-chat-contact--active" : ""}`}>
                  <span className="admin-conv__avatar" aria-hidden="true">
                    {(c.client_nom ?? c.participants[0] ?? "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="admin-chat-contact__detail">
                    <strong>{c.client_nom ?? c.participants.join(", ")}</strong>
                    <small>{c.apercu ?? c.sujet}</small>
                  </span>
                  {c.non_lus > 0 ? <span className="admin-chat-contact__nonlus">{c.non_lus}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <section className="admin-chat-main" aria-label="Conversation active">
          <ActualiserMessagerie dernierMessage={fil.at(-1)?.id ?? null} />
      <header className="admin-entete admin-chat-topbar">
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
        {/* ⚠️ CETTE PAGE N'AVAIT AUCUN RETOUR. Le seul chemin vers la liste
            était le petit lien « Messagerie » du suréveillant, au-dessus du
            titre — invisible au pouce. */}
        <div className="admin-actions">
          <Retour vers="/admin/messagerie" />
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

      <ol className="admin-fil admin-chat-thread" aria-label="Historique de la conversation">
        {fil.map((m, i) => (
          <Fragment key={m.id}>
            {i === 0 || jourParis(fil[i - 1].cree_le) !== jourParis(m.cree_le) ? (
              <li className="admin-chat-date" role="separator">{jourParis(m.cree_le)}</li>
            ) : null}
            <li className={`admin-chat-message admin-chat-message--${m.sens}${m.sens === "entrant" && !m.lu ? " admin-chat-message--neuf" : ""}`}>
              <div className="admin-chat-bulle">
                <div className="admin-chat-bulle__entete">
                  {m.sens === "interne" ? "Note interne" : m.sens === "entrant"
                    ? (m.auteur_nom ?? m.auteur_email ?? "Client")
                    : "Vous"}
                </div>
                <div className="admin-chat-bulle__texte">
                  {m.corps_texte.split("\n").map((ligne, ligneIndex) => (
                    <p key={ligneIndex}>{ligne || " "}</p>
                  ))}
                </div>
                {m.pieces?.length > 0 ? (
                  <div className="admin-chat-bulle__pieces">
                    {m.pieces.map((p) => (
                      <a key={p.id} className="admin-chat-piece"
                        href={p.origine === "document"
                          ? `/api/admin/documents/${p.document_id}/pdf`
                          : `/api/admin/pieces/${p.id}`}>
                        <span aria-hidden="true">📎</span> {p.nom}
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="admin-chat-bulle__pied">
                  <time dateTime={new Date(m.cree_le).toISOString()}>{heureParis(m.cree_le)}</time>
                  <span>{m.sens === "entrant" ? "Reçu"
                    : m.sens === "interne" ? "Privé"
                    : m.statut === "envoye" ? "Envoyé"
                    : m.statut === "en_attente" ? "En attente"
                    : m.statut === "echoue" ? "Échec d’envoi" : m.statut}</span>
                </div>
                {m.erreur ? <p className="admin-chat-bulle__erreur">{m.erreur}</p> : null}
              </div>
            </li>
          </Fragment>
        ))}
        {fil.length === 0 ? (
          <li className="admin-chat-vide">Commencez la conversation en envoyant un message.</li>
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
        <section className="admin-chat-composer" aria-label="Répondre à la conversation">
          <div className="admin-chat-composer__haut">
            <span className="admin-chat-composer__titre">Message</span>
            <details className="admin-chat-options" open={Boolean(modeleChoisi)}>
              <summary>Modèles de réponse</summary>
              <nav className="admin-filtres" aria-label="Modèles de réponse">
                <Link className={`admin-puce${!modeleChoisi ? " admin-puce--active" : ""}`}
                  href={`/admin/messagerie/${id}`}>Message libre</Link>
                {modeles.map((m) => (
                  <Link key={m.id}
                    className={`admin-puce${modeleChoisi?.cle === m.cle ? " admin-puce--active" : ""}`}
                    href={`/admin/messagerie/${id}?modele=${encodeURIComponent(m.cle)}`}>{m.libelle}</Link>
                ))}
              </nav>
            </details>
          </div>

          {manquantes.length > 0 ? (
            <div className="admin-alerte" role="alert">
              <strong>Informations manquantes :</strong>{" "}
              {manquantes.map((c) => `{{${c}}}`).join(", ")}.
              Complétez le dossier avant d'envoyer ce modèle.
            </div>
          ) : null}

          <form action={envoyer} className="admin-chat-form">
            <SaisieMessagerie
              key={modeleChoisi?.cle ?? "message-libre"}
              initial={apercu?.texte ?? ""}
              bloquee={manquantes.length > 0}
              interneSeulement={!estClient}
            />

            <div className="admin-chat-composer__actions">
              {estClient ? (
                <button type="submit" name="interne" value="1"
                  className="admin-chat-note"
                  disabled={manquantes.length > 0}>
                  + Note interne
                </button>
              ) : null}
              <details className="admin-chat-avance">
                <summary>Options d'envoi</summary>
                <div className="admin-chat-avance__champs">
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
                    <label htmlFor="sujet">Sujet de l'e-mail</label>
                    <input id="sujet" name="sujet" type="text"
                      defaultValue={apercuSujet?.texte ?? conv.sujet} />
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
                          {d.statut === "brouillon" ? " — brouillon indisponible" : ""}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </div>
              </details>
            </div>
          </form>
          {estClient ? (
            <p className="admin-chat-reception">
              {repondreA ? "Les réponses des clients apparaîtront automatiquement ici."
                : "Réception intégrée non configurée : les réponses arriveront dans votre boîte e-mail."}
            </p>
          ) : null}
        </section>
      ) : null}
        </section>
      </div>
    </main>
  );
}
