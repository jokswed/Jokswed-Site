import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { engendrerJetonConversation, domaineReponse } from "@/lib/messagerie/adresses";

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
      `SELECT id, reference, contact_nom, contact_email FROM demandes
        WHERE entreprise_destinataire_id = $1 ORDER BY cree_le DESC LIMIT 50`,
      [entreprise.id]);
    const { rows: [orphelins] } = await q(
      "SELECT count(*)::int n FROM messages_orphelins WHERE traite_le IS NULL");
    return { conversations, demandes, orphelins: orphelins?.n ?? 0 };
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
      /* Le client vient du dossier, pas d'une saisie libre : on n'écrit pas
         à une adresse que personne n'a vérifiée. */
      let email = null;
      let nom = null;
      if (nature === "client" && demande) {
        const { rows } = await q(
          "SELECT contact_email, contact_nom FROM demandes WHERE id = $1", [demande]);
        email = rows[0]?.contact_email ?? null;
        nom = rows[0]?.contact_nom ?? null;
      }
      if (nature === "client" && !email) return null;
      const { rows } = await q(
        "SELECT app.ouvrir_conversation($1,$2,$3,$4,$5,NULL,$6::citext,$7) AS id",
        [e.id, nature, sujet, engendrerJetonConversation(), demande, email, nom]);
      return rows[0]?.id ?? null;
    });
    if (id) redirect(`/admin/messagerie/${id}`);
    revalidatePath("/admin/messagerie");
  }

  const { conversations, demandes, orphelins } = donnees;
  const demandeInitiale = demandes.find((d) => d.id === demandePreferee) ?? null;
  const totalNonLus = conversations.reduce((t, c) => t + c.non_lus, 0);
  const receptionPrete = Boolean(domaineReponse());

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Messagerie</h1>
          <p className="recap__note">
            {conversations.length} conversation(s)
            {totalNonLus > 0 ? ` · ${totalNonLus} message(s) non lu(s)` : null}
          </p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
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

      {conversations.length === 0 ? (
        <p className="recap__note" style={{ marginTop: "1.5rem" }}>
          {recherche ? "Aucune conversation ne correspond." : "Aucune conversation."}
        </p>
      ) : (
        <ul className="admin-conversations">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/messagerie/${c.id}`}
                className={`admin-conv${c.non_lus > 0 ? " admin-conv--neuve" : ""}`}>
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
              </Link>
            </li>
          ))}
        </ul>
      )}

      {acces.permissions.has("message.envoyer") ? (
        <section className="admin-bloc" style={{ marginTop: "2rem" }}>
          <h2 className="display t-carte">Nouvelle conversation</h2>
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
                  defaultValue={demandeInitiale ? `Votre demande ${demandeInitiale.reference}` : ""}
                  placeholder="Votre mariage du 13 juin" />
              </div>
            </div>
            <p className="recap__note">
              Une conversation <strong>client</strong> exige un dossier : son
              adresse en est tirée, jamais saisie à la main.
            </p>
            <button type="submit" className="btn btn--bloc">Ouvrir</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
