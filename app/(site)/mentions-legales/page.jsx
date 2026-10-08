/* Mentions légales — page absente du site livré. */
import Reveal from "@/components/Reveal";
import {
  entreprise,
  hebergeur,
  mentionMediateur,
  mentionTva,
} from "@/content/legal";

export const metadata = {
  title: "Mentions légales",
  description:
    "Mentions légales du site JoksWed : éditeur, hébergeur, propriété intellectuelle et médiation de la consommation.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/mentions-legales" },
};

export default function MentionsLegales() {
  return (
    <>
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">Informations légales</Reveal>
        <Reveal as="h1" className="display t-hero" retard={0.1}>
          Mentions <em>légales</em>
        </Reveal>
      </header>

      <section className="conteneur" style={{ paddingBottom: "var(--section)", maxWidth: "48rem" }}>
        <article className="texte" style={{ display: "grid", gap: "2.5rem" }}>
          <div>
            <h2 className="display t-carte">Éditeur du site</h2>
            <p>
              {entreprise.nomCommercial} — {entreprise.responsable}
              <br />{entreprise.statut}
              <br />{entreprise.adresse}, {entreprise.codePostal} {entreprise.ville}, {entreprise.pays}
              <br />SIRET : {entreprise.siret} · Code APE : {entreprise.codeApe} ({entreprise.activite})
              {mentionTva ? <><br />{mentionTva}</> : null}
              <br />Téléphone : {entreprise.telephone}
              <br />E-mail : <a className="lien" href={`mailto:${entreprise.email}`}>{entreprise.email}</a>
            </p>
            <p>Responsable de la publication : {entreprise.responsable}.</p>
          </div>

          <div>
            <h2 className="display t-carte">Hébergement</h2>
            <p>
              {hebergeur.nom}
              <br />{hebergeur.adresse}
              <br /><a className="lien" href={hebergeur.site} rel="noopener noreferrer" target="_blank">{hebergeur.site}</a>
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Propriété intellectuelle</h2>
            <p>
              L&apos;ensemble des photographies présentées sur ce site est protégé par le droit
              d&apos;auteur et demeure la propriété de {entreprise.responsable}. Toute
              reproduction, représentation, modification ou exploitation, totale ou partielle,
              sans accord écrit préalable est interdite.
            </p>
            <p>
              Les clients bénéficient, sur les images qui leur sont livrées, d&apos;un droit
              d&apos;usage privé, familial et non commercial, dans les conditions prévues au
              contrat de prestation.
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Réclamations et médiation</h2>
            <p>
              Toute réclamation peut être adressée par e-mail à{" "}
              <a className="lien" href={`mailto:${entreprise.email}`}>{entreprise.email}</a>.
              En l&apos;absence de solution amiable, un consommateur peut recourir gratuitement
              à un médiateur de la consommation.
            </p>
            {/* ⚠️ Le contrat fourni porte « À COMPLÉTER AVANT SIGNATURE » à son
                article 14. Tant que le médiateur n'est pas désigné, cette page
                le dit, plutôt que d'afficher un nom inventé. */}
            <p><strong>{mentionMediateur}</strong></p>
          </div>

          <div>
            <h2 className="display t-carte">Données personnelles</h2>
            <p>
              Le traitement des données personnelles est détaillé dans la{" "}
              <a className="lien" href="/confidentialite">politique de confidentialité</a>.
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Cookies</h2>
            <p>
              Ce site ne dépose aucun cookie publicitaire ni traceur de mesure
              d&apos;audience. Les polices de caractères sont hébergées sur le site
              lui-même : aucune requête n&apos;est adressée à un service tiers lors de
              la simple consultation des pages.
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
