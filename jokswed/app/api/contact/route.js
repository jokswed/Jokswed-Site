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

   ⚠️ CE QUI A CHANGÉ EN V4.

   8. LA DEMANDE EST PERSISTÉE AVANT TOUTE NOTIFICATION. Elle n'est plus
      portée par un e-mail : elle vit dans `demandes`, avec ses lignes, ses
      consentements et un instantané du catalogue. Un échec d'envoi retarde
      la notification ; il ne perd plus la demande.
   9. L'IDEMPOTENCE EST PASSÉE EN BASE. Elle vivait dans une `Map` du
      processus : sur une architecture sans état, deux soumissions arrivant
      sur deux instances créaient deux demandes. Une contrainte `UNIQUE` est
      partagée par tout le monde.
  10. AUCUN E-MAIL N'EST PLUS ENVOYÉ D'ICI. Les notifications passent par une
      file d'événements, écrite dans la même transaction que la demande.

   ⚠️ CE QUI RESTE EN MÉMOIRE DE PROCESSUS : la limitation de débit. Même
      réserve qu'en V1 — c'est un garde-fou, pas un mur. Elle rejoindra la
      base avec `tentatives_connexion`, qui en porte déjà le patron.
   ============================================================================= */

import { NextResponse } from "next/server";
import { cleDepuisRequete } from "@/lib/limite-debit";
import { verifierLimite } from "@/lib/public/limite";
import { formules, supplements, statutSupplement } from "@/content/offres";
import { deposerDemande } from "@/lib/demandes/depot";
import { drainer } from "@/lib/demandes/drain";
import { tronquerIp } from "@/lib/auth/secrets";

export const runtime = "nodejs";


/** Corps au-delà duquel on refuse sans même analyser. */
const TAILLE_MAX = 32 * 1024;

/* ⚠️ L'IDEMPOTENCE EN MÉMOIRE A ÉTÉ RETIRÉE (V4).

   Elle vivait dans une `Map` du processus : sur une architecture sans état,
   chaque instance avait la sienne, et deux soumissions arrivant sur deux
   fonctions différentes créaient deux demandes. Elle est désormais portée par
   une contrainte `UNIQUE` sur `demandes.cle_idempotence`, partagée par toutes
   les instances. `app.deposer_demande` rend la demande existante au lieu
   d'en créer une seconde. */

