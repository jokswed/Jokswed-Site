/* Test sans envoi Web Push, sans donnée client réelle ni connexion BDD.
   Vérifie le garde de reprise et le dédoublonnage du Service Worker. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
  premiereTentativePush, nomsCouplePush, notificationNouvelleDemande,
} from "../lib/push/demande.js";

assert.equal(premiereTentativePush(1), true);
for (const tentative of [2, 3, 30, 200, null, undefined]) {
  assert.equal(premiereTentativePush(tentative), false,
    "Une reprise Brevo ne doit pas réémettre le push");
}
assert.equal(nomsCouplePush("Julie et Bruno"), "Julie et Bruno");
assert.equal(nomsCouplePush("  Julie   et  Bruno  "), "Julie et Bruno");
assert.equal(nomsCouplePush("Julie\nEt Bruno"), "Julie Et Bruno");
assert.equal(nomsCouplePush(null), "Un couple");

const id = "0c1dda98-dfdb-4be1-b00d-fcae6c7392d1";
const notification = notificationNouvelleDemande(id, "Julie et Bruno");
assert.equal(notification.title, "Nouvelle demande");
assert.equal(notification.body, "Julie et Bruno\nJoksWed");
assert.equal(notification.url, `/admin/demandes/${id}`);
assert.equal(notification.tag, `demande-${id}`);
assert.equal(notification.icon, "/apple-icon.png");
assert.equal(notification.renotify, false);
assert.ok(!JSON.stringify(notification).includes("DEM-2026-0006"),
  "Le numéro de dossier ne doit pas apparaître dans l'alerte");

// Exécuter le Service Worker sans navigateur ni Apple Push, avec une
// registration factice qui expose les notifications encore affichées.
const fichier = resolve(dirname(fileURLToPath(import.meta.url)),
  "../public/jokswed-sw.js");
const source = readFileSync(fichier, "utf8");
const handlers = new Map();
const affichages = [];
const registration = {
  async getNotifications({ tag }) {
    return affichages.filter((n) => n.options.tag === tag);
  },
  async showNotification(title, options) {
    affichages.push({ title, options });
  },
};
const self = {
  registration,
  location: { origin: "https://jokswed.com" },
  addEventListener(type, handler) { handlers.set(type, handler); },
};
runInNewContext(source, { self, URL, clients: {} }, { filename: fichier });

async function pousser(data) {
  let attente;
  handlers.get("push")({
    data: { json: () => data },
    waitUntil: (promise) => { attente = promise; },
  });
  assert.ok(attente instanceof Promise);
  await attente;
}

await pousser(notification);
await pousser(notification);
assert.equal(affichages.length, 1,
  "La même demande déjà visible ne doit pas réafficher une notification");
assert.equal(affichages[0].title, "Nouvelle demande");
assert.equal(affichages[0].options.renotify, false);
await pousser({ title: "Une réponse", body: "JoksWed\nBonjour",
  tag: "message-5c749b20-908f-4320-9090-a234d89fa1e2" });
assert.equal(affichages.length, 2,
  "Une vraie réponse client reste une notification distincte");
assert.equal(affichages[1].options.renotify, true,
  "Les réponses client conservent la possibilité de sonner");
console.log("✓ Déduplication 30 relances, noms du couple et alertes iPhone vérifiées.");
