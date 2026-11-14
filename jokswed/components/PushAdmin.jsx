"use client";

import { useEffect, useState } from "react";

const CLE_VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function cleApplication(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from([...atob(base)].map((c) => c.charCodeAt(0)));
}

function estIphoneOuIpad() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function applicationInstallee() {
  return window.matchMedia("(display-mode: standalone)").matches
    || navigator.standalone === true;
}

/** Web Push : sur iPhone, l'application doit être installée à l'écran
 * d'accueil, puis l'autorisation demandée par un vrai geste de l'utilisateur.
 * Le son et l'affichage des aperçus restent des préférences système iOS. */
export default function PushAdmin() {
  const [etat, setEtat] = useState("chargement");
  const [message, setMessage] = useState("");
  const [test, setTest] = useState(false);

  useEffect(() => {
    let vivant = true;
    const changer = (valeur) => { if (vivant) setEtat(valeur); };

    async function verifier() {
      if (estIphoneOuIpad() && !applicationInstallee()) {
        changer("installation");
        return;
      }
      if (!("serviceWorker" in navigator)
        || !("PushManager" in window)
        || !("Notification" in window)) {
        changer("indisponible");
        return;
      }
      if (!CLE_VAPID) {
        changer("configuration");
        return;
      }
      if (Notification.permission === "denied") {
        changer("refusee");
        return;
      }
      try {
        // Enregistrement silencieux possible sans demander de permission.
        // Le prompt d'autorisation n'apparaît qu'au clic sur "Activer".
        const reg = await navigator.serviceWorker.register(
          "/jokswed-sw.js", { scope: "/" });
        const abonnement = await reg.pushManager.getSubscription();
        changer(abonnement && Notification.permission === "granted"
          ? "active" : "inactive");
      } catch {
        changer("indisponible");
      }
    }
    verifier();
    return () => { vivant = false; };
  }, []);

  async function activer() {
    setMessage("");
    if (!CLE_VAPID) {
      setEtat("configuration");
      return;
    }
    if (estIphoneOuIpad() && !applicationInstallee()) {
      setEtat("installation");
      return;
    }
    try {
      // Permission appelée immédiatement à la suite du geste de l'utilisateur.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEtat("refusee");
        return;
      }

      const reg = await navigator.serviceWorker.register(
        "/jokswed-sw.js", { scope: "/" });
      let abonnement = await reg.pushManager.getSubscription();
      if (!abonnement) {
        abonnement = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: cleApplication(CLE_VAPID),
        });
      }
      const json = abonnement.toJSON();
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
      setMessage("Notifications activées sur cet appareil.");
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
        const r = await fetch("/api/admin/push/abonnement", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!r.ok) throw new Error("Échec de la désinscription côté serveur.");
        await sub.unsubscribe();
      }
      setEtat("inactive");
      setMessage("Notifications désactivées sur cet appareil.");
    } catch {
      setMessage("La désactivation n’a pas pu être terminée.");
    }
  }

  async function tester() {
    setMessage("");
    setTest(true);
    try {
      const r = await fetch("/api/admin/push/test", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.message || `HTTP ${r.status}`);
      setMessage("Notification de test transmise au service Push. Vérifie sa réception sur ton iPhone.");
    } catch (e) {
      setMessage(`Test impossible : ${e instanceof Error ? e.message : "erreur"}.`);
    } finally {
      setTest(false);
    }
  }

  return (
    <section className="admin-bloc" style={{ marginBottom: "1.5rem" }}>
      <h2 className="display t-carte">Notifications sur cet appareil</h2>
      <p className="recap__note">
        Une réponse client déclenche une alerte JoksWed avec son nom, un aperçu
        du message et un accès direct à la conversation.
      </p>

      {etat === "installation" ? (
        <p className="admin-alerte admin-alerte--neutre" role="status">
          Sur iPhone, ouvre JoksWed dans Safari, puis touche Partager →
          « Sur l’écran d’accueil ». Lance ensuite JoksWed depuis son icône,
          connecte-toi à l’administration et active les notifications ici.
        </p>
      ) : null}
      {etat === "refusee" ? (
        <p className="admin-alerte admin-alerte--neutre" role="status">
          Autorisation refusée. Ouvre Réglages iPhone → Notifications → JoksWed
          et autorise les notifications.
        </p>
      ) : null}
      {etat === "configuration" ? (
        <p className="admin-alerte" role="status">
          La clé publique VAPID n’est pas configurée sur cette version du site.
        </p>
      ) : null}
      {etat === "indisponible" ? (
        <p className="admin-alerte admin-alerte--neutre" role="status">
          Les notifications Web Push ne sont pas disponibles sur ce navigateur
          ou cet appareil. Sur iPhone, utilise l’application JoksWed installée
          à l’écran d’accueil (iOS 16.4 minimum).
        </p>
      ) : null}

      <div className="admin-actions" style={{ marginTop: "0.8rem" }}>
        {etat === "active" ? (
          <>
            <button type="button" className="btn btn--fantome" onClick={desactiver}>
              Désactiver sur cet appareil
            </button>
            <button type="button" className="btn" onClick={tester} disabled={test}>
              {test ? "Envoi du test…" : "Tester une notification"}
            </button>
          </>
        ) : etat === "inactive" || etat === "chargement" ? (
          <button type="button" className="btn" onClick={activer}
            disabled={etat === "chargement"}>
            {etat === "chargement" ? "Vérification…" : "Activer les notifications"}
          </button>
        ) : null}
      </div>

      {message ? <p className="recap__note" role="status"
        style={{ marginTop: "0.7rem" }}>{message}</p> : null}
      <p className="recap__note" style={{ marginTop: "0.7rem", fontSize: "0.78rem" }}>
        L’aperçu peut apparaître sur l’écran verrouillé. Pour le son et la
        confidentialité : Réglages iPhone → Notifications → JoksWed →
        Sons et Afficher les aperçus. Le mode Concentration reste prioritaire.
      </p>
    </section>
  );
}
