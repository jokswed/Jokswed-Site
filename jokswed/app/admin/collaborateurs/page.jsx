import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces, interdireAutoModification } from "@/lib/auth/acces";
import { chiffrer, engendrerJeton, hacherJeton } from "@/lib/auth/secrets";

export const metadata = { title: "Collaborateurs" };
export const dynamic = "force-dynamic";

/* Les métiers que la contrainte de `entreprises.service_partenaire` accepte :
   une valeur absente d'ici serait refusée EN BASE, pas ici. */
const SERVICES = [
  ["photobooth", "Photobooth"],
  ["videaste", "Vidéaste"],
  ["photographe", "Photographe"],
  ["second_shooter", "Second shooter"],
  ["autre", "Autre"],
];

/* ⚠️ PRÉPARER ET ENVOYER SONT DEUX GESTES DISTINCTS.

   « Préparer » crée l'invitation en base — jeton haché, jeton chiffré au
   repos, expiration — et s'arrête là : `envoyee_le` reste nul, rien ne part.
   « Envoyer » met un événement en file ; le drain compose le lien, l'envoie,
   puis EFFACE le jeton chiffré. Après cela, la base n'en garde qu'une
   empreinte, et renvoyer le lien exige d'en régénérer un.

   Cette séparation n'est pas de la prudence décorative : c'est elle qui
   garantit qu'aucun e-mail ne part pour une transaction annulée, et qu'une
   panne du fournisseur ne fait pas disparaître l'invitation. */
const DUREE_INVITATION_JOURS = 7;

