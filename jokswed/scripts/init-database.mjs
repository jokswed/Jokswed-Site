import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL doit être configurée hors du dépôt.');
const sql=neon(process.env.DATABASE_URL);
await sql.query(await readFile(new URL('./database.sql',import.meta.url),'utf8'));
console.log('Table des dossiers disponible.');
