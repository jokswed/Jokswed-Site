"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* =============================================================================
   NAVIGATION DE L'ADMINISTRATION — CINQ CIBLES, TOUJOURS LÀ
   -----------------------------------------------------------------------------
   ⚠️ IL N'Y AVAIT DE NAVIGATION QUE SUR LE TABLEAU DE BORD.

   Onze liens, en grille, sur `/admin` — et nulle part ailleurs. Une fois dans
   une fiche de demande ou une conversation, il n'existait plus qu'un lien
   « Retour » codé en dur, différent sur chaque page. Pour passer des demandes
   à la messagerie il fallait remonter à l'accueil.

   Cinq cibles, c'est la limite du pouce sur un petit iPhone : au-delà, chacune
   devient trop étroite pour être touchée sans viser. Les quatre premières sont
   celles qu'on ouvre plusieurs fois par jour ; tout le reste — finances,
   dossiers, collaborateurs, propositions, entreprise, notifications, réglages
   — vit derrière « Plus », qui se touche une fois par semaine.

   ⚠️ MASQUER UN LIEN N'EST PAS UNE PROTECTION, et on ne masque donc rien ici.
   Chaque page cible rappelle `exigerAcces()` avec ses propres permissions et
   redirige avec un motif lisible. Cette barre est un raccourci, pas une garde.
   ============================================================================= */

/* Les écrans d'authentification n'ont pas de navigation : on n'y est pas encore
   entré, et proposer « Demandes » depuis l'écran de connexion n'aurait mené
   qu'à un aller-retour. */
const SANS_BARRE = [
  "/admin/connexion",
  "/admin/amorcage",
  "/admin/second-facteur",
  "/admin/invitation",
];

const ENTREES = [
  { href: "/admin", libelle: "Accueil", exact: true, trace: "M3 10.5 12 3l9 7.5V21H3z" },
  { href: "/admin/demandes", libelle: "Demandes", trace: "M3 7h18v12H3zM3 7l9 6 9-6" },
  { href: "/admin/messagerie", libelle: "Messages", trace: "M4 5h16v11H9l-5 4z" },
  { href: "/admin/saison", libelle: "Saison", trace: "M4 6h16v15H4zM8 3v4M16 3v4M4 11h16" },
  { href: "/admin/plus", libelle: "Plus", trace: "M5 12h14M12 5v14" },
];

export default function BarreAdmin() {
  const chemin = usePathname() ?? "";
  if (SANS_BARRE.some((p) => chemin.startsWith(p))) return null;

  return (
    <nav className="barre-admin" aria-label="Sections de l'administration">
      {ENTREES.map((e) => {
        const actif = e.exact ? chemin === e.href : chemin.startsWith(e.href);
        return (
          <Link
            key={e.href}
            href={e.href}
            className={`barre-admin__lien${actif ? " barre-admin__lien--actif" : ""}`}
            aria-current={actif ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d={e.trace} />
            </svg>
            <span>{e.libelle}</span>
          </Link>
        );
      })}
    </nav>
  );
}
