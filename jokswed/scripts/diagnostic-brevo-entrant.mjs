/**
 * Diagnostic lecture seule : Brevo a-t-il reçu une réponse et appelé JoksWed ?
 *
 * Utilisation : node scripts/diagnostic-brevo-entrant.mjs
 * N'affiche ni clé API, ni secret webhook, ni adresse e-mail client.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const source = [
  join(process.cwd(), ".env.local"),
  join(homedir(), "Downloads", "photographe-portrait", ".env.local"),
].find(existsSync);

function cleDepuisFichier(path) {
  if (!path) return null;
  const ligne = readFileSync(path, "utf8").match(
    /^\s*(?:export\s+)?BREVO_API_KEY\s*=\s*(.+?)\s*$/m
  );
  return ligne?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

const cle = process.env.BREVO_API_KEY || cleDepuisFichier(source);
if (!cle?.startsWith("xkeysib-")) {
  console.error("Clé BREVO_API_KEY locale absente ou invalide.");
  process.exitCode = 1;
} else {
  const api = async (path) => {
    const response = await fetch("https://api.brevo.com/v3" + path, {
      headers: { "api-key": cle, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Brevo HTTP " + response.status);
    return response.json();
  };

  try {
    const data = await api("/inbound/events");
    const recus = Array.isArray(data.events) ? data.events : [];
    const filtre = recus.filter((e) =>
      String(e.recipient || "").toLowerCase().endsWith("@reply.jokswed.com")
    ).slice(-8).reverse();

    console.log("Réception JoksWed — " + filtre.length + " événements récents");
    if (!filtre.length) {
      console.log("Aucun événement pour reply.jokswed.com dans la réponse Brevo.");
    }
    for (const evenement of filtre) {
      const uuid = String(evenement.uuid || "");
      if (!uuid) continue;
      try {
        const details = await api("/inbound/events/" + encodeURIComponent(uuid));
        const statuts = Array.isArray(details.logs)
          ? details.logs.map((ligne) => ligne.type).filter(Boolean)
          : [];
        const date = String(evenement.date || details.receivedAt || "").slice(0, 19);
        console.log(date || "Date inconnue", statuts.join(" → ") || "Sans journal");
      } catch (e) {
        console.log("Événement présent ; détail indisponible :", e.message);
      }
    }
    console.log("Aucune adresse client ni aucun secret affiché.");
  } catch (e) {
    console.error("Diagnostic Brevo impossible :", e.message);
    process.exitCode = 1;
  }
}
