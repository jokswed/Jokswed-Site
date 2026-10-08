/* =============================================================================
   ROUTE DE CONTACT — réception d'une demande de mariage
   -----------------------------------------------------------------------------
   Ce qui a changé en V1, et pourquoi.

   1. LIMITATION DE DÉBIT. La version livrée n'avait qu'un honeypot. Un script
      qui laisse le champ piège vide passait sans aucune limite.

   2. VÉRIFICATION D'ORIGINE. Rien n'empêchait un formulaire tiers de poster
      ici depuis n'importe quel domaine.

   3. PLUS D'EXPÉDITEUR DE REPLI. Le code retombait sur
      « JoksWed <onboarding@resend.dev> » : si la variable manquait, les
      e-mails partaient d'un domaine qui n'est pas celui de JoksWed, avec un
      échec d'authentification probable. On échoue maintenant franchement.

   4. JOURNAUX NETTOYÉS. `console.error("Erreur Resend :", resultat)` écrivait
      la réponse de l'API dans les logs Vercel, et le `catch` global pouvait y
      verser le corps de la requête — donc des données personnelles. On ne
      journalise plus qu'un code et un identifiant de corrélation.

   5. CONSENTEMENT RGPD SÉPARÉ PAR FINALITÉ. Une case obligatoire pour le
      traitement de la demande, une case FACULTATIVE et distincte pour la
      transmission au vidéaste partenaire. Pas une case unique pour deux
      finalités différentes.

   6. DATE NORMALISÉE. Le champ était du texte libre (« 12 septembre 2027 ») :
      inexploitable comme donnée. Il arrive désormais en ISO `AAAA-MM-JJ`.

   7. IDEMPOTENCE. Un double-clic ou un retour réseau ne crée plus deux e-mails.

   ⚠️ CE QUI RESTE À FAIRE, ET QUI N'EST PAS DE LA V1.
      La demande n'est TOUJOURS PAS persistée : l'e-mail reste le seul support.
      Si Brevo/Resend échoue, la demande est perdue. C'est l'objet de la V4
      (table `demandes`, clé d'idempotence en base, l'e-mail devenant une
      simple notification). L'idempotence ci-dessous est en mémoire de
      processus, donc partielle — même réserve que pour la limitation de débit.
   ============================================================================= */

import { NextResponse } from "next/server";
import { limiterDebit, cleDepuisRequete } from "@/lib/limite-debit";

export const runtime = "nodejs";

/* 5 demandes par demi-heure et par /24 : large pour un couple qui hésite,
   étroit pour un script. */
const LIMITE = 5;
const FENETRE_MS = 30 * 60 * 1000;

/** Corps au-delà duquel on refuse sans même analyser. */
const TAILLE_MAX = 32 * 1024;

/** Clés d'idempotence déjà traitées, avec leur réponse. */
const dejaTraitees = new Map();
const IDEMPOTENCE_MS = 10 * 60 * 1000;

function nettoyer(valeur, longueurMax = 2000) {
  return String(valeur ?? "").trim().slice(0, longueurMax);
}

