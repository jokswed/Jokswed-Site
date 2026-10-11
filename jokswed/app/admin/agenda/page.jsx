import Link from "next/link";
import { revalidatePath } from "next/cache";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";

export const metadata = { title: "Mon agenda · JoksWed" };
export const dynamic = "force-dynamic";
const flags = process.env.JOKSWED_AGENDA_ENABLED === "1";

export default async function Agenda() {
  const { entreprise } = await contexteAdmin();
  const a = await accesPage(entreprise.id, ["dossier.lire"]);

  async function ajouter(formulaire) {
    "use server";
    if (process.env.JOKSWED_AGENDA_ENABLED !== "1") {
      throw new Error("Agenda non activé");
    }
    const { entreprise: e } = await contexteAdmin();
    const acces = await accesPage(e.id, ["dossier.ecrire"]);
    const libelle = String(formulaire.get("titre") ?? "").trim();
    const lieu = String(formulaire.get("lieu") ?? "").trim().slice(0, 200);
    const debut = String(formulaire.get("debut") ?? "");
    const fin = String(formulaire.get("fin") ?? "");
    const mariage = String(formulaire.get("mariage") ?? "") || null;
    const partage = formulaire.get("partage") === "1";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debut)
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fin)
        || libelle.length < 2 || libelle.length > 180) {
      throw new Error("Date, horaires ou titre incorrects");
    }
    await acces.executer((q) => q(
      "SELECT app.ajouter_evenement_agenda($1,$2::uuid,$3,$4,$5::timestamp,$6::timestamp,$7)",
      [e.id, mariage, libelle, lieu, debut, fin, partage]
    ));
    revalidatePath("/admin/agenda");
  }

  if (!flags) {
    return <main className="admin-page"><h1 className="display t-section">Agenda</h1>
      <p className="admin-alerte">L'agenda privé n'est pas encore activé sur cette Preview.</p>
      <Link href="/admin/saison" className="btn btn--fantome">Voir la saison des mariages</Link>
    </main>;
  }

  const donnees = await a.executer(async (q) => {
    const { rows: agenda } = await q("SELECT * FROM app.mon_agenda($1)", [entreprise.id]);
    const { rows: mariages } = await q(
      `SELECT DISTINCT m.id,m.date_mariage,m.reference,d.pilote FROM dossiers d
         JOIN mariages m ON m.id=d.mariage_id
        WHERE d.entreprise_id=$1 AND d.statut NOT IN ('annule','refuse')
        ORDER BY m.date_mariage NULLS LAST`, [entreprise.id]);
    /* Chaque membre retrouve ses propres missions, et les mariages acceptés.
       Ce n'est pas une lecture des dossiers commerciaux d'autres entreprises. */
    const { rows: missions } = await q(
      `SELECT dossier_id, mariage_id, reference, prestation, date_mariage, ville
         FROM app.mes_dossiers($1)`, [entreprise.id]);
    return { agenda, mariages, missions };
  });
  const peutAjouter = a.permissions.has("dossier.ecrire");

  return <main className="admin-page">
    <header className="admin-entete">
      <div><p className="label label--nu">{entreprise.nom_commercial}</p>
        <h1 className="display t-section">Mon agenda</h1>
        <p className="recap__note">Vos événements privés et le planning commun des prestations partagées.</p>
      </div>
      <Link href="/admin" className="btn btn--fantome">Retour</Link>
    </header>

    {donnees.missions.length ? <section className="admin-bloc">
      <h2 className="display t-carte">Prestations de mon entreprise</h2>
      <p className="recap__note">Ces dossiers sont accessibles à votre entreprise uniquement.
        Les mariages communs partagent la date et le lieu, pas les finances.</p>
      <ul className="admin-liste" style={{marginTop:"0.8rem"}}>
        {donnees.missions.map(m=><li key={m.dossier_id}>
          <strong>{m.prestation} · {m.reference}</strong>
          <span>{m.date_mariage ? String(m.date_mariage).slice(0,10) : "Date à définir"}</span>
          <span>{m.ville || "Lieu à préciser"}</span>
          <Link className="btn btn--fantome btn--petit" href={`/admin/dossiers?dossier=${m.dossier_id}`}>
            Ouvrir le dossier
          </Link>
        </li>)}
      </ul>
    </section> : null}

    <section className="admin-bloc">
      <h2 className="display t-carte">Mes événements</h2>
      <p className="recap__note">Un événement privé n'est visible que par son auteur.
        Le planning partagé n'est visible que par les entreprises travaillant sur le même mariage.
        Les tarifs et informations financières ne sont jamais partagés.</p>
      {donnees.agenda.length ? <ul className="admin-liste" style={{ marginTop:"1rem" }}>
        {donnees.agenda.map(ev => <li key={ev.id} style={{ flexWrap:"wrap", gap:"0.8rem" }}>
          <strong>{ev.titre}</strong>
          <span>{new Date(ev.debut).toLocaleString("fr-FR",{ timeZone:"Europe/Paris",dateStyle:"full",timeStyle:"short"})}</span>
          <span>{ev.lieu || "Lieu à définir"}</span>
          <span className="admin-pastille">{ev.partage_mariage ? "Planning commun" : "Privé"}</span>
          {ev.entreprise_source ? <span>Partagé par {ev.entreprise_source}</span> : null}
          <a className="btn btn--fantome btn--petit" href={`/api/admin/agenda/${ev.id}/ical`}>
            Ajouter à Apple Calendrier (.ics)
          </a>
        </li>)}
      </ul> : <p className="recap__note">Aucun événement pour l'instant.</p>}
    </section>

    {peutAjouter ? <section className="admin-bloc">
      <h2 className="display t-carte">Ajouter un rendez-vous ou une prestation</h2>
      <form action={ajouter} className="formulaire" style={{marginTop:"1rem"}}>
        <div className="champ"><label htmlFor="agenda-titre">Intitulé de la prestation</label>
          <input id="agenda-titre" name="titre" required minLength={2} maxLength={180}
            placeholder="Ex. Cérémonie laïque, shooting couple" /></div>
        <div className="formulaire__deux">
          <div className="champ"><label htmlFor="agenda-debut">Début (heure de Paris)</label>
            <input id="agenda-debut" type="datetime-local" name="debut" required /></div>
          <div className="champ"><label htmlFor="agenda-fin">Fin (heure de Paris)</label>
            <input id="agenda-fin" type="datetime-local" name="fin" required /></div>
        </div>
        <div className="champ"><label htmlFor="agenda-lieu">Lieu</label>
          <input id="agenda-lieu" name="lieu" maxLength={200} /></div>
        <div className="champ"><label htmlFor="agenda-mariage">Mariage / dossier commun (facultatif)</label>
          <select id="agenda-mariage" name="mariage" defaultValue="">
            <option value="">Événement privé sans mariage</option>
            {donnees.mariages.map(m=><option key={m.id} value={m.id}>
              {m.reference} · {m.date_mariage ? String(m.date_mariage).slice(0,10) : "Date inconnue"}
            </option>)}
          </select></div>
        <label style={{display:"flex",gap:"0.7rem",alignItems:"center"}}>
          <input name="partage" type="checkbox" value="1" />
          Partager ce rendez-vous avec les partenaires du même mariage (réservé au pilote)
        </label>
        <p className="recap__note">Apple Calendrier importe un fichier .ics ; les changements ultérieurs
          ne se synchronisent pas automatiquement. Ne le confondez pas avec un abonnement WebCal.</p>
        <button type="submit" className="btn">Enregistrer dans mon agenda</button>
      </form>
    </section> : null}
  </main>;
}
