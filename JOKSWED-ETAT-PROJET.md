# JoksWed — état du projet

> Document de référence. Il doit suffire à reprendre le travail sans
> réanalyser le code. Mis à jour à la phase de stabilisation (après V7).

## 1. Architecture

| | |
| --- | --- |
| Cadre | Next.js 16.4 (App Router, Turbopack), React 19.3 |
| Base | PostgreSQL 18 en dev (`embedded-postgres`, port 54329), **Neon** en cible |
| Rendu | Server Components + Server Actions. Aucun état client. |
| Dépôt | `/Users/joks/Downloads/jokswed-v2` — **distinct d'EyesofJoks** |
| PDF | moteur maison, sans dépendance (polices base-14) |
| E-mail | Brevo (compte partagé avec EyesofJoks, expéditeur distinct) |

```
app/(site)/       pages publiques          lib/auth/         sessions, secrets, accès
app/admin/        administration           lib/db/           client + migrations
app/api/          routes                   lib/documents/    moteur PDF, gabarits
content/          offres, FAQ, légal       lib/demandes/     dépôt public, drain
scripts/          migrations et bancs      lib/messagerie/   adresses, modèles
```

**Deux couches d'autorisation, toujours les deux** : RLS PostgreSQL (quelles
lignes) + vérification applicative (quels verbes). Les deux sont éprouvées
sous le rôle `jokswed_app` réel, jamais sous le propriétaire.

## 2. Fonctionnalités par version

| V | Contenu | État |
| --- | --- | --- |
| V1 | Assainissement du site public, sources uniques, durcissement | fait |
| V2 | Page d'accueil : bande photo, 3 formules, suppléments, formulaire, FAQ | fait |
| V3 | Identité, entreprises, rôles, permissions, RLS | fait |
| V4 | Demandes persistées, instantané des tarifs, `/admin/demandes`, file d'événements | fait |
| V4.1 | Identité prouvée par session, Brevo, drain périodique, limite de débit en base | fait |
| V5 | Devis, contrats + CGV, factures, avoirs, échéanciers, garde d'émission | fait |
| V6 | Finances, saison des mariages, collaborateurs, transmission vidéo | fait |
| V6.1 | Transmission auto, paliers d'engagement, montants masqués, durcissement RLS | fait |
| V7 | Messagerie : conversations, envoi, réception, modèles, pièces jointes | fait (réception à configurer) |
| Stab. | Amorçage du propriétaire, second facteur, mon compte, en-têtes, scripts Neon et de vérification | fait |

## 3. Décisions techniques structurantes

1. **Hybride, pas monolithe.** JoksWed a sa propre base Neon ; EyesofJoks sert
   de référence de patrons, jamais de socle partagé.
2. **L'identité se prouve, elle ne se déclare pas.** `app.acteur()` résout
   l'empreinte d'un jeton de session (`app.session_jeton`), vérifie révocation,
   expiration, MFA et état du compte. `set_config('app.acteur_id', …)` serait
   falsifiable par le rôle applicatif ; cette piste a été fermée au palier 013.
3. **Trois rôles PostgreSQL.** `jokswed_migrateur` (propriétaire, migrations),
   `jokswed_app` (métier, ni propriétaire ni BYPASSRLS), `jokswed_auth`
   (connexion et activation d'invitation ; **aucun privilège de table**).
4. **L'instantané fait foi.** Demandes et documents figent le catalogue et
   l'identité au moment T. Changer un tarif ne réécrit pas l'histoire.
5. **Émettre, rendre, sceller.** Le numéro n'existe qu'à l'émission et doit
   figurer SUR le PDF ; l'empreinte se pose après. Contrainte différée.
6. **Facturé ≠ encaissé ≠ engagé ≠ proposé.** Quatre mesures, jamais additionnées.
7. **Transactional outbox.** Toute notification naît dans la transaction qui
   crée le fait. Le drain envoie hors transaction, avec reprise exponentielle.
8. **« Au moins une fois, sans doublon évitable ».** Brevo accuse la prise en
   charge, pas la remise : « exactement une fois » n'est pas promis.

## 4. Migrations (46, toutes nommées et conservées)

| Palier | Objet |
| --- | --- |
| 001–009 | socle, identité, entreprises, permissions, mariages/dossiers, RLS, chemin d'authentification, privilèges d'administration, permissions effectives |
| 010–015 | demandes, dépôt, proposition, **identité vérifiable (013)**, limites et livraison, lecture pour le drain |
| 016–021 | documents, émission, motifs, paiements, numérotation autorisée, **numéro dans l'instantané (021)** |
| 022–033 | finances, tableau, saison, collaborateurs, notifications et vidéo, invitations envoyables, partenaires, dossiers de collaborateur, parrainage |
| 034–039 | **RLS par permission (034)**, transmission auto, paliers d'engagement, montants masqués, garde-fous du parrain, engagé par dossier |
| 040–046 | messagerie : tables, RLS, fonctions, réception, modèles, participants |
| 047–048 | **amorçage du propriétaire, mot de passe, MFA, sessions (047)** ; **rôles modèles en migration (048)** |

Appliquer : `npm run db:migrer` (dev) ou `DATABASE_URL_MIGRATEUR=… npx tsx scripts/migrer.mjs`.
La table `schema_migrations` est la source de vérité ; les migrations sont
idempotentes au niveau du fichier, **pas** du contenu : ne jamais réécrire un
palier déjà appliqué en production.

## 5. Sécurité

- **RLS `ENABLE` + `FORCE`** sur toutes les tables métier. Exceptions
  justifiées : `membres` et les 4 tables d'authentification (FORCE casserait
  les fonctions `SECURITY DEFINER` dont elles dépendent) ; `permissions`,
  `taux_tva`, `types_notification` sont des catalogues sans donnée personnelle.
