/* JoksWed — Service Worker des notifications Push (iPhone/PWA et desktop).
 * Pas de cache des conversations, pas d'accès à la session ni aux messages.
 * L'icône et le nom exact d'application affichés dépendent de l'OS.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const chemin = typeof data.url === "string" ? data.url : "/admin";
  const url = chemin.startsWith("/admin/") || chemin === "/admin"
    ? chemin : "/admin";

  const tag = typeof data.tag === "string" ? data.tag : "jokswed";
  const estNouvelleDemande = /^demande-[a-f0-9-]{36}$/i.test(tag);
  event.waitUntil((async () => {
    /* Le serveur empêche les relances dues aux erreurs d'e-mail.
       Le Service Worker supprime également le réaffichage d'une demande
       encore visible ; renotify=false évite de la faire sonner à nouveau. */
    if (estNouvelleDemande && self.registration.getNotifications) {
      try {
        const dejaVisibles = await self.registration.getNotifications({ tag });
        if (dejaVisibles.length > 0) return;
      } catch {
        // Certains navigateurs n'exposent pas getNotifications : le même tag
        // et renotify:false restent utilisables sans casser l'alerte.
      }
    }
    await self.registration.showNotification(data.title || "JoksWed", {
      body: data.body || "Vous avez reçu un nouveau message.",
      icon: data.icon || "/apple-icon.png",
      badge: data.badge || "/apple-icon.png",
      lang: "fr",
      tag,
      renotify: estNouvelleDemande ? false : data.renotify !== false,
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chemin = event.notification.data?.url || "/admin";
  const cible = new URL(chemin, self.location.origin);
  if (cible.origin !== self.location.origin || !cible.pathname.startsWith("/admin")) {
    cible.href = new URL("/admin", self.location.origin).href;
  }

  event.waitUntil((async () => {
    const fenetres = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const fenetre of fenetres) {
      if ("navigate" in fenetre && "focus" in fenetre) {
        try {
          const cibleOuverte = await fenetre.navigate(cible.href);
          return await (cibleOuverte ?? fenetre).focus();
        } catch {
          // Une ancienne fenêtre peut être fermée entre recherche et focus.
        }
      }
    }
    return clients.openWindow ? clients.openWindow(cible.href) : undefined;
  })());
});
