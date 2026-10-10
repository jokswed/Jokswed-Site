import Link from "next/link";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { domaineReponse } from "@/lib/messagerie/adresses";

export const metadata = { title: "Paramètres — Messagerie" };
export const dynamic = "force-dynamic";

/* =============================================================================
   PARAMÈTRES → MESSAGERIE
   -----------------------------------------------------------------------------
   ⚠️ ON NE DEMANDE JAMAIS LE MOT DE PASSE D'UNE BOÎTE.

   Trois méthodes sont modélisées ; une seule fonctionne aujourd'hui, et
   l'écran le dit sans détour :

     · `brevo_partage` — OPÉRATIONNELLE. L'envoi passe par le compte Brevo de
       JoksWed, avec une adresse d'expéditeur que Brevo a vérifiée. Le
       collaborateur garde son identité professionnelle à l'affichage ; il ne
       confie aucun secret.

     · `oauth_gmail` / `oauth_outlook` — NON DISPONIBLES. Lire ou envoyer
       depuis une boîte Gmail exige des scopes « restricted » (gmail.send,
       gmail.readonly) : Google impose alors une vérification de l'application
       et une évaluation de sécurité annuelle par un tiers, à la charge de
       l'éditeur. Microsoft demande un consentement administrateur équivalent.
       Tant que ces démarches ne sont pas faites, proposer le bouton serait
       mentir. Le schéma les prévoit ; l'écran les affiche comme indisponibles.
   ============================================================================= */
const METHODES = {
  brevo_partage: {
    libelle: "Envoi via JoksWed (Brevo)",
    note: "Opérationnel. Votre adresse doit être vérifiée comme expéditeur chez Brevo.",
    disponible: true,
  },
  oauth_gmail: {
    libelle: "Connecter Gmail (OAuth)",
    note: "Indisponible : nécessite la vérification Google de l'application et une "
      + "évaluation de sécurité annuelle. Architecture prête, intégration non faite.",
    disponible: false,
  },
  oauth_outlook: {
    libelle: "Connecter Outlook (OAuth)",
    note: "Indisponible : nécessite un consentement administrateur Microsoft. "
      + "Architecture prête, intégration non faite.",
    disponible: false,
  },
};

