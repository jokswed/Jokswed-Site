import "server-only";

/* =============================================================================
   ENVOYER UN MESSAGE PAR L'API GMAIL
   -----------------------------------------------------------------------------
   `users.messages.send` prend un message RFC 822 complet, encodé en base64url.
   Il n'y a pas de champ « destinataire » : tout est dans les en-têtes, et c'est
   à nous de les écrire correctement.
   ============================================================================= */

const ENVOI = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface MessageGmail {
  de: { email: string; nom?: string | null };
  pour: { email: string; nom?: string | null };
  repondreA?: string | null;
  sujet: string;
  texte: string;
  html: string;
  pieces?: { nom: string; contenu: Buffer; type?: string }[];
  /** Fil Gmail à poursuivre, et en-têtes de réponse RFC. */
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}

/**
 * ⚠️ UN EN-TÊTE NE PEUT PORTER QUE DE L'ASCII.
 *
 * « Gabriel & Jimmy — séance du 12 mai » dans un `Subject` brut arrive haché
 * chez le destinataire. L'encodage « mot encodé » de la RFC 2047 règle cela ;
 * on ne l'applique que si nécessaire, pour garder les en-têtes lisibles.
 */
function enTete(valeur: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(valeur)) return valeur;
  return `=?UTF-8?B?${Buffer.from(valeur, "utf8").toString("base64")}?=`;
}

function adresse(a: { email: string; nom?: string | null }): string {
  return a.nom ? `${enTete(a.nom)} <${a.email}>` : a.email;
}

/** Une frontière qui ne peut pas apparaître dans le corps. */
function frontiere(): string {
  return `=_jokswed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function composerMime(m: MessageGmail): string {
  const fAlt = frontiere();
  const fMixte = frontiere();
  const pieces = m.pieces ?? [];

  const enTetes = [
    `From: ${adresse(m.de)}`,
    `To: ${adresse(m.pour)}`,
    m.repondreA ? `Reply-To: ${m.repondreA}` : null,
    `Subject: ${enTete(m.sujet)}`,
    "MIME-Version: 1.0",
    /* ⚠️ CES DEUX EN-TÊTES FONT LE FIL CÔTÉ CLIENT.
       `threadId` suffit à Gmail, mais la cliente lit peut-être dans Outlook
       ou Apple Mail : eux ne connaissent que `In-Reply-To` et `References`.
       Sans eux, chaque réponse ouvrirait une conversation neuve chez elle. */
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : null,
    m.references ? `References: ${m.references}` : null,
  ].filter(Boolean);

  const alternatif = [
    `Content-Type: multipart/alternative; boundary="${fAlt}"`,
    "",
    `--${fAlt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.texte, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    `--${fAlt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    `--${fAlt}--`,
  ];

  if (pieces.length === 0) {
    return [...enTetes, ...alternatif].join("\r\n");
  }

  const corps = [
    `Content-Type: multipart/mixed; boundary="${fMixte}"`,
    "",
    `--${fMixte}`,
    ...alternatif,
  ];
  for (const p of pieces) {
    corps.push(
      `--${fMixte}`,
      `Content-Type: ${p.type ?? "application/octet-stream"}; name="${enTete(p.nom)}"`,
      `Content-Disposition: attachment; filename="${enTete(p.nom)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      p.contenu.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    );
  }
  corps.push(`--${fMixte}--`);
  return [...enTetes, ...corps].join("\r\n");
}

export interface ResultatGmail {
  statut: "envoye" | "echoue";
  /** `Message-ID` RFC, celui qui ancrera la prochaine réponse. */
  messageIdRfc?: string | null;
  threadId?: string | null;
  erreur?: string | null;
  /** Vrai quand Google a refusé l'autorisation : à signaler, pas à retenter. */
  autorisationPerdue?: boolean;
}

export async function envoyerParGmail(
  jetonAcces: string,
  m: MessageGmail
): Promise<ResultatGmail> {
  const brut = Buffer.from(composerMime(m), "utf8").toString("base64url");

  const r = await fetch(ENVOI, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jetonAcces}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(m.threadId ? { raw: brut, threadId: m.threadId } : { raw: brut }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    const motif = data?.error?.message ?? `HTTP ${r.status}`;
    return {
      statut: "echoue",
      /* 401 : jeton mort. 403 : portée retirée ou accès révoqué. Dans les deux
         cas, retenter à l'identique ne sert à rien — il faut se reconnecter,
         et le dire. */
      autorisationPerdue: r.status === 401 || r.status === 403,
      erreur: String(motif).slice(0, 300),
    };
  }

  const data = await r.json().catch(() => ({}));
  /* Gmail rend son identifiant interne et le fil. Le `Message-ID` RFC, lui,
     demande une relecture du message — qui exigerait une portée de LECTURE
     qu'on n'a pas. On conserve donc l'identifiant Gmail comme ancre interne,
     et le threading côté client repose sur `threadId` et sur les en-têtes
     qu'on a nous-mêmes écrits.
     shortcut: pas de Message-ID RFC renvoyé, à revoir si une portée de lecture
     est un jour accordée. */
  return {
    statut: "envoye",
    messageIdRfc: data.id ? `<gmail-${data.id}@jokswed>` : null,
    threadId: data.threadId ?? null,
  };
}
