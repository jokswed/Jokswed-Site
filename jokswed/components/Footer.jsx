/* =============================================================================
   PIED DE PAGE — fond encre, halo lumineux discret (signature du site)
   ============================================================================= */

import Link from "next/link";
import { site } from "@/content/site";

export default function Footer() {
  return (
    <footer className="pied">
      <div className="conteneur">
        <div className="pied__haut">
          <div>
            <p className="marque">
              Joks<span>Wed</span>
            </p>
            <p className="pied__devise">{site.devise}</p>
          </div>

          <nav aria-label="Plan du site">
            <h3>Explorer</h3>
            <ul>
              <li><Link href="/portfolio">Portfolio</Link></li>
              {/* ⚠️ « Mariages » pointait vers /mariages : route inexistante,
                  donc un 404 présent sur TOUTES les pages du site. Remplacé par
                  la FAQ, qui existe et qui est utile au visiteur. */}
              <li><Link href="/faq">FAQ</Link></li>
              <li><Link href="/tarifs">Tarifs</Link></li>
              <li><Link href="/a-propos">À propos</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </nav>

          <div>
            <h3>Contact</h3>
            <ul>
              <li><a href={`mailto:${site.email}`}>{site.email}</a></li>
              {site.telephone && (
                <li><a href={`tel:${site.telephone.replace(/\s/g, "")}`}>{site.telephone}</a></li>
              )}
              <li>
                <a href={site.instagram} target="_blank" rel="noopener noreferrer">
                  Instagram
                </a>
              </li>
              <li>{site.baseline}</li>
            </ul>
          </div>
        </div>

        <div className="pied__bas">
          <p>© {new Date().getFullYear()} {site.nom}. Tous droits réservés.</p>
          <p style={{ display: "flex", gap: "1.1rem", flexWrap: "wrap" }}>
            <Link href="/mentions-legales">Mentions légales</Link>
            <Link href="/confidentialite">Confidentialité</Link>
          </p>
          <p>{site.signature} — {site.baseline}</p>
        </div>
      </div>
    </footer>
  );
}
