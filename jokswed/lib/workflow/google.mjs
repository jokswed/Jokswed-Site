import { createHash } from 'node:crypto';
import { WorkflowError } from './model.mjs';
// Les identifiants sont uniquement lus côté serveur. Le compte connecté doit avoir accès au calendrier dédié.
export function googleReady(){return !!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REFRESH_TOKEN&&process.env.GOOGLE_CALENDAR_ID);}
async function accessToken(){
 if(!googleReady())throw new WorkflowError('Le calendrier Google doit être connecté avant son ajout.',503);
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(!r.ok)throw new WorkflowError('La connexion Google doit être renouvelée.',502);return (await r.json()).access_token;
}
export function eventBody(id,snapshot){
 const {date,debut,fin,lieu}=snapshot.prestation;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(debut)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(fin)||debut===fin)throw new WorkflowError('Pour le calendrier, précisez les horaires de début et de fin.');
 const endDate=fin<debut?new Date(Date.parse(date)+86400000).toISOString().slice(0,10):date;
 return {id:'a'+createHash('sha256').update(id).digest('hex').slice(0,40),summary:`Option mariage — ${snapshot.client.noms||snapshot.client.nom}`,location:lieu,
  description:`Option en attente de signatures clients et d’acompte. Référence ${snapshot.reference}.`,
  start:{dateTime:`${date}T${debut}:00`,timeZone:process.env.CALENDAR_TIMEZONE||'Europe/Paris'},end:{dateTime:`${endDate}T${fin}:00`,timeZone:process.env.CALENDAR_TIMEZONE||'Europe/Paris'},
  extendedProperties:{private:{jokswedDossier:id}},
 };
}
export async function syncEvent(id,snapshot){
 const body=eventBody(id,snapshot),token=await accessToken();
 const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events`;
 const call=(url,method,payload)=>fetch(url,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
 let r=await call(base+'?sendUpdates=none','POST',body);
 if(r.status===409){const existing=await call(`${base}/${body.id}`,'GET');if(!existing.ok||(await existing.json()).extendedProperties?.private?.jokswedDossier!==id)throw new WorkflowError('L’événement existant ne correspond pas au dossier.',409);const {id:eventId,...patch}=body;r=await call(`${base}/${eventId}?sendUpdates=none`,'PATCH',patch);}
 if(!r.ok)throw new WorkflowError('Le calendrier n’a pas pu être mis à jour. Vous pouvez réessayer sans signer à nouveau.',502);
 const result=await r.json();return {etat:'ajoute',eventId:body.id,calendarId:process.env.GOOGLE_CALENDAR_ID,url:result.htmlLink};
}
