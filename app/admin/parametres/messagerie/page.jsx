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
/* ⚠️ CORRECTION D'UNE AFFIRMATION ANTÉRIEURE.
   On a d'abord écrit que connecter Gmail exigeait une évaluation de
   sécurité annuelle (CASA). C'est vrai pour LIRE une boîte, pas pour
   envoyer. Google classe `gmail.send` comme scope SENSIBLE : vérification
   de l'application, sans évaluation de sécurité ni frais. Les scopes de
   LECTURE (`gmail.readonly`, `gmail.modify`, `gmail.compose`) sont
   RESTREINTS : évaluation annuelle par un tiers agréé, quelques centaines à
   quelques milliers d'euros par an, et environ six semaines.

   Conséquence concrète pour Yvann :
     · envoyer depuis son Gmail — faisable, à condition de monter un projet
       Google Cloud, un écran de consentement, une politique de
       confidentialité publique et de passer la vérification (~10 jours
       ouvrés). Rien de tout cela n'est fait ;
     · synchroniser sa boîte pour y LIRE les réponses — hors de portée tant
       qu'on n'engage pas l'évaluation annuelle.

   On ne propose donc ni l'un ni l'autre aujourd'hui, et on dit pourquoi. */
const METHODES = {
  brevo_partage: {
    libelle: "Envoi via JoksWed (Brevo)",
    note: "Opérationnel. Les messages partent de contact@jokswed.com, signés de "
      + "votre nom. Les réponses reviennent dans JoksWed si la réception est "
      + "configurée, sinon dans la boîte indiquée ci-dessous.",
    disponible: true,
  },
  oauth_gmail: {
    libelle: "Envoyer depuis mon Gmail (OAuth)",
    note: "Pas encore disponible. `gmail.send` est un scope sensible : il "
      + "demande un projet Google Cloud, un écran de consentement, une "
      + "politique de confidentialité publique et une vérification Google "
      + "(~10 jours ouvrés). Sans frais, mais non engagé. L'architecture est "
      + "prête ; l'intégration ne l'est pas.",
    disponible: false,
  },
  oauth_outlook: {
    libelle: "Envoyer depuis mon Outlook (OAuth)",
    note: "Pas encore disponible : consentement administrateur Microsoft requis.",
    disponible: false,
  },
};

export default async function ParametresMessagerie() {
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["message.envoyer"]);

  const identites = await acces.executer(async (q) => {
    const { rows } = await q(
      `SELECT id, adresse, nom_affiche, methode, statut, note, utilisateur_id,
              reponse_vers, signature
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
    /* ⚠️ LA BOÎTE DE RÉPONSE DOIT EXISTER VRAIMENT.
       C'est là qu'arrivent les réponses tant que la réception intégrée
       n'est pas configurée. Y mettre une adresse d'expédition sans boîte
       derrière, c'est perdre le courrier des clients. */
    const reponse = String(formulaire.get("reponse_vers") ?? "").trim().toLowerCase() || null;
    const signature = String(formulaire.get("signature") ?? "").trim() || null;

    await a.executer((q) => q(
      `INSERT INTO identites_messagerie
         (entreprise_id, utilisateur_id, adresse, nom_affiche, methode, statut,
          note, reponse_vers, signature)
       VALUES ($1,$2,$3::citext,$4,$5,$6,$7,$8::citext,$9)
       ON CONFLICT (entreprise_id, adresse)
         DO UPDATE SET nom_affiche = EXCLUDED.nom_affiche, methode = EXCLUDED.methode,
                       reponse_vers = EXCLUDED.reponse_vers,
                       signature = EXCLUDED.signature`,
      [e.id, personnelle ? s.utilisateurId : null, adresse, nom, methode, statut,
       METHODES[methode]?.disponible ? null : "intégration non disponible",
       reponse, signature]));
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
                <span>réponses → {i.reponse_vers ?? "non configurée"}</span>
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
            <div className="champ">
              <label htmlFor="reponse_vers">Boîte qui reçoit les réponses</label>
              <input id="reponse_vers" name="reponse_vers" type="email"
                placeholder="votre@gmail.com" />
            </div>
            <div className="champ">
              <label htmlFor="signature">Signature ajoutée à vos messages</label>
              <input id="signature" name="signature" type="text"
                placeholder="Yvann Cretinoir — Vidéaste" />
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
            <strong>Connecter mon adresse e-mail.</strong>{" "}
            {METHODES.oauth_gmail.note}
          </p>
          <p className="recap__note">
            En attendant : vos messages partent de{" "}
            <code>contact@jokswed.com</code>, signés de votre nom, et les
            réponses arrivent dans la boîte que vous indiquez ci-dessus.
            Vous pouvez y répondre directement — mais cette réponse-là ne
            remontera pas dans JoksWed.
          </p>
          <button type="submit" className="btn btn--bloc">Déclarer cette identité</button>
        </form>
      </section>
    </main>
  );
}
