"use client";

import { useState } from "react";

/* =============================================================================
   COPIER UN TEXTE, AVEC UN REPLI QUAND LE NAVIGATEUR REFUSE
   -----------------------------------------------------------------------------
   ⚠️ LA COPIE PEUT ÉCHOUER, ET IL FAUT ALORS UN AUTRE CHEMIN.

   `navigator.clipboard` n'existe pas hors contexte sécurisé et le navigateur
   peut refuser l'autorisation. `CopierLien` résolvait cela en affichant un
   champ toujours sélectionnable — mais un récapitulatif de demande fait
   plusieurs centaines de caractères : on ne peut pas le laisser à l'écran en
   permanence. En cas de refus, on dévoile donc le texte dans une zone
   sélectionnable, pliée le reste du temps.

   ⚠️ LE TEXTE EST COMPOSÉ SUR LE SERVEUR.

   Il arrive ici déjà rédigé. Ce composant ne connaît pas la demande, ne refait
   aucun calcul et ne peut donc pas laisser filtrer un champ que le serveur a
   délibérément écarté — jeton de suivi, lien d'administration, identifiant
   interne. Rien n'est envoyé nulle part : la copie est une action du visiteur,
   vers son propre presse-papiers.
   ============================================================================= */
export default function CopierTexte({ texte, libelle = "Copier", titre }) {
  const [etat, setEtat] = useState("pret");

  async function copier() {
    try {
      await navigator.clipboard.writeText(texte);
      setEtat("copie");
      setTimeout(() => setEtat("pret"), 2500);
    } catch {
      setEtat("refuse");
    }
  }

  return (
    <>
      <button type="button" className="btn btn--fantome btn--petit"
        onClick={copier} title={titre ?? libelle}
        aria-label={titre ?? libelle}>
        {/* Deux rectangles superposés : l'icône de copie usuelle. */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true"
          style={{ verticalAlign: "-2px", marginRight: "0.4rem" }}>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
        {etat === "copie" ? "Copié" : libelle}
      </button>
      {etat === "refuse" ? (
        <div style={{ marginTop: "0.6rem" }}>
          <p className="recap__note">
            Copie refusée par le navigateur — sélectionnez le texte ci-dessous.
          </p>
          <textarea readOnly value={texte} rows={8}
            aria-label={titre ?? libelle}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.75rem" }} />
        </div>
      ) : null}
    </>
  );
}
