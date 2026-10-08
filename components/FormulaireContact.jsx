"use client";

import { useState } from "react";

export default function FormulaireContact() {
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
          Votre demande a bien été envoyée. Je vous réponds personnellement,
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
          <label htmlFor="date">Date du mariage</label>

          <input
            id="date"
            name="date"
            type="text"
            maxLength={120}
            placeholder="12 septembre 2027"
          />
        </div>

        <div className="champ">
          <label htmlFor="lieu">Lieu</label>

          <input
            id="lieu"
            name="lieu"
            type="text"
            maxLength={200}
            placeholder="Paris, Provence, ailleurs…"
          />
        </div>
      </div>

      <div className="champ">
        <label htmlFor="message">Racontez-moi *</label>

        <textarea
          id="message"
          name="message"
          required
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
          {enCours ? "Envoi…" : "Envoyer ma demande"}
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
          Vos informations servent uniquement à vous répondre.
        </p>
      </div>
    </form>
  );
}
