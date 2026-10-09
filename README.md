# JoksWed — Site officiel

Site de **JoksWed**, photographe de mariage — Paris & International.
Next.js 16 · React 19 · App Router.

---

## ⚠️ Le README précédent décrivait un autre site

Il est corrigé ici. Pour mémoire, ce qu'il affirmait et qui était faux :

| Affirmation | Réalité |
|---|---|
| « Le formulaire ouvre le client mail du visiteur » | Il poste sur `/api/contact`, qui envoie un e-mail par API |
| « Collez votre identifiant dans la constante `FORMSPREE_ID` » | Cette constante n'a jamais existé dans le code |
| « `images/hero.jpg` : grande image d'accueil » | Ce fichier n'existait pas ; l'accueil utilisait `DSC01345-Modifier.jpg` |
| « La page `/mariages/<slug>` est créée automatiquement » | Aucune route `app/mariages/` n'a jamais existé |
| Aucune variable d'environnement mentionnée | Trois sont obligatoires — voir `.env.example` |

---

## Lancer le site en local

```bash
npm install
cp .env.example .env.local   # puis renseigner les trois variables obligatoires
npm run dev                  # http://localhost:3000
```

## Vérifier avant de déployer

```bash
npm run suite
```

Enchaîne quatre étapes et **échoue** à la première qui casse :

1. `verifier:sitemap` — chaque URL annoncée a sa page, chaque page publique est annoncée ;
2. `verifier:coherence` — aucune formulation contradictoire, aucun lien mort, aucune image manquante, aucun prix en dur ;
3. `build` — compilation de production ;
4. `banc` — démarre le serveur et éprouve 32 points : codes HTTP de la route de contact, limitation de débit, consentements, absence de données personnelles dans les journaux, image Open Graph, balisage FAQPage, poids des images, `npm audit`.

Le banc **n'envoie aucun e-mail** : la clé fournisseur qu'il utilise est volontairement invalide.

---

## Où se modifie quoi

| Fichier | Contenu |
|---|---|
| `content/offres.ts` | **Formules et suppléments. Montants en centimes, TTC.** Source unique |
| `content/faq.ts` | **FAQ. Source unique** pour `/faq` et l'encart de `/tarifs` |
| `content/legal.ts` | Identité légale, sous-traitants, finalités RGPD |
| `content/site.js` | Textes, avis, portfolio, chemins d'images |
| `app/globals.css` | Système de design (couleurs, typographie, animations) |
| `app/layout.jsx` | Polices et métadonnées globales |
| `app/opengraph-image.jpg` | Visuel des partages sociaux (1200 × 630) |

### Changer un prix

Uniquement dans `content/offres.ts`, en **centimes** : `130_000` pour 1 300 € TTC.
L'accueil, `/tarifs`, le formulaire et — à partir de la V5 — les devis et factures
lisent cette même valeur. `npm run verifier:coherence` échoue si un prix réapparaît
en dur dans une page.

### Remplacer une photo

Déposer le fichier dans `public/images/…` et mettre à jour le chemin dans
`content/site.js`. Garder une largeur maximale de 2400 px et une qualité JPEG
d'environ 80 : `npm run banc` échoue si `public/images` dépasse 15 Mo.

---

## Ce que la V1 a corrigé

