import { NextResponse } from 'next/server';
import { COOKIE,checkPassword,session,sameOrigin,readJson,configured } from '@/lib/workflow/auth.mjs';
export const runtime='nodejs';
export async function POST(request){try{
 sameOrigin(request);
 if(!configured())return NextResponse.json({message:'L’accès privé doit être configuré dans Vercel.'},{status:503});
 const {password}=await readJson(request,2000);
 if(!checkPassword(password)){await new Promise(r=>setTimeout(r,500));return NextResponse.json({message:'Mot de passe incorrect.'},{status:401});}
 const r=NextResponse.json({ok:true});r.cookies.set(COOKIE,session(),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:8*3600,path:'/'});return r;
}catch(e){return NextResponse.json({message:e.status?e.message:'Connexion impossible.'},{status:e.status||500});}}
export async function DELETE(request){try{sameOrigin(request);const r=NextResponse.json({ok:true});r.cookies.set(COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:0,path:'/'});return r;}catch{return NextResponse.json({message:'Déconnexion refusée.'},{status:403});}}
