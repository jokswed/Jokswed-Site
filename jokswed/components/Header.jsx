"use client";

/* =============================================================================
   EN-TÊTE
   - Transparent au-dessus du héros, il devient blanc translucide au défilement.
   - Sur mobile : menu plein écran, liens qui apparaissent en cascade.
   ============================================================================= */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { site } from "@/content/site";

const LIENS = [
  { href: "/", label: "Accueil" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/faq", label: "FAQ" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/a-propos", label: "À propos" },
  { href: "/contact", label: "Contact" },
];

export default function Header() {
  const pathname = usePathname();
  const [defile, setDefile] = useState(false);
  const [ouvert, setOuvert] = useState(false);

  /* La page d'accueil et les reportages ont un héros sombre :
     le header y reste transparent tant qu'on n'a pas défilé. */
  const surHeros = pathname === "/" || pathname.startsWith("/mariages/");

  useEffect(() => {
    const onScroll = () => setDefile(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Fermer le menu à chaque navigation + bloquer le défilement quand ouvert */
  useEffect(() => setOuvert(false), [pathname]);
  useEffect(() => {
    document.documentElement.style.overflow = ouvert ? "hidden" : "";
    return () => (document.documentElement.style.overflow = "");
  }, [ouvert]);

  const plein = defile || ouvert || !surHeros;

  return (
    <header className={`entete ${plein ? "entete--plein" : ""}`}>
      <div className="conteneur entete__barre">
        <Link
          href="/"
          className="marque"
          aria-label={`${site.nom} — retour à l'accueil`}
          style={!plein ? { color: "#fff" } : undefined}
        >
          Joks<span>Wed</span>
        </Link>

        {/* Navigation bureau */}
        <nav className="nav-bureau" aria-label="Navigation principale">
          {LIENS.filter((l) => l.href !== "/").map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href ? "page" : undefined}
              style={!plein ? { color: "#fff" } : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Bouton menu mobile */}
        <button
          className="burger"
          aria-expanded={ouvert}
          aria-controls="menu-mobile"
          aria-label={ouvert ? "Fermer le menu" : "Ouvrir le menu"}
          onClick={() => setOuvert(!ouvert)}
        >
          <span style={!plein && !ouvert ? { background: "#fff" } : undefined} />
          <span style={!plein && !ouvert ? { background: "#fff" } : undefined} />
        </button>
      </div>

      {/* Menu mobile plein écran */}
      <nav
        id="menu-mobile"
        className={`menu-mobile ${ouvert ? "est-ouvert" : ""}`}
        aria-label="Menu mobile"
      >
        {LIENS.map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            style={{ transitionDelay: ouvert ? `${0.08 + i * 0.06}s` : "0s" }}
          >
            {l.label}
          </Link>
        ))}
        <p className="menu-mobile__contact">
          {site.email} · {site.baseline}
        </p>
      </nav>
    </header>
  );
}
