import Link from "next/link";
import { contexteAdmin } from "@/lib/admin/garde";
import { formaterDateSql } from "@/lib/dates";
import { exigerAcces } from "@/lib/auth/acces";
import PushAdmin from "@/components/PushAdmin";

export const metadata = { title: "Tableau de bord" };
export const dynamic = "force-dynamic";

export default async function TableauDeBord({ searchParams }) {
  const params = await searchParams;
  const { session, entreprises, entreprise } = await contexteAdmin();
  const acces = await exigerAcces(entreprise.id);

  const chiffres = await acces.executer(async (q) => {
    const { rows: [dem] } = await q(
      `SELECT count(*) FILTER (WHERE lue_le IS NULL)::int AS non_lues,
              count(*)::int AS total
         FROM demandes WHERE entreprise_destinataire_id = $1`, [entreprise.id]);
    const { rows: [d] } = await q(
      `SELECT count(*) FILTER (WHERE statut = 'nouvelle_demande')::int AS nouvelles,
              count(*) FILTER (WHERE statut = 'reserve')::int AS reserves,
              count(*)::int AS total
         FROM dossiers WHERE entreprise_id = $1`, [entreprise.id]);
    const { rows: [m] } = await q(
      "SELECT count(*)::int AS n FROM membres WHERE entreprise_id = $1 AND retire_le IS NULL",
      [entreprise.id]);
    /* ⚠️ DEUX SOURCES, ET IL FAUT LES DEUX.
       · `demandes` est la source métier du TITULAIRE : elle porte les
         mariages saisis à la main et ceux qui ont une date mais ne sont pas
         encore confirmés. L'ancienne requête, qui joignait `dossiers` à
         `mariages`, ne voyait aucun des deux.
       · `dossiers` reste la seule source d'un PARTENAIRE : un vidéaste ou un
         prestataire photobooth n'a pas de demande chez lui — son dossier naît
         de l'acceptation d'une proposition. Lire `demandes` seule a vidé son
         tableau de bord ; un banc l'a relevé.

       ⚠️ ET PAR DATE DE MARIAGE CROISSANTE, JAMAIS PAR `cree_le`.
       `reference` ferme l'ordre : deux mariages le même jour sortent toujours
       dans la même suite. */
    const { rows: prochains } = await q(
      `WITH depuis_demandes AS (
         SELECT d.id AS cible, 'demande' AS vue, d.reference,
                d.contact_nom, d.contact_nom_2, d.date_mariage, d.ville,
                d.mariage_id IS NOT NULL AS confirme, d.photobooth_360
           FROM demandes d
          WHERE d.entreprise_destinataire_id = $1
            AND d.date_mariage >= current_date
            AND d.statut NOT IN ('refusee','annulee','archivee')
       ),
       depuis_dossiers AS (
         SELECT dd.id AS cible, 'dossier' AS vue, dd.reference,
                dd.reference AS contact_nom, NULL::text AS contact_nom_2,
                m.date_mariage, m.ville, true AS confirme,
                false AS photobooth_360
           FROM dossiers dd
           JOIN mariages m ON m.id = dd.mariage_id
          WHERE dd.entreprise_id = $1 AND m.date_mariage >= current_date
            AND NOT EXISTS (SELECT 1 FROM demandes d2 WHERE d2.dossier_id = dd.id)
       )
       SELECT * FROM depuis_demandes
       UNION ALL
       SELECT * FROM depuis_dossiers
       ORDER BY date_mariage, reference
       LIMIT 8`, [entreprise.id]);
    /* Une section à part, et non un tri qui les noierait : un mariage sans
       date est une action à mener, pas une ligne de calendrier. */
    const { rows: sansDate } = await q(
      `SELECT d.id, d.reference, d.contact_nom, d.statut
         FROM demandes d
        WHERE d.entreprise_destinataire_id = $1 AND d.date_mariage IS NULL
          AND d.statut NOT IN ('refusee','annulee','archivee','close')
        ORDER BY d.reference LIMIT 8`, [entreprise.id]);
    const { rows: nouvelles } = await q(
      `SELECT d.id, d.reference, d.contact_nom, d.date_mariage, d.origine, d.cree_le
         FROM demandes d
        WHERE d.entreprise_destinataire_id = $1 AND d.lue_le IS NULL
        ORDER BY d.cree_le DESC LIMIT 8`, [entreprise.id]);
    return { ...d, membres: m.n, prochains, sansDate, nouvelles,
             demandes: dem.total, nonLues: dem.non_lues };
  });

  const peut = (p) => acces.permissions.has(p);

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Tableau de bord</h1>
          <p className="recap__note">{entreprise.roles}</p>
        </div>
        <form method="post" action="/api/admin/deconnexion">
          <button type="submit" className="btn btn--fantome">Se déconnecter</button>
        </form>
      </header>

      {params?.refus ? (
        <p role="alert" className="admin-alerte">
          Accès refusé : {params.refus}.
        </p>
      ) : null}

      {/* ⚠️ UN SÉLECTEUR, PAS UNE PHRASE.
          On est membre de plusieurs entreprises dès qu'on parraine un
          partenaire. Sans ce choix, la deuxième était inatteignable : on
          savait qu'elle existait, on ne pouvait rien y faire. */}
      {entreprises.length > 1 ? (
        <form method="post" action="/api/admin/entreprise-active"
          className="admin-ligne-actions" style={{ marginBottom: "1.5rem" }}>
          <input type="hidden" name="suite" value="/admin" />
          <label htmlFor="entreprise-active" className="label label--nu">
            Entreprise active
          </label>
          <select id="entreprise-active" name="entreprise" defaultValue={entreprise.id}>
            {entreprises.map((e) => (
              <option key={e.id} value={e.id}>{e.nom_commercial}</option>
            ))}
          </select>
          <button type="submit" className="btn btn--fantome">Changer</button>
        </form>
      ) : null}

      <PushAdmin />

      <section className="admin-chiffres">
        {[
          ["Demandes non lues", chiffres.nonLues],
          ["Demandes reçues", chiffres.demandes],
          ["Mariages réservés", chiffres.reserves],
          ["Dossiers au total", chiffres.total],
          ["Membres actifs", chiffres.membres],
        ].map(([libelle, valeur]) => (
          <div key={libelle} className="admin-chiffre">
            <p className="admin-chiffre__valeur">{valeur}</p>
            <p className="label label--nu">{libelle}</p>
          </div>
        ))}
      </section>

      {chiffres.nouvelles.length > 0 ? (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 className="display t-carte">Nouvelles demandes</h2>
          <p className="recap__note">
            Arrivées et pas encore ouvertes. Celles du site public sont
            enregistrées avant toute notification.
          </p>
          <ul className="admin-liste">
            {chiffres.nouvelles.map((n) => (
              <li key={n.id}>
                <strong>
                  <Link className="lien" href={`/admin/demandes/${n.id}`}>
                    {n.contact_nom}
                  </Link>
                </strong>
                <span>{n.reference}</span>
                <span>{n.date_mariage ? formaterDateSql(n.date_mariage) : "date à définir"}</span>
                <span className="admin-jeton">
                  {n.origine === "manuel" ? "manuel" : "site"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section style={{ marginTop: "2.5rem" }}>
        <h2 className="display t-carte">Prochains mariages</h2>
        {chiffres.prochains.length === 0 ? (
          <p className="recap__note">Aucun mariage à venir dans cette entreprise.</p>
        ) : (
          <ul className="admin-liste">
            {chiffres.prochains.map((p) => (
              <li key={`${p.vue}-${p.cible}`}>
                <strong>
                  <Link className="lien" href={p.vue === "demande"
                    ? `/admin/demandes/${p.cible}`
                    : `/admin/dossiers?dossier=${p.cible}`}>
                    {p.contact_nom}{p.contact_nom_2 ? ` & ${p.contact_nom_2}` : ""}
                  </Link>
                </strong>
                <span>{formaterDateSql(p.date_mariage)}</span>
                <span>{p.ville ?? "—"}</span>
                <span className={`admin-pastille${p.confirme ? " admin-pastille--emis" : ""}`}>
                  {p.confirme ? "confirmé" : "à confirmer"}
                </span>
                {p.photobooth_360 ? (
                  <span className="admin-jeton">Photobooth 360</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {chiffres.sansDate.length > 0 ? (
          <>
            <h3 className="label label--nu" style={{ marginTop: "1.6rem" }}>
              Sans date
            </h3>
            <ul className="admin-liste">
              {chiffres.sansDate.map((p) => (
                <li key={p.id}>
                  <strong>
                    <Link className="lien" href={`/admin/demandes/${p.id}`}>
                      {p.contact_nom}
                    </Link>
                  </strong>
                  <span>{p.reference}</span>
                  <span>date à définir</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <nav className="admin-nav" aria-label="Sections de l'administration">
        {/* ⚠️ MASQUER UN LIEN N'EST PAS UNE PROTECTION.
            Chaque page cible rappelle `exigerAcces()` avec ses propres
            permissions ; ce filtrage-ci ne sert qu'à ne pas proposer une
            porte fermée. */}
        {peut("dossier.lire") ? (
          <Link href="/admin/demandes" className="btn">Demandes</Link>
        ) : null}
        {peut("dossier.ecrire") ? (
          <Link href="/admin/demandes/nouveau" className="btn">+ Nouveau dossier</Link>
        ) : null}
        {peut("dossier.lire") ? (
          <Link href="/admin/saison" className="btn btn--fantome">Saison</Link>
        ) : null}
        {peut("finance.lire") ? (
          <Link href="/admin/finances" className="btn btn--fantome">Finances</Link>
        ) : null}
        {peut("collaboration.repondre") ? (
          <Link href="/admin/propositions" className="btn btn--fantome">Propositions</Link>
        ) : null}
        {peut("document.rediger") ? (
          <Link href="/admin/dossiers" className="btn btn--fantome">Mes dossiers</Link>
        ) : null}
        {peut("entreprise.reglages") ? (
          <Link href="/admin/entreprise" className="btn btn--fantome">Mon entreprise</Link>
        ) : null}
        {peut("message.lire") ? (
          <Link href="/admin/messagerie" className="btn btn--fantome">Messagerie</Link>
        ) : null}
        <Link href="/admin/notifications" className="btn btn--fantome">Notifications</Link>
        <Link href="/admin/parametres/compte" className="btn btn--fantome">Mon compte</Link>
        {peut("message.envoyer") ? (
          <Link href="/admin/parametres/messagerie" className="btn btn--fantome">Messagerie — réglages</Link>
        ) : null}
        {peut("membre.inviter") ? (
          <Link href="/admin/collaborateurs" className="btn btn--fantome">Collaborateurs</Link>
        ) : null}
      </nav>

      <p className="recap__note" style={{ marginTop: "2.5rem" }}>
        Les demandes envoyées depuis le site public sont enregistrées en base avant
        toute notification : un échec d&apos;envoi ne peut plus en perdre une.
      </p>
    </main>
  );
}
