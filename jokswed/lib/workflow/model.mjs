import { createHash, randomUUID } from 'node:crypto';
import { calculerDevis } from '../devis.mjs';
import { PACKAGES } from './catalogue.mjs';
import { conditionsInitiales } from './conditions.mjs';
export { PACKAGES };
export class WorkflowError extends Error { constructor(message,status=400){ super(message);this.status=status; } }
export function draft(d={}) {
 const p=PACKAGES[d.formule];
 return { id:randomUUID(), revision:1, contentVersion:1, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  demande:d, client:{noms:d.noms||'',email:d.email||'',nom:d.nomSignataire||'',adresse:d.adresse||'',secondNom:d.secondSignataire||'',secondEmail:d.secondEmail||''},
  prestation:{formule:d.formule||'indecis',date:/^\d{4}-\d{2}-\d{2}$/.test(d.date||'')?d.date:'',lieu:d.lieu||'',heures:p?.hours||0,debut:d.debut||'',fin:d.fin||'',engagement:'',inclus:p?.inclus.join('\n')||''},
  lignes:p?[{libelle:`Formule ${p.label}`,montantCentimes:p.cents}]:[],
  tva:'20',tvaConfirmee:true,echeances:[30,30,40],deuxiemeVersement:'',validiteJours:30,
  conditions:conditionsInitiales(), approbations:{}, historique:[], paiements:[], calendrier:null, refuse:false,
 };
}
export function total(d) { return calculerDevis({lignes:d.lignes,tva:d.tva,pourcentages:d.echeances}); }
const text=(v,max=5000)=> {if(typeof v!=='string'||v.length>max)throw new WorkflowError('Un champ est invalide ou trop long.');return v.trim();};
export function edit(d, input) {
 if(Object.values(d.approbations).some(a=>a.envoi && a.envoi.etat!=="envoye"))throw new WorkflowError("Un envoi est en cours ou à vérifier. Vérifiez son résultat avant de modifier le dossier.",409);
 const c=input.client,p=input.prestation;
 if(!c||!p||!Array.isArray(input.lignes)||input.lignes.length>30)throw new WorkflowError('Dossier incomplet.');
 const out=structuredClone(d);
 out.client=Object.fromEntries(['noms','email','nom','adresse','secondNom','secondEmail'].map(k=>[k,text(c[k]??'',k==='adresse'?1000:254)]));
 out.prestation=Object.fromEntries(['formule','date','lieu','debut','fin','engagement','inclus'].map(k=>[k,text(p[k]??'')]));
 out.prestation.heures=Number(p.heures);
 if(!Number.isFinite(out.prestation.heures)||out.prestation.heures<0||out.prestation.heures>48)throw new WorkflowError('Durée invalide.');
 if(!['indecis',...Object.keys(PACKAGES)].includes(out.prestation.formule))throw new WorkflowError('Formule invalide.');
 out.lignes=input.lignes.map(l=>({libelle:text(l.libelle,300),montantCentimes:l.montantCentimes}));
 out.tva=input.tva;out.tvaConfirmee=input.tvaConfirmee===true;
 out.echeances=input.echeances;out.deuxiemeVersement=text(input.deuxiemeVersement??'',100);
 out.conditions=text(input.conditions??'',40000);
 total(out);
 if(out.approbations.devis||out.approbations.contrat) out.historique.push({type:'nouvelle-version',date:new Date().toISOString(),approbations:out.approbations});
 out.approbations={};out.refuse=false;out.contentVersion=(d.contentVersion||1)+1;
 // Garder l’événement existant à titre d’historique, mais jamais autoriser son ajout tacitement.
 if(out.calendrier)out.calendrier={...out.calendrier,etat:'a-revoir'};
 return out;
}
export function company(env=process.env){return {nom:env.DOCUMENT_BUSINESS_NAME||'EyesofJoks — RAHARISON JOHN',adresse:env.DOCUMENT_ADDRESS||'7 rue Emmanuel Rain, 95500 Gonesse',siret:env.DOCUMENT_SIRET||'93760042700010',email:env.DOCUMENT_EMAIL||'eyesofjoks@gmail.com',telephone:'07 69 90 25 99'};}
export function documentSnapshot(d,kind,env=process.env){
 if(!['devis','contrat'].includes(kind))throw new WorkflowError('Document inconnu.');
 return {kind,reference:`JW-${d.id.slice(0,8).toUpperCase()}-V${d.contentVersion||1}`,client:d.client,prestation:d.prestation,lignes:d.lignes,tva:d.tva,tvaConfirmee:d.tvaConfirmee,echeances:d.echeances,deuxiemeVersement:d.deuxiemeVersement,validiteJours:d.validiteJours,conditions:kind==='contrat'?d.conditions:'',entreprise:company(env),total:total(d)};
}
export const digest=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
export function approvalProblems(d,kind){
 const errors=[];
 try {total(d);}catch(e){errors.push(e.message);}
 if(!d.client.nom||!d.client.adresse||!d.client.email)errors.push('Compléter le nom, l’adresse et l’e-mail du signataire.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.client.email))errors.push('Vérifier l’e-mail du signataire.');
 if(Boolean(d.client.secondNom)!==Boolean(d.client.secondEmail)||(d.client.secondEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.client.secondEmail)))errors.push('Compléter les coordonnées du second signataire.');
 const date=d.prestation.date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)errors.push('Renseigner une date de mariage valide.');
 if(!d.prestation.lieu||!d.prestation.inclus)errors.push('Compléter les lieux et les prestations incluses.');
 if(!d.tvaConfirmee)errors.push('Confirmer le régime de TVA pour cette version.');
 if(!d.deuxiemeVersement)errors.push('Fixer la date du deuxième versement.');
 if(kind==='contrat'&&(!d.conditions.trim()||d.conditions.includes('[À COMPLÉTER]')))errors.push('Compléter les conditions du contrat.');
 if(d.refuse)errors.push('Modifier le dossier refusé avant de le valider.');
 return errors;
}
