import { documentSnapshot,digest,approvalProblems,WorkflowError } from './model.mjs';
import { renderPdf } from './pdf.mjs';
import { eventBody, googleReady } from './google.mjs';
export async function approve(d,kind,{expectedHash,addCalendar,readConfirmed},env=process.env){
 const s=documentSnapshot(d,kind,env);
 if(expectedHash!==digest(s))throw new WorkflowError('Le document a changé. Consultez la nouvelle version avant de la valider.',409);
 if(readConfirmed!==true)throw new WorkflowError('Confirmez la lecture du document.');
 if(kind==='devis'&&typeof addCalendar!=='boolean')throw new WorkflowError('Choisissez oui ou non pour le calendrier.');
 if(d.approbations[kind])throw new WorkflowError('Cette version est déjà validée.',409);
 const errors=approvalProblems(d,kind);if(errors.length)throw new WorkflowError(errors.join(' '));
 if(kind==='devis'&&addCalendar){if(!googleReady())throw new WorkflowError('Connectez le calendrier Google, ou choisissez de ne pas ajouter la date.',503);eventBody(d.id,s);}
 if(!env.SIGNATURE_PNG_BASE64)throw new WorkflowError('Votre image de signature doit être configurée avant validation.',503);
 const signedAt=new Date().toISOString();const bytes=await renderPdf(s,{signedAt,signature:env.SIGNATURE_PNG_BASE64});
 const next=structuredClone(d);
 next.approbations[kind]={snapshot:s,hash:digest(s),signedAt,pdf:bytes.toString('base64'),envoi:null};
 next.historique.push({type:`validation-${kind}`,date:signedAt,hash:digest(s)});
 if(kind==='devis')next.calendrier=addCalendar?{etat:'a-ajouter',snapshot:s}:{etat:'non-demande'};
 return next;
}
export async function sendApproved(d,kind){
 const a=d.approbations[kind];if(!a)throw new WorkflowError('Validez le document avant de l’envoyer.');
 if(a.envoi?.etat==='envoye')return a.envoi;
 if(!process.env.RESEND_API_KEY||!process.env.CONTACT_FROM_EMAIL)throw new WorkflowError('L’adresse d’expédition doit être configurée.',503);
 const recipients=[a.snapshot.client.email,a.snapshot.client.secondEmail].filter(Boolean);
 const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`jw-${d.id}-${kind}-${a.hash}`},body:JSON.stringify({from:process.env.CONTACT_FROM_EMAIL,to:[...new Set(recipients)],reply_to:process.env.CONTACT_TO_EMAIL||'jokswed@gmail.com',subject:`Votre ${kind} de mariage — ${a.snapshot.reference}`,text:`Bonjour,\n\nVous trouverez votre ${kind} en pièce jointe. Merci de le consulter et de revenir vers moi pour toute question.\n\n${a.snapshot.entreprise.nom}`,attachments:[{filename:`${kind}-${a.snapshot.reference}.pdf`,content:a.pdf}]})});
 if(!r.ok)throw new WorkflowError('L’envoi n’a pas été confirmé. Vérifiez le suivi avant une nouvelle tentative.',502);
 return {etat:'envoye',date:new Date().toISOString(),id:(await r.json()).id};
}
