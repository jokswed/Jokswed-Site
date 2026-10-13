"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SuiviAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const rafraichir = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(rafraichir, 30_000);
    document.addEventListener("visibilitychange", rafraichir);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", rafraichir);
    };
  }, [router]);

  return null;
}
