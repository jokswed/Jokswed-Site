/* =============================================================================
   LE FLUX iCALENDAR DU CARNET
   -----------------------------------------------------------------------------
   ⚠️ UN FLUX S'ABONNE UNE FOIS, ET SE RELIT ENSUITE POUR TOUJOURS.

   Apple Calendar ne « reçoit » pas des mariages : il relit périodiquement
   l'intégralité du fichier et réconcilie. Trois conséquences, et chacune
   dicte une règle ci-dessous :

     · L'IDENTITÉ DOIT ÊTRE STABLE. `UID` vaut l'identifiant de la demande,
       jamais un dérivé de la date : si l'UID changeait quand on déplace un
       mariage, le client garderait l'ancien événement ET ajouterait le
       nouveau. Deux mariages là où il n'y en a qu'un.

     · LA MODIFICATION DOIT S'ANNONCER. `SEQUENCE` et `LAST-MODIFIED`
       augmentent à chaque écriture ; un client qui a déjà vu l'événement sait
       alors qu'il doit remplacer sa copie plutôt que la conserver.

     · L'ANNULATION DOIT ÊTRE DITE. Un événement retiré du fichier disparaît
       chez la plupart des clients, mais pas chez tous, et jamais tout de
       suite. `STATUS:CANCELLED` est explicite.

   ⚠️ AUCUN MONTANT N'ENTRE ICI.
   Ni prix, ni acompte, ni reste dû. Un calendrier se synchronise sur un
   téléphone, s'affiche sur un écran verrouillé et se partage d'un geste.
   ============================================================================= */

/* ⚠️ `\\` EN PREMIER, SINON ON ÉCHAPPE SES PROPRES ÉCHAPPEMENTS.
   RFC 5545 §3.3.11 : la barre oblique inverse, le point-virgule, la virgule
   et le saut de ligne. Un nom de domaine « Château d'Arc, Pavillon » coupait
   la propriété en deux sans cela. */