function echapperHtml(valeur) {
  return nettoyer(valeur)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailValide(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** `AAAA-MM-JJ`, et une date réelle : le 31 février est refusé. */
function dateIsoValide(valeur) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const d = new Date(`${valeur}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valeur;
}

/**
 * L'origine de la requête est-elle la nôtre ?
 *
 * On compare l'hôte de `Origin` (ou `Referer` à défaut) à celui du site. Les
 * aperçus Vercel portent un hôte `*.vercel.app` : on les accepte, sinon aucune
 * préproduction ne serait testable.
 */
function origineAutorisee(request) {
  const brut = request.headers.get("origin") || request.headers.get("referer");
  if (!brut) return false;

  let hote;
  try {
    hote = new URL(brut).host;
  } catch {
    return false;
  }

  const attendus = new Set();
  for (const v of [process.env.SITE_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    if (v) {
      try {
        attendus.add(new URL(v).host);
      } catch {
        /* variable mal formée : ignorée, pas de plantage */
      }
    }
  }
  if (process.env.VERCEL_URL) attendus.add(process.env.VERCEL_URL);
  if (process.env.NODE_ENV !== "production") {
    attendus.add("localhost:3000");
    attendus.add("127.0.0.1:3000");
  }

  return attendus.has(hote) || hote.endsWith(".vercel.app");
}

/** Identifiant court pour relier une erreur de log à une réponse, sans donnée. */
function correlation() {
  return Math.random().toString(36).slice(2, 10);
}

export async function POST(request) {
  const trace = correlation();

  try {
    if (!origineAutorisee(request)) {
      return NextResponse.json(
        { ok: false, message: "Requête refusée." },
        { status: 403 },
      );
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json(
        { ok: false, message: "Format de requête invalide." },
        { status: 415 },
      );
    }

    const brut = await request.text();
    if (brut.length > TAILLE_MAX) {
      return NextResponse.json(
        { ok: false, message: "Message trop volumineux." },
        { status: 413 },
      );
    }

    const cle = cleDepuisRequete(request);
    const quota = limiterDebit(cle, LIMITE, FENETRE_MS);
    if (!quota.autorise) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Vous avez déjà envoyé plusieurs demandes. Merci de patienter un instant — je réponds à chacune.",
        },
        { status: 429, headers: { "Retry-After": String(quota.reessayerDansS) } },
      );
    }

    let body;
    try {
      body = JSON.parse(brut);
    } catch {
      return NextResponse.json(
        { ok: false, message: "Format de requête invalide." },
        { status: 400 },
      );
    }

    /* Idempotence : la même clé renvoie la même réponse, sans second envoi. */
    const cleIdempotence = nettoyer(request.headers.get("idempotency-key") ?? "", 100);
    if (cleIdempotence) {
      const anterieure = dejaTraitees.get(cleIdempotence);
      if (anterieure && Date.now() - anterieure.quand < IDEMPOTENCE_MS) {
        return NextResponse.json({ ok: true, rejeu: true }, { status: 200 });
      }
    }

    /* Champ invisible anti-spam : un vrai visiteur le laisse vide.
       On répond `ok` pour ne pas renseigner le robot sur sa détection. */
    if (nettoyer(body.website, 200)) {
      return NextResponse.json({ ok: true });
    }

    const noms = nettoyer(body.noms, 120);
    const email = nettoyer(body.email, 254).toLowerCase();
    const telephone = nettoyer(body.telephone, 40);
    const dateBrute = nettoyer(body.date, 20);
    const lieu = nettoyer(body.lieu, 200);
    const message = nettoyer(body.message, 5000);
    const formule = nettoyer(body.formule, 60);

    /* ⚠️ DEUX CONSENTEMENTS DISTINCTS, POUR DEUX FINALITÉS DISTINCTES. */
    const consentementDemande = body.consentement === true;
    const consentementPartenaire = body.consentementPartenaire === true;

    const erreurs = [];
    if (!noms) erreurs.push("Merci d'indiquer vos prénoms.");
    if (!emailValide(email)) erreurs.push("L'adresse e-mail semble incorrecte.");
    if (!message) erreurs.push("Merci de me dire quelques mots sur votre mariage.");
    if (dateBrute && !dateIsoValide(dateBrute)) erreurs.push("La date est invalide.");
    if (!consentementDemande) {
      erreurs.push(
        "Merci d'accepter que vos informations soient utilisées pour traiter votre demande.",
      );
    }

    if (erreurs.length > 0) {
      return NextResponse.json({ ok: false, message: erreurs[0], erreurs }, { status: 422 });
    }

    const dateLisible = dateBrute
      ? new Date(`${dateBrute}T12:00:00Z`).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : "À définir";

    /* ⚠️ AUCUN REPLI SUR UN DOMAINE TIERS. Mal configuré = erreur franche. */
    const apiKey = process.env.RESEND_API_KEY;
    const destinataire = process.env.CONTACT_TO_EMAIL;
    const expediteur = process.env.CONTACT_FROM_EMAIL;

    if (!apiKey || !destinataire || !expediteur) {
      console.error(
        `[contact] configuration incomplète (trace=${trace}) : ` +
          `${!apiKey ? "RESEND_API_KEY " : ""}${!destinataire ? "CONTACT_TO_EMAIL " : ""}` +
          `${!expediteur ? "CONTACT_FROM_EMAIL" : ""}`.trim(),
      );
      return NextResponse.json(
        {
          ok: false,
          message:
            "Le service d'envoi n'est pas configuré. Écrivez-moi directement en attendant.",
          trace,
        },
        { status: 500 },
      );
    }

    const lignes = [
      "Nouvelle demande reçue depuis le site JoksWed",
      "",
      `Prénoms : ${noms}`,
      `E-mail : ${email}`,
      telephone ? `Téléphone : ${telephone}` : null,
      `Date du mariage : ${dateLisible}`,
      `Lieu : ${lieu || "À définir"}`,
      formule ? `Formule envisagée : ${formule}` : null,
      "",
      `Transmission au vidéaste partenaire : ${consentementPartenaire ? "acceptée" : "non acceptée"}`,
      "",
      "Message :",
      message,
    ].filter(Boolean);

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717;max-width:640px">
        <h2 style="margin-bottom:20px">Nouvelle demande mariage</h2>
        <p><strong>Prénoms :</strong> ${echapperHtml(noms)}</p>
        <p><strong>E-mail :</strong> <a href="mailto:${echapperHtml(email)}">${echapperHtml(email)}</a></p>
        ${telephone ? `<p><strong>Téléphone :</strong> ${echapperHtml(telephone)}</p>` : ""}
        <p><strong>Date du mariage :</strong> ${echapperHtml(dateLisible)}</p>
        <p><strong>Lieu :</strong> ${echapperHtml(lieu || "À définir")}</p>
        ${formule ? `<p><strong>Formule envisagée :</strong> ${echapperHtml(formule)}</p>` : ""}
        <p><strong>Transmission au vidéaste partenaire :</strong> ${
          consentementPartenaire ? "acceptée" : "non acceptée"
        }</p>
        <hr style="border:0;border-top:1px solid #ddd;margin:24px 0" />
        <p><strong>Message :</strong></p>
        <p style="white-space:pre-wrap">${echapperHtml(message)}</p>
      </div>
    `;

    const reponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: expediteur,
        to: [destinataire],
        reply_to: email,
        subject: `Nouvelle demande mariage — ${noms}`,
        text: lignes.join("\n"),
        html,
      }),
    });

    if (!reponse.ok) {
      /* ⚠️ On journalise le STATUT, jamais le corps de la réponse ni la
         charge utile : l'un comme l'autre contiennent des données
         personnelles, et les logs Vercel ne sont pas le bon endroit. */
      console.error(`[contact] envoi refusé par le fournisseur : HTTP ${reponse.status} (trace=${trace})`);
      return NextResponse.json(
        { ok: false, message: "L'envoi a échoué. Merci de réessayer.", trace },
        { status: 502 },
      );
    }

    if (cleIdempotence) {
      dejaTraitees.set(cleIdempotence, { quand: Date.now() });
      if (dejaTraitees.size > 2_000) {
        for (const [k, v] of dejaTraitees) {
          if (Date.now() - v.quand > IDEMPOTENCE_MS) dejaTraitees.delete(k);
        }
      }
    }

    /* On ne renvoie PAS l'identifiant du fournisseur au navigateur :
       il n'en a aucun usage, et c'est un détail d'infrastructure. */
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    console.error(
      `[contact] erreur inattendue (trace=${trace}) : ${
        erreur instanceof Error ? erreur.name : "inconnue"
      }`,
    );
    return NextResponse.json(
      { ok: false, message: "Une erreur inattendue est survenue.", trace },
      { status: 500 },
    );
  }
}
