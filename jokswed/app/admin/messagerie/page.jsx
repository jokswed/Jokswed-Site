import Retour from "@/components/admin/Retour";
import ActualiserMessagerie from "@/components/admin/ActualiserMessagerie";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { engendrerJetonConversation, domaineReponse } from "@/lib/messagerie/adresses";
import { ouvrirConversationDemande } from "@/lib/messagerie/ouvrir-demande";

export const metadata = { title: "Messagerie" };
export const dynamic = "force-dynamic";

/* =============================================================================
   MESSAGERIE — LISTE DES CONVERSATIONS
   -----------------------------------------------------------------------------
   ⚠️ TROIS NATURES, TROIS COULEURS, ET AUCUNE AMBIGUÏTÉ.

   Une conversation « client » envoie de vrais e-mails. Une « partagée »
   réunit des prestataires. Une « interne » ne quitte jamais l'entreprise.
   La nature est figée à la création : on n'ajoute pas un client à une note
   interne, on ouvre une autre conversation. C'est la base qui le refuse.
   ============================================================================= */
const NATURES = {
  client: { libelle: "Client", note: "Les messages partent par e-mail." },
  partagee: { libelle: "Partagée", note: "Entre prestataires. Rien n'en sort." },
  interne: { libelle: "Interne", note: "Votre entreprise seule. Rien n'en sort." },
};

