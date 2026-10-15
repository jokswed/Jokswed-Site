"use client";

import { useState } from "react";

/* =============================================================================
   UNE URL QU'ON PEUT LIRE, SÉLECTIONNER, ET COPIER
   -----------------------------------------------------------------------------
   ⚠️ LE CHAMP RESTE LA VÉRITÉ, LE BOUTON N'EST QU'UN RACCOURCI.

   `navigator.clipboard` n'existe pas hors contexte sécurisé, et le navigateur
   peut refuser l'autorisation. L'URL est donc d'abord affichée dans un champ
   en lecture seule, sélectionnable à la main : si la copie échoue, on le dit,
   et il reste un moyen de faire.
   ============================================================================= */
export default function CopierLien({ valeur, libelle = "Copier" }) {
  const [etat, setEtat] = useState("pret");

  async function copier() {
    try {
      await navigator.clipboard.writeText(valeur);
      setEtat("copie");
      setTimeout(() => setEtat("pret"), 2500);
    } catch {
      setEtat("refuse");
    }
  }

  return (
    <div className="admin-ligne-actions">
      <input type="text" readOnly value={valeur} aria-label="Adresse du flux"
        onFocus={(e) => e.currentTarget.select()}
        style={{ flex: "1 1 20rem", fontFamily: "monospace", fontSize: "0.8rem" }} />
      <button type="button" className="btn btn--fantome" onClick={copier}>
        {etat === "copie" ? "Copié" : libelle}
      </button>
      {etat === "refuse" ? (
        <span className="recap__note">
          Copie refusée par le navigateur — sélectionnez le champ.
        </span>
      ) : null}
    </div>
  );
}
