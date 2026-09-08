import { NextResponse } from 'next/server';
import { requireAdmin,sameOrigin,readJson } from '@/lib/workflow/auth.mjs';
import { listRecords,createRecord } from '@/lib/workflow/store.mjs';
import { draft } from '@/lib/workflow/model.mjs';
import { googleReady } from '@/lib/workflow/google.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request){try{requireAdmin(request);const data=await listRecords();return NextResponse.json({dossiers:data.map(d=>({id:d.id,noms:d.client.noms||d.client.nom||'Nouveau dossier',date:d.prestation.date,revision:d.revision,refuse:d.refuse,documents:Object.keys(d.approbations),createdAt:d.createdAt})),configuration:{google:googleReady(),signature:!!process.env.SIGNATURE_PNG_BASE64}},{headers:{'Cache-Control':'no-store'}});}catch(e){return NextResponse.json({message:e.status?e.message:'Impossible de charger les dossiers. Vérifiez la connexion au stockage.'},{status:e.status||503});}}
export async function POST(request){try{requireAdmin(request);sameOrigin(request);const {noms}=await readJson(request,1000);if(typeof noms!=='string'||!noms.trim()||noms.length>120)return NextResponse.json({message:'Indiquez les prénoms du couple.'},{status:400});return NextResponse.json(await createRecord(draft({noms:noms.trim()})));}catch(e){return NextResponse.json({message:e.status?e.message:'Impossible de créer le dossier.'},{status:e.status||503});}}
