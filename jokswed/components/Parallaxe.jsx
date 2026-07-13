"use client";

/* =============================================================================
   <Parallaxe> — très léger décalage vertical au défilement (héros).
   Implémenté avec requestAnimationFrame + transform : fluide à 60 fps,
   aucun reflow. Désactivé si l'utilisateur préfère réduire les animations.
   ============================================================================= */

import { useEffect, useRef } from "react";

export default function Parallaxe({ children, vitesse = 0.18, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cadre = null;
    const rendre = () => {
      cadre = null;
      const y = Math.min(window.scrollY, window.innerHeight * 1.2);
      el.style.transform = `translate3d(0, ${y * vitesse}px, 0)`;
    };
    const onScroll = () => {
      if (cadre === null) cadre = requestAnimationFrame(rendre);
    };

    rendre();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (cadre) cancelAnimationFrame(cadre);
    };
  }, [vitesse]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