- **Politiques restrictives par permission** (palier 034) : l'appartenance à
  l'entreprise ne suffit plus, il faut porter le verbe.
- **Aucune écriture directe** sur `invitations`, `membres_*`, `documents`,
  `conversations`, `messages`. Tout passe par des fonctions qui vérifient et
  tracent dans la même transaction.
- **`app.exiger(entreprise, permission, cible)`** refuse qu'on s'applique une
  mesure à soi-même.
- scrypt N=2^17, AES-256-GCM pour les graines TOTP, TOTP RFC 6238, jetons
  hachés en HMAC, IP tronquées (/24, /48).
- Cookie `__Host-jokswed_session`, HttpOnly, Secure, SameSite=Lax.
- Limite de débit **en base** (`limites_debit`), par e-mail et par IP tronquée.

## 6. Rôles applicatifs (modèles, copiés à la création d'une entreprise)

| Rôle | Portée |
| --- | --- |
| `proprietaire` | tout sur son entreprise, sauf `finance.consolide.lire` |
| `administrateur` | gestion courante, sans rôles ni remboursements |
| `photographe` | dossiers, planning, coordonnées, documents en lecture |
| `videaste` | ses dossiers, ses documents, ses finances |
| `assistant` | planning et dossiers, aucune finance, aucune coordonnée |
| `monteur` | lecture seule des dossiers affectés |
| `parrain` | **deux permissions** : `membre.inviter`, `membre.revoquer` |

28 permissions, en table (`permissions`) : en ajouter une n'exige ni migration
de type ni déploiement.

## 7. Configuration Neon (à faire à la main)

1. Créer un projet Neon **JoksWed**, séparé d'EyesofJoks. Région `eu-central-1`.
   Plan gratuit suffisant pour démarrer.
2. Créer deux bases : `jokswed` (production) et `jokswed_preview`.
3. Récupérer la chaîne du rôle propriétaire (`neondb_owner`).
4. Jouer : `DATABASE_URL_MIGRATEUR=<chaîne owner> npm run neon:preparer`
   — crée `jokswed_migrateur`, `jokswed_app`, `jokswed_auth` avec des mots de
   passe **distincts** fournis en variables, applique les 46 migrations, puis
   vérifie les privilèges. Le script n'affiche jamais un mot de passe.
5. Vérifier : `DATABASE_URL_MIGRATEUR=… npm run test:neon`.

⚠️ `DATABASE_URL_APP` doit porter `jokswed_app`. Le propriétaire contourne la
RLS : s'y connecter désactiverait silencieusement tout le cloisonnement.

**Sauvegarde** : Neon conserve un historique de 7 jours (plan gratuit) —
restauration par *branch from timestamp*. Avant toute migration de production :
`pg_dump` dans un fichier daté, conservé hors Vercel.

## 8. Configuration Vercel (à faire à la main)

1. Nouveau projet Vercel **jokswed**, dépôt distinct, **racine = ce dépôt**.
   Ne pas réutiliser le projet EyesofJoks.
2. Variables (voir §10), par environnement : Production et Preview **ne
   partagent ni base ni secrets**.
3. `vercel.json` déclare déjà le cron `/api/cron/drain` toutes les 15 min.
   Plan Hobby : 2 crons max, exécution quotidienne seulement → **le plan Pro
   est nécessaire pour un drain au quart d'heure**. À défaut, déclencher le
   drain depuis un service externe appelant la route avec `CRON_SECRET`.
