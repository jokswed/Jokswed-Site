"use client";

/* =============================================================================
   <FormulaireContact>
   Par défaut, le formulaire compose un e-mail prérempli dans le client mail
   du visiteur : aucun serveur nécessaire, fonctionne immédiatement.

   💡 Pour recevoir les messages directement (sans client mail) :
      1. Créez un formulaire gratuit sur https://formspree.io
      2. Remplacez la constante FORMSPREE_ID ci-dessous par votre identifiant
         (ex. "mqkvabcd") — le formulaire basculera automatiquement en envoi direct.
   ============================================================================= */

import { useState } from "react";
import { site } from "@/content/site";

const FORMSPREE_ID = ""; // ← ex. "mqkvabcd" (laisser vide pour le mode e-mail)

export default function FormulaireContact() {
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function envoyer(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const donnees = Object.fromEntries(f.entries());

    /* --- Mode Formspree (envoi direct) --- */
    if (FORMSPREE_ID) {
      setEnCours(true);
      try {
        const rep = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: f,
        });
        if (rep.ok) setEnvoye(true);
      } finally {
        setEnCours(false);
      }
      return;
    }

    /* --- Mode e-mail prérempli (par défaut) --- */
    const sujet = encodeURIComponent(`Demande mariage — ${donnees.noms || ""}`);
    const corps = encodeURIComponent(
      `Bonjour Joks,\n\n` +
        `Nos prénoms : ${donnees.noms}\n` +
        `Date du mariage : ${donnees.date || "à définir"}\n` +
        `Lieu : ${donnees.lieu || "à définir"}\n\n` +
        `${donnees.message}\n\n` +
        `Notre e-mail : ${donnees.email}`
    );
    window.location.href = `mailto:${site.email}?subject=${sujet}&body=${corps}`;
    setEnvoye(true);
  }

  if (envoye) {
    return (
      <div className="formulaire">
        <h3 className="display t-carte">Merci.</h3>
        <p className="texte">
          Votre message est en route. Je vous réponds personnellement, en général
          sous 48 heures. À très vite !
        </p>
      </div>
    );
  }

  return (
    <form className="formulaire" onSubmit={envoyer}>
      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor="noms">Vos prénoms *</label>
          <input id="noms" name="noms" type="text" required autoComplete="name" placeholder="Camille & Alex" />
        </div>
        <div className="champ">
          <label htmlFor="email">Votre e-mail *</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="vous@exemple.com" />
        </div>
      </div>

      <div className="formulaire__deux">
        <div className="champ">
          <label htmlFor="date">Date du mariage</label>
          <input id="date" name="date" type="text" placeholder="12 septembre 2027" />
        </div>
        <div className="champ">
          <label htmlFor="lieu">Lieu</label>
          <input id="lieu" name="lieu" type="text" placeholder="Paris, Provence, ailleurs…" />
        </div>
      </div>

      <div className="champ">
        <label htmlFor="message">Racontez-moi *</label>
        <textarea
          id="message"
          name="message"
          required
          placeholder="Votre rencontre, votre journée, ce qui compte pour vous…"
        />
      </div>

      <div>
        <button type="submit" className="btn" disabled={enCours}>
          {enCours ? "Envoi…" : "Envoyer mon message"}
        </button>
        <p className="formulaire__note" style={{ marginTop: "1rem" }}>
          Vos informations ne servent qu'à vous répondre. Rien d'autre.
        </p>
      </div>
    </form>
  );
}
