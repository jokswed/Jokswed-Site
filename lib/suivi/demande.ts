import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  return process.env.JOKSWED_SUIVI_SECRET?.trim() || null;
}

export function jetonSuiviDemande(demandeId: string): string | null {
  const cle = secret();
  if (!cle) return null;
  return createHmac("sha256", cle)
    .update(`jokswed:demande:${demandeId}`)
    .digest("base64url");
}

export function verifierSuiviDemande(demandeId: string, fourni: string | null | undefined): boolean {
  if (!fourni) return false;
  const attendu = jetonSuiviDemande(demandeId);
  if (!attendu) return false;
  const a = Buffer.from(attendu, "utf8");
  const b = Buffer.from(String(fourni), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function lienSuiviDemande(demandeId: string): string | null {
  const jeton = jetonSuiviDemande(demandeId);
  if (!jeton) return null;
  const site = (process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://jokswed.com")
    .replace(/\/+$/, "");
  return `${site}/suivi/${encodeURIComponent(demandeId)}?t=${encodeURIComponent(jeton)}`;
}
