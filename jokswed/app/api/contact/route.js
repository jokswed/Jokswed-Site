import { NextResponse } from 'next/server';
import { lireDemande, lignesDemande, echapperHtml, DemandeInvalide } from '@/lib/demande.mjs';
export const runtime = 'nodejs';

export async function POST(request) {
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ok:false, message:'Format de demande invalide.'}, {status:415});
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 24000) return NextResponse.json({ok:false, message:'Votre message est trop long.'}, {status:413});
    let body;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ok:false, message:'Formulaire invalide.'}, {status:400}); }
    const d = lireDemande(body);
    if (d.spam) return NextResponse.json({ok:true});
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return NextResponse.json({ok:false, message:'Le service d’envoi n’est pas encore configuré.'}, {status:503});
    const title = d.type === 'devis' ? 'Dossier à préparer — aucune signature' : 'Nouvelle demande mariage';
    const lignes = lignesDemande(d);
    const text = [title, '', ...lignes.map(([label, value]) => `${label} : ${value}`), '', 'Cette demande ne réserve pas la date et ne vaut pas accord sur un devis.'].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717"><h2>${title}</h2>${lignes.map(([label,value]) => `<p style="white-space:pre-wrap"><strong>${label} :</strong> ${echapperHtml(value)}</p>`).join('')}<p>Cette demande ne réserve pas la date et ne vaut pas accord sur un devis.</p></div>`;
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json'},
      signal: AbortSignal.timeout(15000),
      body:JSON.stringify({from:process.env.CONTACT_FROM_EMAIL || 'JoksWed <onboarding@resend.dev>', to:[process.env.CONTACT_TO_EMAIL || 'jokswed@gmail.com'], reply_to:d.email, subject:`${title} — ${d.noms}`, text, html}),
    });
    if (!response.ok) {
      console.error('Échec du service de messagerie', response.status);
      return NextResponse.json({ok:false, message:'L’envoi a échoué. Merci de réessayer.'}, {status:502});
    }
    return NextResponse.json({ok:true});
  } catch (error) {
    if (error instanceof DemandeInvalide) return NextResponse.json({ok:false,message:error.message}, {status:400});
    console.error('Échec du traitement du formulaire');
    return NextResponse.json({ok:false,message:'L’envoi n’a pas pu être confirmé. Merci de nous contacter par e-mail si nécessaire.'}, {status:500});
  }
}
