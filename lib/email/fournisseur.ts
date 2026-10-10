import "server-only";

/* =============================================================================
   FOURNISSEUR D'E-MAIL — BREVO, ET UN SIMULATEUR POUR LES BANCS
   -----------------------------------------------------------------------------
   ⚠️ CE QUI EST VÉRIFIÉ, ET CE QUI RESTE À FAIRE À LA MAIN.

   Réutiliser le compte Brevo d'EyesofJoks pour JoksWed est possible : Brevo
   accepte plusieurs expéditeurs vérifiés et plusieurs domaines authentifiés
   sur un même compte. Rien de ce qui suit ne touche la configuration
   existante d'EyesofJoks — ce module ne lit qu'une clé d'API et un expéditeur.

   ⚠️ TROIS ACTIONS MANUELLES, QUE JE NE PEUX PAS FAIRE À TA PLACE :

     1. ajouter `jokswed.com` comme domaine dans Brevo et publier
        l'enregistrement DKIM qu'il fournit (`brevo._domainkey`) ainsi que son
        code de vérification ;
     2. déclarer l'expéditeur `contact@jokswed.com` et le valider ;
     3. publier un DMARC en observation (`v=DMARC1; p=none; rua=…`) avant de
        durcir.

   ⚠️ SUR SPF, UNE PRÉCISION QUI ÉVITE UNE FAUSSE PISTE.

   Brevo n'exige PAS d'inclure son SPF à la racine du domaine : l'alignement
   se fait par DKIM, et l'enveloppe part d'un sous-domaine qui porte déjà le
   SPF de Brevo. Réclamer un `include:spf.sendinblue.com` sur `jokswed.com`
   consommerait une recherche DNS pour rien. (Constaté sur l'autre projet.)

   ⚠️ ET SUR LA GARANTIE D'ENVOI.

   Brevo accuse la PRISE EN CHARGE d'un message, pas sa remise. Aucune
   architecture ici ne peut promettre « exactement une fois » : si l'appel
   expire après que Brevo l'a accepté, la reprise renverra le message. On vise
   donc « au moins une fois, sans doublon évitable » — la clé d'idempotence
   couvre les reprises que NOUS déclenchons, pas celles qui surviennent après
   une acceptation invisible pour nous.
   ============================================================================= */

export interface MessageSortant {
  destinataire: string;
  destinataireNom?: string | null;
  sujet: string;
  html: string;
  texte: string;
  repondreA?: string | null;
  /** Expéditeur explicite, pour une identité autre que celle par défaut. */
  expediteurEmail?: string | null;
  expediteurNom?: string | null;
  /** Pièces jointes : nom + contenu. Brevo les attend en base64. */
  pieces?: { nom: string; contenu: Buffer }[];
  /** Étiquettes Brevo, utiles pour filtrer les statistiques par projet. */
  etiquettes?: string[];
}

export interface ResultatEnvoi {
  statut: "envoye" | "echoue" | "inhibe";
  fournisseur: string;
  messageId?: string | null;
  erreur?: string | null;
}

/**
 * Expéditeur de JoksWed, distinct de celui d'EyesofJoks.
 *
 * ⚠️ UNE SEULE ADRESSE D'EXPÉDITION, ET ELLE EST VÉRIFIÉE CHEZ BREVO.
 * `contact@jokswed.com`. Brevo refuse tout expéditeur qu'il ne connaît pas,
 * et un message refusé est un message perdu.
 */
export function expediteur(): { email: string; nom: string } {
  return {
    email: process.env.JOKSWED_EMAIL_EXPEDITEUR ?? "contact@jokswed.com",
    nom: process.env.JOKSWED_EMAIL_NOM ?? "JoksWed",
  };
}

/**
 * Où les réponses doivent arriver.
 *
 * ⚠️ `contact@jokswed.com` EST UN EXPÉDITEUR, PAS UNE BOÎTE AUX LETTRES.
 *
 * Laisser un client répondre à cette adresse enverrait sa réponse nulle
 * part : personne ne la lirait, et rien ne le signalerait. Les e-mails
 * transactionnels pointent donc vers une boîte qui existe réellement.
 *
 * Les CONVERSATIONS de la messagerie, elles, ne passent pas par ici : leur
 * `Reply-To` porte le jeton de la conversation, pour que la réponse revienne
 * dans le fil. Les mélanger ferait sortir la conversation de la plateforme.
 */
