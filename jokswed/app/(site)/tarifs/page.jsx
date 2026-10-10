/* =============================================================================
   PAGE TARIFS — 3 formules, suppléments, déroulement, FAQ
   -----------------------------------------------------------------------------
   ⚠️ CETTE PAGE NE CONTIENT PLUS AUCUN PRIX NI AUCUNE QUESTION EN DUR.

     · formules et suppléments → content/offres.ts (montants en centimes)
     · FAQ                     → content/faq.ts   (sous-ensemble `faqVitrine`)

   Changer un prix se fait à un seul endroit, et l'accueil, le formulaire et —
   en V5 — les devis liront la même valeur.
   ============================================================================= */

import { tarifs } from "@/content/site";
import { formules, supplements, formaterPrix } from "@/content/offres";
import { faqVitrine } from "@/content/faq";
import Reveal from "@/components/Reveal";
import CtaBandeau from "@/components/CtaBandeau";

/* Le prix d'appel vient du catalogue : écrit en dur ici, il se serait mis à
   mentir dès le premier changement de tarif. */
const prixDAppel = formaterPrix(
  Math.min(...formules.filter((f) => f.visible).map((f) => f.prixCents)),
);

export const metadata = {
  title: "Tarifs & formules",
  description:
    "Formules et tarifs de JoksWed, photographe de mariage à Paris et à l'international : " +
    `reportage de mariage, séance engagement, albums fine art. À partir de ${prixDAppel} TTC.`,
  alternates: { canonical: "/tarifs" },
};

export default function Tarifs() {
  const formulesVisibles = formules.filter((f) => f.visible);
  const supplementsVisibles = supplements.filter((s) => s.visible);

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
          {formulesVisibles.map((f, i) => (
            <Reveal
              key={f.cle}
              retard={i * 0.12}
              className={`formule ${f.misEnAvant ? "formule--phare" : ""}`}
            >
              <p className="label label--nu">{f.surnom}</p>
              <h2 className="formule__nom">{f.nom}</h2>
              {/* ⚠️ « TTC » EXPLICITE.

                  Le site livré affichait « 1300€ » sans mention, alors que le
                  devis et le contrat traitent ce montant comme un TTC incluant
                  216,67 € de TVA à 20 %. Face à un consommateur, le prix doit
                  être annoncé toutes taxes comprises, sans ambiguïté. */}
              <p className="formule__prix">
                {formaterPrix(f.prixCents)}
                <span
                  style={{
                    fontSize: "0.42em",
                    letterSpacing: "0.08em",
                    marginLeft: "0.4em",
                    opacity: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  TTC
                </span>
              </p>
              <p className="formule__duree">{f.dureeTexte}</p>
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
          Prix toutes taxes comprises, déplacements en France métropolitaine inclus.
          Paiement en deux ou trois fois possible, selon l&apos;échéancier convenu au devis.
        </Reveal>
      </section>

      {/* --- Suppléments --- */}
      <section className="section section--papier">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Sur mesure</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>Suppléments</Reveal>
          </div>
          <div className="options">
            {supplementsVisibles.map((o, i) => (
              <Reveal key={o.cle} className="option" retard={i * 0.05}>
                <h3>{o.nom}</h3>
                <p>{o.description}</p>
                {/* Aucun tarif d'option ne m'a été communiqué : on l'écrit,
                    plutôt que d'afficher un prix inventé. */}
                <p
                  className="label label--nu"
                  style={{ marginTop: "0.6rem", opacity: 0.65 }}
                >
                  {o.prixCents === null ? "Sur devis" : formaterPrix(o.prixCents)}
                </p>
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

      {/* --- FAQ (extrait de la source unique) --- */}
      <section className="section section--papier">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Questions fréquentes</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>FAQ</Reveal>
          </div>
          <Reveal className="faq">
            {faqVitrine.map((q) => (
              <details key={q.cle}>
                <summary>{q.question}</summary>
                <p>{q.reponse}</p>
              </details>
            ))}
          </Reveal>
          <Reveal style={{ marginTop: "2rem" }}>
            <a href="/faq" className="lien">Toutes les questions →</a>
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
