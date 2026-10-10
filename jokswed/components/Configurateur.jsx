"use client";

/* =============================================================================
   <Configurateur> — formules, suppléments, vidéaste et formulaire
   -----------------------------------------------------------------------------
   Un SEUL îlot client pour tout le parcours commercial de l'accueil. La bande
   photographique, la FAQ et le reste de la page restent rendus côté serveur :
   le JavaScript envoyé ne couvre que ce qui est réellement interactif.

   ⚠️ LA SÉLECTION EST PORTÉE ICI, PAS DANS LE FORMULAIRE.

   « Choisir cette formule » depuis une carte et changer d'avis depuis le
   formulaire modifient le MÊME état. Le client ne resaisit jamais son choix,
   et il n'existe pas deux vérités possibles à l'envoi.

   ⚠️ AUCUN PRIX N'EST ENVOYÉ AU SERVEUR.

   Le formulaire transmet des CLÉS (« formule-2 », « videaste »). Les montants
   affichés ici sont indicatifs ; le chiffrage qui engagera JoksWed sera refait
   côté serveur en V4, depuis le catalogue en base. Un prix qui transite par le
   navigateur est un prix qu'on peut modifier avant l'envoi.
   ============================================================================= */

import { useCallback, useMemo, useRef, useState } from "react";
import Reveal from "@/components/Reveal";
import FormulaireContact from "@/components/FormulaireContact";
import { chiffrer, formaterPrix, statutSupplement } from "@/content/offres";

