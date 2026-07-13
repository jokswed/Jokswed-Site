/* =============================================================================
   PAGE TARIFS — 3 formules, options, déroulement, FAQ
   ✏️ Les prix et le contenu des formules se modifient dans /content/site.js
   ============================================================================= */

import { tarifs } from "@/content/site";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";

export const metadata = {
  title: "Tarifs & formules",
  description:
    "Formules et tarifs de JoksWed, photographe de mariage à Paris et à l'international : reportage de mariage, séance engagement, albums fine art.",
};

export default function Tarifs() {
  return (
    <>
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">Tarifs</Reveal>
        <Reveal as="h1" className="display t-hero" retard={0.1}>
          Des formules <em>simples</em>
        </Reveal>
        <Reveal as="p" className="texte" retard={0.2}>{tarifs.intro}</Reveal>
      </header>

      {/* --- Formules --- */}
      <section className="conteneur" style={{ paddingBottom: "var(--section)" }}>
        <div className="formules">
          {tarifs.formules.map((f, i) => (
            <Reveal
              key={f.nom}
              retard={i * 0.12}
              className={`formule ${f.misEnAvant ? "formule--phare" : ""}`}
            >
              <p className="label label--nu">{f.surnom}</p>
              <h2 className="formule__nom">{f.nom}</h2>
              <p className="formule__prix">{f.prix}</p>
              <p className="formule__duree">{f.duree}</p>
              <p style={{ fontSize: "0.98rem" }}>{f.description}</p>
              <ul>
                {f.inclus.map((el) => (
                  <li key={el}>{el}</li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
        <Reveal as="p" className="formulaire__note" style={{ marginTop: "2rem" }}>
          Tarifs communiqués sur devis, frais de déplacement inclus. Facilités de
          paiement possibles.
        </Reveal>
      </section>

      {/* --- Options --- */}
      <section className="section section--papier">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Sur mesure</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>Options</Reveal>
          </div>
          <div className="options">
            {tarifs.options.map((o, i) => (
              <Reveal key={o.nom} className="option" retard={i * 0.05}>
                <h3>{o.nom}</h3>
                <p>{o.detail}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --- Déroulement --- */}
      <section className="section">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Comment ça se passe</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Le déroulement
            </Reveal>
          </div>
          <div className="deroulement">
            {tarifs.deroulement.map((e, i) => (
              <Reveal key={e.titre} className="etape" retard={i * 0.08}>
                <h3>{e.titre}</h3>
                <p>{e.texte}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --- FAQ --- */}
      <section className="section section--papier">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Questions fréquentes</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>FAQ</Reveal>
          </div>
          <Reveal className="faq">
            {tarifs.faq.map((q) => (
              <details key={q.question}>
                <summary>{q.question}</summary>
                <p>{q.reponse}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      <CtaBandeau
        titre="Demandez votre devis personnalisé"
        texte="Chaque journée est différente : écrivez-moi et recevez un devis clair, sans surprise."
        bouton="Demander un devis"
      />
    </>
  );
}
