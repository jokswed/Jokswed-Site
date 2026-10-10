/* =============================================================================
   PAGE CONTACT — formulaire, coordonnées, zone d'intervention, réseaux
   ============================================================================= */

import Image from "next/image";
import { contact, site } from "@/content/site";
import Reveal from "@/components/Reveal";
import FormulaireContact from "@/components/FormulaireContact";

export const metadata = {
  title: "Contact",
  description:
    "Contactez JoksWed, photographe de mariage à Paris et à l'international. Réponse personnelle sous 48 heures.",
};

export default function Contact() {
  return (
    <>
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">Contact</Reveal>
        <Reveal as="h1" className="display t-hero" retard={0.1}>
          {contact.titre}
        </Reveal>
        <Reveal as="p" className="texte" retard={0.2}>{contact.texte}</Reveal>
      </header>

      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        <div className="contact-grille">
          {/* --- Colonne gauche : photo + coordonnées --- */}
          <div className="contact-infos">
            <Reveal photo>
              <Image
                src={contact.image}
                alt="JoksWed — photographe de mariage"
                width={1200}
                height={1500}
                sizes="(max-width: 950px) 100vw, 40vw"
              />
            </Reveal>

            <Reveal className="contact-coordonnees">
              <p className="label label--nu">Coordonnées</p>
              <a href={`mailto:${site.email}`}>{site.email}</a>
              {site.telephone && (
                <a href={`tel:${site.telephone.replace(/\s/g, "")}`}>{site.telephone}</a>
              )}
              <a href={site.instagram} target="_blank" rel="noopener noreferrer">
                Instagram — @jokswed
              </a>
            </Reveal>

            <Reveal className="contact-coordonnees" retard={0.1}>
              <p className="label label--nu">Studio</p>
              <p>{contact.adresse}</p>
              <p style={{ color: "var(--gris)" }}>{contact.zone}</p>
              <a
                href={contact.lienCarte}
                target="_blank"
                rel="noopener noreferrer"
                className="lien"
                style={{ marginTop: "0.6rem" }}
              >
                Voir sur la carte →
              </a>
            </Reveal>
          </div>

          {/* --- Colonne droite : formulaire --- */}
          <Reveal retard={0.15}>
            <FormulaireContact />
          </Reveal>
        </div>
      </section>
    </>
  );
}
