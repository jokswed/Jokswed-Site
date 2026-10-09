/* Produit un exemplaire de chaque document via la VRAIE chaîne de génération,
   depuis une demande déposée par le formulaire public. */
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import pg from "pg";
const r_ = createRequire(import.meta.url);
const so = r_.resolve("server-only");
r_.cache[so] = { id: so, filename: so, loaded: true, exports: {} } as never;
process.env.JOKSWED_CHIFFREMENT_CLE = Buffer.alloc(32, 7).toString("base64");

const { demarrer, urlMigrateur, baseVierge } = await import("./pg-dev.mjs");
const { migrer } = await import("./migrer.mjs");
const { semer } = await import("./semer.mjs");
const { deposerDemande } = await import("../lib/demandes/depot.ts");
const gen = await import("../lib/documents/generer.ts");
const { fermerPool } = await import("../lib/db/client.ts");

const pgdev = await demarrer();
try {
  const base = await baseVierge("jokswed_exemples");
  await migrer(urlMigrateur(base), { silencieux: true });
  const f: any = await semer(urlMigrateur(base), { silencieux: true });

  const c = new pg.Client({ connectionString: urlMigrateur(base) });
  await c.connect();
  await c.query(
    `INSERT INTO sessions (utilisateur_id, jeton_hache, expire_le, mfa_validee)
     VALUES ($1,'exemples', now() + interval '1 day', true)`, [f.utilisateurs.proprietaire]);
  /* Régime et médiateur posés, pour montrer un document ÉMIS. */
  await c.query(
    `INSERT INTO regimes_tva (entreprise_id, regime, mention_legale, debut_le)
     VALUES ($1,'franchise_base','TVA non applicable, article 293 B du CGI', current_date)`,
    [f.entreprises.jokswed]);
  await c.query(
    `UPDATE entreprises SET mediateur_nom = 'Médiateur du e-commerce (exemple)',
            mediateur_url = 'https://exemple.invalid/mediation' WHERE id = $1`,
    [f.entreprises.jokswed]);

  const q = async (texte: string, valeurs: unknown[] = []) => {
    const res = await c.query(texte, valeurs as never[]);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  };
  const avec = async <T,>(travail: () => Promise<T>): Promise<T> => {
    await c.query("BEGIN");
    try {
      await c.query("SELECT set_config('app.session_jeton','exemples', true)");
      const r = await travail();
      await c.query("COMMIT");
      return r;
    } catch (e) { await c.query("ROLLBACK"); throw e; }
  };

  process.env.DATABASE_URL_APP = urlMigrateur(base);
  const depot = await deposerDemande({
    cleIdempotence: "exemples-v5",
    contactNom: "Camille & Noé FICTIF",
    contactEmail: "camille.noe@exemple.invalid",
    contactTelephone: "06 55 44 33 22",
    dateMariage: "2028-08-26",
    lieu: "Domaine des Essais, 77300 Fontainebleau",
    message: "Reportage complet de la journée.",
    formuleCle: "formule-2",
    supplementsCles: [],
    consentementDemande: true,
    consentementPartenaire: false,
    ipTronquee: "203.0.113.0/24",
  });

  /* 1. DEVIS */
  const devis = await avec(() =>
    gen.genererDevisDepuisDemande(q as never, depot.demandeId,
      f.entreprises.jokswed, f.utilisateurs.proprietaire));

  /* Émission réelle du devis, pour que le contrat le référence par son numéro. */
  /* Émettre, puis rendre, puis sceller — DANS UNE SEULE TRANSACTION.
     La contrainte différée refuse de valider une émission non scellée. */
  const emettre = async (documentId: string) => avec(async () => {
    const e = await q("SELECT * FROM app.emettre_document($1)", [documentId]);
    if (!e.rows[0]?.emis) throw new Error(`émission refusée : ${e.rows[0]?.motifs}`);
    const { rows } = await q("SELECT instantane FROM documents WHERE id = $1", [documentId]);
    const { pdf } = gen.rendrePdf(rows[0].instantane, false);
    const { createHash } = await import("node:crypto");
    await q("SELECT app.sceller_document($1,$2)",
      [documentId, createHash("sha256").update(pdf).digest("hex")]);
  });
  await emettre(devis.documentId);

  /* ⚠️ CHAQUE EXEMPLAIRE EST ÉCRIT DANS SON ÉTAT RÉEL, ET RELU APRÈS
     L'ÉMISSION : c'est elle qui pose le numéro dans l'instantané. */
  const d1e = await avec(() => q("SELECT instantane FROM documents WHERE id = $1", [devis.documentId]));
  await writeFile(new URL("../.pgdev/exemple-1-devis.pdf", import.meta.url).pathname,
    gen.rendrePdf(d1e.rows[0].instantane, false).pdf);

  /* 2. CONTRAT */
  const contrat = await avec(() =>
    gen.genererContratDepuisDevis(q as never, devis.documentId,
      f.entreprises.jokswed, f.utilisateurs.proprietaire));
  const d2 = await avec(() => q("SELECT instantane FROM documents WHERE id = $1", [contrat.documentId]));
  await writeFile(new URL("../.pgdev/exemple-2-contrat.pdf", import.meta.url).pathname,
    gen.rendrePdf(d2.rows[0].instantane, true).pdf);

  /* 3. FACTURE D'ACOMPTE */
  const facture = await avec(() =>
    gen.genererFactureDepuisDevis(q as never, devis.documentId, "acompte",
      f.entreprises.jokswed, f.utilisateurs.proprietaire));
  await emettre(facture.documentId);
  const d3 = await avec(() => q("SELECT instantane FROM documents WHERE id = $1", [facture.documentId]));
  await writeFile(new URL("../.pgdev/exemple-3-facture-acompte.pdf", import.meta.url).pathname,
    gen.rendrePdf(d3.rows[0].instantane, false).pdf);

  const situation = await avec(() => q("SELECT * FROM app.situation_financiere($1)", [depot.demandeId]));
  const etats = await avec(() => q(
    "SELECT type, numero, statut FROM documents ORDER BY cree_le"));
  console.log("états :", JSON.stringify(etats.rows));
  console.log("acompte :", (facture.montantCents / 100).toFixed(2), "€");
  console.log("situation :", JSON.stringify(situation.rows[0]));
  await c.end();
} catch (erreur) {
  console.error("échec :", erreur instanceof Error ? erreur.message : erreur);
  process.exitCode = 1;
} finally {
  /* ⚠️ Le pool applicatif doit être fermé AVANT d'arrêter PostgreSQL :
     sinon ses connexions ouvertes remontent un « terminating connection »
     qui masque l'erreur réelle. */
  await fermerPool().catch(() => {});
  await pgdev.stop();
}
