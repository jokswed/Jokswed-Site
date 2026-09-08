import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { WorkflowError } from './model.mjs';
export const COOKIE='jw_gestion';
export function configured(){return (process.env.ADMIN_PASSWORD||'').length>=20&&(process.env.SESSION_SECRET||'').length>=32;}
const mac=s=>createHmac('sha256',process.env.SESSION_SECRET||'').update(s).digest('base64url');
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function checkPassword(p){return configured()&&typeof p==='string'&&equal(mac(p),mac(process.env.ADMIN_PASSWORD));}
export function session(now=Date.now()){if(!configured())throw new WorkflowError('L’accès privé doit être configuré.',503);const payload=Buffer.from(JSON.stringify({expires:now+8*3600000,nonce:randomBytes(16).toString('hex')})).toString('base64url');return `${payload}.${mac(payload)}`;}
export function validSession(token,now=Date.now()){if(!configured()||typeof token!=='string')return false;try{const [p,s,...rest]=token.split('.');return !rest.length&&!!s&&equal(s,mac(p))&&JSON.parse(Buffer.from(p,'base64url').toString()).expires>now;}catch{return false;}}
export function requireAdmin(request){const token=request.cookies.get(COOKIE)?.value;if(!validSession(token))throw new WorkflowError('Connectez-vous à votre espace privé.',401);}
export function sameOrigin(request){const origin=request.headers.get('origin');const expected=process.env.APP_URL||new URL(request.url).origin;if(!origin||origin!==expected)throw new WorkflowError('Origine de la demande refusée.',403);}
export async function readJson(request,max=70000){const text=await request.text();if(Buffer.byteLength(text)>max)throw new WorkflowError('Données trop volumineuses.',413);try{return JSON.parse(text);}catch{throw new WorkflowError('Demande invalide.');}}
