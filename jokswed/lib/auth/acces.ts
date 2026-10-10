import "server-only";
import { avecActeur, type Requete } from "@/lib/db/client";
import { sessionCourante, type SessionActive } from "./session";

/* =============================================================================
   AUTORISATION APPLICATIVE
   -----------------------------------------------------------------------------
   ⚠️ CE QUE RLS NE FAIT PAS, ET QUE CE MODULE DOIT FAIRE.

   Une politique répond à « quelles LIGNES cet acteur peut-il voir ». Elle ne
   sait pas répondre à :

     · « a-t-il le droit d'ÉMETTRE un document ? » — c'est un verbe ;
     · « peut-il modifier SES PROPRES permissions ? » — cela dépend de
       l'identité de la CIBLE, pas de l'appartenance de la ligne ;
     · « doit-il voir cette COLONNE ? » — RLS filtre des lignes, pas des champs.

   Le banc de sécurité le démontre explicitement : un membre PEUT, au seul
   niveau SQL, insérer une permission sur son propre membre. C'est ici que
   c'est refusé.
   ============================================================================= */

export class AccesRefuse extends Error {
  constructor(public readonly motif: string) {
    super(`Accès refusé : ${motif}`);
    this.name = "AccesRefuse";
  }
}

export interface Contexte {
  session: SessionActive;
  entrepriseId: string;
  permissions: Set<string>;
  /** Exécute une requête dans la transaction portant l'identité de l'acteur. */
  q: Requete;
}

/** Session valide et second facteur franchi, ou rien. */
export async function exigerSession(): Promise<SessionActive> {
  const session = await sessionCourante();
  if (!session) throw new AccesRefuse("aucune session");
  if (!session.mfaValidee) throw new AccesRefuse("second facteur non validé");
  return session;
}

/** Les entreprises dont l'acteur est membre actif, avec son rôle lisible. */
export async function mesEntreprises(session: SessionActive) {
  return avecActeur({ utilisateurId: session.utilisateurId, jetonHache: session.jetonHache }, async (q) => {
    const { rows } = await q(
      `SELECT e.id, e.slug, e.nom_commercial,
              coalesce(string_agg(r.libelle, ', ' ORDER BY r.libelle), '—') AS roles
         FROM membres m
         JOIN entreprises e ON e.id = m.entreprise_id
         LEFT JOIN membres_roles mr ON mr.membre_id = m.id
         LEFT JOIN roles r ON r.id = mr.role_id
        WHERE m.utilisateur_id = $1 AND m.retire_le IS NULL
        GROUP BY e.id, e.slug, e.nom_commercial
        ORDER BY e.nom_commercial`,
      [session.utilisateurId],
    );
    return rows;
  });
}

/**
 * Ouvre un contexte autorisé pour une entreprise, et exige les permissions
 * demandées. Lève plutôt que de rendre un résultat vide : une route qui
 * oublie de vérifier le retour échoue bruyamment au lieu d'afficher une page
 * à moitié vide.
 */
export async function exigerAcces(
  entrepriseId: string,
  requises: string[] = [],
): Promise<Omit<Contexte, "q"> & { executer: <T>(t: (q: Requete) => Promise<T>) => Promise<T> }> {
  const session = await exigerSession();

  const permissions = await avecActeur({ utilisateurId: session.utilisateurId, jetonHache: session.jetonHache }, async (q) => {
    const { rows: membre } = await q(
      `SELECT 1 FROM membres
        WHERE utilisateur_id = $1 AND entreprise_id = $2 AND retire_le IS NULL`,
      [session.utilisateurId, entrepriseId],
    );
    if (membre.length === 0) throw new AccesRefuse("non membre de cette entreprise");
    const { rows } = await q("SELECT permission_cle FROM app.permissions_effectives($1)", [
      entrepriseId,
    ]);
    return new Set<string>(rows.map((r) => r.permission_cle));
  });

  for (const p of requises) {
    if (!permissions.has(p)) throw new AccesRefuse(`permission manquante : ${p}`);
  }

  return {
    session,
    entrepriseId,
    permissions,
    executer: (travail) =>
      avecActeur(
        { utilisateurId: session.utilisateurId, jetonHache: session.jetonHache },
        travail,
      ),
  };
}

/**
 * ⚠️ NUL NE MODIFIE SES PROPRES DROITS.
 *
 * Même avec `role.gerer`. Sans cette règle, la permission de gérer les rôles
 * serait une permission de s'accorder toutes les autres — et la hiérarchie
 * des droits n'existerait plus.
 */
export function interdireAutoModification(acteurId: string, cibleId: string): void {
  if (acteurId === cibleId) {
    throw new AccesRefuse("on ne modifie pas ses propres droits");
  }
}

/** Trace une action sensible. Appelé DANS la transaction de l'acteur. */
export async function tracer(
  q: Requete,
  acteurId: string,
  entrepriseId: string | null,
  action: string,
  ressourceType: string,
  ressourceId: string | null,
  avant: unknown = null,
  apres: unknown = null,
): Promise<void> {
  await q(
    `INSERT INTO journal_audit
       (acteur_id, entreprise_id, action, ressource_type, ressource_id, avant, apres)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [acteurId, entrepriseId, action, ressourceType, ressourceId,
     avant ? JSON.stringify(avant) : null, apres ? JSON.stringify(apres) : null],
  );
}
