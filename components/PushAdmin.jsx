"use client";

import { useEffect, useState } from "react";

const CLE_VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function cleApplication(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(base);
  return Uint8Array.from([...brut].map((c) => c.charCodeAt(0)));
}

export default function PushAdmin() {
  const [etat, setEtat] = useState("chargement");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setEtat("indisponible");
      return;
    }
    navigator.serviceWorker.getRegistration("/").then(async (reg) => {
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setEtat(sub ? "active" : "inactive");
    }).catch(() => setEtat("inactive"));
  }, []);

  async function activer() {
    setMessage("");
    if (!CLE_VAPID) {
      setMessage("Clé Push non configurée sur le serveur.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEtat("refusee");
        setMessage("Autorisation de notification refusée dans ce navigateur.");
        return;
      }

      const reg = await navigator.serviceWorker.register("/jokswed-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: cleApplication(CLE_VAPID),
        });
      }

      const json = sub.toJSON();
      const r = await fetch("/api/admin/push/abonnement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEtat("active");
      setMessage("Notifications push activées sur cet appareil.");
    } catch (e) {
      setMessage(`Activation impossible (${e instanceof Error ? e.message : "erreur"}).`);
    }
  }

  async function desactiver() {
    setMessage("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/admin/push/abonnement", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEtat("inactive");
      setMessage("Notifications push désactivées sur cet appareil.");
    } catch {
      setMessage("La désactivation n’a pas pu être terminée.");
    }
  }

  if (etat === "indisponible") return null;

  return (
    <section className="admin-bloc" style={{ marginBottom: "1.5rem" }}>
      <h2 className="display t-carte">Notifications push</h2>
      <p className="recap__note">
        Recevez immédiatement une alerte sur cet appareil lorsqu’une nouvelle demande arrive.
      </p>
      <div className="admin-actions" style={{ marginTop: "0.8rem" }}>
        {etat === "active" ? (
          <button type="button" className="btn btn--fantome" onClick={desactiver}>
            Désactiver sur cet appareil
          </button>
        ) : (
          <button type="button" className="btn" onClick={activer} disabled={etat === "chargement"}>
            {etat === "chargement" ? "Vérification…" : "Activer les notifications push"}
          </button>
        )}
      </div>
      {message ? <p className="recap__note" style={{ marginTop: "0.7rem" }}>{message}</p> : null}
    </section>
  );
}
