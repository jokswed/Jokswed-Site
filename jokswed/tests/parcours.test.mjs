import test from 'node:test';
import assert from 'node:assert/strict';
import { lireDemande, lignesDemande, echapperHtml } from '../lib/demande.mjs';
import { calculerDevis } from '../lib/devis.mjs';
const contact = { noms:'Couple test', email:'test@example.com', message:'Bonjour' };
const dossier = { ...contact, type:'devis', date:'2027-06-04', lieu:'Lieu à Paris', nomSignataire:'Client test', adresse:'Adresse test, France' };
test('le formulaire court existant reste accepté',()=>assert.equal(lireDemande(contact).formule,'indecis'));
test('toutes les informations du dossier parviennent au photographe',()=>{
 const d = lireDemande({...dossier, secondSignataire:'Autre client',secondEmail:'second@example.com',options:'Album'});
 const texte = lignesDemande(d).flat().join(' ');
 for(const s of ['Autre client','second@example.com','Album','2027-06-04']) assert.ok(texte.includes(s));
});
test('dossier incomplet, dates impossibles et formules inconnues refusés',()=>{
 for(const d of [{...dossier,adresse:''},{...dossier,date:'2027-02-30'},{...contact,formule:'inventee'},{...dossier,secondSignataire:'Manque email'}]) assert.throws(()=>lireDemande(d));
});
test('le message ne peut injecter du HTML',()=>assert.equal(echapperHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;'));
test('rejet des objets malformés et messages trop longs',()=>{
 for(const d of [null,[],{...contact,noms:{}},{...contact,message:'x'.repeat(5001)},{...contact,noms:'Test\nBcc:test@example.com'}]) assert.throws(()=>lireDemande(d));
});
test('le piège anti-spam évite le traitement',()=>assert.deepEqual(lireDemande({...contact,website:'robot'}),{spam:true}));
const lignes = [{libelle:'Prestation test',montantCentimes:140000}];
test('TVA inconnue : émission bloquée',()=>assert.throws(()=>calculerDevis({lignes,tva:'a-verifier'})));
test('exemple 1 400 euros : TVA et trois paiements exacts',()=>assert.deepEqual(calculerDevis({lignes,tva:'20'}),{totalCentimes:140000,htCentimes:116667,tvaCentimes:23333,versementsCentimes:[42000,42000,56000]}));
test('franchise : aucune TVA et conservation des centimes',()=>{
 const d=calculerDevis({lignes:[{libelle:'Test',montantCentimes:100001}],tva:'franchise'});
 assert.equal(d.tvaCentimes,0);assert.equal(d.versementsCentimes.reduce((a,b)=>a+b,0),100001);
});
test('prix non confirmé et échéancier invalide bloqués',()=>{
 assert.throws(()=>calculerDevis({lignes:[{libelle:'Option'}],tva:'20'}));
 assert.throws(()=>calculerDevis({lignes,tva:'20',pourcentages:[30,30,30]}));
});
