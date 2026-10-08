"use client";

/* =============================================================================
   <Galerie> — mosaïque d'images cliquables + visionneuse plein écran.
   - Chargement progressif : next/image charge chaque photo à la demande.
   - Visionneuse : navigation au clic, aux flèches du clavier, fermeture Échap.
   - Chaque image « se développe » à l'apparition (effet signature).

   Props :
     photos        : [{ src, alt }]
     pleineLargeur : indices (0, 1, 2…) des photos à afficher en pleine largeur
                     (utilisé sur les pages reportage pour le côté immersif)
   ============================================================================= */

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import Reveal from "@/components/Reveal";

export default function Galerie({ photos, pleineLargeur = [] }) {
  const [index, setIndex] = useState(null); // null = visionneuse fermée
  const ouverte = index !== null;

  const fermer = useCallback(() => setIndex(null), []);
  const suivante = useCallback(
    () => setIndex((i) => (i + 1) % photos.length),
    [photos.length]
  );
  const precedente = useCallback(
    () => setIndex((i) => (i - 1 + photos.length) % photos.length),
    [photos.length]
  );

  /* Clavier + verrouillage du défilement quand la visionneuse est ouverte */
  useEffect(() => {
    if (!ouverte) return;
    const onKey = (e) => {
      if (e.key === "Escape") fermer();
      if (e.key === "ArrowRight") suivante();
      if (e.key === "ArrowLeft") precedente();
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [ouverte, fermer, suivante, precedente]);

  return (
    <>
      {/* --- Mosaïque --- */}
      <div className="mosaique">
        {photos.map((p, i) =>
          pleineLargeur.includes(i) ? null : (
            <button
              key={p.src}
              onClick={() => setIndex(i)}
              aria-label={`Agrandir : ${p.alt || "photographie"}`}
              style={{ display: "block", width: "100%", padding: 0 }}
            >
              <Reveal photo retard={(i % 3) * 0.08}>
                <Image
                  src={p.src}
                  alt={p.alt || ""}
                  width={1200}
                  height={1500}
                  sizes="(max-width: 900px) 50vw, 33vw"
                  style={{ width: "100%", height: "auto" }}
                />
              </Reveal>
            </button>
          )
        )}
      </div>

      {/* --- Images pleine largeur (immersion) --- */}
      {pleineLargeur.map((i) =>
        photos[i] ? (
          <button
            key={photos[i].src}
            onClick={() => setIndex(i)}
            aria-label={`Agrandir : ${photos[i].alt || "photographie"}`}
            style={{ display: "block", width: "100%", padding: 0, marginTop: "clamp(0.9rem, 2vw, 1.6rem)" }}
          >
            <Reveal photo className="pleine-largeur">
              <Image
                src={photos[i].src}
                alt={photos[i].alt || ""}
                width={2400}
                height={1030}
                sizes="100vw"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Reveal>
          </button>
        ) : null
      )}

      {/* --- Visionneuse --- */}
      {ouverte && (
        <div
          className="visionneuse"
          role="dialog"
          aria-modal="true"
          aria-label="Visionneuse de photographies"
        >
          <div className="visionneuse__barre">
            <span>
              {String(index + 1).padStart(2, "0")} / {String(photos.length).padStart(2, "0")}
            </span>
            <button className="visionneuse__fermer" onClick={fermer} autoFocus>
              Fermer ✕
            </button>
          </div>
          <div className="visionneuse__scene" onClick={fermer}>
            <button
              className="visionneuse__nav visionneuse__nav--prec"
              onClick={(e) => { e.stopPropagation(); precedente(); }}
              aria-label="Photographie précédente"
            >
              ←
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[index].src}
              alt={photos[index].alt || ""}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="visionneuse__nav visionneuse__nav--suiv"
              onClick={(e) => { e.stopPropagation(); suivante(); }}
              aria-label="Photographie suivante"
            >
              →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
