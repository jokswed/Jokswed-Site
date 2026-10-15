import Link from "next/link";
import { redirect } from "next/navigation";
import { accesPage, contexteAdmin } from "@/lib/admin/garde";
import { formules, formaterPrix } from "@/content/offres";

export const metadata = { title: "Nouveau dossier" };
export const dynamic = "force-dynamic";

/* =============================================================================
   UN DOSSIER QUI N'EST JAMAIS PASSÉ PAR LE FORMULAIRE
   -----------------------------------------------------------------------------
   ⚠️ C'EST LA MÊME TABLE, LE MÊME CYCLE, LES MÊMES ÉCRANS.

   Un mariage pris au téléphone devient une ligne de `demandes` avec
   `origine = 'manuel'`. Il apparaît donc dans la liste des demandes, dans le
   tableau de bord, dans la saison, dans le tableau financier et dans le flux
   de calendrier sans qu'une seule de ces vues ait été dédoublée.

   ⚠️ ET ENREGISTRER N'ENVOIE RIEN.
   Ni accusé de réception, ni notification au couple : il vient de raccrocher.
   L'envoi est un geste séparé, depuis la fiche.
   ============================================================================= */

/* Les montants arrivent en euros depuis un champ texte. On arrondit APRÈS
   multiplication, et on ne garde que des centimes entiers : « 1300 »,
   « 1300,00 » et « 1 300 » donnent tous 130000. */