4. Protection de la Preview : Vercel → Settings → Deployment Protection →
   *Vercel Authentication* (gratuit) ou *Password Protection* (Pro).
5. Domaine : ajouter `jokswed.com` **seulement après validation** de la Preview.

## 9. Configuration Brevo

| Usage | État |
| --- | --- |
| Envoi transactionnel (accusés, alertes, invitations, messagerie) | prêt — exige `BREVO_API_KEY` et un expéditeur vérifié |
| Expéditeur `contact@jokswed.com` | à **vérifier** dans Brevo (Senders) |
| Authentification du domaine `jokswed.com` (DKIM + code Brevo) | à vérifier ; **SPF racine non requis** |
| Réception des réponses | **non opérationnelle** — voir ci-dessous |

Réception, trois actions manuelles :
1. sous-domaine **distinct** du domaine d'envoi, ex. `reply.jokswed.com` ;
2. MX : `10 inbound1.sendinblue.com.` et `20 inbound2.sendinblue.com.` ;
3. webhook Brevo `type: inbound`, événement `inboundEmailProcessed`, vers
   `https://jokswed.com/api/entrant/brevo/<JOKSWED_WEBHOOK_ENTRANT>`.

⚠️ Brevo **ne signe pas** ses webhooks : le secret d'URL est l'authentification.
Rien de tout cela ne touche la configuration d'EyesofJoks (sous-domaine et
webhook nouveaux).

## 10. Variables d'environnement

| Clé | Obligatoire | Note |
| --- | --- | --- |
| `SITE_URL` | oui | vérification d'origine + URL absolues |
| `DATABASE_URL_APP` | oui | rôle `jokswed_app` |
| `DATABASE_URL_AUTH` | oui | rôle `jokswed_auth` |
| `DATABASE_URL_MIGRATEUR` | migrations seulement | jamais dans l'application |
| `JOKSWED_CHIFFREMENT_CLE` | oui | 32 octets base64 |
| `BREVO_API_KEY` | pour envoyer | sans elle, tout est inhibé |
| `JOKSWED_EMAIL_EXPEDITEUR` / `_NOM` | oui | expéditeur vérifié chez Brevo |
| `CRON_SECRET` | oui | protège `/api/cron/drain` |
| `JOKSWED_DOMAINE_REPONSE` | réception | ex. `reply.jokswed.com` |
| `JOKSWED_WEBHOOK_ENTRANT` | réception | secret long, dans l'URL du webhook |
| `JOKSWED_AMORCAGE` | **temporaire** | active `/admin/amorcage`, à retirer après usage |
| `EMAIL_FOURNISSEUR` | bancs | `simule` = aucun envoi réel |
| `EMAIL_DRY_RUN` | optionnel | `1` = rien ne part |

Aucune valeur secrète n'est versionnée. `.env.example` les liste toutes.

## 11. Incomplet / signalé indisponible

- **Réception d'e-mails** : code prêt et éprouvé sur un faux webhook ; exige
  MX + webhook réels. L'écran l'annonce.
- **OAuth Gmail / Outlook** pour l'identité d'un collaborateur : modélisé,
  affiché indisponible (scope « restricted », évaluation de sécurité annuelle).
- **Aucune synchronisation d'une boîte existante.**
- **Pas de webhook de remise Brevo** : un envoi reste `envoye`, jamais `remis`.
- **Pas de relance d'échéance automatique** (`echeance.proche` existe, rien ne
  la déclenche).
- **Pas de signature électronique qualifiée** (`case_acceptation` ≠ signature).
- **Pas de stockage objet** : pièces reçues en base, bornées à 8 Mio.
- **Portail client (V8), PWA et push (V9)** : non commencés, gelés.
- **Régime de TVA et médiateur** non renseignés → l'émission définitive reste
  bloquée, les brouillons restent possibles. C'est voulu.

## 12. Tests de référence

```bash
npm run suite        # 619 vérifications, échoue à la première qui casse
```

| Étape | Nb | Objet |
| --- | --- | --- |
| `verifier:sitemap` | — | URL annoncées ↔ pages réelles |
| `verifier:coherence` | — | formulations, liens, images, prix en dur |
| `build` | — | compilation de production |
| `banc` | 52 | site public, limite de débit, consentements, journaux |
| `test:secrets` | 24 | chiffrement, hachage, jetons |
| `test:pdf` | 90 | moteur documentaire, 3 formules, arrondis, clauses |
| `test:securite` | 81 | RLS et autorisations **sous `jokswed_app`** |
| `test:v6` | 149 | finances, collaborateurs, vidéo, 2 entreprises |
| `test:v7` | 56 | messagerie, réception sur vrai serveur HTTP |
| `test:admin` | 130 | parcours complets, cloisonnement |
| `test:amorcage` | 22 | création du premier propriétaire **sur base vide**, sans fixtures |
| `test:neon` | 9 | compatibilité du schéma |

