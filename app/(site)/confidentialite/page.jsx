/* Politique de confidentialité — page absente du site livré. */
import Reveal from "@/components/Reveal";
import { entreprise, sousTraitants, traitements } from "@/content/legal";

export const metadata = {
  title: "Politique de confidentialité",
  description:
    "Quelles données JoksWed collecte, pourquoi, combien de temps elles sont conservées et comment exercer vos droits.",
  alternates: { canonical: "/confidentialite" },
};

export default function Confidentialite() {
  return (
    <>
      <header className="conteneur page-entete">
        <Reveal as="p" className="label">Vos données</Reveal>
        <Reveal as="h1" className="display t-hero" retard={0.1}>
          Politique de <em>confidentialité</em>
        </Reveal>
        <Reveal as="p" className="texte" retard={0.2}>
          Ce que je collecte, pourquoi, pour combien de temps, et ce que vous pouvez exiger.
          Sans détour.
        </Reveal>
      </header>

      <section className="conteneur" style={{ paddingBottom: "var(--section)", maxWidth: "52rem" }}>
        <article className="texte" style={{ display: "grid", gap: "2.5rem" }}>
          <div>
            <h2 className="display t-carte">Responsable du traitement</h2>
            <p>
              {entreprise.nomCommercial} — {entreprise.responsable},
              {" "}{entreprise.adresse}, {entreprise.codePostal} {entreprise.ville}.
              <br />Contact : <a className="lien" href={`mailto:${entreprise.email}`}>{entreprise.email}</a>
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Traitements réalisés</h2>
            {/* Une finalité par ligne, avec SA base légale et SA durée.
                Mélanger « répondre à une demande » et « transmettre à un
                partenaire » sous un même consentement ne serait pas valable. */}
            <div style={{ display: "grid", gap: "1.6rem", marginTop: "1rem" }}>
              {traitements.map((t) => (
                <div
                  key={t.finalite}
                  style={{
                    borderLeft: "2px solid var(--ligne)",
                    paddingLeft: "1.2rem",
                  }}
                >
                  <h3 style={{ fontSize: "1.02rem", marginBottom: "0.5rem" }}>{t.finalite}</h3>
                  <p style={{ fontSize: "0.94rem", margin: 0 }}>
                    <strong>Données :</strong> {t.donnees}
                    <br /><strong>Base légale :</strong> {t.baseLegale}
                    <br /><strong>Conservation :</strong> {t.conservation}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="display t-carte">Partage avec le vidéaste partenaire</h2>
            <p>
              Si vous souhaitez une prestation vidéo, vos coordonnées peuvent être transmises
              au vidéaste partenaire afin qu&apos;il établisse son propre devis. Ce partage
              repose <strong>uniquement sur votre consentement</strong>, recueilli par une case
              distincte et facultative du formulaire. Il n&apos;a pas lieu si vous ne la cochez pas.
            </p>
            <p>
              Le vidéaste exerce son activité sous sa propre entreprise : il est responsable du
              traitement des données qu&apos;il reçoit pour établir et exécuter sa prestation.
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Sous-traitants techniques</h2>
            <div style={{ display: "grid", gap: "0.9rem", marginTop: "1rem" }}>
              {sousTraitants.map((s) => (
                <p key={s.nom} style={{ fontSize: "0.94rem", margin: 0 }}>
                  <strong>{s.nom}</strong> — {s.role} <em>({s.zone})</em>
                </p>
              ))}
            </div>
            <p>
              Aucune donnée n&apos;est vendue, louée ni cédée à des fins publicitaires.
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Vos droits</h2>
            <p>
              Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement,
              de limitation, d&apos;opposition et de portabilité, ainsi que du droit de retirer
              à tout moment un consentement donné. Le retrait ne remet pas en cause les
              traitements licitement réalisés auparavant.
            </p>
            <p>
              Pour les exercer, écrivez à{" "}
              <a className="lien" href={`mailto:${entreprise.email}`}>{entreprise.email}</a>.
              Je réponds dans un délai d&apos;un mois.
            </p>
            <p>
              Certaines données ne peuvent pas être effacées à la demande : les documents
              comptables — devis acceptés, contrats, factures — sont conservés pendant les
              durées légales d&apos;archivage qui s&apos;imposent à moi.
            </p>
            <p>
              Si ma réponse ne vous satisfait pas, vous pouvez saisir la CNIL —{" "}
              <a className="lien" href="https://www.cnil.fr" rel="noopener noreferrer" target="_blank">
                cnil.fr
              </a>.
            </p>
          </div>

          <div>
            <h2 className="display t-carte">Sécurité</h2>
            <p>
              Les échanges avec ce site sont chiffrés (HTTPS). Les adresses IP utilisées pour
              limiter les envois abusifs sont <strong>tronquées</strong> et conservées trente
              minutes. Les journaux techniques ne contiennent ni le contenu de vos messages ni
              vos coordonnées.
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
