import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contexteAdmin } from "@/lib/admin/garde";
import { exigerAcces } from "@/lib/auth/acces";
import { avecAuth } from "@/lib/db/client";
import { validerSignature } from "@/lib/documents/signature-trace";
import SignaturePad from "@/components/admin/SignaturePad";
import {
  chiffrer, codeTotp, dechiffrer, engendrerGraineTotp,
  hacherMotDePasse, verifierMotDePasse, verifierTotp,
} from "@/lib/auth/secrets";

export const metadata = { title: "Mon compte" };
export const dynamic = "force-dynamic";

/* =============================================================================
   PARAMÈTRES → MON COMPTE
   -----------------------------------------------------------------------------
   Mot de passe, second facteur, sessions ouvertes, connexions récentes.

   ⚠️ L'ANCIEN MOT DE PASSE EST EXIGÉ POUR EN CHANGER.
   Sans cela, une session volée suffirait à verrouiller le propriétaire hors
   de son propre compte.

   ⚠️ LA GRAINE TOTP EST CHIFFRÉE AU REPOS (AES-256-GCM).
   Elle n'est déchiffrée que le temps de vérifier un code, et n'apparaît en
   clair que dans l'URL `otpauth://` affichée une seule fois, à celui qui
   vient de la demander.
   ============================================================================= */