function nettoyer(valeur, longueurMax = 2000) {
  return String(valeur ?? "").trim().slice(0, longueurMax);
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

    let body;
    try {
      body = JSON.parse(brut);
    } catch {
      return NextResponse.json(
        { ok: false, message: "Format de requête invalide." },
        { status: 400 },
      );
    }

    /* La clé voyage jusqu'à la contrainte UNIQUE de PostgreSQL. */
    const cleIdempotence = nettoyer(request.headers.get("idempotency-key") ?? "", 100);

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
    /* ═══════════════════════════════════════════════════════════════════
       LA SÉLECTION EST REVALIDÉE CONTRE LE CATALOGUE, CÔTÉ SERVEUR.
       ═══════════════════════════════════════════════════════════════════
       Le navigateur n'envoie que des clés, mais rien ne l'empêche d'en
       inventer. On ne retient donc que celles qui existent, et on applique
       ICI la règle de compatibilité : un supplément déjà compris dans la
       formule est signalé comme tel, jamais ajouté comme une ligne vendue.
       C'est la même règle que l'affichage, mais c'est celle-ci qui fait foi. */
    const formuleCle = nettoyer(body.formule, 60);
    const formuleRetenue = formules.find((f) => f.cle === formuleCle) ?? null;
    const formule = formuleRetenue ? `${formuleRetenue.nom} — ${formuleRetenue.surnom}` : "";

    const clesRecues = Array.isArray(body.supplements)
      ? body.supplements.slice(0, 20).map((c) => nettoyer(c, 60))
      : [];

    const supplementsRetenus = [];
    const supplementsDejaInclus = [];
    for (const cle of clesRecues) {
      const s = supplements.find((x) => x.cle === cle);
      if (!s) continue; // clé inconnue : ignorée en silence
      const statut = statutSupplement(s, formuleRetenue ? formuleRetenue.cle : null);
      if (statut === "incompatible") continue;
      if (statut === "inclus") supplementsDejaInclus.push(s.nom);
      else supplementsRetenus.push(s.nom);
    }

    const videoDemandee = clesRecues.includes("videaste");

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

    /* ═══════════════════════════════════════════════════════════════════
       LIMITATION DE DÉBIT — EN BASE, ET APRÈS VALIDATION
       ═══════════════════════════════════════════════════════════════════
       Après, parce qu'elle s'appuie sur l'adresse e-mail : une limite par IP
       seule interdirait le formulaire à tout un opérateur mobile, où des
       milliers d'abonnés partagent la même adresse publique. Les contrôles
       qui précèdent (origine, taille, type) n'ont pas besoin de la base et
       écartent déjà l'essentiel du bruit. */
    const cle = cleDepuisRequete(request);
    let quota;
    try {
      quota = await verifierLimite(cle, email);
    } catch {
      /* ⚠️ BASE INJOIGNABLE : ON LAISSE PASSER LA LIMITE, PAS LA DEMANDE.
         Le dépôt juste après échouera de toute façon et renverra un 503
         honnête. Refuser ici afficherait « trop de demandes » à un client
         qui n'a rien fait de mal. */
      quota = { autorise: true, reessayerDans: 0 };
    }
    if (!quota.autorise) {
      return NextResponse.json(
        {
          ok: false,
          message:
            quota.motif === "email"
              ? "Vous avez déjà envoyé plusieurs demandes avec cette adresse. " +
                "Je réponds à chacune — inutile de renvoyer."
              : "Trop de demandes reçues à l'instant. Merci de réessayer dans quelques minutes.",
        },
        { status: 429, headers: { "Retry-After": String(quota.reessayerDans) } },
      );
    }

    /* ═══════════════════════════════════════════════════════════════════
       ON ENREGISTRE D'ABORD. LA NOTIFICATION VIENT ENSUITE.
       ═══════════════════════════════════════════════════════════════════
       Jusqu'à la V3, l'e-mail était le seul support : un échec d'envoi
       perdait la demande, et rien ne le signalait. Désormais la demande, ses
       lignes, ses consentements, la proposition vidéo éventuelle et
       l'événement de notification sont écrits dans UNE transaction. */
    let depot;
    try {
      depot = await deposerDemande({
        cleIdempotence: cleIdempotence || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        contactNom: noms,
        contactEmail: email,
        contactTelephone: telephone || null,
        dateMariage: dateBrute || null,
        lieu: lieu || null,
        message,
        formuleCle: formuleRetenue?.cle ?? null,
        supplementsCles: clesRecues,
        consentementDemande,
        consentementPartenaire,
        ipTronquee: tronquerIp(
          request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
        ),
      });
    } catch (erreur) {
      /* ⚠️ ÉCHEC D'ÉCRITURE : ON NE PRÉTEND PAS AVOIR REÇU LA DEMANDE.
         Répondre `ok` ici reviendrait à dire au couple que leur message est
         arrivé alors qu'il n'existe nulle part. On journalise un code de
         corrélation, jamais la charge utile. */
      console.error(
        `[contact] enregistrement impossible (trace=${trace}) : ${
          erreur instanceof Error ? erreur.name : "inconnue"
        }`,
      );
      return NextResponse.json(
        {
          ok: false,
          message:
            "Votre demande n'a pas pu être enregistrée. Merci de réessayer, " +
            "ou de m'écrire directement.",
          trace,
        },
        { status: 503 },
      );
    }

    /* Rejeu d'une clé déjà vue : même réponse, aucune seconde demande. */
    if (depot.rejeu) {
      return NextResponse.json({ ok: true, reference: depot.reference, rejeu: true });
    }

    /* Le drain pose les notifications internes. Son échec ne doit PAS faire
       échouer la demande : elle est déjà enregistrée, et l'événement reste en
       file avec son report. */
    try {
      await drainer();
    } catch (erreur) {
      console.error(
        `[contact] drain différé (trace=${trace}) : ${
          erreur instanceof Error ? erreur.name : "inconnue"
        }`,
      );
    }

    /* On renvoie la RÉFÉRENCE : le couple peut la citer s'il m'écrit, et
       elle prouve que la demande existe bien en base. */
    return NextResponse.json({ ok: true, reference: depot.reference });
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
