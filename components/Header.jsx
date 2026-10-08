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
            /* ⚠️ `aria-expanded` était écrit en dur à "false".
               Il décrit l'état du menu, pas celui du bouton : il doit suivre
               `ouvert`, sinon un lecteur d'écran annonce « replié » alors que
               le menu est déployé. */
            aria-expanded={ouvert}
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
      {/* ⚠️ `inert` ET `aria-hidden` QUAND LE MENU EST FERMÉ.

          Ce <nav> reste TOUJOURS dans le document — il est simplement déplacé
          hors écran par la CSS. Sans `inert`, ses six liens et sa croix
          restaient donc atteignables à la tabulation alors qu'ils sont
          invisibles : un utilisateur au clavier traversait un menu fantôme
          avant d'atteindre le contenu. `inert` les retire du parcours de focus
          et des lecteurs d'écran. */}
      <nav
        id="menu-mobile"
        className={`menu-mobile ${ouvert ? "est-ouvert" : ""}`}
        aria-label="Menu mobile"
        aria-hidden={!ouvert}
        inert={!ouvert}
      >
        {/* Croix indépendante */}
        <button
          className="menu-mobile__close"
          aria-label="Fermer le menu"
          aria-expanded={ouvert}
          aria-controls="menu-mobile"
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
