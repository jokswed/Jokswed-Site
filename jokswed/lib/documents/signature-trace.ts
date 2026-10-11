/** Validation serveur indépendante du navigateur. Aucune chaîne SVG n'est admise. */
export type PointSignature = [number, number];
export type TraceSignature = PointSignature[][];
export function validerSignature(value: unknown): TraceSignature {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    throw new Error("Nombre de traits invalide");
  }
  let total = 0;
  const traces: TraceSignature = value.map((trait) => {
    if (!Array.isArray(trait) || trait.length < 1 || trait.length > 100) {
      throw new Error("Tracé de signature invalide");
    }
    total += trait.length;
    return trait.map((point) => {
      if (!Array.isArray(point) || point.length !== 2 ||
          !point.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) {
        throw new Error("Coordonnées de signature invalides");
      }
      return [Math.round(point[0]*10000)/10000,Math.round(point[1]*10000)/10000] as PointSignature;
    });
  });
  if (total < 3 || total > 1800) throw new Error("Signature trop courte ou trop longue");
  return traces;
}