- **Dépendances** — Next 14.2.15 → 16.4.0, React 18 → 19.3. Lève une RCE critique de l'API d'optimisation d'images (applicable, le format AVIF étant activé) et un contournement d'autorisation du middleware qui interdisait d'ajouter un espace authentifié. `npm audit` : 1 critique + 3 hautes → **0**.
- **Liens morts** — `/mariages` était annoncé au sitemap, lié depuis l'accueil **et depuis le pied de page de toutes les pages**, sans qu'aucune route existe.
- **Open Graph** — l'image déclarée n'existait pas : tout partage sortait sans visuel. Remplacée par un vrai fichier 1200 × 630, résolu par convention Next.
- **Sitemap** — `/faq` y était absente ; les pages légales y sont ajoutées.
- **FAQ** — deux FAQ indépendantes se contredisaient sur le délai de livraison (13-15 vs 15-20 jours), le nombre de photos (« minimum 800 » vs « plusieurs centaines ») et les frais de déplacement. Une seule source, alignée sur le devis et le contrat signés.
- **Prix** — annoncés **TTC**, et typés en centimes entiers au lieu de chaînes (`"1300€"`).
- **Vidéaste** — l'ancien texte est remplacé par le nouveau. Ses coordonnées personnelles ne sont **pas** publiées.
- **Images** — 116 Mo → **12 Mo**. Cinq paires de doublons exacts supprimées, 27 images de reportages de démonstration retirées, fichiers au-delà de 2400 px recompressés.
- **Route de contact** — limitation de débit, vérification d'origine, plafond de taille, idempotence, consentements RGPD séparés par finalité, date normalisée en ISO, journaux expurgés, plus aucun expéditeur de repli sur un domaine tiers.
- **Accessibilité** — `aria-expanded` suit l'état réel du menu ; le menu mobile fermé est `inert`, ses six liens n'étant plus atteignables à la tabulation.
- **Pages légales** — mentions légales et politique de confidentialité, absentes du site livré.

## Ce que la V2 a apporté

- **Bande photographique** pleine largeur, carrés collés, défilement continu. Animation **100 % CSS** : aucun JavaScript, donc rien à recalculer par image — c'est ce qui tient sur Safari iOS. La série est dupliquée exactement une fois et translatée de -50 %, condition arithmétique du raccord invisible (vérifiée au banc : demi-piste = largeur d'une série).
- **Les trois formules sur l'accueil**, avec « Choisir cette formule ». La sélection est reprise automatiquement dans le formulaire, et reste modifiable depuis celui-ci.
- **Suppléments** sélectionnables, et la règle anti-double-facturation appliquée **des deux côtés** : un supplément compris dans la formule s'affiche « Incluse dans votre formule », n'est pas cliquable, et le serveur le reclasse aussi à la réception.
- **Carte vidéaste** avec le nouveau texte d'Yvann, le lien vers ses réalisations, et l'emplacement de l'aperçu vidéo. Ses coordonnées ne sont pas publiées — vérifié au banc.
- **Aucun total n'est affiché tant qu'une ligne reste « sur devis »** : seulement le prix de la formule et la liste des prestations à chiffrer.
- **Formulaire sur l'accueil**, avec récapitulatif en direct. Les prix ne transitent jamais par le navigateur : seules des clés sont envoyées, revalidées contre le catalogue côté serveur.
- **Aucune notification au vidéaste** : son compte et ses permissions n'existent pas. Une demande vidéo est signalée dans l'e-mail comme à relayer manuellement.
- **En-tête opaque sur l'accueil** : il se rendait en blanc translucide par-dessus un héros sombre qui n'existe plus, et devenait illisible sur les photos claires de la bande.
- **Cibles tactiles du pied de page** portées de 22 à 24 px (minimum WCAG 2.2 AA).
- **Tailles d'images affinées** (320 et 640 ajoutés) : un carré de 250 px sur écran 2× recevait un fichier de 768 px.

## Ce que la V3 a apporté

**Base de données JoksWed indépendante** — PostgreSQL, 7 migrations, 20 tables.
Entièrement distincte de celle d'EyesofJoks, qui n'a reçu aucune migration.

**Identité** : utilisateurs, empreintes scrypt (paramètres OWASP, ~180 ms par
vérification), second facteur TOTP chiffré au repos en AES-256-GCM, sessions
dont seule l'empreinte du jeton est stockée, limitation des tentatives en base.

**Entreprises et permissions** : entreprises juridiquement distinctes, régimes
de TVA historisés, 28 permissions en table, 6 rôles modèles, plusieurs rôles par
membre, refus individuels qui l'emportent, invitations à jeton haché.

**Row Level Security** sur 19 tables, `FORCE` partout sauf 5 exceptions
justifiées et vérifiées par banc. Rôle `jokswed_app` ni propriétaire, ni
superutilisateur, ni `BYPASSRLS`. Identité portée par `set_config(..., true)`,
locale à la transaction.

**Administration** : connexion, tableau de bord, collaborateurs. Même système de
design que le site public, mobile d'abord.

### Lancer l'environnement de développement

```bash
npm run dev:complet
```

Démarre un PostgreSQL isolé (port 54329, dossier `.pgdev/`), applique les
migrations, pose des fixtures en `.invalid`, puis lance Next.

