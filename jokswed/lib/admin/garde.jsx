import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccesRefuse, exigerAcces, exigerSession, mesEntreprises } from "@/lib/auth/acces";

/* =============================================================================
   GARDE DES PAGES D'ADMINISTRATION
   -----------------------------------------------------------------------------
   Toute page sous /admin passe par ici. Le middleware n'a vu qu'un cookie ;
   c'est cette fonction qui interroge la base et tranche réellement.
   ============================================================================= */
export async function contexteAdmin() {
  let session;
  try {
    session = await exigerSession();
  } catch (e) {
    if (e instanceof AccesRefuse) {
      redirect(e.motif.includes("facteur") ? "/admin/second-facteur" : "/admin/connexion");
    }
    throw e;
  }
  const entreprises = await mesEntreprises(session);
  if (entreprises.length === 0) {
    /* Compte valide mais rattaché à aucune entreprise active : c'est le cas
       d'un accès révoqué. On ne montre pas une administration vide. */
    redirect("/admin/connexion?erreur=desactive");
  }

  /* ⚠️ L'ENTREPRISE ACTIVE EST UNE PRÉFÉRENCE, PAS UNE AUTORISATION.
     Le cookie ne fait que CHOISIR parmi les entreprises dont `mesEntreprises`
     a déjà établi, en base, que l'acteur est membre actif. Un identifiant
     forgé n'y figure pas : on retombe alors sur la première. Le cookie ne
     donne donc aucun accès — il n'en ouvre aucun que la base n'ait accordé. */
  const choix = (await cookies()).get("jokswed_entreprise")?.value;
  const entreprise = entreprises.find((e) => e.id === choix) ?? entreprises[0];
  return { session, entreprises, entreprise };
}

/**
 * `exigerAcces` pour une PAGE : une permission manquante renvoie au tableau
 * de bord avec un motif, au lieu de laisser une exception produire un 500.
 *
 * ⚠️ CE N'EST PAS UN ADOUCISSEMENT DE LA RÈGLE.
 * L'accès reste refusé, et aucune donnée n'est rendue. Seule la présentation
 * change : une redirection lisible plutôt qu'une page d'erreur.
 */
export async function accesPage(entrepriseId, permissions = []) {
  try {
    return await exigerAcces(entrepriseId, permissions);
  } catch (e) {
    if (e instanceof AccesRefuse) {
      if (e.motif.includes("session")) redirect("/admin/connexion");
      if (e.motif.includes("facteur")) redirect("/admin/second-facteur");
      redirect("/admin?refus=" + encodeURIComponent(e.motif));
    }
    throw e;
  }
}
