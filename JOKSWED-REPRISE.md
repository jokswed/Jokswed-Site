# Reprendre le travail sur JoksWed

> À lire en premier dans une nouvelle session. L'état détaillé est dans
> **JOKSWED-ETAT-PROJET.md**.

## Où l'on en est

JoksWed est fonctionnellement **complet de la V1 à la V7** et gelé : plus de
nouvelles fonctionnalités, on stabilise et on déploie. `npm run suite` =
**619 vérifications vertes**. La phase en cours est la mise en service :
amorçage du compte propriétaire, Neon, Vercel Preview, puis production.

## Les trois règles qui ne se négocient pas

1. **Ne jamais toucher EyesofJoks.** C'est `/Users/joks/Downloads/photographe-portrait`,
   en production. Référence de patrons uniquement. Vérifier le répertoire de
   travail avant chaque commande.
2. **Ne jamais déployer en production sans validation explicite de John.**
   Jamais de `vercel --prod` direct : preview → inspect → promote.
3. **Ne pas assouplir une protection pour faire passer un test.** Si un banc
   échoue, c'est le code ou le banc qui est faux, pas la règle.

## Travailler

```bash
cd /Users/joks/Downloads/jokswed-v2
npm run dev:complet      # PostgreSQL embarqué + fixtures + Next sur :3144
npm run suite            # tout, avant chaque commit
npm run db:migrer        # appliquer les migrations
```

Comptes de développement (domaine `.invalid`, jamais réels) :
`proprietaire@`, `videaste@`, `assistant@`, `photographe@exemple.invalid`,
mot de passe `mot-de-passe-de-developpement`.

⚠️ **`preview_start` a déjà ouvert le serveur d'EyesofJoks** en résolvant un
nom dans le mauvais dépôt. Lancer le serveur JoksWed par
`npm run dev:complet`, puis pointer le navigateur sur `http://127.0.0.1:3144`.

## Ce qui reste à faire, dans l'ordre

| # | Action | Qui |
| --- | --- | --- |
| 1 | Créer le projet Neon JoksWed + bases `jokswed` et `jokswed_preview` | **John** |
| 2 | `npm run neon:preparer` avec la chaîne propriétaire | Claude |
| 3 | Créer le projet Vercel `jokswed` (racine = ce dépôt) | **John** |
| 4 | Déclarer les variables Preview, déployer, protéger | **John** + Claude |
| 5 | `npm run verifier:prod -- <url>` et vérifications manuelles | Claude |
| 6 | Vérifier l'expéditeur Brevo `contact@jokswed.com` | **John** |
| 7 | Initialiser le compte propriétaire via `/admin/amorcage?cle=…`, puis **retirer le secret** | **John** |
| 8 | Valider la bascule sur `jokswed.com` | **John** |
| 9 | Inviter Yvann depuis `/admin/collaborateurs` | **John** |

Claude ne peut pas faire 1, 3 et 6 : ils exigent une authentification chez
Neon, Vercel et Brevo. Il n'y a pas de CLI Vercel installée ni de jeton.

## Pièges déjà rencontrés — ne pas les refaire

- Un **paramètre de SORTIE** plpgsql masque une colonne du même nom :
  toujours aliaser (`fd.contractualise_cents`).
- `sum()` rend un **bigint** ; les paramètres de sortie sont des `integer` :
  caster, sinon « structure of query does not match ».
- Ajouter un paramètre à défaut crée une **surcharge**, pas un remplacement :
  `DROP FUNCTION` d'abord.
- `ON CONFLICT` sur un index **partiel** exige de répéter son `WHERE`.
- Une **grille sans `grid-template-columns`** se dimensionne sur `max-content`
  et fait déborder toute la page sur iPhone.
- Une jointure directe sur `entreprises` **supprime silencieusement** des
  lignes : sa politique ne rend que les siennes. Passer par une fonction.
- Un **déclencheur différé** ne voit pas l'état final : relire la ligne.
- `preview_start` peut ouvrir le mauvais dépôt.
- Les **rôles modèles** n'étaient créés que par les fixtures : une base de
  production neuve n'en avait aucun et l'amorçage échouait. D'où
  `test:amorcage`, qui tourne sur une base **vide**.
- Le **middleware** redirige tout `/admin/*` : les chemins qui précèdent la
  session (amorçage, invitation, second facteur) doivent y être exemptés.

## Conventions

- Tout en français : code, commentaires, commits, interface.
- Les commentaires expliquent **pourquoi**, et signalent les pièges par `⚠️`.
- Chaque correction de défaut s'accompagne d'une assertion de banc qui
  échouerait sans elle.
- Les migrations ne se réécrivent jamais une fois appliquées en production.
