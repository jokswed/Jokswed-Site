"use client";

import { useState } from "react";
import Link from "next/link";
import { FORMULES } from "@/lib/demande.mjs";

export default function FormulaireContact({ detail = false }) {
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  async function envoyer(e) {
    e.preventDefault();
    setErreur("");
    setEnCours(true);

    const formulaire = e.currentTarget;
    const donnees = Object.fromEntries(new FormData(formulaire).entries());

    try {
      const reponse = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(donnees),
      });

      const resultat = await reponse.json().catch(() => ({}));

      if (!reponse.ok || !resultat.ok) {
        throw new Error(
          resultat.message || "Le message n’a pas pu être envoyé."
        );
      }

      formulaire.reset();
      setEnvoye(true);
    } catch (err) {
      setErreur(
        err instanceof Error
          ? err.message
          : "Le message n’a pas pu être envoyé. Merci de réessayer."
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
          {detail ? "Vos informations ont bien été transmises pour préparer votre devis. Cela ne réserve pas votre date. " : "Votre demande a bien été envoyée. "} Je vous réponds personnellement,
          généralement sous 48 heures. À très vite !
        </p>

        <button
          type="button"
          className="btn"
          onClick={() => setEnvoye(false)}
        >
          Envoyer une autre demande
        </button>
      </div>
    );
  }

  return (
    <form className="formulaire" onSubmit={envoyer}>
      <input type="hidden" name="type" value={detail ? "devis" : "contact"} />
      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor="noms">Vos prénoms *</label>

          <input
            id="noms"
            name="noms"
            type="text"
            required
            maxLength={120}
            autoComplete="name"
            placeholder="Antony & Eva"
          />
        </div>

        <div className="champ">
          <label htmlFor="email">Votre e-mail *</label>

          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="vous@exemple.com"
          />
        </div>
      </div>

      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor="date">Date du mariage{detail ? " *" : ""}</label>

          <input
            id="date"
            name="date"
            type={detail ? "date" : "text"}
            required={detail}
            maxLength={120}
            placeholder="12 septembre 2027"
          />
        </div>

        <div className="champ">
          <label htmlFor="lieu">Lieu(x){detail ? " *" : ""}</label>

          <input
            id="lieu"
            name="lieu"
            type="text"
            maxLength={500}
            required={detail}
            placeholder={detail ? "Adresses des cérémonies et de la réception" : "Paris, Provence, ailleurs…"}
          />
        </div>
      </div>

      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor="formule">Formule envisagée</label>
          <select id="formule" name="formule" defaultValue="indecis">
            {Object.entries(FORMULES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="champ">
          <label htmlFor="telephone">Téléphone (facultatif)</label>
          <input id="telephone" name="telephone" type="tel" autoComplete="tel" maxLength={40} />
        </div>
      </div>
      {detail && <fieldset className="dossier-champs">
        <legend>Les informations pour vos documents</legend>
        <p>Les champs marqués * sont nécessaires. Si vous souhaitez signer à deux, renseignez aussi le second signataire.</p>
        <div className="champ">
          <label htmlFor="nomSignataire">Nom et prénom complets du signataire *</label>
          <input id="nomSignataire" name="nomSignataire" required maxLength={160} autoComplete="section-signataire name" />
        </div>
        <div className="champ">
          <label htmlFor="adresse">Adresse de facturation complète, code postal, ville et pays *</label>
          <textarea id="adresse" name="adresse" required maxLength={500} autoComplete="street-address" />
        </div>
        <div className="formulaire__deux">
          <div className="champ">
            <label htmlFor="secondSignataire">Nom complet du second signataire (facultatif)</label>
            <input id="secondSignataire" name="secondSignataire" maxLength={160} autoComplete="section-second name" />
          </div>
          <div className="champ">
            <label htmlFor="secondEmail">E-mail du second signataire (facultatif)</label>
            <input id="secondEmail" name="secondEmail" type="email" maxLength={254} autoComplete="section-second email" />
          </div>
        </div>
        <div className="champ">
          <label htmlFor="horaires">Horaires souhaités (si connus)</label>
          <input id="horaires" name="horaires" maxLength={300} placeholder="Début et fin de présence, horaires des cérémonies…" />
        </div>
        <div className="champ">
          <label htmlFor="options">Options souhaitées (facultatif)</label>
          <textarea id="options" name="options" maxLength={1000} placeholder="Séance engagement, album supplémentaire…" />
        </div>
      </fieldset>}

      <div className="champ">
        <label htmlFor="message">{detail ? "Informations complémentaires (facultatif)" : "Racontez-moi *"}</label>

        <textarea
          id="message"
          name="message"
          required={!detail}
          maxLength={5000}
          placeholder="Votre rencontre, votre journée, ce qui compte pour vous…"
        />
      </div>

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
        }}
      >
        <label htmlFor="website">Site web</label>

        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <button type="submit" className="btn" disabled={enCours}>
          {enCours ? "Envoi…" : detail ? "Transmettre mes informations" : "Envoyer ma demande"}
        </button>

        {erreur && (
          <p
            role="alert"
            style={{
              marginTop: "1rem",
              color: "#9b2c2c",
              lineHeight: 1.5,
            }}
          >
            {erreur}
          </p>
        )}

        <p className="formulaire__note" style={{ marginTop: "1rem" }}>
          Vos informations sont utilisées pour répondre à votre demande{detail ? " et préparer votre devis et votre contrat" : ""}. <Link href="/confidentialite">En savoir plus sur vos données</Link>.
          {detail && " L’envoi de ce formulaire ne vaut ni signature ni réservation."}
        </p>
      </div>
    </form>
  );
}
