import Link from "next/link";
import { revalidatePath } from "next/cache";
import { contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces } from "@/lib/auth/acces";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/* =============================================================================
   NOTIFICATIONS ET PRÉFÉRENCES
   -----------------------------------------------------------------------------
   ⚠️ LES PRÉFÉRENCES SONT PERSONNELLES, PAS ADMINISTRABLES.

   La politique de `preferences_notification` n'a aucune clause par entreprise :
   chacun ne voit et ne règle que les siennes. Un employeur n'a pas à savoir
   ce que son collaborateur a désactivé, ni à le réactiver pour lui.

   Et une permission manquante l'emporte sur une préférence : cocher
   « échéance financière » sans `finance.lire` ne fait rien arriver.
   ============================================================================= */
export default async function Notifications() {
  const { entreprise } = await contexteAdmin();
  const acces = await exigerAcces(entreprise.id);

  const donnees = await acces.executer(async (q) => {
    const { rows: notifs } = await q("SELECT * FROM app.mes_notifications(50)");
    const { rows: types } = await q(
      `SELECT t.cle, t.libelle, t.permission, t.defaut_app, t.defaut_email,
              p.en_app, p.par_email
         FROM types_notification t
         LEFT JOIN preferences_notification p
                ON p.type = t.cle AND p.utilisateur_id = app.acteur()
        ORDER BY t.libelle`);
    return { notifs, types };
  });

  async function enregistrerPreferences(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    const cles = formulaire.getAll("type");
    await a.executer(async (q) => {
      for (const cle of cles) {
        await q(
          `INSERT INTO preferences_notification (utilisateur_id, type, en_app, par_email)
           VALUES (app.acteur(), $1, $2, $3)
           ON CONFLICT (utilisateur_id, type)
             DO UPDATE SET en_app = EXCLUDED.en_app, par_email = EXCLUDED.par_email`,
          [cle, formulaire.get(`app-${cle}`) === "1", formulaire.get(`mail-${cle}`) === "1"]);
      }
    });
    revalidatePath("/admin/notifications");
  }

  async function toutMarquerLu() {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    await a.executer((q) => q(
      "UPDATE notifications SET lue_le = now() WHERE destinataire_id = app.acteur() AND lue_le IS NULL"));
    revalidatePath("/admin/notifications");
  }

  const nonLues = donnees.notifs.filter((n) => !n.lue_le).length;

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Notifications</h1>
          <p className="recap__note">{nonLues} non lue(s)</p>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      <section className="admin-bloc">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem",
          alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 className="display t-carte">Reçues</h2>
          {nonLues > 0 ? (
            <form action={toutMarquerLu}>
              <button type="submit" className="btn btn--fantome">Tout marquer comme lu</button>
            </form>
          ) : null}
        </div>
        {donnees.notifs.length === 0 ? (
          <p className="recap__note">Aucune notification.</p>
        ) : (
          <ul className="admin-notifs">
            {donnees.notifs.map((n) => (
              <li key={n.id} className={`admin-notif${!n.lue_le ? " admin-notif--neuve" : ""}`}>
                <p className="admin-notif__titre">
                  {n.lien ? <Link href={n.lien}>{n.titre}</Link> : n.titre}
                </p>
                {n.corps ? <p className="admin-notif__meta">{n.corps}</p> : null}
                <p className="admin-notif__meta">
                  {new Date(n.cree_le).toLocaleString("fr-FR")} · {n.type}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-bloc">
        <h2 className="display t-carte">Mes préférences</h2>
        <p className="recap__note">
          Elles n&apos;appartiennent qu&apos;à vous. Une permission manquante
          l&apos;emporte toujours : un type que votre rôle ne couvre pas ne vous
          sera pas notifié, quelle que soit la case cochée.
        </p>
        <form action={enregistrerPreferences} className="formulaire" style={{ marginTop: "1rem" }}>
          <ul className="admin-liste">
            {donnees.types.map((t) => {
              const app = t.en_app ?? t.defaut_app;
              const mail = t.par_email ?? t.defaut_email;
              const couvert = !t.permission || acces.permissions.has(t.permission);
              return (
                <li key={t.cle} style={{ flexWrap: "wrap" }}>
                  <input type="hidden" name="type" value={t.cle} />
                  <strong style={{ opacity: couvert ? 1 : 0.5 }}>{t.libelle}</strong>
                  <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <input type="checkbox" name={`app-${t.cle}`} value="1" defaultChecked={app} />
                    Dans l&apos;espace
                  </label>
                  <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <input type="checkbox" name={`mail-${t.cle}`} value="1" defaultChecked={mail} />
                    Par e-mail
                  </label>
                  {!couvert ? (
                    <span style={{ flexBasis: "100%", color: "var(--gris)", fontSize: "0.78rem" }}>
                      Votre rôle ne porte pas « {t.permission} » : rien ne vous
                      sera envoyé pour ce type.
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button type="submit" className="btn btn--bloc">Enregistrer</button>
        </form>
      </section>
    </main>
  );
}
