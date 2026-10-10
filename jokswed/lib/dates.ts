/**
 * Formate une date SQL « AAAA-MM-JJ » sans jamais passer par un fuseau.
 *
 * Construire un `Date` depuis cette chaîne la situerait à minuit UTC ou
 * local selon la forme, et l'affichage reculerait ou avancerait d'un jour
 * selon la saison. On lit donc les composantes directement.
 */
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function formaterDateSql(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valeur));
  if (!m) return String(valeur);
  const [, annee, mois, jour] = m;
  return `${Number(jour)} ${MOIS[Number(mois) - 1]} ${annee}`;
}