export function adresseDeReponse(): string {
  return process.env.JOKSWED_EMAIL_REPONSE ?? "jokswed@gmail.com";
}

/**
 * L'envoi est-il inhibé ?
 *
 * ⚠️ LE DÉFAUT EST L'INHIBITION. Il faut être en production Vercel ET avoir
 * une clé pour qu'un message parte. Hors de là, rien ne sort — même avec une
 * clé valide laissée par mégarde dans un `.env.local`.
 */
export function envoiInhibe(): { inhibe: boolean; motif: string } {
  if (process.env.EMAIL_DRY_RUN === "1") return { inhibe: true, motif: "EMAIL_DRY_RUN" };
  if (!process.env.BREVO_API_KEY) return { inhibe: true, motif: "clé Brevo absente" };
  if (process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV !== "production") {
    return { inhibe: true, motif: "hors production" };
  }
  return { inhibe: false, motif: "" };
}

/* Boîte du simulateur : les bancs y lisent ce qui SERAIT parti. */
const boiteSimulee: (MessageSortant & { horodatage: string })[] = [];

export function boiteDeTest(): readonly (MessageSortant & { horodatage: string })[] {
  return boiteSimulee;
}
export function viderBoiteDeTest(): void {
  boiteSimulee.length = 0;
}

/**
 * Envoie un message.
 *
 * Trois chemins : simulateur (bancs), inhibé (développement), Brevo (production).
 * Aucune exception n'en sort : un échec est une VALEUR, pour que l'appelant
 * puisse le journaliser et replanifier plutôt que perdre l'événement.
 */
export async function envoyer(message: MessageSortant): Promise<ResultatEnvoi> {
  /* Simulateur explicite : utilisé par les bancs, jamais par la production. */
  if (process.env.EMAIL_FOURNISSEUR === "simule") {
    boiteSimulee.push({ ...message, horodatage: new Date().toISOString() });
    /* Permet d'éprouver le comportement en cas de panne du fournisseur. */
    if (process.env.EMAIL_SIMULE_ECHEC === "1") {
      return { statut: "echoue", fournisseur: "simule", erreur: "panne simulée" };
    }
    return {
      statut: "envoye",
      fournisseur: "simule",
      messageId: `<simule-${boiteSimulee.length}@jokswed.test>`,
    };
  }

  const { inhibe, motif } = envoiInhibe();
  if (inhibe) return { statut: "inhibe", fournisseur: "aucun", erreur: motif };

  /* ⚠️ L'IDENTITÉ D'EXPÉDITION DOIT ÊTRE VÉRIFIÉE CHEZ BREVO.
     On ne la choisit pas ici : l'appelant l'a déjà validée contre
     `identites_messagerie`, et Brevo refusera de toute façon un expéditeur
     qu'il ne connaît pas. */
  const defaut = expediteur();
  const de = {
    email: message.expediteurEmail ?? defaut.email,
    nom: message.expediteurNom ?? defaut.nom,
  };
  try {
    const reponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY!,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: de.email, name: de.nom },
        to: [{ email: message.destinataire, name: message.destinataireNom ?? undefined }],
        replyTo: message.repondreA ? { email: message.repondreA } : undefined,
        subject: message.sujet,
        htmlContent: message.html,
        textContent: message.texte,
        attachment: message.pieces?.length
          ? message.pieces.map((p) => ({
              name: p.nom, content: p.contenu.toString("base64"),
            }))
          : undefined,
        tags: message.etiquettes ?? ["jokswed"],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!reponse.ok) {
      /* ⚠️ On ne journalise QUE le statut : le corps d'erreur Brevo contient
         l'adresse du destinataire. */
      return {
        statut: "echoue",
        fournisseur: "brevo",
        erreur: `HTTP ${reponse.status}`,
      };
    }

    const corps = (await reponse.json().catch(() => ({}))) as { messageId?: string };
    /* Brevo rend le Message-ID RFC réel : c'est l'ancre du futur threading
       des réponses clients. On le conserve dès maintenant. */
    return { statut: "envoye", fournisseur: "brevo", messageId: corps.messageId ?? null };
  } catch (erreur) {
    return {
      statut: "echoue",
      fournisseur: "brevo",
      erreur: erreur instanceof Error ? erreur.name : "erreur réseau",
    };
  }
}