export default async function Collaborateurs() {
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["membre.inviter"]);

  const donnees = await acces.executer(async (q) => {
    const { rows: membres } = await q(
      `SELECT m.id, m.ajoute_le, m.retire_le, m.suspendu_le, m.motif_suspension,
              u.id AS utilisateur_id, u.prenom, u.nom, u.email, u.desactive_le,
              coalesce(string_agg(DISTINCT r.libelle, ', '), '—') AS roles,
              (SELECT count(*)::int FROM affectations a
                WHERE a.utilisateur_id = u.id AND a.entreprise_id = m.entreprise_id
                  AND a.retiree_le IS NULL) AS affectations
         FROM membres m
         JOIN utilisateurs u ON u.id = m.utilisateur_id
         LEFT JOIN membres_roles mr ON mr.membre_id = m.id
         LEFT JOIN roles r ON r.id = mr.role_id
        WHERE m.entreprise_id = $1
        GROUP BY m.id, u.id ORDER BY m.retire_le NULLS FIRST, u.nom`,
      [entreprise.id]);
    const { rows: invitations } = await q(
      `SELECT id, email, prenom, nom, cree_le, expire_le, envoyee_le, utilisee_le, revoquee_le
         FROM invitations WHERE entreprise_id = $1 ORDER BY cree_le DESC`,
      [entreprise.id]);
    const { rows: roles } = await q(
      "SELECT id, cle, libelle, description FROM roles WHERE entreprise_id = $1 ORDER BY libelle",
      [entreprise.id]);
    const { rows: journal } = await q(
      `SELECT j.action, j.horodatage, j.ressource_type, u.prenom, u.nom
         FROM journal_audit j LEFT JOIN utilisateurs u ON u.id = j.acteur_id
        WHERE j.entreprise_id = $1
          AND j.action IN ('invitation.creee','invitation.envoyee','invitation.revoquee',
                           'invitation.acceptee','membre.suspendu','membre.reactive',
                           'membre.revoque','membre.permissions','membre.roles')
        ORDER BY j.horodatage DESC LIMIT 25`, [entreprise.id]);
    /* Les entreprises partenaires que je parraine. Pas un `SELECT … FROM
       entreprises` : la politique ne rendrait que les miennes, et élargir la
       politique exposerait SIRET, adresse et IBAN chiffré pour afficher un
       nom (palier 012). La fonction rend trois champs. */
    const partenaires = acces.permissions.has("collaboration.proposer")
      ? (await q("SELECT * FROM app.partenaires_disponibles($1)", [entreprise.id])).rows
      : [];
    return { membres, invitations, roles, journal, partenaires };
  });

  async function preparerInvitation(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.inviter"]);

    const email = String(formulaire.get("email") ?? "").trim().toLowerCase();
    const roleId = String(formulaire.get("role") ?? "");
    if (!email || !roleId) return;

    /* Le jeton en clair n'est PAS stocké : seule son empreinte l'est. Le lien
       n'existera donc que dans l'e-mail, le jour où il sera envoyé. */
    const jeton = engendrerJeton();

    /* ⚠️ APPEL DE FONCTION, PAS D'INSERT DIRECT.
       Depuis le palier 008, `jokswed_app` n'a plus le droit d'écrire dans
       `invitations` : la permission `membre.inviter` et l'appartenance à
       l'entreprise sont vérifiées EN BASE, et la trace d'audit est posée
       dans la même transaction que l'écriture. */
    /* ⚠️ LE JETON EST CHIFFRÉ, PAS STOCKÉ EN CLAIR.
       L'envoi se fera plus tard, depuis le drain, où le jeton n'existera
       plus. On le conserve donc chiffré (AES-256-GCM, clé hors base) le temps
       de l'envoi — après quoi le drain l'efface. */
    await a.executer((q) =>
      q(`SELECT app.admin_creer_invitation($1,$2,$3,$4,$5,ARRAY[$6]::uuid[],$7,$8)`,
        [e.id, email, String(formulaire.get("prenom") ?? "") || null,
         String(formulaire.get("nom") ?? "") || null, hacherJeton(jeton), roleId,
         DUREE_INVITATION_JOURS, chiffrer(jeton)]));
    revalidatePath("/admin/collaborateurs");
  }

  async function revoquerMembre(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.revoquer"]);
    const cible = String(formulaire.get("utilisateur") ?? "");

    /* Vérification applicative CONSERVÉE : elle donne un message clair avant
       d'atteindre la base. Mais elle n'est plus la seule — `app.exiger()`
       refuse la même chose côté PostgreSQL, hors de portée du code. */
    interdireAutoModification(s.utilisateurId, cible);

    await a.executer(async (q) => {
      const { rows } = await q(
        `SELECT id FROM membres
          WHERE entreprise_id = $1 AND utilisateur_id = $2 AND retire_le IS NULL`,
        [e.id, cible]);
      if (!rows[0]) return;
      /* Les sessions ouvertes du collaborateur tombent d'elles-mêmes : sans
         adhésion active, `entreprises_de_lacteur()` rend un tableau vide et
         il ne voit plus rien dès la requête suivante. Vérifié au banc. */
      await q("SELECT app.admin_revoquer_membre($1)", [rows[0].id]);
    });
    revalidatePath("/admin/collaborateurs");
  }

  /* ⚠️ SE RETIRER SOI-MÊME EST TOUJOURS PERMIS.
     Le geste ne fait que RÉDUIRE ses propres droits ; `exigerAcces` sans
     permission suffit donc. La base refuse en revanche de laisser une
     entreprise sans personne pour l'administrer. */
  async function quitterEntreprise() {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    await a.executer((q) => q("SELECT app.quitter_entreprise($1)", [e.id]));
    redirect("/admin");
  }

  async function envoyerInvitation(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.inviter"]);
    await a.executer((q) => q("SELECT app.admin_envoyer_invitation($1)",
      [String(formulaire.get("invitation"))]));
    revalidatePath("/admin/collaborateurs");
  }

  async function revoquerInvitation(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.inviter"]);
    await a.executer((q) => q("SELECT app.admin_revoquer_invitation($1)",
      [String(formulaire.get("invitation"))]));
    revalidatePath("/admin/collaborateurs");
  }

  async function suspendre(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.revoquer"]);
    await a.executer((q) => q("SELECT app.admin_suspendre_membre($1,$2,$3)",
      [String(formulaire.get("membre")), formulaire.get("suspendre") === "1",
       String(formulaire.get("motif") ?? "").trim() || null]));
    revalidatePath("/admin/collaborateurs");
  }

  async function definirRoles(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["role.gerer"]);
    const cible = String(formulaire.get("utilisateur") ?? "");
    /* Double garde : applicative pour le message, et `app.exiger(…, cible)`
       en base, hors de portée du code. */
    interdireAutoModification(s.utilisateurId, cible);
    const roles = formulaire.getAll("role").map(String).filter(Boolean);
    await a.executer((q) => q("SELECT app.admin_definir_roles($1,$2::uuid[])",
      [String(formulaire.get("membre")), roles]));
    revalidatePath("/admin/collaborateurs");
  }

  /* ── Un prestataire extérieur ──
     ⚠️ CE N'EST PAS UN MEMBRE DE PLUS : C'EST UNE ENTREPRISE À PART.
     Un vidéaste ou un prestataire photobooth ne doit PAS devenir membre de
     JoksWed — il verrait alors tous les dossiers, toutes les demandes et tous
     les montants, puisque la RLS cloisonne par entreprise et non par
     affectation. On lui crée donc SA structure : il ne voit que les dossiers
     qu'on lui confie, et aucun de mes chiffres.

     ⚠️ ET LA CRÉATION NE TRANSMET AUCUN DOSSIER.
     Elle ouvre une structure, rien d'autre. La transmission d'un mariage se
     fait depuis la fiche, et seulement après confirmation. */
  async function creerPartenaire(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.inviter"]);
    const nom = String(formulaire.get("nom") ?? "").trim();
    const email = String(formulaire.get("email") ?? "").trim().toLowerCase();
    const service = String(formulaire.get("service") ?? "autre");
    if (!nom || !email || !SERVICES.some(([c]) => c === service)) return;

    /* Le slug sert de clé d'idempotence : recréer le même prestataire ne
       fabrique pas une seconde structure. */
    const slug = `${service}-${nom}`.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    if (!slug) return;

    await a.executer((q) => q(
      "SELECT app.creer_entreprise_partenaire($1,$2,$3,$4::citext,$5)",
      [e.id, slug, nom, email, service]));
    revalidatePath("/admin/collaborateurs");
  }

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Collaborateurs</h1>
        </div>
        <a href="/admin" className="btn btn--fantome">Retour</a>
      </header>

      <section>
        <h2 className="display t-carte">Membres</h2>
        <ul className="admin-liste">
          {donnees.membres.map((m) => (
            <li key={m.id} style={{ flexWrap: "wrap",
              opacity: m.retire_le ? 0.45 : m.suspendu_le ? 0.7 : 1 }}>
              <strong>{m.prenom} {m.nom}</strong>
              <span>{m.email}</span>
              <span>{m.roles}</span>
              <span className="admin-pastille">
                {m.affectations} mariage(s) attribué(s)
              </span>
              <span className={`admin-pastille${m.retire_le || m.suspendu_le ? "" : " admin-pastille--emis"}`}>
                {m.retire_le ? "révoqué"
                  : m.suspendu_le ? "suspendu"
                  : m.utilisateur_id === session.utilisateurId ? "vous" : "actif"}
              </span>
              {m.motif_suspension ? (
                <span style={{ flexBasis: "100%" }}>Motif : {m.motif_suspension}</span>
              ) : null}

              {!m.retire_le && m.utilisateur_id !== session.utilisateurId ? (
                <div className="admin-paiement__actions" style={{ marginLeft: "auto" }}>
                  {acces.permissions.has("membre.revoquer") ? (
                    <form action={suspendre}>
                      <input type="hidden" name="membre" value={m.id} />
                      <input type="hidden" name="suspendre" value={m.suspendu_le ? "0" : "1"} />
                      <button type="submit" className="btn btn--fantome btn--petit">
                        {m.suspendu_le ? "Réactiver" : "Suspendre"}
                      </button>
                    </form>
                  ) : null}
                  {acces.permissions.has("membre.revoquer") ? (
                    <form action={revoquerMembre}>
                      <input type="hidden" name="utilisateur" value={m.utilisateur_id} />
                      <button type="submit" className="btn btn--fantome btn--petit">Révoquer</button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {/* ⚠️ LES RÔLES SE MODIFIENT, MAIS JAMAIS LES SIENS.
                  `interdireAutoModification` côté serveur ET `app.exiger(…,
                  cible)` en base : la permission de gérer les rôles ne doit
                  pas devenir la permission de s'accorder toutes les autres. */}
              {!m.retire_le && acces.permissions.has("role.gerer")
                && m.utilisateur_id !== session.utilisateurId ? (
                <form action={definirRoles} style={{ flexBasis: "100%", marginTop: "0.6rem" }}>
                  <input type="hidden" name="membre" value={m.id} />
                  <input type="hidden" name="utilisateur" value={m.utilisateur_id} />
                  <div className="admin-paiement__actions">
                    {donnees.roles.map((r) => (
                      <label key={r.id}
                        style={{ display: "flex", gap: "0.35rem", alignItems: "center",
                          fontSize: "0.8rem" }}>
                        <input type="checkbox" name="role" value={r.id}
                          defaultChecked={m.roles.includes(r.libelle)} />
                        {r.libelle}
                      </label>
                    ))}
                    <button type="submit" className="btn btn--fantome btn--petit">
                      Appliquer les rôles
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <h2 className="display t-carte">Inviter un collaborateur</h2>
        <p className="recap__note">
          L&apos;invitation est préparée et conservée, mais <strong>aucun e-mail n&apos;est
          envoyé</strong> : l&apos;envoi est une action séparée, soumise à votre validation.
          Le lien n&apos;est jamais stocké en clair — la base n&apos;en garde qu&apos;une empreinte.
        </p>
        <form action={preparerInvitation} className="formulaire" style={{ marginTop: "1.2rem" }}>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="prenom">Prénom</label>
              <input id="prenom" name="prenom" type="text" />
            </div>
            <div className="champ">
              <label htmlFor="nom">Nom</label>
              <input id="nom" name="nom" type="text" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" required inputMode="email" />
          </div>
          <div className="champ">
            <label htmlFor="role">Rôle</label>
            <select id="role" name="role" required defaultValue="">
              <option value="" disabled>Choisir un rôle…</option>
              {donnees.roles.map((r) => (
                <option key={r.id} value={r.id}>{r.libelle}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn">Préparer l&apos;invitation</button>
        </form>
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <h2 className="display t-carte">Invitations</h2>
        {donnees.invitations.length === 0 ? (
          <p className="recap__note">Aucune invitation préparée.</p>
        ) : (
          <ul className="admin-liste">
            {donnees.invitations.map((i) => {
              const encoreUtile = !i.utilisee_le && !i.revoquee_le
                && new Date(i.expire_le) > new Date();
              return (
                <li key={i.id} style={{ flexWrap: "wrap" }}>
                  <strong>{i.email}</strong>
                  <span className={`admin-pastille${i.utilisee_le ? " admin-pastille--emis" : ""}`}>
                    {i.utilisee_le ? "acceptée"
                      : i.revoquee_le ? "révoquée"
                      : new Date(i.expire_le) <= new Date() ? "expirée"
                      : i.envoyee_le ? "envoyée"
                      : "préparée — non envoyée"}
                  </span>
                  <span>expire le {new Date(i.expire_le).toLocaleDateString("fr-FR")}</span>
                  {encoreUtile && acces.permissions.has("membre.inviter") ? (
                    <div className="admin-paiement__actions" style={{ marginLeft: "auto" }}>
                      {!i.envoyee_le ? (
                        <form action={envoyerInvitation}>
                          <input type="hidden" name="invitation" value={i.id} />
                          <button type="submit" className="btn btn--petit">
                            Envoyer l&apos;invitation
                          </button>
                        </form>
                      ) : null}
                      <form action={revoquerInvitation}>
                        <input type="hidden" name="invitation" value={i.id} />
                        <button type="submit" className="btn btn--fantome btn--petit">
                          Révoquer
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ⚠️ UN RÔLE D'AMORÇAGE DOIT POUVOIR SE RENDRE.
          Le parrain n'existe que pour qu'une entreprise neuve ait quelqu'un
          capable d'y créer la première invitation. Une fois son
          propriétaire installé, laisser le parrain en place serait un accès
          qui survit à sa raison d'être. */}
      {donnees.membres.some((m) => m.utilisateur_id === session.utilisateurId
        && !m.retire_le && /Parrain/.test(m.roles)) ? (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 className="display t-carte">Votre rôle ici</h2>
          <p className="recap__note">
            Vous êtes <strong>parrain</strong> de cette entreprise : vous pouvez
            inviter et révoquer, rien d&apos;autre. Ni ses dossiers, ni ses
            documents, ni ses comptes ne vous sont accessibles. Une fois son
            responsable installé, retirez-vous.
          </p>
          <form action={quitterEntreprise} style={{ marginTop: "0.9rem" }}>
            <button type="submit" className="btn btn--fantome">
              Me retirer de cette entreprise
            </button>
          </form>
        </section>
      ) : null}

      {/* ⚠️ LE JOURNAL N'EST PAS DÉCORATIF.
          Qui a invité, qui a suspendu, qui a changé des rôles, et quand. Si
          un accès a existé, il en reste une trace — c'est ce qui permet de
          répondre à « depuis quand voyait-il ce dossier ? ». */}
      {acces.permissions.has("membre.inviter") ? (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 className="display t-carte">Prestataires partenaires</h2>
          <p className="recap__note">
            Vidéaste, second photographe, photobooth… Chacun reçoit sa propre
            structure : il ne voit que les mariages qu&apos;on lui confie, et
            jamais mes montants. Le créer ne lui transmet rien — la
            transmission se fait depuis la fiche, après confirmation du dossier.
          </p>

          {donnees.partenaires.length > 0 ? (
            <ul className="admin-liste" style={{ marginTop: "1rem" }}>
              {donnees.partenaires.map((p) => (
                <li key={p.id}>
                  <strong>{p.nom_commercial}</strong>
                  <span className="admin-jeton">
                    {SERVICES.find(([c]) => c === p.service_partenaire)?.[1]
                      ?? "métier non précisé"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={creerPartenaire} className="formulaire" style={{ marginTop: "1rem" }}>
            <div className="admin-grille-champs">
              <div className="champ">
                <label htmlFor="partenaire-nom">Nom commercial</label>
                <input id="partenaire-nom" name="nom" type="text" required />
              </div>
              <div className="champ">
                <label htmlFor="partenaire-service">Métier</label>
                <select id="partenaire-service" name="service" defaultValue="photobooth">
                  {SERVICES.map(([c, libelle]) => (
                    <option key={c} value={c}>{libelle}</option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label htmlFor="partenaire-email">E-mail professionnel</label>
                <input id="partenaire-email" name="email" type="email" required />
              </div>
            </div>
            <button type="submit" className="btn btn--fantome">
              Créer le prestataire
            </button>
          </form>
        </section>
      ) : null}

      {acces.permissions.has("audit.lire") && donnees.journal.length > 0 ? (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 className="display t-carte">Journal des accès</h2>
          <ul className="admin-liste">
            {donnees.journal.map((j, i) => (
              <li key={`${j.horodatage}-${i}`}>
                <strong>{j.action.replace(/\./g, " · ")}</strong>
                <span>{j.prenom ? `${j.prenom} ${j.nom ?? ""}` : "—"}</span>
                <span>{new Date(j.horodatage).toLocaleString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