export default function Configurateur({ formules, supplements, videaste }) {
  const [formuleCle, setFormuleCle] = useState(null);
  const [supplementsCles, setSupplementsCles] = useState([]);
  const ancreFormulaire = useRef(null);

  const formuleChoisie = formules.find((f) => f.cle === formuleCle) ?? null;

  /* Les suppléments déjà compris dans la formule retenue sortent de la
     sélection : garder une case cochée pour une prestation facturée 0 €
     entretient exactement la confusion qu'on veut éviter. */
  const choisirFormule = useCallback(
    (cle, faireDefiler = true) => {
      setFormuleCle(cle);
      setSupplementsCles((actuels) =>
        actuels.filter((c) => {
          const s = supplements.find((x) => x.cle === c);
          return s ? statutSupplement(s, cle) === "proposable" : false;
        }),
      );
      if (faireDefiler && ancreFormulaire.current) {
        ancreFormulaire.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [supplements],
  );

  const basculerSupplement = useCallback((cle) => {
    setSupplementsCles((actuels) =>
      actuels.includes(cle) ? actuels.filter((c) => c !== cle) : [...actuels, cle],
    );
  }, []);

  const devis = useMemo(
    () => chiffrer(formuleCle, supplementsCles),
    [formuleCle, supplementsCles],
  );

  /* La carte vidéaste a sa propre présentation : on la sort de la grille.
     ⚠️ ON L'IDENTIFIE PAR SON EXÉCUTANT, PAS PAR SA CLÉ.
     Le supplément a pour clé « videaste » ; le partenaire, « videaste-partenaire ».
     Comparer les deux ne renvoyait rien, et la carte disparaissait purement et
     simplement de la page. Le lien correct est `executantPartenaire`, qui est
     justement ce qui permettra demain d'avoir plusieurs vidéastes. */
  const supplementVideo = supplements.find((s) => s.executantPartenaire === videaste.cle);
  const cleVideo = supplementVideo?.cle;
  const autresSupplements = supplements.filter((s) => s.cle !== cleVideo);
  const videoAjoutee = cleVideo ? supplementsCles.includes(cleVideo) : false;

  const etiquettePrix = (supplement) =>
    supplement.prixCents === null ? "Sur devis" : formaterPrix(supplement.prixCents);

  return (
    <>
      {/* ═══════════════════ LES TROIS FORMULES ═══════════════════ */}
      <section className="section" id="formules">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Formules</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Trois façons de <em>raconter</em> votre journée
            </Reveal>
            <Reveal as="p" className="texte" retard={0.2}>
              Prix toutes taxes comprises, déplacements en France métropolitaine inclus.
            </Reveal>
          </div>

          <div className="formules">
            {formules.map((f, i) => {
              const choisie = f.cle === formuleCle;
              return (
                <Reveal
                  key={f.cle}
                  retard={i * 0.1}
                  className={`formule ${f.misEnAvant ? "formule--phare" : ""} ${
                    choisie ? "formule--choisie" : ""
                  }`}
                >
                  <p className="label label--nu">{f.surnom}</p>
                  <h3 className="formule__nom">{f.nom}</h3>
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

                  <div className="formule__choix">
                    <button
                      type="button"
                      className={`btn btn--bloc ${choisie ? "" : "btn--fantome"}`}
                      onClick={() => choisirFormule(f.cle)}
                      aria-pressed={choisie}
                    >
                      {choisie ? "✓ Formule sélectionnée" : "Choisir cette formule"}
                    </button>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════ SUPPLÉMENTS ═══════════════════ */}
      <section className="section section--papier" id="supplements">
        <div className="conteneur">
          <div className="entete-section">
            <Reveal as="p" className="label">Sur mesure</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Compléter votre <em>formule</em>
            </Reveal>
            <Reveal as="p" className="texte" retard={0.2}>
              {formuleChoisie
                ? `Ajoutez ce qui vous manque à la ${formuleChoisie.nom}. Ce qu'elle comprend déjà est signalé, et jamais compté deux fois.`
                : "Choisissez d'abord une formule : je vous indiquerai alors ce qu'elle comprend déjà, pour ne rien vous facturer en double."}
            </Reveal>
          </div>

          <div className="supplements">
            {autresSupplements.map((s) => {
              const statut = statutSupplement(s, formuleCle);
              if (statut === "incompatible") return null;

              /* ⚠️ LE CAS QUI COMPTE : déjà compris dans la formule.
                 On l'affiche — le client doit voir qu'il l'a — mais la carte
                 n'est pas un bouton, et `chiffrer()` ne l'additionne pas. */
              if (statut === "inclus") {
                return (
                  <div key={s.cle} className="supplement supplement--inclus">
                    <p className="supplement__titre">
                      <span>{s.nom}</span>
                    </p>
                    <p className="etiquette-incluse">✓ Incluse dans votre formule</p>
                    <p className="supplement__texte">{s.description}</p>
                  </div>
                );
              }

              const actif = supplementsCles.includes(s.cle);
              return (
                <button
                  key={s.cle}
                  type="button"
                  className="supplement"
                  aria-pressed={actif}
                  onClick={() => basculerSupplement(s.cle)}
                >
                  <span className="supplement__titre">
                    <span>{s.nom}</span>
                    <span className="supplement__prix">{etiquettePrix(s)}</span>
                  </span>
                  <span className="supplement__texte">{s.description}</span>
                  <span className="etiquette-incluse" aria-hidden="true">
                    {actif ? "✓ Ajouté" : "+ Ajouter"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ─────────── LA CARTE VIDÉASTE ─────────── */}
          {supplementVideo ? (
            <Reveal style={{ marginTop: "clamp(2rem, 5vw, 3.5rem)" }}>
              <div className="videaste">
                <div className="videaste__texte">
                  <p className="label label--nu">Votre mariage en vidéo</p>
                  <h3 className="display t-carte" style={{ marginBottom: "0.2rem" }}>
                    {videaste.nom}
                  </h3>
                  <p className="supplement__prix" style={{ marginBottom: "0.4rem" }}>
                    {videaste.metier}
                  </p>

                  {/* Texte de présentation fourni par le vidéaste, mot pour mot.
                      Ses coordonnées personnelles ne sont PAS publiées : elles
                      servent à créer son compte collaborateur, pas la vitrine. */}
                  {videaste.presentation.split("\n").map((paragraphe) => (
                    <p key={paragraphe.slice(0, 40)}>{paragraphe}</p>
                  ))}

                  <p className="recap__note">
                    Prestation réalisée et facturée séparément par son entreprise.
                    Le tarif vous est communiqué après étude de votre projet.
                  </p>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", marginTop: "0.6rem" }}>
                    <button
                      type="button"
                      className={`btn ${videoAjoutee ? "" : "btn--fantome"}`}
                      aria-pressed={videoAjoutee}
                      onClick={() => basculerSupplement(cleVideo)}
                    >
                      {videoAjoutee
                        ? "✓ Vidéaste ajouté"
                        : "Ajouter un vidéaste à mon mariage"}
                    </button>
                    {videaste.lienPortfolio ? (
                      <a
                        className="btn btn--fantome"
                        href={videaste.lienPortfolio}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Voir ses réalisations
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="videaste__media">
                  {videaste.apercuVideo ? (
                    <video
                      controls
                      preload="none"
                      playsInline
                      poster={videaste.apercuMiniature ?? undefined}
                    >
                      <source src={videaste.apercuVideo} type="video/mp4" />
                    </video>
                  ) : (
                    /* ⚠️ AUCUNE VIDÉO D'APERÇU N'A ÉTÉ FOURNIE.
                       Elle n'est ni dans le ZIP ni dans les pièces jointes. On
                       réserve l'emplacement et on le dit, plutôt que de monter
                       un lecteur vide ou de substituer une autre vidéo. */
                    <p className="videaste__attente">
                      Aperçu vidéo
                      <br />
                      à venir
                    </p>
                  )}
                </div>
              </div>
            </Reveal>
          ) : null}
        </div>
      </section>

      {/* ═══════════════════ APPEL À L'ACTION ═══════════════════ */}
      <section className="section">
        <div className="conteneur" style={{ maxWidth: "var(--max-texte)", textAlign: "center" }}>
          <Reveal as="p" className="label">Et maintenant ?</Reveal>
          <Reveal as="h2" className="display t-section" retard={0.1}>
            Et si nous racontions <em>votre histoire</em> ?
          </Reveal>
          <Reveal as="p" className="texte" retard={0.2} style={{ marginTop: "1.2rem" }}>
            Partagez-moi quelques détails sur votre mariage et découvrons ensemble la
            formule qui vous correspond.
          </Reveal>
          <Reveal retard={0.3} style={{ marginTop: "2.2rem" }}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                ancreFormulaire.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Vérifier ma date et faire une demande
            </button>
            {/* ⚠️ « Vérifier » n'est pas « réserver ».
                Aucun calendrier de disponibilités n'est encore branché : le
                bouton ouvre une demande, et le texte ne promet rien d'autre. */}
            <p className="recap__note" style={{ marginTop: "1rem" }}>
              Votre date est vérifiée à la main, puis confirmée par écrit.
              Une demande ne réserve pas encore votre journée.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════════════ FORMULAIRE ═══════════════════ */}
      <section className="section section--papier" id="demande" ref={ancreFormulaire}>
        <div className="conteneur" style={{ maxWidth: "48rem" }}>
          <div className="entete-section">
            <Reveal as="p" className="label">Votre demande</Reveal>
            <Reveal as="h2" className="display t-section" retard={0.1}>
              Parlez-moi de <em>votre journée</em>
            </Reveal>
          </div>

          {/* Changer d'avis sans remonter la page. */}
          <div style={{ display: "grid", gap: "0.8rem", marginBottom: "2rem" }}>
            <p className="label label--nu">Formule souhaitée</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem" }}>
              {formules.map((f) => (
                <button
                  key={f.cle}
                  type="button"
                  className={`btn ${f.cle === formuleCle ? "" : "btn--fantome"}`}
                  style={{ padding: "0.8rem 1.4rem", fontSize: "0.82rem" }}
                  aria-pressed={f.cle === formuleCle}
                  onClick={() => choisirFormule(f.cle, false)}
                >
                  {f.nom} — {formaterPrix(f.prixCents)}
                </button>
              ))}
              <button
                type="button"
                className={`btn ${formuleCle === null ? "" : "btn--fantome"}`}
                style={{ padding: "0.8rem 1.4rem", fontSize: "0.82rem" }}
                aria-pressed={formuleCle === null}
                onClick={() => choisirFormule(null, false)}
              >
                Je ne sais pas encore
              </button>
            </div>
          </div>

          <FormulaireContact formule={formuleCle ?? ""} supplements={supplementsCles}>
            <Recapitulatif
              devis={devis}
              formuleChoisie={formuleChoisie}
              supplements={supplements}
              supplementsCles={supplementsCles}
            />
          </FormulaireContact>
        </div>
      </section>
    </>
  );
}

/* -----------------------------------------------------------------------------
   RÉCAPITULATIF
   ⚠️ UN TOTAL N'EST ANNONCÉ QUE S'IL EST COMPLET.

   Dès qu'une ligne reste à chiffrer, `devis.totalDefinitif` est faux et on
   n'affiche PAS de total : seulement le prix de la formule et la liste des
   prestations à chiffrer. Un total partiel présenté comme un total est une
   promesse qu'on ne tiendra pas.
   --------------------------------------------------------------------------- */
function Recapitulatif({ devis, formuleChoisie, supplements, supplementsCles }) {
  if (!formuleChoisie && supplementsCles.length === 0) return null;

  const retenus = supplementsCles
    .map((cle) => supplements.find((s) => s.cle === cle))
    .filter(Boolean);

  return (
    <div className="recap" aria-live="polite">
      <p className="label label--nu">Récapitulatif</p>

      {formuleChoisie ? (
        <p className="recap__ligne">
          <span>{formuleChoisie.nom} — {formuleChoisie.surnom}</span>
          <span>{formaterPrix(formuleChoisie.prixCents)} TTC</span>
        </p>
      ) : (
        <p className="recap__ligne">
          <span>Formule</span>
          <span>À définir ensemble</span>
        </p>
      )}

      {retenus.map((s) => (
        <p key={s.cle} className="recap__ligne">
          <span>{s.nom}</span>
          <span>{s.prixCents === null ? "Sur devis" : formaterPrix(s.prixCents)}</span>
        </p>
      ))}

      {devis.dejaIncluses.length > 0 ? (
        <p className="recap__note">
          Déjà compris dans votre formule, donc non facturé :{" "}
          {devis.dejaIncluses.join(", ")}.
        </p>
      ) : null}

      {devis.totalDefinitif && formuleChoisie ? (
        <p className="recap__ligne recap__ligne--total">
          <span>Total</span>
          <span>{formaterPrix(devis.totalChiffrableCents)} TTC</span>
        </p>
      ) : (
        <p className="recap__note">
          {devis.aChiffrer.length > 0
            ? `Le tarif de ${devis.aChiffrer.join(", ")} dépend de votre projet : je vous le communique avec votre devis. Aucun total n'est donc affiché ici tant qu'il n'est pas complet.`
            : "Le montant exact figurera sur votre devis."}
        </p>
      )}
    </div>
  );
}
