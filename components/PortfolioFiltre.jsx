"use client";

/* =============================================================================
   <PortfolioFiltre> — filtres du portfolio (Tout / Mariage / Couples / Éditorial)
   Le filtrage est instantané, sans rechargement de page.
   ============================================================================= */

import { useState } from "react";
import Galerie from "@/components/Galerie";
import { portfolio, categoriesPortfolio } from "@/content/site";

export default function PortfolioFiltre() {
  const [actif, setActif] = useState("tout");

  const photos =
    actif === "tout" ? portfolio : portfolio.filter((p) => p.categorie === actif);

  return (
    <>
      <div className="filtres" role="tablist" aria-label="Filtrer le portfolio">
        {categoriesPortfolio.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={actif === c.id}
            className={`filtre ${actif === c.id ? "est-actif" : ""}`}
            onClick={() => setActif(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* key={actif} force une réapparition en douceur à chaque filtre */}
      <div key={actif}>
        <Galerie photos={photos} />
      </div>
    </>
  );
}