export function echapper(valeur) {
  return String(valeur ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/* ⚠️ 75 OCTETS PAR LIGNE, PAS 75 CARACTÈRES.
   RFC 5545 §3.1 compte en octets. « Château » pèse 8 octets pour 7
   caractères : plier sur la longueur de la chaîne produisait des lignes
   trop longues, que certains clients tronquent. On plie donc sur l'encodage
   UTF-8, et on ne coupe jamais au milieu d'un caractère. */
export function plier(ligne) {
  const octets = Buffer.from(ligne, "utf8");
  if (octets.length <= 75) return ligne;
  const morceaux = [];
  let debut = 0;
  let limite = 75;
  while (debut < octets.length) {
    let fin = Math.min(debut + limite, octets.length);
    /* Reculer tant qu'on est sur un octet de continuation UTF-8 (10xxxxxx). */
    while (fin < octets.length && (octets[fin] & 0xc0) === 0x80) fin -= 1;
    morceaux.push(octets.subarray(debut, fin).toString("utf8"));
    debut = fin;
    limite = 74; // les lignes suivantes commencent par une espace
  }
  return morceaux.join("\r\n ");
}

function horodatage(instant) {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/* `SEQUENCE` doit croître à chaque modification et rester un entier positif.
   ⚠️ EN SECONDES, PAS EN MINUTES.
   Avec une granularité à la minute, deux corrections successives — déplacer
   la date, puis rectifier l'heure — produisaient la MÊME version : un client
   qui avait déjà vu l'évènement gardait sa copie périmée. Les secondes
   écoulées depuis 2026 tiennent dans un entier signé jusqu'en 2094, et
   `LAST-MODIFIED` porte la même précision. */
function sequence(majLe) {
  const ms = Date.parse(majLe ?? "") || 0;
  return Math.max(0, Math.floor((ms - Date.UTC(2026, 0, 1)) / 1000));
}

/* Europe/Paris, déclaré dans le fichier plutôt que converti en UTC.
   Les règles européennes (dernier dimanche de mars et d'octobre) sont stables
   depuis 1996 : un mariage de 2027 comme un mariage de 2031 tombe juste, sans
   que le serveur ait à calculer un décalage saisonnier. */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/**
 * @param {Array} evenements lignes de `app.calendrier_entreprise`
 * @param {{nom: string, site?: string, maintenant?: number}} contexte
 */
export function construireIcs(evenements, contexte) {
  const maintenant = horodatage(contexte.maintenant ?? Date.now());
  const site = contexte.site ?? "https://jokswed.com";
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JoksWed//Carnet de mariages//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${echapper(contexte.nom)}`,
    "X-WR-TIMEZONE:Europe/Paris",
    /* 60 minutes : un client qui relit plus souvent n'apprend rien de plus,
       et un mariage ne se déplace pas à la minute. */
    "REFRESH-INTERVAL;VALUE=DURATION:PT60M",
    "X-PUBLISHED-TTL:PT60M",
    ...VTIMEZONE,
  ];

  for (const e of evenements) {
    const jour = String(e.date_mariage).replace(/-/g, "");
    const debut = e.heure_debut ? String(e.heure_debut).slice(0, 5).replace(":", "") : null;
    const fin = e.heure_fin ? String(e.heure_fin).slice(0, 5).replace(":", "") : null;

    lignes.push("BEGIN:VEVENT");
    /* ⚠️ L'UID NE DÉPEND PAS DE LA DATE. Déplacer un mariage met à jour SON
       événement ; il n'en crée pas un second. */
    lignes.push(`UID:demande-${e.demande_id}@jokswed.com`);
    lignes.push(`DTSTAMP:${maintenant}`);
    lignes.push(`SEQUENCE:${sequence(e.maj_le)}`);
    lignes.push(`LAST-MODIFIED:${horodatage(e.maj_le ?? Date.now())}`);

    if (debut && fin) {
      lignes.push(`DTSTART;TZID=Europe/Paris:${jour}T${debut}00`);
      lignes.push(`DTEND;TZID=Europe/Paris:${jour}T${fin}00`);
    } else if (debut) {
      lignes.push(`DTSTART;TZID=Europe/Paris:${jour}T${debut}00`);
      /* Sans heure de fin, on ne devine pas une durée : l'événement dure la
         journée, ce qui est la vérité tant qu'on n'en sait pas plus. */
      lignes.push(`DURATION:PT12H`);
    } else {
      /* Journée entière. `DTEND` est EXCLUSIF en VALUE=DATE : le lendemain. */
      const lendemain = new Date(`${e.date_mariage}T00:00:00Z`);
      lendemain.setUTCDate(lendemain.getUTCDate() + 1);
      lignes.push(`DTSTART;VALUE=DATE:${jour}`);
      lignes.push(
        `DTEND;VALUE=DATE:${lendemain.toISOString().slice(0, 10).replace(/-/g, "")}`);
    }

    lignes.push(`SUMMARY:${echapper(
      `${e.annule ? "ANNULÉ — " : ""}Mariage ${e.couple}`)}`);
    if (e.lieu || e.ville) {
      lignes.push(`LOCATION:${echapper([e.lieu, e.ville].filter(Boolean).join(", "))}`);
    }
    const description = [
      `Référence : ${e.reference}`,
      e.planning ? `\nPlanning :\n${e.planning}` : null,
      `\n${site}/admin/demandes/${e.demande_id}`,
    ].filter(Boolean).join("\n");
    lignes.push(`DESCRIPTION:${echapper(description)}`);
    lignes.push(`URL:${site}/admin/demandes/${e.demande_id}`);
    lignes.push(`STATUS:${e.annule ? "CANCELLED" : "CONFIRMED"}`);
    lignes.push("TRANSP:OPAQUE");
    lignes.push("END:VEVENT");
  }

  lignes.push("END:VCALENDAR");
  /* CRLF obligatoire (RFC 5545 §3.1), et une ligne finale vide. */
  return `${lignes.map(plier).join("\r\n")}\r\n`;
}
