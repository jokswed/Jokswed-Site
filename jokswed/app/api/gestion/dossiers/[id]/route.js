import { NextResponse } from 'next/server';
import { requireAdmin,sameOrigin,readJson } from '@/lib/workflow/auth.mjs';
import { getRecord,saveRecord } from '@/lib/workflow/store.mjs';
import { edit,documentSnapshot,digest,WorkflowError } from '@/lib/workflow/model.mjs';
import { approve,sendApproved } from '@/lib/workflow/actions.mjs';
import { renderPdf } from '@/lib/workflow/pdf.mjs';
import { syncEvent } from '@/lib/workflow/google.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function view(d){return {...d,approbations:Object.fromEntries(Object.entries(d.approbations).map(([k,{pdf,...a}])=>[k,a])),historique:d.historique.map(h=>({...h,approbations:h.approbations?Object.fromEntries(Object.entries(h.approbations).map(([k,{pdf,...a}])=>[k,a])):undefined}))};}
function failure(e){return NextResponse.json({message:e.status?e.message:'L’opération n’a pas pu être confirmée. Rechargez le dossier avant de réessayer.'},{status:e.status||500});}
export async function GET(request,{params}){try{
 requireAdmin(request);const d=await getRecord(params.id);const kind=new URL(request.url).searchParams.get('document');
 if(kind){if(!['devis','contrat'].includes(kind))throw new WorkflowError('Document inconnu.');const a=d.approbations[kind],s=a?.snapshot||documentSnapshot(d,kind);const pdf=a?Buffer.from(a.pdf,'base64'):await renderPdf(s);return new Response(pdf,{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${kind}-${s.reference}.pdf"`,'Cache-Control':'private, no-store','X-Document-Hash':digest(s)}});}
 return NextResponse.json(view(d),{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(request,{params}){try{
 requireAdmin(request);sameOrigin(request);const body=await readJson(request);let d=await getRecord(params.id);
 if(body.revision!==d.revision)throw new WorkflowError('Le dossier a changé. Rechargez-le avant de continuer.',409);
 const revision=d.revision;
 if(body.action==='modifier')d=edit(d,body.dossier);
 else if(body.action==='refuser'){if(Object.keys(d.approbations).length)throw new WorkflowError('Ce dossier contient un document signé. Créez une nouvelle version ou traitez son annulation séparément.');d.refuse=true;d.historique.push({type:'refus',date:new Date().toISOString()});}
 else if(body.action==='valider')d=await approve(d,body.kind,body);
 else if(body.action==='calendrier'){
  if(!d.approbations.devis||!['a-ajouter','erreur'].includes(d.calendrier?.etat))throw new WorkflowError('Aucun ajout au calendrier en attente.');
  try{d.calendrier={...await syncEvent(d.id,d.calendrier.snapshot),snapshot:d.calendrier.snapshot};}catch(e){d.calendrier={...d.calendrier,etat:'erreur'};await saveRecord(d,revision);throw e;}
 }
 else if(body.action==='envoyer'){
  if(!['devis','contrat'].includes(body.kind)||!d.approbations[body.kind])throw new WorkflowError('Document non validé.');
  // Réserver l’envoi avant l’appel externe : une incertitude ne provoque pas de renvoi automatique.
  const a=d.approbations[body.kind];if(a.envoi)throw new WorkflowError(a.envoi.etat==='envoye'?'Document déjà envoyé.':'Un envoi est déjà en cours ou à vérifier.',409);
  a.envoi={etat:'en-cours',date:new Date().toISOString()};d=await saveRecord(d,revision);
  try {a.envoi=await sendApproved(d,body.kind);d.approbations[body.kind].envoi=a.envoi;d=await saveRecord(d,d.revision);return NextResponse.json(view(d));}
  catch(e){d.approbations[body.kind].envoi={etat:'a-verifier',date:new Date().toISOString()};await saveRecord(d,d.revision);throw e;}
 }
 else throw new WorkflowError('Action inconnue.');
 d=await saveRecord(d,revision);
 // L’ajout suit la validation explicite, avec reprise indépendante en cas d’échec.
 if(body.action==='valider'&&body.kind==='devis'&&body.addCalendar){try{d.calendrier={...await syncEvent(d.id,d.calendrier.snapshot),snapshot:d.calendrier.snapshot};}catch{d.calendrier={...d.calendrier,etat:'erreur'};}d=await saveRecord(d,d.revision);}
 return NextResponse.json(view(d));
}catch(e){return failure(e);}}
