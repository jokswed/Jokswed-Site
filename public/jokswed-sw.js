self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "JoksWed", {
      body: data.body || "Une nouvelle notification est disponible.",
      tag: data.tag || "jokswed",
      renotify: true,
      data: { url: data.url || "/admin" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cible = new URL(event.notification.data?.url || "/admin", self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      for (const fenetre of fenetres) {
        if ("focus" in fenetre) {
          fenetre.navigate(cible);
          return fenetre.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(cible) : undefined;
    }),
  );
});
