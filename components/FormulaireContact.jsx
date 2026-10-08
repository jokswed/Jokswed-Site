"use client";

/* =============================================================================
   <FormulaireContact>
   -----------------------------------------------------------------------------
   V1 : mise en cohérence avec la route durcie.

     · date en `type="date"` → arrive en ISO AAAA-MM-JJ, exploitable comme donnée
       (c'était du texte libre : « 12 septembre 2027 ») ;
     · téléphone en `type="tel"` → clavier numérique sur iPhone ;
     · DEUX consentements séparés, l'un obligatoire, l'autre facultatif ;
     · clé d'idempotence générée à l'ouverture → un double envoi ne crée pas
       deux demandes ;
     · les cases sont converties en vrais booléens (FormData rend "on").

   Le formulaire progressif en plusieurs étapes, avec sélection de formule et
   suppléments, est l'objet de la V2 (refonte de l'accueil). Ici on corrige ce
   qui est faux ou risqué, sans changer le parcours.
   ============================================================================= */

import { useId, useRef, useState } from "react";

/* ⚠️ LES LABELS DU SITE SONT EN CAPITALES ESPACÉES.

   `app/globals.css` stylise `.champ label` comme une étiquette de champ :
   `text-transform: uppercase`, interlettrage de 3,2 px, gris clair. Parfait
   pour « VOTRE E-MAIL », illisible pour une phrase de consentement de deux
   lignes — vérifié à l'écran : « J'ACCEPTE QUE MES INFORMATIONS SOIENT… ».

   Un texte que l'utilisateur doit lire avant de cocher doit se lire. On repasse
   donc ces deux labels en casse et en couleur normales, sans toucher à la
   feuille de style globale ni aux autres champs. */
const styleConsentement = {
  display: "flex",
  gap: "0.7rem",
  alignItems: "flex-start",
  fontSize: "0.9rem",
  lineHeight: 1.55,
  cursor: "pointer",
  textTransform: "none",
  letterSpacing: "normal",
  color: "var(--encre, #171717)",
  fontWeight: 400,
};

/**
 * @param {object} props
 * @param {string}   [props.formule]      Clé de la formule retenue (« formule-2 »).
 * @param {string[]} [props.supplements]  Clés des suppléments retenus.
 * @param {React.ReactNode} [props.children] Récapitulatif affiché en tête.
 */
