"use client";

import { useRouter } from "next/navigation";

/* =============================================================================
   REVENIR LÀ D'OÙ L'ON VIENT, ET NON LÀ OÙ LA PAGE CROIT QU'ON ÉTAIT
   -----------------------------------------------------------------------------
   ⚠️ ONZE LIENS « RETOUR », ONZE DESTINATIONS CODÉES EN DUR.

   Chaque page profonde renvoyait vers un endroit fixe : la fiche d'une demande
   vers la liste des demandes, toujours — même si l'on y était arrivé depuis la
   messagerie ou depuis la saison. On perdait le filtre, la recherche et la
   position de défilement, et il fallait refaire le chemin à la main.

   `router.back()` rend tout cela gratuitement : Next restaure la position de
   défilement et l'état de la page précédente.

   ⚠️ MAIS `back()` SEUL PEUT SORTIR DU SITE.

   Sur un lien ouvert directement — depuis un e-mail, un signet, un nouvel
   onglet — l'entrée précédente de l'historique est une AUTRE origine, ou rien
   du tout. On vérifie donc que l'on vient bien de l'administration avant de
   reculer, et on retombe sinon sur une destination déclarée par la page.
   ============================================================================= */
export default function Retour({ vers, libelle = "Retour" }) {
  const router = useRouter();

  function revenir() {
    let interne = false;
    try {
      const venant = document.referrer;
      interne =
        window.history.length > 1 &&
        venant.length > 0 &&
        new URL(venant).origin === window.location.origin &&
        new URL(venant).pathname.startsWith("/admin") &&
        /* Revenir sur la page qu'on est en train de quitter n'avance à rien :
           c'est le cas d'un rechargement, où le référent est la page elle-même. */
        new URL(venant).pathname !== window.location.pathname;
    } catch {
      /* Référent illisible (politique de référent, URL exotique) : on prend le
         chemin sûr plutôt que de deviner. */
      interne = false;
    }

    if (interne) router.back();
    else router.push(vers);
  }

  return (
    <button type="button" onClick={revenir} className="btn btn--fantome retour">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 19l-7-7 7-7" />
      </svg>
      {libelle}
    </button>
  );
}