function centimes(brut) {
  const net = String(brut ?? "").replace(/\s/g, "").replace(",", ".").trim();
  if (!net) return null;
  const cents = Math.round(Number.parseFloat(net) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

export default async function NouveauDossier() {
  const { entreprise } = await contexteAdmin();
  await accesPage(entreprise.id, ["dossier.ecrire"]);

  async function creer(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await accesPage(e.id, ["dossier.ecrire"]);

    const texte = (nom) => String(formulaire.get(nom) ?? "").trim() || null;
    const formuleCle = texte("formule");
    const formule = formuleCle ? formules.find((f) => f.cle === formuleCle) : null;

    /* ⚠️ LE PRIX CONVENU PRIME SUR LE TARIF DE LA FORMULE.
       Une formule sert de point de départ ; le prix réellement convenu — avec
       remise, options ou tarif personnalisé — est celui qui pilote
       l'échéancier et les totaux. */
    const prixTotal = centimes(formulaire.get("prix_total"))
      ?? formule?.prixCents ?? null;
    const nombre = Number.parseInt(String(formulaire.get("echeances") ?? "1"), 10);

    const champs = {
      contact_nom: texte("nom_1") ?? "",
      contact_nom_2: texte("nom_2"),
      contact_email: texte("email"),
      contact_telephone: texte("telephone"),
      contact_adresse: texte("adresse"),
      contact_prefere: texte("contact_prefere"),
      date_mariage: texte("date_mariage"),
      heure_debut: texte("heure_debut"),
      heure_fin: texte("heure_fin"),
      lieu_mairie: texte("mairie"),
      lieu_ceremonie: texte("ceremonie"),
      lieu_reception: texte("domaine"),
      lieu: texte("domaine") ?? texte("ceremonie") ?? texte("mairie"),
      ville: texte("ville"),
      departement: texte("departement"),
      invites_estimes: texte("invites"),
      horaires: texte("horaires"),
      formule_cle: formuleCle,
      formule_nom: formule ? `${formule.nom} — ${formule.surnom}` : texte("formule_libre"),
      formule_prix_cents: formule ? String(formule.prixCents) : null,
      prix_total_cents: prixTotal === null ? null : String(prixTotal),
      nombre_echeances: String([1, 2, 3].includes(nombre) ? nombre : 1),
      photobooth_360: formulaire.get("photobooth") === "1",
      video_demandee: formulaire.get("video") === "1",
      message: texte("notes"),
      complements: texte("complements"),
    };
    if (!champs.contact_nom) return;

    const demande = await a.executer(async (q) => {
      const { rows } = await q(
        "SELECT * FROM app.creer_demande_manuelle($1,$2::jsonb)",
        [e.id, JSON.stringify(champs)]);
      return rows[0] ?? null;
    });
    if (demande?.demande_id) redirect(`/admin/demandes/${demande.demande_id}`);
  }

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Nouveau dossier</h1>
          <p className="recap__note">
            Un mariage convenu de vive voix. Rien ne part au couple : vous
            enregistrez, vous écrivez ensuite si vous le voulez.
          </p>
        </div>
        <Link href="/admin/demandes" className="btn btn--fantome">Retour</Link>
      </header>

      <form action={creer} className="formulaire">
        <section className="admin-bloc">
          <h2 className="display t-carte">Le couple</h2>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="nom_1">Prénom et nom — personne 1</label>
              <input id="nom_1" name="nom_1" type="text" required
                     placeholder="Marie Test" />
            </div>
            <div className="champ">
              <label htmlFor="nom_2">Prénom et nom — personne 2</label>
              <input id="nom_2" name="nom_2" type="text" placeholder="Jean Test" />
            </div>
          </div>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" />
            </div>
            <div className="champ">
              <label htmlFor="telephone">Téléphone</label>
              <input id="telephone" name="telephone" type="tel" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="adresse">Adresse (si pertinente)</label>
            <input id="adresse" name="adresse" type="text" />
          </div>
          <div className="champ">
            <label htmlFor="contact_prefere">Contact préféré</label>
            <select id="contact_prefere" name="contact_prefere" defaultValue="">
              <option value="">—</option>
              <option value="email">E-mail</option>
              <option value="telephone">Téléphone</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <p className="recap__note">
            Sans e-mail, une adresse d&apos;attente est posée : elle ne peut pas
            recevoir de message par erreur. Vous la corrigerez depuis la fiche.
          </p>
        </section>

        <section className="admin-bloc">
          <h2 className="display t-carte">Le mariage</h2>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="date_mariage">Date</label>
              <input id="date_mariage" name="date_mariage" type="date" />
            </div>
            <div className="champ">
              <label htmlFor="invites">Nombre d&apos;invités</label>
              <input id="invites" name="invites" type="number" min="0" />
            </div>
          </div>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="heure_debut">Heure de début</label>
              <input id="heure_debut" name="heure_debut" type="time" />
            </div>
            <div className="champ">
              <label htmlFor="heure_fin">Heure de fin</label>
              <input id="heure_fin" name="heure_fin" type="time" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="mairie">Mairie — adresse</label>
            <input id="mairie" name="mairie" type="text" />
          </div>
          <div className="champ">
            <label htmlFor="ceremonie">Cérémonie / église — adresse</label>
            <input id="ceremonie" name="ceremonie" type="text" />
          </div>
          <div className="champ">
            <label htmlFor="domaine">Domaine / salle — adresse</label>
            <input id="domaine" name="domaine" type="text" />
          </div>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="ville">Ville</label>
              <input id="ville" name="ville" type="text" />
            </div>
            <div className="champ">
              <label htmlFor="departement">Département</label>
              <input id="departement" name="departement" type="text" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="horaires">Horaires connus (texte libre)</label>
            <input id="horaires" name="horaires" type="text" />
          </div>
          <div className="champ">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={3} />
          </div>
          <div className="champ">
            <label htmlFor="complements">Informations complémentaires</label>
            <textarea id="complements" name="complements" rows={2} />
          </div>
        </section>

        <section className="admin-bloc">
          <h2 className="display t-carte">Commercial</h2>
          <div className="champ">
            <label htmlFor="formule">Formule</label>
            <select id="formule" name="formule" defaultValue="">
              <option value="">Tarif personnalisé</option>
              {formules.map((f) => (
                <option key={f.cle} value={f.cle}>
                  {f.nom} — {f.surnom} ({formaterPrix(f.prixCents)})
                </option>
              ))}
            </select>
          </div>
          <div className="formulaire__deux">
            <div className="champ">
              <label htmlFor="formule_libre">Libellé du tarif personnalisé</label>
              <input id="formule_libre" name="formule_libre" type="text"
                     placeholder="Prestation sur mesure" />
            </div>
            <div className="champ">
              <label htmlFor="prix_total">Prix total convenu (€ TTC)</label>
              <input id="prix_total" name="prix_total" type="text"
                     inputMode="decimal" placeholder="1300" />
            </div>
          </div>
          <div className="champ">
            <label htmlFor="echeances">Échéancier</label>
            <select id="echeances" name="echeances" defaultValue="1">
              <option value="1">Paiement unique</option>
              <option value="2">2 fois</option>
              <option value="3">3 fois</option>
            </select>
          </div>
          <fieldset className="champ">
            <legend>Options</legend>
            <label className="admin-case">
              <input type="checkbox" name="photobooth" value="1" />
              Photobooth 360
            </label>
            <label className="admin-case">
              <input type="checkbox" name="video" value="1" />
              Prestation vidéo (partenaire)
            </label>
            {/* ⚠️ AUCUN TARIF PHOTOBOOTH N'EST AFFICHÉ, PARCE QU'AUCUN N'A ÉTÉ
                ARRÊTÉ. L'option reste « sur devis » jusqu'à ce qu'un montant
                soit saisi sur la fiche du dossier. */}
            <p className="recap__note">
              Le Photobooth 360 est compté « sur devis » : son prix se saisit
              depuis la fiche, une fois convenu.
            </p>
          </fieldset>
          <p className="recap__note">
            Source : <strong>manuel</strong>. Le prix convenu prime sur le tarif
            de la formule — c&apos;est lui qui répartit l&apos;échéancier.
          </p>
        </section>

        <button type="submit" className="btn btn--bloc">Créer le dossier</button>
      </form>
    </main>
  );
}
