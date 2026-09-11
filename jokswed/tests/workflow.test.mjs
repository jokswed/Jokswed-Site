import test from 'node:test';
import assert from 'node:assert/strict';
import { draft,edit,total,documentSnapshot,digest,approvalProblems } from '../lib/workflow/model.mjs';
import { eventBody } from '../lib/workflow/google.mjs';
import { approve } from '../lib/workflow/actions.mjs';
import { session,validSession,checkPassword,sameOrigin } from '../lib/workflow/auth.mjs';
function complete(){const d=draft({noms:'Couple fictif',formule:'signature',nomSignataire:'Client test',email:'test@example.com',adresse:'Adresse fictive',date:'2027-06-04',lieu:'Lieu de test'});d.tvaConfirmee=true;d.deuxiemeVersement='2027-05-01';d.conditions='Conditions de test uniquement.';return d;}
test('TVA comprise par défaut et prix client inchangé',()=>{const d=draft({formule:'signature'});assert.equal(d.tva,'20');assert.equal(d.tvaConfirmee,true);assert.equal(total(d).totalCentimes,130000);assert.equal(total(d).htCentimes,108333);assert.equal(total(d).tvaCentimes,21667);});
test('les clauses incomplètes empêchent la signature du contrat',()=>{const d=complete();d.conditions='Médiateur : [À COMPLÉTER]';assert.ok(approvalProblems(d,'contrat').length);});
test('une modification retire les deux validations et conserve l’historique',()=>{const d=complete();d.approbations={devis:{hash:'old',pdf:'pdf'},contrat:{hash:'old2'}};const e=edit(d,{...d,client:{...d.client,nom:'Nom modifié'}});assert.deepEqual(e.approbations,{});assert.equal(e.historique.length,1);assert.equal(e.contentVersion,2);assert.equal(d.approbations.devis.hash,'old');});
test('l’état de livraison ne change pas la version du document',()=>{const d=complete();const h=digest(documentSnapshot(d,'devis'));d.revision++;assert.equal(h,digest(documentSnapshot(d,'devis')));});
test('un aperçu périmé ne peut pas être signé',async()=>{const d=complete();await assert.rejects(()=>approve(d,'devis',{expectedHash:'faux',readConfirmed:true,addCalendar:false}),/changé/);});
test('choix calendrier et lecture sont obligatoires',async()=>{const d=complete(),expectedHash=digest(documentSnapshot(d,'devis'));await assert.rejects(()=>approve(d,'devis',{expectedHash,readConfirmed:false,addCalendar:false}),/lecture/);await assert.rejects(()=>approve(d,'devis',{expectedHash,readConfirmed:true}),/oui ou non/);});
test('aucune signature possible sans image de signature',async()=>{const d=complete(),expectedHash=digest(documentSnapshot(d,'devis'));await assert.rejects(()=>approve(d,'devis',{expectedHash,readConfirmed:true,addCalendar:false},{}),/signature/);});
test('calendrier : lendemain pour une fin après minuit et identifiant stable',()=>{const d=complete();d.prestation.debut='14:00';d.prestation.fin='02:00';const s=documentSnapshot(d,'devis');const a=eventBody(d.id,s),b=eventBody(d.id,s);assert.equal(a.end.dateTime,'2027-06-05T02:00:00');assert.equal(a.id,b.id);assert.match(a.id,/^[0-9a-v]+$/);assert.equal(a.attendees,undefined);});
test('calendrier : horaire absent ou invalide interdit',()=>{const d=complete();assert.throws(()=>eventBody(d.id,documentSnapshot(d,'devis')),/horaires/);d.prestation.debut='99:00';d.prestation.fin='15:00';assert.throws(()=>eventBody(d.id,documentSnapshot(d,'devis')));});
test('session expirée, falsifiée ou mot de passe erroné refusés',()=>{const old={...process.env};process.env.ADMIN_PASSWORD='test-only-password-long-enough';process.env.SESSION_SECRET='test-only-session-secret-long-enough';try{const s=session(1000);assert.ok(validSession(s,2000));assert.ok(!validSession(s+'x',2000));assert.ok(!validSession(s,1000+8*3600000));assert.ok(checkPassword('test-only-password-long-enough'));assert.ok(!checkPassword('incorrect'));}finally{process.env=old;}});
test('les mutations depuis une autre origine sont refusées',()=>{const old=process.env.APP_URL;process.env.APP_URL='https://jokswed.example';try{assert.throws(()=>sameOrigin(new Request('https://jokswed.example/api',{headers:{origin:'https://other.example'}})),/Origine/);}finally{if(old===undefined)delete process.env.APP_URL;else process.env.APP_URL=old;}});

test('validation du devis uniquement : signature stockée et contrat toujours non signé',async()=>{
 const d=complete();const env={...process.env,SIGNATURE_PNG_BASE64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='};
 const expectedHash=digest(documentSnapshot(d,'devis',env));
 const a=await approve(d,'devis',{expectedHash,readConfirmed:true,addCalendar:false},env);
 assert.ok(Buffer.from(a.approbations.devis.pdf,'base64').subarray(0,4).equals(Buffer.from('%PDF')));
 assert.equal(a.approbations.contrat,undefined);assert.equal(d.approbations.devis,undefined);assert.equal(a.calendrier.etat,'non-demande');
});

test('les champs des mariés construisent un brouillon non signé',()=>{const d=draft({formule:'signature',nomSignataire:'Camille Test',email:'test@example.com',adresse:'Adresse test',date:'2027-06-12',lieu:'Paris',debut:'10:00',fin:'22:00'});assert.equal(d.client.nom,'Camille Test');assert.equal(d.prestation.debut,'10:00');assert.equal(d.prestation.fin,'22:00');assert.equal(d.lignes[0].montantCentimes,130000);assert.deepEqual(d.approbations,{});assert.equal(d.calendrier,null);});
