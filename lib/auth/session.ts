import "server-only";
import { cookies, headers } from "next/headers";
import { avecAuth, sansIdentite } from "@/lib/db/client";
import { engendrerJeton, hacherJeton, verifierMotDePasse, tronquerIp } from "./secrets";

/* =============================================================================
   SESSIONS
   -----------------------------------------------------------------------------
   Le cookie porte un jeton opaque de 256 bits ; la base n'en garde que
   l'empreinte. `__Host-` en production impose HTTPS, le chemin racine et
   l'absence de domaine : un sous-domaine compromis ne peut pas le poser.
   ============================================================================= */

export const DUREE_JOURS = 7;
export const NOM_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-jokswed_session" : "jokswed_session";

const LIMITE_TENTATIVES = 8;
const FENETRE_MINUTES = 15;

export interface SessionActive {
  sessionId: string;
  utilisateurId: string;
  mfaValidee: boolean;
  /** L'empreinte du jeton : c'est elle qui prouve l'identité à la base. */
  jetonHache: string;
}

/** Résout la session depuis le cookie. `null` si absente, expirée ou révoquée. */
export async function sessionCourante(): Promise<SessionActive | null> {
  const jeton = (await cookies()).get(NOM_COOKIE)?.value;
  if (!jeton) return null;

  const { rows } = await avecAuth((q) =>
    q("SELECT * FROM app.auth_session($1)", [hacherJeton(jeton)]),
  );
  if (rows.length === 0) return null;
  return {
    sessionId: rows[0].session_id,
    utilisateurId: rows[0].utilisateur_id,
    mfaValidee: rows[0].mfa_validee,
    jetonHache: hacherJeton(jeton),
  };
}

export type ResultatConnexion =
  | { ok: true; mfaRequise: boolean; jeton: string; maxAge: number }
  | { ok: false; motif: "identifiants" | "trop_de_tentatives" | "compte_desactive"; attendre?: number };

/**
 * Vérifie un couple e-mail / mot de passe et ouvre une session.
 *
 * ⚠️ LE MESSAGE D'ÉCHEC EST LE MÊME POUR UN E-MAIL INCONNU ET UN MOT DE PASSE
 * FAUX. Les distinguer transformerait le formulaire en oracle d'existence de
 * comptes. Et dans les deux cas on paie le coût d'un scrypt, pour que la
 * durée de réponse ne trahisse pas non plus la différence.
 */
export async function connecter(email: string, motDePasse: string): Promise<ResultatConnexion> {
  const entetes = await headers();
  const ip = tronquerIp(entetes.get("x-forwarded-for") ?? entetes.get("x-real-ip"));
  const cle = `connexion:${ip}`;

  const { rows: compte } = await avecAuth((q) =>
    q("SELECT app.auth_tentatives_recentes($1,$2) AS n", [cle, FENETRE_MINUTES]),
  );
  if (Number(compte[0].n) >= LIMITE_TENTATIVES) {
    return { ok: false, motif: "trop_de_tentatives", attendre: FENETRE_MINUTES * 60 };
  }

  const { rows } = await avecAuth((q) =>
    q("SELECT * FROM app.auth_identifiant($1)", [email.trim().toLowerCase()]),
  );

  /* Compte inconnu : on vérifie quand même une empreinte factice, pour que la
     réponse coûte le même temps qu'un compte réel. */
  const empreinte =
    rows[0]?.secret_hache ??
    "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(88);
  const correct = await verifierMotDePasse(motDePasse, empreinte);

  if (rows.length === 0 || !correct) {
    await avecAuth((q) => q("SELECT app.auth_journaliser_tentative($1,false)", [cle]));
    return { ok: false, motif: "identifiants" };
  }
  if (rows[0].desactive) {
    await avecAuth((q) => q("SELECT app.auth_journaliser_tentative($1,false)", [cle]));
    return { ok: false, motif: "compte_desactive" };
  }

  const jeton = engendrerJeton();
  const mfaRequise = Boolean(rows[0].mfa_requise);

  await avecAuth((q) =>
    q("SELECT app.auth_creer_session($1,$2,$3,$4,$5,$6,$7)", [
      rows[0].utilisateur_id, hacherJeton(jeton), DUREE_JOURS,
      null, entetes.get("user-agent")?.slice(0, 300) ?? null, ip,
      /* Tant que le second facteur n'est pas validé, la session existe mais
         n'ouvre rien : le middleware la renvoie vers l'étape TOTP. */
      !mfaRequise,
    ]),
  );
  await avecAuth((q) => q("SELECT app.auth_journaliser_tentative($1,true)", [cle]));

  /* ⚠️ LE COOKIE N'EST PAS POSÉ ICI.

     Une première version appelait `cookies().set()` puis la route renvoyait
     une `NextResponse.redirect()`. Résultat observé au banc : aucune session
     n'était jamais ouverte — l'en-tête ne survivait pas à la réponse de
     redirection construite séparément. On rend donc le jeton à l'appelant,
     qui le pose sur LA réponse qu'il retourne. Plus d'ambiguïté sur qui
     écrit quoi. */

  /* L'audit de connexion s'écrit SANS identité : la politique d'insertion du
     journal est ouverte, précisément pour qu'une action refusée reste
     traçable. */
  await sansIdentite((q) =>
    /* ⚠️ DEUX PARAMÈTRES DISTINCTS, PAS `$1` RÉUTILISÉ.
       `acteur_id` est un uuid et `ressource_id` un text : avec le même
       placeholder aux deux places, PostgreSQL ne peut pas déduire un type
       unique et lève « inconsistent types deduced for parameter $1 »
       (42P08). La connexion échouait alors en 500, sans cookie. */
    q(`INSERT INTO journal_audit (acteur_id, action, ressource_type, ressource_id, ip_tronquee)
       VALUES ($1,'session.ouverte','utilisateur',$2,$3)`,
      [rows[0].utilisateur_id, String(rows[0].utilisateur_id), ip]),
  );

  return { ok: true, mfaRequise, jeton, maxAge: DUREE_JOURS * 86400 };
}

/** Révoque la session en base. La suppression du cookie revient à l'appelant. */
export async function deconnecter(): Promise<void> {
  const jeton = (await cookies()).get(NOM_COOKIE)?.value;
  if (jeton) {
    await avecAuth((q) => q("SELECT app.auth_revoquer_session($1)", [hacherJeton(jeton)]));
  }
}

/** Options du cookie de session, au même endroit pour la pose et la purge. */
export function optionsCookie(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
