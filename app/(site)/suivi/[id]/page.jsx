import { notFound } from "next/navigation";
import { sansIdentite } from "@/lib/db/client";
import { verifierSuiviDemande } from "@/lib/suivi/demande";
import { formaterDateSql } from "@/lib/dates";
import SuiviAutoRefresh from "@/components/SuiviAutoRefresh";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Suivi de votre demande",
  robots: { index: false, follow: false },
};

const STATUTS = {
  non_lue: ["Demande reçue", "Votre demande est bien enregistrée."],
  a_traiter: ["Étude en cours", "Je consulte les informations que vous m’avez transmises."],
  en_cours_devis: ["Proposition en préparation", "Je prépare les éléments adaptés à votre journée."],
  attente_client: ["Votre retour est attendu", "Une réponse ou une information de votre part est nécessaire."],
  attente_collaborateur: ["Coordination en cours", "Je finalise un point avec un partenaire."],
  devis_envoye: ["Proposition envoyée", "Une proposition vous a été adressée."],
  confirmee: ["Mariage confirmé", "Votre dossier est confirmé chez JoksWed."],
  refusee: ["Demande clôturée", "Cette demande a été clôturée."],
  archivee: ["Demande clôturée", "Cette demande a été archivée."],
};

export default async function SuiviDemande({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const token = typeof sp?.t === "string" ? sp.t : null;

  if (!verifierSuiviDemande(id, token)) notFound();

  const { rows } = await sansIdentite((q) =>
    q("SELECT * FROM app.demande_suivi_public($1)", [id]),
  );
  const demande = rows[0];
  if (!demande) notFound();

  const [titre, explication] = STATUTS[demande.statut] ?? [
    "Demande en cours",
    "Votre demande est bien enregistrée chez JoksWed.",
  ];

  return (
    <main style={{
      minHeight: "75vh",
      display: "grid",
      placeItems: "center",
      padding: "clamp(2rem, 7vw, 6rem) 1.2rem",
    }}>
      <SuiviAutoRefresh />
      <article style={{
        width: "min(760px, 100%)",
        background: "#fff",
        border: "1px solid #e8e5df",
        padding: "clamp(1.4rem, 5vw, 3.4rem)",
      }}>
        <p className="label label--nu">Suivi · {demande.reference}</p>
        <h1 className="display t-section" style={{ marginTop: "0.7rem" }}>
          {titre}
        </h1>
        <p className="texte" style={{ marginTop: "1rem" }}>{explication}</p>

        <dl style={{
          display: "grid",
          gridTemplateColumns: "minmax(110px, 0.7fr) 1.5fr",
          gap: "0.7rem 1.2rem",
          margin: "2rem 0",
          fontSize: "0.95rem",
        }}>
          <dt style={{ color: "var(--gris, #8b8781)" }}>Couple</dt>
          <dd>{demande.contact_nom}</dd>
          <dt style={{ color: "var(--gris, #8b8781)" }}>Date</dt>
          <dd>{demande.date_mariage ? formaterDateSql(demande.date_mariage) : "À définir"}</dd>
          <dt style={{ color: "var(--gris, #8b8781)" }}>Lieu</dt>
          <dd>{demande.lieu ?? "À préciser"}</dd>
          <dt style={{ color: "var(--gris, #8b8781)" }}>Formule</dt>
          <dd>{demande.formule_nom ?? "À définir ensemble"}</dd>
        </dl>

        {demande.derniere_reponse ? (
          <section style={{
            borderTop: "1px solid #e8e5df",
            paddingTop: "1.5rem",
            marginTop: "1.5rem",
          }}>
            <p className="label label--nu">Dernière réponse de JoksWed</p>
            <div className="texte" style={{ whiteSpace: "pre-wrap", marginTop: "0.8rem" }}>
              {demande.derniere_reponse}
            </div>
            {demande.derniere_reponse_le ? (
              <p className="recap__note" style={{ marginTop: "0.8rem" }}>
                Envoyée le {new Date(demande.derniere_reponse_le).toLocaleString("fr-FR")}
              </p>
            ) : null}
          </section>
        ) : (
          <p className="recap__note" style={{ marginTop: "1.4rem" }}>
            Vous recevrez également un e-mail dès qu’une réponse vous sera envoyée.
            Cette page se met à jour automatiquement.
          </p>
        )}
      </article>
    </main>
  );
}
