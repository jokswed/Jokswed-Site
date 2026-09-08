import { neon } from '@neondatabase/serverless';
import { WorkflowError } from './model.mjs';
function sql(){if(!process.env.DATABASE_URL)throw new WorkflowError('Le stockage des dossiers doit être connecté.',503);return neon(process.env.DATABASE_URL);}
export async function listRecords(){ const rows=await sql()`SELECT data FROM jw_dossiers ORDER BY updated_at DESC LIMIT 200`;return rows.map(r=>r.data); }
export async function getRecord(id){const rows=await sql()`SELECT data FROM jw_dossiers WHERE id=${id}`;if(!rows[0])throw new WorkflowError('Dossier introuvable.',404);return rows[0].data;}
export async function createRecord(d,key=d.id){const rows=await sql()`INSERT INTO jw_dossiers(id,data,capture_key) VALUES (${d.id},${JSON.stringify(d)}::jsonb,${key}) ON CONFLICT(capture_key) DO UPDATE SET capture_key=EXCLUDED.capture_key RETURNING data`;return rows[0].data;}
export async function saveRecord(d,revision){d.revision=revision+1;d.updatedAt=new Date().toISOString();const rows=await sql()`UPDATE jw_dossiers SET data=${JSON.stringify(d)}::jsonb,updated_at=now() WHERE id=${d.id} AND (data->>'revision')::int=${revision} RETURNING data`;if(!rows.length)throw new WorkflowError('Ce dossier a changé dans une autre fenêtre. Rechargez-le avant de continuer.',409);return rows[0].data;}