⚠️ Utilisez bien `dev:complet` et non `next start` : en production le cookie
porte le préfixe `__Host-`, qui impose HTTPS. Servi en HTTP simple, il est
rejeté par le navigateur et la connexion échoue silencieusement.

### Tests

```bash
npm run test:securite   # 41 épreuves RLS, avec le rôle réel de l'application
npm run test:admin      # 27 épreuves HTTP sur les routes d'administration
npm run test:secrets    # 24 épreuves des primitives, dont le vecteur RFC 6238
```

## Ce que la V4 a apporté

**Correction de sécurité préalable (paliers 008-009)** — l'élévation de privilèges
est fermée EN BASE, pas seulement côté serveur. Le rôle applicatif a perdu tout
droit d'écriture sur `membres`, `membres_roles`, `membres_permissions`, `roles`,
`roles_permissions`, `affectations`, `invitations` et sur les réglages
d'entreprise. Ces opérations passent par six fonctions qui vérifient
l'appartenance, la permission et l'interdiction de se viser soi-même.

**Second vecteur trouvé en auditant** : `app.auth_creer_session()` était accordée
au rôle métier et ouvre une session pour n'importe quel identifiant. Une
injection dans une requête métier permettait de se forger une session de
propriétaire. Elle appartient désormais à `jokswed_auth`, un rôle **sans aucun
privilège de table**, utilisé par le seul chemin de connexion.

**Les demandes sont persistées avant toute notification.** La demande, ses
lignes, ses consentements, la proposition vidéo et l'événement de notification
sont écrits dans **une seule transaction**. Un échec d'envoi retarde la
notification ; il ne perd plus la demande. L'idempotence est passée d'une `Map`
de processus à une contrainte `UNIQUE` partagée par toutes les instances.

**Instantané tarifaire** : chaque demande fige le catalogue tel qu'il était.
Changer un prix demain ne réécrit pas ce que ce client a vu.

**`/admin/demandes`** : liste filtrable, fiche complète, complétion des
informations, notes internes, changement de statut. Aucun bouton de devis ou de
contrat n'est affiché tant que leur moteur n'existe pas.

**Collaboration vidéo enregistrée, non transmise** : la proposition est créée
automatiquement, `envoyee_le` reste nul. Aucune coordonnée ne part.

### Tests V4

```bash
npm run test:neon       # 9 contrôles de compatibilité avant migration
npm run test:admin      # 63 épreuves HTTP, dont le parcours complet
npm run test:securite   # 66 épreuves RLS et élévation de privilèges
```

## Ce que la V4.1 a apporté

**L'identité n'est plus déclarée, elle est prouvée.** Les paramètres
personnalisés PostgreSQL (`app.*`) sont réglables par tout rôle : tant que
`app.acteur_id` portait un identifiant d'utilisateur, une seule ligne de SQL
sous le rôle applicatif suffisait à se déclarer propriétaire. **La faille a été
reproduite avant d'être corrigée.** Le réglage porte désormais l'empreinte du
jeton de session, que `app.acteur()` résout en base — et qui vérifie en plus la
révocation, l'expiration, le second facteur et l'état du compte.

**E-mails Brevo** avec expéditeur distinct d'EyesofJoks, gabarits HTML et texte
à l'identité JoksWed, fournisseur simulé pour les bancs, journal d'envoi avec
statut et Message-ID.

**File périodique** : `/api/cron/drain`, protégé par `CRON_SECRET`, verrou
consultatif contre les traitements concurrents, report exponentiel, historique
des tentatives, relance manuelle possible.

**Limitation de débit persistante**, à deux échelles : stricte par adresse
e-mail, large par réseau /24 — pour ne pas bloquer un opérateur mobile entier.

### Actions manuelles avant mise en service

1. **Brevo** : ajouter `jokswed.com` comme domaine, publier son DKIM et son code de vérification, déclarer et valider l'expéditeur `contact@jokswed.com`. ⚠️ Brevo n'exige **pas** d'`include` SPF à la racine : l'alignement passe par DKIM.
2. **DMARC** : publier `v=DMARC1; p=none; rua=…` en observation avant de durcir.
3. **Vercel** : vérifier que ton offre autorise une tâche planifiée toutes les 15 minutes (`vercel.json`). L'offre Hobby la limite à une fois par jour — et son usage commercial est de toute façon exclu.
4. **`CRON_SECRET`** : sans lui, l'endpoint répond 503 au lieu de s'ouvrir.

