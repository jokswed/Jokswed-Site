import Link from "next/link";
import { contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces } from "@/lib/auth/acces";
import Retour from "@/components/admin/Retour";

export const metadata = { title: "Plus" };
export const dynamic = "force-dynamic";

/* =============================================================================
   TOUT CE QU'ON N'OUVRE PAS CHAQUE JOUR
   -----------------------------------------------------------------------------
   Le tableau de bord portait onze boutons en grille, à hauteur égale : les
   demandes, qu'on ouvre dix fois par jour, et les réglages de messagerie,
   qu'on touche une fois par mois. Les quatre premières destinations sont
   passées dans la barre du bas ; celles-ci vivent ici, groupées par usage.

   ⚠️ RIEN N'A ÉTÉ RETIRÉ. Les onze destinations existent toujours, aux mêmes
   adresses, avec les mêmes gardes de permission. Seule leur place change.
   ============================================================================= */
export default async function Plus() {
  const { entreprise } = await contexteAdmin();
  const acces = await exigerAcces(entreprise.id);
  const peut = (p) => acces.permissions.has(p);

  const groupes = [
    {
      titre: "Le travail",
      liens: [
        ["dossier.ecrire", "/admin/demandes/nouveau", "Nouveau dossier",
          "Créer un mariage qui n'est pas passé par le formulaire"],
        ["document.rediger", "/admin/dossiers", "Mes dossiers",
          "Les dossiers qui m'ont été confiés"],
        ["collaboration.repondre", "/admin/propositions", "Propositions",
          "Les prestations qu'on me propose"],
      ],
    },
    {
      titre: "L'argent",
      liens: [
        ["finance.lire", "/admin/finances", "Finances",
          "Encaissé, attendu, prévisionnel"],
      ],
    },
    {
      titre: "L'entreprise",
      liens: [
        ["entreprise.reglages", "/admin/entreprise", "Mon entreprise",
          "Identité, mentions, régime de TVA"],
        ["membre.inviter", "/admin/collaborateurs", "Collaborateurs",
          "Inviter, suspendre, révoquer un accès"],
      ],
    },
    {
      titre: "Mes réglages",
      liens: [
        [null, "/admin/parametres/compte", "Mon compte",
          "Mot de passe, second facteur, sessions"],
        ["message.envoyer", "/admin/parametres/messagerie", "Messagerie",
          "Adresses d'envoi et modèles de réponse"],
        [null, "/admin/notifications", "Notifications",
          "Ce dont je veux être prévenu"],
      ],
    },
  ];

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{entreprise.nom_commercial}</p>
          <h1 className="display t-section">Plus</h1>
        </div>
        <div className="admin-actions">
          <Retour vers="/admin" />
        </div>
      </header>

      {groupes.map((g) => {
        const visibles = g.liens.filter(([p]) => p === null || peut(p));
        /* Un groupe dont aucun lien n'est accessible ne laisse pas un titre
           seul au milieu de la page. */
        if (visibles.length === 0) return null;
        return (
          <section className="admin-bloc" key={g.titre}>
            <h2 className="display t-carte">{g.titre}</h2>
            <ul className="plus-liste">
              {visibles.map(([, href, libelle, aide]) => (
                <li key={href}>
                  <Link href={href}>
                    <strong>{libelle}</strong>
                    <span>{aide}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <form method="post" action="/api/admin/deconnexion" style={{ marginTop: "2rem" }}>
        <button type="submit" className="btn btn--fantome">Se déconnecter</button>
      </form>
    </main>
  );
}
