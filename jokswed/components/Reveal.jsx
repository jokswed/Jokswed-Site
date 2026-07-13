"use client";

/* =============================================================================
   <Reveal> — apparition douce au défilement.
   Utilisation :
     <Reveal>...</Reveal>                     → fondu + léger glissement
     <Reveal retard={0.15}>...</Reveal>       → avec un décalage (cascade)
     <Reveal photo>...</Reveal>               → effet « tirage qui se développe »
   Respecte automatiquement prefers-reduced-motion (voir globals.css).
   ============================================================================= */

import { useEffect, useRef, useState } from "react";

export default function Reveal({
  children,
  retard = 0,
  photo = false,
  as: Tag = "div",
  className = "",
  ...props
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entree]) => {
        if (entree.isIntersecting) {
          setVisible(true);
          obs.disconnect(); // une seule apparition, jamais de clignotement
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const classes = [
    photo ? "photo photo--revele" : "reveal",
    visible ? "est-visible" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag
      ref={ref}
      className={classes}
      style={retard ? { "--retard": `${retard}s`, transitionDelay: photo ? `${retard}s` : undefined } : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
}