export default async function ParametresMessagerie() {
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["message.envoyer"]);

  const identites = await acces.executer(async (q) => {
    const { rows } = await q(
      `SELECT id, adresse, nom_affiche, methode, statut, note, utilisateur_id
         FROM identites_messagerie WHERE entreprise_id = $1
        ORDER BY utilisateur_id NULLS FIRST, adresse`, [entreprise.id]);
    return rows;
  });

  async function declarer(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["message.envoyer"]);
    const adresse = String(formulaire.get("adresse") ?? "").trim().toLowerCase();
    const nom = String(formulaire.get("nom") ?? "").trim();
    const methode = String(formulaire.get("methode") ?? "brevo_partage");
    if (!adresse || !nom) return;

    /* ⚠️ UNE IDENTITÉ DÉCLARÉE N'EST PAS UNE IDENTITÉ VÉRIFIÉE.
       On la pose à `a_configurer` : tant que l'adresse n'est pas validée
       comme expéditeur chez Brevo, l'envoi échouerait. C'est le propriétaire
       qui la bascule en `active`, une fois la validation faite de son côté. */
    const statut = METHODES[methode]?.disponible ? "a_configurer" : "non_disponible";
    const personnelle = formulaire.get("personnelle") === "1";

    await a.executer((q) => q(
      `INSERT INTO identites_messagerie
         (entreprise_id, utilisateur_id, adresse, nom_affiche, methode, statut, note)
       VALUES ($1,$2,$3::citext,$4,$5,$6,$7)
       ON CONFLICT (entreprise_id, adresse)
         DO UPDATE SET nom_affiche = EXCLUDED.nom_affiche, methode = EXCLUDED.methode`,
      [e.id, personnelle ? s.utilisateurId : null, adresse, nom, methode, statut,
       METHODES[methode]?.disponible ? null : "intégration non disponible"]));
    revalidatePath("/admin/parametres/messagerie");
  }

  async function activer(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["entreprise.reglages"]);
    await a.executer((q) => q(
      `UPDATE identites_messagerie
          SET statut = $2, verifiee_le = CASE WHEN $2 = 'active' THEN now() END
        WHERE id = $1 AND entreprise_id = $3 AND methode = 'brevo_partage'`,
      [String(formulaire.get("identite")), String(formulaire.get("statut")), e.id]));
    revalidatePath("/admin/parametres/messagerie");
  }

  const domaine = domaineReponse();

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Messagerie</h1>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      <section className="admin-bloc">
        <h2 className="display t-carte">Réception des réponses</h2>
        {domaine ? (
          <p className="recap__note">
            Domaine de réception : <code>{domaine}</code>. Les réponses des
            clients reviennent dans la conversation d&apos;origine.
          </p>
        ) : (
          <div className="admin-alerte">
            <strong>Non configurée.</strong> Vos messages partent, mais les
            réponses n&apos;arrivent pas dans JoksWed.
          </div>
        )}
        {/* ⚠️ CE QUI RESTE À FAIRE À LA MAIN, ÉCRIT NOIR SUR BLANC.
            Ces trois points ne peuvent pas être automatisés depuis ici : ils
            touchent le DNS et le compte Brevo. */}
        <ol className="admin-etapes">
          <li>
            Choisir un <strong>sous-domaine distinct</strong> de celui qui envoie,
            par exemple <code>reply.jokswed.com</code>. Brevo refuse d&apos;utiliser
            le domaine d&apos;envoi.
          </li>
          <li>
            Ajouter deux enregistrements <strong>MX</strong> :
            priorité 10 → <code>inbound1.sendinblue.com.</code>, priorité 20 →{" "}
            <code>inbound2.sendinblue.com.</code>
          </li>
          <li>
            Créer le webhook Brevo (type <code>inbound</code>, événement{" "}
            <code>inboundEmailProcessed</code>) pointant vers{" "}
            <code>/api/entrant/brevo/&lt;secret&gt;</code>, puis renseigner{" "}
            <code>JOKSWED_DOMAINE_REPONSE</code> et{" "}
            <code>JOKSWED_WEBHOOK_ENTRANT</code>.
          </li>
        </ol>
        <p className="recap__note">
          Brevo ne signe pas ses webhooks : le secret dans l&apos;URL est ce qui
          authentifie l&apos;appel. Il doit être long et ne jamais circuler
          ailleurs.
        </p>
      </section>

      <section className="admin-bloc">
        <h2 className="display t-carte">Identités d&apos;envoi</h2>
        {identites.length === 0 ? (
          <p className="recap__note">Aucune identité déclarée.</p>
        ) : (
          <ul className="admin-liste">
            {identites.map((i) => (
              <li key={i.id} style={{ flexWrap: "wrap" }}>
                <strong>{i.nom_affiche}</strong>
                <span>{i.adresse}</span>
                <span>{METHODES[i.methode]?.libelle ?? i.methode}</span>
                <span className={`admin-pastille${i.statut === "active" ? " admin-pastille--emis" : ""}`}>
                  {i.statut === "active" ? "active"
                    : i.statut === "a_configurer" ? "à vérifier chez Brevo"
                    : "indisponible"}
                </span>
                <span>{i.utilisateur_id ? "personnelle" : "entreprise"}</span>
                {i.note ? <span style={{ flexBasis: "100%" }}>{i.note}</span> : null}
                {i.methode === "brevo_partage"
                  && acces.permissions.has("entreprise.reglages") ? (
                  <form action={activer} style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="identite" value={i.id} />
                    <input type="hidden" name="statut"
                      value={i.statut === "active" ? "a_configurer" : "active"} />
                    <button type="submit" className="btn btn--fantome btn--petit">
                      {i.statut === "active" ? "Désactiver" : "Marquer vérifiée"}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form action={declarer} className="formulaire" style={{ marginTop: "1.2rem" }}>
          <div className="admin-grille-champs">
            <div className="champ">
              <label htmlFor="nom">Nom affiché</label>
              <input id="nom" name="nom" type="text" required
                defaultValue={entreprise.nom_commercial} />
            </div>
            <div className="champ">
              <label htmlFor="adresse">Adresse d&apos;expédition</label>
              <input id="adresse" name="adresse" type="email" required />
            </div>
            <div className="champ pleine">
              <label htmlFor="methode">Méthode</label>
              <select id="methode" name="methode" defaultValue="brevo_partage">
                {/* ⚠️ `disabled`, PAS SEULEMENT UN LIBELLÉ.
                    Une option qu'on peut choisir laisse croire qu'elle
                    fonctionne ; on la laisse visible pour dire qu'elle
                    existe, et insélectionnable pour dire qu'elle n'est pas
                    prête. */}
                {Object.entries(METHODES).map(([cle, m]) => (
                  <option key={cle} value={cle} disabled={!m.disponible}>
                    {m.libelle}{m.disponible ? "" : " — indisponible"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="admin-case">
            <input type="checkbox" name="personnelle" value="1" />
            Identité personnelle (visible de moi seul)
          </label>
          <p className="recap__note">
            {METHODES.oauth_gmail.note}
          </p>
          <button type="submit" className="btn btn--bloc">Déclarer cette identité</button>
        </form>
      </section>
    </main>
  );
}
