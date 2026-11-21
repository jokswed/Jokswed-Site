/**
 * Présentation et déduplication applicative des alertes d'une demande.
 *
 * IMPORTANT : app.evenements_a_traiter augmente "tentatives" avant le
 * traitement de l'événement, hors du SAVEPOINT utilisé en cas d'échec
 * d'e-mail. Une demande dont l'accusé Brevo échoue peut donc être retraitée
 * de nombreuses fois : le Push ne doit partir qu'à la première tentative.
 */
export function premiereTentativePush(tentatives) {
  return Number(tentatives) === 1;
}

/** Le formulaire public collecte les noms du couple dans contact_nom :
 * ne pas substituer la référence commerciale DEM-... à ces noms. */
export function nomsCouplePush(contactNom) {
  const noms = String(contactNom ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return noms || "Un couple";
}

export function notificationNouvelleDemande(demandeId, contactNom) {
  return {
    title: "Nouvelle demande",
    body: `${nomsCouplePush(contactNom)}\nJoksWed`,
    icon: "/apple-icon.png",
    badge: "/apple-icon.png",
    url: `/admin/demandes/${demandeId}`,
    // Même identifiant sur toutes les réceptions/reprises d'une demande.
    tag: `demande-${demandeId}`,
    renotify: false,
  };
}
