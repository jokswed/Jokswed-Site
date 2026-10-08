"use client";

/* =============================================================================
   EN-TÊTE
   - Transparent au-dessus du héros, il devient blanc translucide au défilement.
   - Sur mobile : menu plein écran avec bouton ✕ indépendant.
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

  const surHeros = pathname === "/" || pathname.startsWith("/faq");

  useEffect(() => {
    const onScroll = () => setDefile(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOuvert(false);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.style.overflow = ouvert ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [ouvert]);

  const plein = defile || !surHeros;

  return (
    <header className={`entete ${plein ? "entete--plein" : ""}`}>
      <div className="conteneur entete__barre">
        <Link
          href="/"
          className="marque"
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

        {/* Burger uniquement lorsque le menu est fermé */}
        {!ouvert && (
          <button
            className="burger"
            aria-expanded="false"
            aria-controls="menu-mobile"
            aria-label="Ouvrir le menu"
            onClick={() => setOuvert(true)}
          >
            <span
              style={!plein ? { background: "#fff" } : undefined}
            />
            <span
              style={!plein ? { background: "#fff" } : undefined}
            />
          </button>
        )}
      </div>

      {/* Menu mobile */}
      <nav
        id="menu-mobile"
        className={`menu-mobile ${ouvert ? "est-ouvert" : ""}`}
        aria-label="Menu mobile"
      >
        {/* Croix indépendante */}
        <button
          className="menu-mobile__close"
          aria-label="Fermer le menu"
          onClick={() => setOuvert(false)}
        >
          ✕
        </button>

        <div className="menu-mobile__liens">
          {LIENS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                transitionDelay: ouvert
                  ? `${0.08 + i * 0.06}s`
                  : "0s",
              }}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <p className="menu-mobile__contact">
          {site.email} · {site.baseline}
        </p>
      </nav>
    </header>
  );
}
