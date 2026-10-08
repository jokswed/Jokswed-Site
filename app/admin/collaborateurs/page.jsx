import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces, interdireAutoModification, tracer } from "@/lib/auth/acces";
import { engendrerJeton, hacherJeton } from "@/lib/auth/secrets";

export const metadata = { title: "Collaborateurs" };
export const dynamic = "force-dynamic";

/* ⚠️ AUCUNE INVITATION N'EST ENVOYÉE PAR CETTE PAGE.

   Le bouton CRÉE l'invitation en base (jeton haché, expiration) et s'arrête
   là : `envoyee_le` reste nul. L'envoi effectif est une action distincte, qui
   demandera une validation explicite — on ne déclenche pas un e-mail vers une
   vraie personne depuis un écran en cours de construction. */
const DUREE_INVITATION_JOURS = 7;

export default async function Collaborateurs() {
  const { session, entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id, ["membre.inviter"]);

  const donnees = await acces.executer(async (q) => {
    const { rows: membres } = await q(
      `SELECT m.id, m.ajoute_le, m.retire_le, u.id AS utilisateur_id,
              u.prenom, u.nom, u.email, u.desactive_le,
              coalesce(string_agg(r.libelle, ', ' ORDER BY r.libelle), '—') AS roles
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
    return { membres, invitations, roles };
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

    await a.executer(async (q) => {
      const { rows } = await q(
        `INSERT INTO invitations (entreprise_id, email, prenom, nom, jeton_hache,
                                  roles, cree_par, expire_le)
         VALUES ($1,$2,$3,$4,$5,ARRAY[$6]::uuid[],$7, now() + make_interval(days => $8))
         ON CONFLICT (entreprise_id, email)
           WHERE utilisee_le IS NULL AND revoquee_le IS NULL DO NOTHING
         RETURNING id`,
        [e.id, email, String(formulaire.get("prenom") ?? "") || null,
         String(formulaire.get("nom") ?? "") || null, hacherJeton(jeton), roleId,
         s.utilisateurId, DUREE_INVITATION_JOURS]);
      if (rows[0]) {
        await tracer(q, s.utilisateurId, e.id, "invitation.preparee", "invitation",
          rows[0].id, null, { email });
      }
    });
    revalidatePath("/admin/collaborateurs");
  }

  async function revoquerMembre(formulaire) {
    "use server";
    const { session: s, entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["membre.revoquer"]);
    const cible = String(formulaire.get("utilisateur") ?? "");

    /* ⚠️ RLS NE PEUT PAS PORTER CETTE RÈGLE : elle dépend de l'identité de la
       CIBLE, pas de l'appartenance de la ligne. C'est exactement le partage
       des rôles entre la base et la couche applicative. */
    interdireAutoModification(s.utilisateurId, cible);

    await a.executer(async (q) => {
      await q(
        `UPDATE membres SET retire_le = now(), retire_par = $1
          WHERE entreprise_id = $2 AND utilisateur_id = $3 AND retire_le IS NULL`,
        [s.utilisateurId, e.id, cible]);
      /* Les sessions ouvertes du collaborateur tombent d'elles-mêmes : sans
         adhésion active, `entreprises_de_lacteur()` rend un tableau vide et
         il ne voit plus rien dès la requête suivante. Vérifié au banc. */
      await tracer(q, s.utilisateurId, e.id, "membre.revoque", "utilisateur", cible);
    });
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
            <li key={m.id} style={m.retire_le ? { opacity: 0.45 } : undefined}>
              <strong>{m.prenom} {m.nom}</strong>
              <span>{m.email}</span>
              <span>{m.roles}</span>
              <span>
                {m.retire_le
                  ? "Accès révoqué"
                  : m.utilisateur_id === session.utilisateurId
                    ? "Vous"
                    : null}
              </span>
              {!m.retire_le && m.utilisateur_id !== session.utilisateurId
                && acces.permissions.has("membre.revoquer") ? (
                <form action={revoquerMembre}>
                  <input type="hidden" name="utilisateur" value={m.utilisateur_id} />
                  <button type="submit" className="btn btn--fantome btn--petit">Révoquer</button>
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
            {donnees.invitations.map((i) => (
              <li key={i.id}>
                <strong>{i.email}</strong>
                <span>
                  {i.utilisee_le ? "Acceptée"
                    : i.revoquee_le ? "Révoquée"
                    : i.envoyee_le ? "Envoyée"
                    : "Préparée — non envoyée"}
                </span>
                <span>expire le {new Date(i.expire_le).toLocaleDateString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
