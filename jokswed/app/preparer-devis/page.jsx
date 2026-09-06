import FormulaireContact from "@/components/FormulaireContact";
export const metadata = { title: "Préparer votre devis", robots: { index: false, follow: false } };
export default function PreparerDevis() {
  return <div className="conteneur dossier-page">
    <header><p className="label">Votre mariage</p><h1 className="display t-hero">Préparons votre devis</h1>
    <p className="texte">Après notre premier échange, complétez les informations nécessaires à vos documents. Je vérifierai la prestation, le prix et ma disponibilité avant de vous transmettre votre devis.</p></header>
    <FormulaireContact detail />
  </div>;
}
