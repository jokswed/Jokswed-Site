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

Services déjà créés par John : projet **Neon** `jokswed` (branches
`production` et `preview`, Frankfurt), projet **Vercel** `jokswed` (domaine
`jokswed.com`, dépôt `jokswed/Jokswed-Site`, branche `main`, Root Directory
`jokswed`), **Brevo** (domaine authentifié, expéditeur unique
`contact@jokswed.com`).

| # | Action | Qui |
| --- | --- | --- |
| 1 | Chaîne du propriétaire de la branche Neon **preview** | **John** |
| 2 | ~~`npm run neon:preparer`~~ → 4 rôles + 56 paliers + 10 contrôles | **fait** : 14/14 épreuves de fumée sur la branche `preview`, avec les vrais rôles |
| 3 | `npm run preparer:preview` puis `git push -u origin preview` | Claude prépare, **John pousse** |
| 4 | Variables Preview dans Vercel + protection du déploiement | **John** |
| 5 | `npm run verifier:prod -- <url-preview>` | Claude |
| 6 | Parcours manuel : accueil, formulaire, /admin, demande, document, finances, messagerie, iPhone | Claude |
| 7 | `/admin/amorcage?cle=…`, puis **retirer le secret** | **John** |
| 8 | Même chose sur la branche Neon `production` | Claude + John |
| 9 | Validation explicite, puis fusion `preview` → `main` | **John** décide |
| 10 | Inviter Yvann depuis `/admin/collaborateurs` | **John** |

Claude ne peut pas faire 1, 3 (la poussée), 4, 7 et 9 : pas de CLI Vercel,
pas de `gh`, pas de jeton, et aucune authentification Git dans cet
environnement.

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
