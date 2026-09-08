'use client';
import { useState,useEffect } from 'react';
import { PACKAGES } from '@/lib/workflow/catalogue.mjs';
const euros=c=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(c/100);
async function api(path,body,method){const r=await fetch('/api/gestion/'+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const result=await r.json();if(!r.ok){const e=new Error(result.message||'Opération impossible.');e.status=r.status;throw e;}return result;}
export default function Gestion(){
 const [login,setLogin]=useState(false),[password,setPassword]=useState(''),[rows,setRows]=useState([]),[config,setConfig]=useState({}),[d,setD]=useState(null),[dirty,setDirty]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[read,setRead]=useState(false),[calendar,setCalendar]=useState(''),[name,setName]=useState('');
 async function refresh(){try{const r=await api('dossiers');setRows(r.dossiers);setConfig(r.configuration);setLogin(true);}catch(e){setMessage(e.message);if(e.status===401)setLogin(false);}}
 useEffect(()=>{refresh();},[]);
 useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
 async function run(fn){setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message);if(e.status===401)setLogin(false);}finally{setBusy(false);}}
 function change(section,key,value){setD(prev=>({...prev,[section]:{...prev[section],[key]:value}}));setDirty(true);setPreview(null);setRead(false);}
 function top(key,value){setD(prev=>({...prev,[key]:value}));setDirty(true);setPreview(null);setRead(false);}
 async function open(id){if(dirty){setMessage('Enregistrez vos modifications avant de changer de dossier.');return;}setD(await api('dossiers/'+id));setPreview(null);setRead(false);setCalendar('');}
 async function action(action,extra={}){const next=await api('dossiers/'+d.id,{action,revision:d.revision,...extra});setD(next);setDirty(false);setRead(false);setPreview(null);await refresh();return next;}
 async function see(kind){const r=await fetch(`/api/gestion/dossiers/${d.id}?document=${kind}`,{cache:'no-store'});if(!r.ok){const e=await r.json();throw new Error(e.message);}setPreview({kind,hash:r.headers.get('X-Document-Hash'),url:URL.createObjectURL(await r.blob())});setRead(false);setCalendar('');}
 function selectPackage(value){const p=PACKAGES[value];if(!p)return;setD(prev=>({...prev,prestation:{...prev.prestation,formule:value,heures:p.hours,inclus:p.inclus.join('\n')},lignes:[{libelle:'Formule '+p.label,montantCentimes:p.cents}]}));setDirty(true);setPreview(null);}
 const field=(label,section,key,type='text',wide=false)=><label className={wide?'gestion-wide':''}>{label}{wide?<textarea value={d[section][key]} onChange={e=>change(section,key,e.target.value)}/>:<input type={type} value={d[section][key]} onChange={e=>change(section,key,type==='number'?Number(e.target.value):e.target.value)}/>}</label>;
 return <section className="conteneur gestion">
  <header className="gestion-head"><div><p className="label">Espace privé</p><h1 className="display">Vos dossiers mariage</h1></div>{login&&<button className="btn" disabled={busy} onClick={()=>run(async()=>{await api('session',null,'DELETE');setLogin(false);setD(null);setRows([]);})}>Se déconnecter</button>}</header>
  {message&&<p role="status" className="gestion-message">{message}</p>}
  {!login?<form className="gestion-login" onSubmit={e=>{e.preventDefault();run(async()=>{await api('session',{password});setPassword('');setLogin(true);await refresh();});}}><label>Mot de passe de votre espace privé<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="btn" disabled={busy}>Se connecter</button></form>:<>
   <p className="gestion-muted">{config.signature?'Signature configurée':'Signature à configurer'} · {config.google?'Google Calendrier connecté':'Google Calendrier à connecter'}. La signature client et le suivi automatique des paiements restent à raccorder.</p>
   <div className="gestion-grid"><aside>
    <form onSubmit={e=>{e.preventDefault();run(async()=>{if(dirty)throw new Error('Enregistrez le dossier ouvert avant de continuer.');const n=await api('dossiers',{noms:name});setName('');await refresh();await open(n.id);});}}><label>Nouveau couple<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} required placeholder="Prénoms du couple"/></label><button className="btn" disabled={busy}>Créer un dossier</button></form>
    <nav aria-label="Dossiers">{rows.map(r=><button key={r.id} className={'gestion-dossier '+(d?.id===r.id?'selected':'')} disabled={busy} onClick={()=>run(()=>open(r.id))}><strong>{r.noms}</strong><span>{r.date||'Date à préciser'}</span><small>{r.refuse?'Refusé':r.documents.length?'Document validé':'Brouillon'}</small></button>)}</nav>
    {!rows.length&&<p>Aucun dossier pour le moment.</p>}
   </aside><div>{!d?<p>Sélectionnez une demande ou créez un dossier pour préparer vos documents.</p>:<>
    <h2>{d.client.noms||'Dossier mariage'}</h2>
    {(d.demande.message||d.demande.options)&&<details><summary>Demande initiale</summary><p className="gestion-pre">{d.demande.message}</p>{d.demande.options&&<p>Options souhaitées : {d.demande.options}</p>}</details>}
    <form onSubmit={e=>{e.preventDefault();run(async()=>{await action('modifier',{dossier:d});setMessage('Dossier enregistré. Les documents sont prêts à être relus.');});}}>
     <fieldset disabled={busy}><legend>Clients</legend><div className="gestion-fields">
      {field('Prénoms affichés','client','noms')}{field('Nom complet du signataire','client','nom')}{field('E-mail du signataire','client','email','email')}{field('Adresse complète de facturation','client','adresse','text',true)}{field('Second signataire (facultatif)','client','secondNom')}{field('Son e-mail','client','secondEmail','email')}
     </div></fieldset>
     <fieldset disabled={busy}><legend>Prestation et prix</legend><div className="gestion-fields">
      <label>Formule<select value={d.prestation.formule} onChange={e=>selectPackage(e.target.value)}><option value="indecis">À choisir</option>{Object.entries(PACKAGES).map(([k,p])=><option value={k} key={k}>{p.label} — {euros(p.cents)}</option>)}</select></label>
      {field('Date du mariage','prestation','date','date')}{field('Début de présence','prestation','debut','time')}{field('Fin de présence','prestation','fin','time')}{field('Nombre d’heures incluses','prestation','heures','number')}{field('Date et lieu de la séance engagement (si prévus)','prestation','engagement')}{field('Lieux et adresses','prestation','lieu','text',true)}{field('Prestations incluses, une par ligne','prestation','inclus','text',true)}
     </div><p className="gestion-muted">Choisir une autre formule remplace les lignes tarifaires. Ajoutez ensuite les options convenues.</p>
     {d.lignes.map((l,i)=><div className="gestion-ligne" key={i}><label>Prestation<input value={l.libelle} onChange={e=>top('lignes',d.lignes.map((x,j)=>j===i?{...x,libelle:e.target.value}:x))}/></label><label>Prix client (€)<input type="number" min="0" step="0.01" value={l.montantCentimes/100} onChange={e=>top('lignes',d.lignes.map((x,j)=>j===i?{...x,montantCentimes:Math.round(Number(e.target.value)*100)}:x))}/></label><button type="button" onClick={()=>top('lignes',d.lignes.filter((_,j)=>j!==i))}>Retirer</button></div>)}
     <button type="button" onClick={()=>top('lignes',[...d.lignes,{libelle:'Option à préciser',montantCentimes:0}])}>Ajouter une option</button>
     <p><strong>Total client : {euros(d.lignes.reduce((s,l)=>s+l.montantCentimes,0))}</strong></p>
     <label>Régime de TVA<select value={d.tva} onChange={e=>{top('tva',e.target.value);top('tvaConfirmee',false);}}><option value="franchise">Franchise en base — aucune TVA facturée</option><option value="20">TVA à 20 % comprise dans le prix client</option></select></label>
     <label className="gestion-check"><input type="checkbox" checked={d.tvaConfirmee} onChange={e=>top('tvaConfirmee',e.target.checked)}/>J’ai vérifié que ce régime de TVA correspond à ma situation.</label>
     <p className="gestion-muted">Le brouillon utilise votre hypothèse de franchise. Le prix client reste inchangé dans les deux cas.</p>
     </fieldset>
     <fieldset disabled={busy}><legend>Paiement et contrat</legend><p>Échéancier : {d.echeances.join(' % / ')} %. Le solde intervient après l’aperçu photo.</p><label>Date du deuxième versement<input type="date" value={d.deuxiemeVersement} onChange={e=>top('deuxiemeVersement',e.target.value)}/></label>
      <details><summary>Relire et compléter les conditions du contrat</summary><p>Les mentions [À COMPLÉTER] doivent être renseignées avant de signer le contrat.</p><label>Conditions<textarea className="gestion-conditions" value={d.conditions} onChange={e=>top('conditions',e.target.value)}/></label></details>
     </fieldset>
     <div className="gestion-actions"><button className="btn" disabled={busy||!dirty}>Enregistrer les modifications</button>{dirty&&<span>Enregistrer crée une nouvelle version non signée.</span>}</div>
    </form>
    <fieldset disabled={busy||dirty}><legend>Documents et validation</legend>
     <div className="gestion-actions">{['devis','contrat'].map(kind=><button key={kind} onClick={()=>run(()=>see(kind))}>Consulter le {kind}{d.approbations[kind]?' validé':''}</button>)}
     {!Object.keys(d.approbations).length&&<button onClick={()=>run(()=>action('refuser'))}>Refuser ce dossier</button>}</div>
     {preview&&<div className="gestion-preview"><iframe title={`Aperçu du ${preview.kind}`} src={preview.url}/><a href={preview.url} target="_blank" rel="noreferrer">Ouvrir le PDF en grand</a>
      {!d.approbations[preview.kind]?<><label className="gestion-check"><input type="checkbox" checked={read} onChange={e=>setRead(e.target.checked)}/>J’ai relu cette version du {preview.kind} et je souhaite la signer.</label>
       {preview.kind==='devis'&&<label>Ajouter cette date à mon calendrier Google, visible dans Apple Calendrier ?<select value={calendar} onChange={e=>setCalendar(e.target.value)}><option value="">Choisir oui ou non</option><option value="oui">Oui, comme option de mariage</option><option value="non">Non</option></select></label>}
       <button className="btn" disabled={!read||(preview.kind==='devis'&&!calendar)} onClick={()=>run(async()=>{await action('valider',{kind:preview.kind,expectedHash:preview.hash,readConfirmed:read,addCalendar:calendar==='oui'});setMessage('Document validé et signé. Vous pouvez maintenant l’envoyer.');})}>Valider et signer le {preview.kind}</button>
      </>:<p>Cette version est validée et signée par vous. Les signatures clients restent à recueillir.</p>}
     </div>}
     {Object.entries(d.approbations).map(([kind,a])=><div className="gestion-envoi" key={kind}><strong>{kind} validé</strong><span>{a.envoi?.etat==='envoye'?'Envoyé':a.envoi?'Envoi à vérifier':'Non envoyé'}</span>{!a.envoi&&<button onClick={()=>run(async()=>{await action('envoyer',{kind});setMessage('Document envoyé aux signataires indiqués.');})}>Envoyer aux signataires</button>}</div>)}
     {d.calendrier&&<p>Calendrier : {({ajoute:'option ajoutée',erreur:'ajout à reprendre','a-ajouter':'ajout en attente','a-revoir':'à revoir après modification','non-demande':'aucun ajout demandé'})[d.calendrier.etat]}.</p>}
     {['a-ajouter','erreur'].includes(d.calendrier?.etat)&&<button onClick={()=>run(()=>action('calendrier'))}>Réessayer l’ajout au calendrier</button>}
    </fieldset>
   </>}</div></div>
  </>}
 </section>;
}