export default function FormulaireContact({ formule = "", supplements = [], children }) {
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const idBase = useId();

  /* Une clé par formulaire monté. Conservée tant que l'envoi n'a pas abouti :
     un échec réseau suivi d'un nouveau clic réutilise la même clé, donc la
     route reconnaît le rejeu au lieu de créer une seconde demande. */
  const cleIdempotence = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  /* La date du mariage est nécessairement à venir. */
  const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  async function envoyer(e) {
    e.preventDefault();
    if (enCours) return;
    setErreur("");
    setEnCours(true);

    const formulaire = e.currentTarget;
    const champs = new FormData(formulaire);

    const donnees = {
      noms: champs.get("noms") ?? "",
      email: champs.get("email") ?? "",
      telephone: champs.get("telephone") ?? "",
      date: champs.get("date") ?? "",
      lieu: champs.get("lieu") ?? "",
      message: champs.get("message") ?? "",
      formule: champs.get("formule") ?? "",
      /* Des CLÉS, jamais des montants : le serveur rechiffrera lui-même
         depuis le catalogue. */
      supplements,
      website: champs.get("website") ?? "",
      // FormData rend "on" pour une case cochée, et rien du tout sinon :
      // la route attend des booléens stricts.
      consentement: champs.get("consentement") === "on",
      consentementPartenaire: champs.get("consentementPartenaire") === "on",
    };

    try {
      const reponse = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": cleIdempotence.current,
        },
        body: JSON.stringify(donnees),
      });

      const resultat = await reponse.json().catch(() => ({}));

      if (!reponse.ok || !resultat.ok) {
        throw new Error(resultat.message || "Le message n'a pas pu être envoyé.");
      }

      formulaire.reset();
      setEnvoye(true);
    } catch (err) {
      setErreur(
        err instanceof Error
          ? err.message
          : "Le message n'a pas pu être envoyé. Merci de réessayer.",
      );
    } finally {
      setEnCours(false);
    }
  }

  if (envoye) {
    return (
      <div className="formulaire" role="status" aria-live="polite">
        <h3 className="display t-carte">Merci.</h3>
        <p className="texte">
          Votre demande a bien été envoyée. Je vous réponds personnellement,
          généralement sous 48 heures. À très vite !
        </p>
        {/* ⚠️ Pas de « votre date est réservée » : une demande n'est pas une
            réservation. La date n'est bloquée qu'au contrat signé et à
            l'acompte encaissé (article 2 du contrat). */}
        <button
          type="button"
          className="btn"
          onClick={() => {
            cleIdempotence.current =
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            setEnvoye(false);
          }}
        >
          Envoyer une autre demande
        </button>
      </div>
    );
  }

  return (
    <form className="formulaire" onSubmit={envoyer} noValidate={false}>
      {/* `value` et non `defaultValue` : la formule change après le montage,
         quand le visiteur clique « Choisir cette formule » plus haut dans la
         page. Un champ non contrôlé garderait la valeur initiale — donc une
         chaîne vide — et le choix du client serait silencieusement perdu. */}
      <input type="hidden" name="formule" value={formule} readOnly />

      {children ? <div style={{ marginBottom: "2rem" }}>{children}</div> : null}

      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor={`${idBase}-noms`}>Vos prénoms *</label>
          <input
            id={`${idBase}-noms`}
            name="noms"
            type="text"
            required
            maxLength={120}
            autoComplete="name"
            placeholder="Antony & Eva"
          />
        </div>

        <div className="champ">
          <label htmlFor={`${idBase}-email`}>Votre e-mail *</label>
          <input
            id={`${idBase}-email`}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            placeholder="vous@exemple.com"
          />
        </div>
      </div>

      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor={`${idBase}-telephone`}>Votre téléphone</label>
          <input
            id={`${idBase}-telephone`}
            name="telephone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            inputMode="tel"
            placeholder="06 12 34 56 78"
          />
        </div>

        <div className="champ">
          <label htmlFor={`${idBase}-date`}>Date du mariage</label>
          {/* `type="date"` ouvre le sélecteur natif sur iPhone et garantit un
              format ISO côté serveur. En texte libre, la donnée était
              inexploitable pour vérifier une disponibilité. */}
          <input
            id={`${idBase}-date`}
            name="date"
            type="date"
            min={demain}
            autoComplete="off"
          />
          <p className="formulaire__note" style={{ marginTop: "0.4rem" }}>
            Pas encore fixée ? Laissez vide et dites-le-moi dans votre message.
          </p>
        </div>
      </div>

      <div className="champ">
        <label htmlFor={`${idBase}-lieu`}>Lieu</label>
        <input
          id={`${idBase}-lieu`}
          name="lieu"
          type="text"
          maxLength={200}
          placeholder="Paris, Provence, ailleurs…"
        />
      </div>

      <div className="champ">
        <label htmlFor={`${idBase}-message`}>Racontez-moi *</label>
        <textarea
          id={`${idBase}-message`}
          name="message"
          required
          maxLength={5000}
          placeholder="Votre rencontre, votre journée, ce qui compte pour vous…"
        />
      </div>

      {/* ───────────────── CONSENTEMENTS ─────────────────
          Deux finalités distinctes, donc deux cases distinctes. Une case unique
          pour « vous répondre » ET « transmettre à un partenaire » ne constitue
          pas un consentement valable pour la seconde. */}
      <div className="champ" style={{ gap: "0.9rem" }}>
        <label
          htmlFor={`${idBase}-consentement`}
          style={styleConsentement}
        >
          <input
            id={`${idBase}-consentement`}
            name="consentement"
            type="checkbox"
            required
            style={{ marginTop: "0.25rem", width: "1.1rem", height: "1.1rem", flexShrink: 0 }}
          />
          <span>
            J&apos;accepte que mes informations soient utilisées pour étudier ma demande
            et me répondre. *{" "}
            <a href="/confidentialite" className="lien">
              Politique de confidentialité
            </a>
          </span>
        </label>

        <label
          htmlFor={`${idBase}-consentement-partenaire`}
          style={styleConsentement}
        >
          <input
            id={`${idBase}-consentement-partenaire`}
            name="consentementPartenaire"
            type="checkbox"
            style={{ marginTop: "0.25rem", width: "1.1rem", height: "1.1rem", flexShrink: 0 }}
          />
          <span>
            Si je souhaite une prestation vidéo, j&apos;accepte que mes coordonnées soient
            transmises au vidéaste partenaire pour qu&apos;il établisse son devis.
            <em> Facultatif.</em>
          </span>
        </label>
      </div>

      {/* Champ piège : hors écran, jamais atteint au clavier. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      >
        <label htmlFor={`${idBase}-website`}>Site web</label>
        <input
          id={`${idBase}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <button type="submit" className="btn" disabled={enCours}>
          {enCours ? "Envoi…" : "Envoyer ma demande"}
        </button>

        {erreur && (
          <p role="alert" style={{ marginTop: "1rem", color: "#9b2c2c", lineHeight: 1.5 }}>
            {erreur}
          </p>
        )}

        <p className="formulaire__note" style={{ marginTop: "1rem" }}>
          Envoyer une demande ne réserve pas votre date : elle n&apos;est bloquée
          qu&apos;à la signature du contrat et au versement de l&apos;acompte.
        </p>
      </div>
    </form>
  );
}
