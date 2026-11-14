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

  event.waitUntil(
    self.registration.showNotification(data.title || "JoksWed", {
      body: data.body || "Vous avez reçu un nouveau message.",
      icon: data.icon || "/apple-icon.png",
      badge: data.badge || "/apple-icon.png",
      lang: "fr",
      tag: data.tag || "jokswed",
      renotify: true,
      data: { url },
    }),
  );
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