function quand(iso) {
  const d = new Date(iso);
  const jours = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (jours === 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (jours === 1) return "hier";
  if (jours < 7) return `il y a ${jours} j`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export default async function Messagerie({ searchParams }) {
  const params = await searchParams;
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["message.lire"]);

  const recherche = String(params?.q ?? "").trim();
  const archivees = params?.vue === "archivees";
  const demandePreferee = typeof params?.demande === "string" ? params.demande : "";

  const donnees = await acces.executer(async (q) => {
    const { rows: conversations } = await q(
      "SELECT * FROM app.mes_conversations($1,$2,$3)",
      [entreprise.id, archivees, recherche || null]);
    const { rows: demandes } = await q(
      `SELECT id, reference, contact_nom, contact_email, message, cree_le
          FROM demandes WHERE entreprise_destinataire_id = $1
          ORDER BY cree_le DESC LIMIT 100`,
      [entreprise.id]);
    const { rows: conversationsExistantes } = await q(
      `SELECT DISTINCT demande_id FROM conversations
        WHERE entreprise_id = $1 AND nature = 'client' AND demande_id IS NOT NULL`,
      [entreprise.id]);
    const { rows: [orphelins] } = await q(
      "SELECT count(*)::int n FROM messages_orphelins WHERE traite_le IS NULL");
    return { conversations, demandes, conversationsExistantes, orphelins: orphelins?.n ?? 0 };
  });

  async function ouvrir(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["message.envoyer"]);
    const nature = String(formulaire.get("nature") ?? "client");
    const sujet = String(formulaire.get("sujet") ?? "").trim();
    if (!sujet) return;
    const demande = String(formulaire.get("demande") ?? "") || null;

    const id = await a.executer(async (q) => {
      if (nature === "client") {
        return ouvrirConversationDemande(q, e.id, demande);
      }
      const { rows } = await q(
        "SELECT app.ouvrir_conversation($1,$2,$3,$4,$5,NULL,NULL::citext,NULL) AS id",
        [e.id, nature, sujet, engendrerJetonConversation(), demande]);
      return rows[0]?.id ?? null;
    });
    if (id) redirect(`/admin/messagerie/${id}`);
    revalidatePath("/admin/messagerie");
  }

  const { conversations, demandes, conversationsExistantes, orphelins } = donnees;
  const dejaLiees = new Set(conversationsExistantes.map((c) => c.demande_id));
  const demandesSansFil = archivees ? [] : demandes.filter((d) =>
    d.message?.trim() && !dejaLiees.has(d.id) &&
    (!recherche || [d.reference, d.contact_nom, d.contact_email, d.message]
      .some((valeur) => String(valeur ?? "").toLowerCase().includes(recherche.toLowerCase())))
  );
  const demandeInitiale = demandes.find((d) => d.id === demandePreferee) ?? null;
  const totalNonLus = conversations.reduce((t, c) => t + c.non_lus, 0);
  const receptionPrete = Boolean(domaineReponse());

  return (
    <main className="admin-page admin-chat-index">
      <ActualiserMessagerie />
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Messagerie</h1>
          <p className="recap__note">
            {conversations.length + demandesSansFil.length} discussion(s)
            {totalNonLus > 0 ? ` · ${totalNonLus} message(s) non lu(s)` : null}
          </p>
        </div>
        <Retour vers="/admin" />
      </header>

      {/* ⚠️ ON NE LAISSE PAS CROIRE QUE LA RÉCEPTION MARCHE.
          Sans domaine de réception configuré, on écrit très bien au client —
          mais sa réponse n'arrive nulle part. Le dire ici vaut mieux que de
          le découvrir en attendant une réponse qui ne viendra jamais. */}
      {!receptionPrete ? (
        <div className="admin-alerte">
          <strong>Réception non configurée.</strong> Vos messages partent, mais
          les réponses des clients n&apos;arriveront pas dans JoksWed tant que le
          sous-domaine de réception et ses enregistrements MX ne sont pas en
          place. Voir <Link href="/admin/parametres/messagerie">Paramètres →
          Messagerie</Link>.
        </div>
      ) : null}

      {orphelins > 0 && acces.permissions.has("entreprise.reglages") ? (
        <p className="recap__note">
          {orphelins} message(s) reçu(s) n&apos;ont pas pu être rattachés à une
          conversation. Ils sont conservés en quarantaine plutôt que rattachés
          au hasard.
        </p>
      ) : null}

      <form method="get" className="admin-ligne-actions" style={{ marginTop: "1.2rem" }}>
        <input type="search" name="q" defaultValue={recherche}
          placeholder="Rechercher un nom, une adresse, un mot…"
          aria-label="Rechercher dans les conversations" />
        {archivees ? <input type="hidden" name="vue" value="archivees" /> : null}
        <button type="submit" className="btn btn--fantome">Chercher</button>
      </form>

      <nav className="admin-filtres" aria-label="Affichage">
        <Link className={`admin-puce${!archivees ? " admin-puce--active" : ""}`}
          href={`/admin/messagerie${recherche ? `?q=${encodeURIComponent(recherche)}` : ""}`}>
          En cours
        </Link>
        <Link className={`admin-puce${archivees ? " admin-puce--active" : ""}`}
          href={`/admin/messagerie?vue=archivees${recherche ? `&q=${encodeURIComponent(recherche)}` : ""}`}>
          Archivées
        </Link>
      </nav>

      {conversations.length === 0 && demandesSansFil.length === 0 ? (
        <p className="recap__note" style={{ marginTop: "1.5rem" }}>
          {recherche ? "Aucune conversation ne correspond." : "Aucune conversation."}
        </p>
      ) : (
        <ul className="admin-conversations">
          {demandesSansFil.map((d) => (
            <li key={d.id}>
              <form action={ouvrir} className="admin-chat-demande-form">
                <input type="hidden" name="nature" value="client" />
                <input type="hidden" name="demande" value={d.id} />
                <input type="hidden" name="sujet"
                  value={`Votre demande de mariage ${d.reference} — JoksWed`} />
                <button type="submit" className="admin-conv admin-conv--neuve admin-chat-demande"
                  aria-label={`Ouvrir la demande de ${d.contact_nom}`}>
                  <span className="admin-conv__avatar" aria-hidden="true">
                    {d.contact_nom.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="admin-conv__contenu">
                    <span className="admin-conv__haut">
                      <strong className="admin-conv__nom">{d.contact_nom}</strong>
                      <span className="admin-conv__quand">{quand(d.cree_le)}</span>
                    </span>
                    <span className="admin-conv__sujet">{d.reference} · Nouvelle demande</span>
                    <span className="admin-conv__apercu">{d.message}</span>
                    <span className="admin-conv__bas">
                      <span className="admin-pastille admin-pastille--non_lue">À répondre</span>
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/messagerie/${c.id}`}
                className={`admin-conv${c.non_lus > 0 ? " admin-conv--neuve" : ""}`}>
                <span className="admin-conv__avatar" aria-hidden="true">
                  {(c.client_nom ?? c.participants[0] ?? "?").trim().charAt(0).toUpperCase()}
                </span>
                <span className="admin-conv__contenu">
                <span className="admin-conv__haut">
                  <strong className="admin-conv__nom">
                    {c.client_nom ?? c.participants.join(", ")}
                  </strong>
                  <span className="admin-conv__quand">{quand(c.derniere_activite_le)}</span>
                </span>
                <span className="admin-conv__sujet">{c.sujet}</span>
                {c.apercu ? <span className="admin-conv__apercu">{c.apercu}</span> : null}
                <span className="admin-conv__bas">
                  <span className={`admin-pastille admin-pastille--${c.nature}`}>
                    {NATURES[c.nature]?.libelle ?? c.nature}
                  </span>
                  {c.reference ? <span className="admin-pastille">{c.reference}</span> : null}
                  {c.non_lus > 0 ? (
                    <span className="admin-pastille admin-pastille--non_lue">
                      {c.non_lus} non lu(s)
                    </span>
                  ) : null}
                </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {acces.permissions.has("message.envoyer") ? (
        <details className="admin-bloc admin-chat-nouveau" open={Boolean(demandeInitiale)}>
          <summary>+ Nouvelle discussion</summary>
          <form action={ouvrir} className="formulaire">
            <div className="admin-grille-champs">
              <div className="champ">
                <label htmlFor="nature">Nature</label>
                <select id="nature" name="nature" defaultValue="client">
                  {Object.entries(NATURES).map(([cle, n]) => (
                    <option key={cle} value={cle}>{n.libelle} — {n.note}</option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label htmlFor="demande">Dossier</label>
                <select id="demande" name="demande" defaultValue={demandeInitiale?.id ?? ""}>
                  <option value="">— aucun —</option>
                  {demandes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.reference} · {d.contact_nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ pleine">
                <label htmlFor="sujet">Sujet</label>
                <input id="sujet" name="sujet" type="text" required
                  defaultValue={demandeInitiale ? `Votre demande de mariage ${demandeInitiale.reference} — JoksWed` : ""}
                  placeholder="Votre mariage du 13 juin" />
              </div>
            </div>
            <p className="recap__note">
              Une conversation <strong>client</strong> exige un dossier : son
              adresse en est tirée, jamais saisie à la main.
            </p>
            <button type="submit" className="btn btn--bloc">Ouvrir</button>
          </form>
        </details>
      ) : null}
    </main>
  );
}
