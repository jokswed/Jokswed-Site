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

## Ce qui reste ouvert

- **La demande n'est pas persistée.** L'e-mail reste le seul support : si l'envoi échoue, la demande est perdue. Objet de la V4 (table `demandes`).
- **La limitation de débit et l'idempotence sont en mémoire de processus**, donc partielles sur une architecture sans état. Elles passent en base en V3.
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