## Ce que la V5 a apporté

**Moteur documentaire sans aucune dépendance.** Le devis fourni sort de Canva et
n'utilise que `/Helvetica` et `/Helvetica-Bold` — deux des quatorze polices
garanties dans tout lecteur PDF. La fidélité visuelle de ton modèle est donc
atteignable sans embarquer un octet de police, sans Puppeteer, sans coût.
Vérifié : le PDF produit s'ouvre dans un vrai lecteur, en A4, et son texte
extrait suit ton modèle ligne pour ligne.

**Génération depuis une fiche** : un bouton, et le devis reprend l'identité du
prestataire, celle des clients, la date, les lieux, la formule, ses inclusions
et l'échéancier. Rien n'est ressaisi. L'échéancier applique la règle du modèle :
433,33 + 433,33 + **433,34** — le reliquat tombe sur la dernière échéance, et la
somme fait exactement le total.

**La garde d'émission fait ce que tu as demandé** : tant que le régime de TVA
n'est pas qualifié et que le médiateur n'est pas désigné, le brouillon se
prépare, se relit, se télécharge — mais ne devient jamais définitif. Les motifs
s'affichent **avant** le clic. Un brouillon porte un bandeau « DOCUMENT NON
ÉMIS, SANS VALEUR ».

**Un refus d'émission ne consomme aucun numéro** : la série comptable ne garde
aucun trou. Les bancs puisent dans une série `TEST-` distincte.

**Immuabilité** : un document émis ne peut être ni modifié ni supprimé —
exception levée, jamais un silence.

## Ce qui reste ouvert

- **Aucun envoi « exactement une fois » n'est promis.** Brevo accuse la prise en charge, pas la remise : si un appel expire après qu'il a accepté le message, la reprise le renverra. On vise « au moins une fois, sans doublon évitable ».
- **Aucun webhook Brevo n'est branché** : un envoi reste au statut `envoye`, jamais `remis` ni `ouvert`.
- **Aucune interface de relance** : `app.relancer_envoi()` existe et est éprouvée, mais aucun bouton ne l'appelle encore.
- **Le contrat et la facture n'ont pas encore de moteur.** Le devis en a un ; la structure (clauses conditionnées, versions de CGV, signatures) est en base et attend son gabarit. Aucun bouton ne les propose — un bouton qui ne produit rien est pire que son absence.
- **Aucune signature électronique.** La table `signatures` distingue déjà `case_acceptation` d'une signature qualifiée, et l'interface ne présentera jamais la première comme la seconde.
- **Médiateur de la consommation** non désigné (« À COMPLÉTER AVANT SIGNATURE », article 14 du contrat). Bloque l'émission de tout contrat définitif.
- **Régime de TVA à qualifier.** L'obligation d'afficher un numéro de TVA intracommunautaire n'est pas générale : elle dépend du régime. En franchise en base (art. 293 B du CGI), c'est la mention « TVA non applicable » qui est obligatoire, pas le numéro. En régime assujetti, le numéro du vendeur figure parmi les mentions de l'article 242 nonies A, annexe II du CGI. Le devis fourni applique 20 % de TVA : soit le numéro manque, soit c'est le taux qui est l'anomalie. `content/legal.ts` modélise les deux cas et n'affiche rien tant que le régime n'est pas qualifié.
- **Aucun tarif d'option** n'a été communiqué : tous les suppléments sont « sur devis ».
- **La vidéo d'aperçu du vidéaste est absente** du ZIP et des pièces jointes. L'emplacement est prêt (`videastePartenaire.apercuVideo`), à `null`.

---

## Déploiement

Rien n'est déployé sans validation explicite. Le flux attendu : aperçu Vercel,
inspection, puis promotion — jamais un `--prod` direct.

```
app/              → les pages
components/       → les briques réutilisables
content/          → offres.ts · faq.ts · legal.ts · site.js
lib/              → utilitaires serveur
public/images/    → les photos
scripts/          → les bancs d'essai
```
