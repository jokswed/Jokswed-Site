"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * La boîte ouverte doit recevoir les nouveaux courriers sans rechargement manuel.
 * router.refresh() conserve l'état des composants client et relit les données RSC.
 * Ne travaille pas quand l'onglet est masqué, afin de limiter les requêtes.
 */
export default function ActualiserMessagerie({ dernierMessage = null }) {
  const router = useRouter();
  const procheFin = useRef(true);
  const premierAffichage = useRef(true);

  useEffect(() => {
    const rafraichir = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const minuteur = window.setInterval(rafraichir, 15000);
    document.addEventListener("visibilitychange", rafraichir);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", rafraichir);
    };
  }, [router]);

  useEffect(() => {
    const fil = document.querySelector(".admin-chat-main .admin-fil");
    if (!fil) return;
    const ecoute = () => {
      procheFin.current = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 180;
    };
    if (premierAffichage.current || procheFin.current) {
      fil.scrollTop = fil.scrollHeight;
    }
    premierAffichage.current = false;
    fil.addEventListener("scroll", ecoute, { passive: true });
    return () => fil.removeEventListener("scroll", ecoute);
  }, [dernierMessage]);

  return null;
}
