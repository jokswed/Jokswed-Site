// La TVA et les montants sont explicitement validés par le professionnel.
// Aucun tarif d’option issu d’un dossier client n’est un tarif général implicite.
export function calculerDevis({ lignes, tva, pourcentages = [30,30,40] }) {
  if (!['franchise', '20'].includes(tva)) throw new Error('Régime de TVA à confirmer avant émission.');
  if (!Array.isArray(lignes) || !lignes.length) throw new Error('Prestation manquante.');
  for (const l of lignes) {
    if (typeof l.libelle !== 'string' || !l.libelle.trim() || !Number.isSafeInteger(l.montantCentimes) || l.montantCentimes < 0) throw new Error('Chaque prestation doit avoir un prix confirmé en centimes.');
  }
  const total = lignes.reduce((n,l) => n+l.montantCentimes,0);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Montant invalide.');
  if (!Array.isArray(pourcentages) || !pourcentages.length || pourcentages.some(p=>!Number.isInteger(p)||p<=0) || pourcentages.reduce((a,b)=>a+b,0)!==100) throw new Error('Les versements doivent totaliser 100 %.');
  const ht = tva === '20' ? Math.round(total / 1.2) : total;
  let reste = total;
  const versements = pourcentages.map((p,i)=>{ const montant = i === pourcentages.length-1 ? reste : Math.round(total*p/100); reste -= montant; return montant; });
  return { totalCentimes:total, htCentimes:ht, tvaCentimes:total-ht, versementsCentimes:versements };
}