export default async function MonCompte({ searchParams }) {
  const sp = await searchParams;
  const { session, entreprise } = await contexteAdmin();
  const acces = await exigerAcces(entreprise.id);

  const vue = await acces.executer(async (q) => {
    const { rows: moi } = await q(
      "SELECT prenom, nom, email FROM utilisateurs WHERE id = app.acteur()");
    const { rows: sessions } = await q("SELECT * FROM app.mes_sessions()");
    const { rows: connexions } = await q("SELECT * FROM app.mes_connexions(15)");
    const { rows: facteurs } = await q(
      `SELECT id, libelle, confirme_le FROM facteurs_mfa
        WHERE utilisateur_id = app.acteur() ORDER BY cree_le DESC`);
    const { rows: attente } = await q("SELECT * FROM app.mfa_en_attente()");
    const signature = process.env.JOKSWED_SIGNATURES_ENABLED === "1"
      ? await q("SELECT 1 FROM signatures_profils WHERE entreprise_id=$1 AND utilisateur_id=app.acteur()",
          [entreprise.id]) : { rows: [] };
    return { moi: moi[0], sessions, connexions, facteurs, attente: attente[0] ?? null,
      signaturePresente: signature.rows.length > 0 };
  });

  async function enregistrerSignature(formulaire) {
    "use server";
    if (process.env.JOKSWED_SIGNATURES_ENABLED !== "1") throw new Error("Signatures non activées");
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["document.rediger"]);
    const brut = String(formulaire.get("trace") ?? "");
    if (brut.length > 35000) throw new Error("Signature trop volumineuse");
    const valide = validerSignature(JSON.parse(brut));
    await a.executer(q => q(
      `INSERT INTO signatures_profils (entreprise_id, utilisateur_id, trace_chiffree)
         VALUES ($1,app.acteur(),$2)
         ON CONFLICT (entreprise_id, utilisateur_id)
           DO UPDATE SET trace_chiffree=excluded.trace_chiffree, maj_le=now()`,
      [e.id, chiffrer(JSON.stringify(valide))]));
    revalidatePath("/admin/parametres/compte");
  }

  async function retirerSignature() {
    "use server";
    if (process.env.JOKSWED_SIGNATURES_ENABLED !== "1") throw new Error("Signatures non activées");
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id, ["document.rediger"]);
    await a.executer(q => q(
      "DELETE FROM signatures_profils WHERE entreprise_id=$1 AND utilisateur_id=app.acteur()",[e.id]));
    revalidatePath("/admin/parametres/compte");
  }

  async function changerMotDePasse(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    const ancien = String(formulaire.get("ancien") ?? "");
    const nouveau = String(formulaire.get("nouveau") ?? "");
    const confirmation = String(formulaire.get("confirmation") ?? "");

    if (nouveau.length < 12) return redirigerVers("court");
    if (nouveau !== confirmation) return redirigerVers("different");

    /* L'empreinte actuelle se lit par le rôle d'authentification : la table
       `identifiants` n'est pas lisible par le rôle métier, et c'est voulu. */
    const empreinte = await avecAuth(async (q) => {
      const { rows } = await q("SELECT * FROM app.auth_identifiant($1)",
        [String(vue.moi.email).toLowerCase()]);
      return rows[0]?.secret_hache ?? null;
    });
    if (!empreinte || !(await verifierMotDePasse(ancien, empreinte))) {
      return redirigerVers("ancien");
    }

    const nouvelleEmpreinte = await hacherMotDePasse(nouveau);
    await a.executer((q) => q("SELECT app.changer_mot_de_passe($1)",
      [nouvelleEmpreinte]));
    /* ⚠️ LES AUTRES SESSIONS TOMBENT.
       Changer de mot de passe parce qu'on le croit compromis n'a de sens que
       si cela déconnecte celui qui l'aurait volé. La session courante
       survit, pour ne pas s'enfermer dehors au milieu de l'opération. */
    await a.executer((q) => q("SELECT app.revoquer_mes_sessions(true)"));
    return redirigerVers(null, "mot_de_passe");
  }

  async function preparerMfa() {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    const graine = engendrerGraineTotp();
    await a.executer((q) => q("SELECT app.mfa_preparer($1,$2)",
      [chiffrer(graine), "Application d'authentification"]));
    revalidatePath("/admin/parametres/compte");
  }

  async function confirmerMfa(formulaire) {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    const code = String(formulaire.get("code") ?? "").replace(/\s+/g, "");
    const ok = await a.executer(async (q) => {
      const { rows } = await q("SELECT * FROM app.mfa_en_attente()");
      if (!rows[0]) return false;
      if (!verifierTotp(dechiffrer(Buffer.from(rows[0].secret_chiffre)), code, 1)) return false;
      const { rows: r } = await q("SELECT app.mfa_confirmer($1) AS x", [rows[0].id]);
      return r[0]?.x === true;
    });
    return redirigerVers(ok ? null : "code", ok ? "mfa" : null);
  }

  async function retirerMfa() {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    await a.executer((q) => q("SELECT app.mfa_retirer()"));
    revalidatePath("/admin/parametres/compte");
  }

  async function revoquerSessions() {
    "use server";
    const { entreprise: e } = await contexteAdmin();
    const a = await exigerAcces(e.id);
    await a.executer((q) => q("SELECT app.revoquer_mes_sessions(true)"));
    return redirigerVers(null, "sessions");
  }

  const facteurActif = vue.facteurs.find((f) => f.confirme_le);
  /* L'URL `otpauth://` n'est composée qu'ici, pour un facteur en attente, et
     disparaît dès qu'il est confirmé. */
  const graineEnAttente = vue.attente
    ? dechiffrer(Buffer.from(vue.attente.secret_chiffre))
    : null;
  const urlOtp = graineEnAttente
    ? `otpauth://totp/${encodeURIComponent(`JoksWed:${vue.moi.email}`)}`
      + `?secret=${graineEnAttente}&issuer=JoksWed&digits=6&period=30`
    : null;

  const MESSAGES = {
    court: "Le mot de passe doit faire au moins 12 caractères.",
    different: "Les deux saisies ne correspondent pas.",
    ancien: "Mot de passe actuel incorrect.",
    code: "Code incorrect. Vérifiez l'heure de votre téléphone.",
  };
  const SUCCES = {
    mot_de_passe: "Mot de passe changé. Vos autres sessions ont été déconnectées.",
    mfa: "Double authentification activée.",
    sessions: "Vos autres sessions ont été déconnectées.",
  };

  return (
    <main className="admin-page">
      <header className="admin-entete">
        <div>
          <p className="label label--nu">{vue.moi.email}</p>
          <h1 className="display t-section">Mon compte</h1>
        </div>
        <Link href="/admin" className="btn btn--fantome">Retour</Link>
      </header>

      {sp?.erreur ? (
        <p role="alert" className="admin-alerte">{MESSAGES[sp.erreur] ?? "Refusé."}</p>
      ) : null}
      {sp?.ok ? (
        <p className="admin-alerte admin-alerte--neutre">{SUCCES[sp.ok] ?? "Enregistré."}</p>
      ) : null}

      {process.env.JOKSWED_SIGNATURES_ENABLED === "1" ? (
        <section className="admin-bloc">
          <h2 className="display t-carte">Ma signature</h2>
          <p className="recap__note">{vue.signaturePresente
            ? "Signature enregistrée et chiffrée pour cette entreprise. Vous pouvez la remplacer."
            : "Aucune signature enregistrée pour cette entreprise."}</p>
          <SignaturePad action={enregistrerSignature} />
          {vue.signaturePresente ? <form action={retirerSignature}>
            <button type="submit" className="btn btn--fantome" style={{marginTop:"0.7rem"}}>
              Supprimer ma signature enregistrée
            </button>
          </form> : null}
        </section>
      ) : null}

      <section className="admin-bloc">
        <h2 className="display t-carte">Mot de passe</h2>
        <form action={changerMotDePasse} className="formulaire">
          <div className="champ">
            <label htmlFor="ancien">Mot de passe actuel</label>
            <input id="ancien" name="ancien" type="password"
              autoComplete="current-password" required />
          </div>
          <div className="admin-grille-champs">
            <div className="champ">
              <label htmlFor="nouveau">Nouveau (12 caractères minimum)</label>
              <input id="nouveau" name="nouveau" type="password"
                autoComplete="new-password" minLength={12} required />
            </div>
            <div className="champ">
              <label htmlFor="confirmation">Confirmer</label>
              <input id="confirmation" name="confirmation" type="password"
                autoComplete="new-password" minLength={12} required />
            </div>
          </div>
          <p className="recap__note">
            Changer de mot de passe déconnecte vos autres appareils. Celui-ci
            reste connecté.
          </p>
          <button type="submit" className="btn btn--bloc">Changer</button>
        </form>
      </section>

      <section className="admin-bloc">
        <h2 className="display t-carte">Double authentification</h2>
        {facteurActif ? (
          <>
            <p className="recap__note">
              <span className="admin-pastille admin-pastille--emis">active</span>{" "}
              Un code vous sera demandé à chaque connexion.
            </p>
            <form action={retirerMfa} style={{ marginTop: "0.9rem" }}>
              <button type="submit" className="btn btn--fantome">Désactiver</button>
            </form>
          </>
        ) : urlOtp ? (
          <>
            <p className="recap__note">
              Ajoutez cette clé dans votre application d&apos;authentification,
              puis saisissez le code qu&apos;elle affiche. La clé n&apos;est
              montrée qu&apos;une fois.
            </p>
            <p className="recap" style={{ marginTop: "0.8rem", wordBreak: "break-all" }}>
              <code>{graineEnAttente}</code>
            </p>
            <form action={confirmerMfa} className="formulaire" style={{ marginTop: "1rem" }}>
              <div className="champ">
                <label htmlFor="code">Code à six chiffres</label>
                <input id="code" name="code" type="text" inputMode="numeric"
                  autoComplete="one-time-code" required />
              </div>
              <button type="submit" className="btn btn--bloc">Activer</button>
            </form>
          </>
        ) : (
          <>
            <p className="recap__note">
              Non activée. Une fois en place, un mot de passe volé ne suffira
              plus à entrer.
            </p>
            <form action={preparerMfa} style={{ marginTop: "0.9rem" }}>
              <button type="submit" className="btn">Activer</button>
            </form>
          </>
        )}
      </section>

      <section className="admin-bloc">
        <h2 className="display t-carte">Sessions ouvertes</h2>
        <ul className="admin-liste">
          {vue.sessions.map((s) => (
            <li key={s.id} style={{ flexWrap: "wrap" }}>
              <strong>{s.courante ? "Cet appareil" : "Autre appareil"}</strong>
              <span>{(s.user_agent ?? "—").slice(0, 60)}</span>
              <span>{s.ip_tronquee ?? "—"}</span>
              <span>{new Date(s.dernier_acces_le).toLocaleString("fr-FR")}</span>
              {!s.mfa_validee ? (
                <span className="admin-pastille">second facteur non franchi</span>
              ) : null}
            </li>
          ))}
        </ul>
        {vue.sessions.length > 1 ? (
          <form action={revoquerSessions} style={{ marginTop: "0.9rem" }}>
            <button type="submit" className="btn btn--fantome">
              Déconnecter les autres appareils
            </button>
          </form>
        ) : null}
      </section>

      <section className="admin-bloc">
        <h2 className="display t-carte">Activité récente</h2>
        <ul className="admin-liste">
          {vue.connexions.map((c, i) => (
            <li key={`${c.horodatage}-${i}`}>
              <strong>{c.action.replace(/\./g, " · ")}</strong>
              <span>{new Date(c.horodatage).toLocaleString("fr-FR")}</span>
              <span>{c.ip_tronquee ?? "—"}</span>
            </li>
          ))}
          {vue.connexions.length === 0 ? (
            <li><span>Aucune activité enregistrée.</span></li>
          ) : null}
        </ul>
        <p className="recap__note">
          Les adresses IP sont tronquées (/24 en IPv4) : de quoi reconnaître un
          réseau inhabituel, pas de quoi pister.
        </p>
      </section>

      <p className="recap__note">
        Vous avez perdu l&apos;accès ? Il n&apos;y a pas de réinitialisation par
        e-mail : elle ferait de votre boîte le maillon faible. La procédure de
        secours est décrite dans <code>JOKSWED-ETAT-PROJET.md</code> et exige un
        accès à la base.
      </p>
    </main>
  );
}

/* `redirect()` lance une exception de contrôle : on l'isole pour que les
   actions ci-dessus se lisent sans bruit. */
function redirigerVers(erreur, ok) {
  const p = new URLSearchParams();
  if (erreur) p.set("erreur", erreur);
  if (ok) p.set("ok", ok);
  redirect(`/admin/parametres/compte?${p}`);
}