Et, contre un déploiement :
```bash
npm run verifier:prod -- https://<url>     # 28 contrôles externes, non destructifs
```

Chaque banc part d'une base vierge. Aucun e-mail réel n'est envoyé.

## 12 bis. Compte propriétaire — procédure

**Création initiale, une seule fois :**

1. Poser `JOKSWED_AMORCAGE=<openssl rand -hex 24>` dans l'environnement Vercel.
2. Ouvrir `https://<url>/admin/amorcage?cle=<cette valeur>`.
3. Saisir son e-mail et **choisir son mot de passe** (12 caractères minimum,
   idéalement généré par un gestionnaire). Rien n'est affiché ni journalisé.
4. **Retirer `JOKSWED_AMORCAGE`** et redéployer.

Trois verrous : le secret d'URL (404 sinon), l'absence totale de compte en
base, et une revérification côté PostgreSQL. La page refuse d'elle-même dès
le premier compte créé — mais le secret doit quand même être retiré.

**Ensuite, depuis `/admin/parametres/compte` :** changer son mot de passe
(l'ancien est exigé ; les autres sessions tombent), activer le second
facteur TOTP, lister et révoquer ses sessions, consulter son activité.

**Accès perdu.** Il n'y a **pas** de réinitialisation par e-mail : elle ferait
de la boîte Gmail le maillon faible de toute la plateforme. La procédure de
secours exige un accès à la base :
```sql
-- 1. retirer le second facteur
DELETE FROM facteurs_mfa WHERE utilisateur_id =
  (SELECT id FROM utilisateurs WHERE email = 'votre@adresse');
-- 2. poser une empreinte scrypt produite par `hacherMotDePasse()`
UPDATE identifiants SET secret_hache = '<empreinte>'
 WHERE utilisateur_id = (SELECT id FROM utilisateurs WHERE email = 'votre@adresse')
   AND type = 'mot_de_passe';
-- 3. couper toutes les sessions
UPDATE sessions SET revoquee_le = now() WHERE revoquee_le IS NULL;
```

## 13. Risques connus

| Risque | Parade |
| --- | --- |
| Se connecter en production avec le rôle propriétaire | `test:securite` échoue ; vérifier `DATABASE_URL_APP` |
| Mots de passe de développement en production | le script Neon les refuse ; `npm run verifier:prod` les détecte |
| Migration rejouée sur une base déjà à jour | `schema_migrations` ; ne jamais réécrire un palier appliqué |
| Cron Vercel indisponible en plan Hobby | déclencheur externe avec `CRON_SECRET` |
| Webhook entrant non signé par Brevo | secret d'URL + jeton de conversation + expéditeur participant |
| Confusion de projet Vercel | projets et dépôts séparés ; vérifier la racine avant tout déploiement |
| `JOKSWED_AMORCAGE` oublié après usage | la page refuse déjà, mais le retirer et redéployer |
| Base neuve sans rôles modèles | corrigé au palier 048 ; éprouvé par `test:amorcage` |

## 14. Procédure de déploiement

```
1. npm run suite                      # doit être intégralement vert
2. Neon : créer le projet et les bases, puis npm run neon:preparer
3. Vercel : créer le projet, déclarer les variables (Preview d'abord)
4. Déployer en Preview, protéger l'accès
5. npm run verifier:prod -- <url-preview>   # contrôles de bout en bout
6. Valider à la main : accueil, formulaire, /admin, demande, document, finances
7. Production : mêmes variables, base `jokswed`, puis promotion du déploiement
8. Domaine jokswed.com en dernier, après validation explicite
```

⚠️ Jamais de `vercel --prod` direct : *preview → inspect → promote*.

## 15. Retour arrière

| Niveau | Geste |
| --- | --- |
| Code | Vercel → Deployments → déploiement précédent → *Promote to Production* (instantané, aucune perte) |
| Domaine | retirer `jokswed.com` du projet JoksWed ; le site précédent reprend |
| Base | Neon → *Restore* à un horodatage antérieur, ou restauration du `pg_dump` daté |
| Migration | aucune migration n'est destructive à ce jour ; si l'une le devient, écrire son inverse AVANT de l'appliquer |
| E-mails | `EMAIL_DRY_RUN=1` coupe tout envoi sans redéployer |

L'ordre de bascule (domaine en dernier) est ce qui rend le retour arrière
instantané : tant que `jokswed.com` n'est pas déplacé, rien n'est visible.
