export const FORMULES = Object.freeze({
  indecis: 'Je ne sais pas encore',
  essentielle: "L’Essentielle",
  signature: 'Signature',
  prestige: 'Prestige',
});

export class DemandeInvalide extends Error {}
const emailValide = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function champ(body, key, max, requis = false) {
  const value = body[key] ?? '';
  if (typeof value !== 'string' || value.length > max) throw new DemandeInvalide('Merci de vérifier les champs du formulaire.');
  const text = value.trim();
  if (requis && !text) throw new DemandeInvalide('Merci de remplir les champs obligatoires.');
  return text;
}
export function lireDemande(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new DemandeInvalide('Formulaire invalide.');
  if (champ(body, 'website', 200)) return { spam: true };
  const detail = body.type === 'devis';
  if (body.type && !['contact', 'devis'].includes(body.type)) throw new DemandeInvalide('Type de demande invalide.');
  const d = {
    type: detail ? 'devis' : 'contact',
    noms: champ(body, 'noms', 120, true),
    email: champ(body, 'email', 254, true).toLowerCase(),
    telephone: champ(body, 'telephone', 40),
    date: champ(body, 'date', 120, detail),
    lieu: champ(body, 'lieu', 500, detail),
    message: champ(body, 'message', 5000, !detail),
    formule: champ(body, 'formule', 30) || 'indecis',
  };
  if (!emailValide(d.email) || /[\r\n]/.test(d.noms) || !Object.hasOwn(FORMULES, d.formule)) throw new DemandeInvalide('Merci de vérifier votre e-mail et la formule choisie.');
  if (detail) {
    d.nomSignataire = champ(body, 'nomSignataire', 160, true);
    d.adresse = champ(body, 'adresse', 500, true);
    d.secondSignataire = champ(body, 'secondSignataire', 160);
    d.secondEmail = champ(body, 'secondEmail', 254).toLowerCase();
    d.horaires = champ(body, 'horaires', 300);
    d.options = champ(body, 'options', 1000);
    if (Boolean(d.secondSignataire) !== Boolean(d.secondEmail) || (d.secondEmail && !emailValide(d.secondEmail))) throw new DemandeInvalide('Pour le second signataire, renseignez son nom complet et son e-mail, ou laissez les deux champs vides.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(d.date)) || new Date(d.date).toISOString().slice(0,10) !== d.date) throw new DemandeInvalide('Merci de vérifier la date du mariage.');
  }
  return d;
}
export function lignesDemande(d) {
  return [
    ['Prénoms', d.noms], ['E-mail', d.email], ['Téléphone', d.telephone],
    ['Date du mariage', d.date], ['Lieu(x)', d.lieu], ['Formule envisagée', FORMULES[d.formule]],
    ...(d.type === 'devis' ? [
      ['Signataire', d.nomSignataire], ['Adresse de facturation', d.adresse],
      ['Second signataire', d.secondSignataire], ['E-mail du second signataire', d.secondEmail],
      ['Horaires souhaités', d.horaires], ['Options souhaitées', d.options],
    ] : []), ['Message', d.message],
  ].map(([label, value]) => [label, value || 'À préciser']);
}
export function echapperHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
