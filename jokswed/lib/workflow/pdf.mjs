import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
const money=c=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(c/100).replaceAll('\u202f',' ').replaceAll('\u00a0',' ');
const clean=s=>String(s??'').replaceAll('\u202f',' ').replaceAll('\u00a0',' ').replaceAll('‑','-').replaceAll('→','-').replaceAll('✨','').replaceAll('🤍','').replaceAll('👑','');
export async function renderPdf(snapshot,{signedAt=null,signature=null}={}) {
 const pdf=await PDFDocument.create();const regular=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 let page,y;
 const ink=rgb(.1,.1,.1),grey=rgb(.4,.4,.4);
 function next(){page=pdf.addPage([595.28,841.89]);y=788;page.drawText(signedAt?'DOCUMENT VALIDÉ PAR LE PHOTOGRAPHE':'BROUILLON - NON SIGNÉ',{x:44,y:818,size:8,font:bold,color:grey});}
 next();
 function line(t,{size=10,font=regular,color=ink,space=snapshot.kind==='devis'?2:5}={}){
  let words=clean(t).split(/\s+/),current='';
  const width=s=>{try{return font.widthOfTextAtSize(s,size);}catch{throw new Error('Un caractère du document ne peut pas être imprimé. Remplacez les symboles inhabituels.');}};
  function flush(){if(y<size+58)next();page.drawText(current,{x:44,y,size,font,color});y-=size*1.45;current='';}
  for(let w of words){
   if(width(w)>505){if(current)flush();let part='';for(const char of w){if(width(part+char)>505){current=part;flush();part='';}part+=char;}current=part;continue;}
   if(current&&width(current+' '+w)>505)flush();current=current?current+' '+w:w;
  }
  if(current)flush();y-=space;
 }
 const title=t=>{if(y<70)next();line(t,{size:13,font:bold,space:8});};
 line(snapshot.kind==='devis'?'DEVIS':'CONTRAT DE PRESTATION',{size:27,font:bold,space:10});
 line(snapshot.entreprise.nom,{size:14});line(`Référence : ${snapshot.reference}`);line(snapshot.entreprise.adresse);
 line(`SIRET : ${snapshot.entreprise.siret} | ${snapshot.entreprise.email}`);
 title('Clients');line(snapshot.client.nom||'Nom à compléter');if(snapshot.client.secondNom)line(snapshot.client.secondNom);line(snapshot.client.adresse||'Adresse à compléter');line(snapshot.client.email);
 title('Votre mariage');line(`Date : ${snapshot.prestation.date||'À préciser'} | Présence : jusqu’à ${snapshot.prestation.heures} heures`);
 line(`Lieu(x) : ${snapshot.prestation.lieu||'À préciser'}`);line(`Horaires : ${snapshot.prestation.debut||'À préciser'} - ${snapshot.prestation.fin||'À préciser'}`);
 if(snapshot.prestation.engagement)line(`Séance engagement : ${snapshot.prestation.engagement}`);
 title('Prestations');for(const l of snapshot.lignes)line(`${l.libelle} : ${money(l.montantCentimes)}`,{font:bold});
 for(const l of snapshot.prestation.inclus.split('\n').filter(Boolean))line(`- ${l}`);
 title(`Total à payer : ${money(snapshot.total.totalCentimes)}`);
 if(snapshot.tva==='20')line(`HT : ${money(snapshot.total.htCentimes)} | TVA 20 % : ${money(snapshot.total.tvaCentimes)}`);
 else line(snapshot.tvaConfirmee?'TVA non applicable, article L. 223-3 du CIBS.':'Hypothèse de préparation : franchise de TVA, à confirmer avant émission.');
 title('Paiement');const labels=['Acompte à la signature',`Deuxième versement : ${snapshot.deuxiemeVersement||'date à convenir'}`,'Solde après mise à disposition de l’aperçu et avant livraison complète'];
 snapshot.total.versementsCentimes.forEach((v,i)=>line(`${labels[i]||`Versement ${i+1}`} : ${money(v)} (${snapshot.echeances[i]} %)`));
 line('La réservation est définitive après signature du devis et du contrat et encaissement de l’acompte.');
 if(snapshot.kind==='devis'){line(`Validité : ${snapshot.validiteJours} jours à compter de la validation datée du photographe.`);line('Les autres conditions figurent dans le contrat de prestation associé.');}
 else {if(y<180)next();title('Conditions de la prestation');if(!snapshot.conditions.trim())line('Conditions à compléter avant validation.');else for(const paragraph of snapshot.conditions.split('\n').filter(Boolean)){if(/^\d+\./.test(paragraph)){if(y<140)next();line(paragraph,{size:10,font:bold,space:6});}else line(paragraph,{size:10,space:4});}}
 if(y<(signedAt?190:150))next();title('Signature du photographe');
 if(signedAt&&signature){const image=await pdf.embedPng(signature);const dims=image.scaleToFit(150,55);page.drawImage(image,{x:44,y:y-dims.height,width:dims.width,height:dims.height});y-=dims.height+12;line(`Validé le ${new Date(signedAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})} (Europe/Paris)`);}
 else line('En attente de validation - aucune signature apposée.');
 title('Accord des clients');line('Les signatures clients seront recueillies séparément.');
 for(const [i,p] of pdf.getPages().entries())p.drawText(`${snapshot.reference} | ${i+1} / ${pdf.getPageCount()}`,{x:44,y:27,size:8,font:regular,color:grey});
 return Buffer.from(await pdf.save());
}
