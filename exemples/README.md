# Exemplaires de référence

Produits par `npx tsx scripts/exemples.mts`, à travers la chaîne réelle :
dépôt du formulaire public → persistance PostgreSQL → génération → émission.
Le script travaille sur une base jetable (`jokswed_exemples`) : il ne touche
ni la base de développement, ni aucune donnée réelle.

| Fichier | Pages | État | Ce qu'il montre |
| --- | --- | --- | --- |
| `devis-exemple.pdf` | 1 | émis | Numéro, échéancier en 3 fois, bandeau noir |
| `contrat-exemple.pdf` | 4 | brouillon | Contrat + CGV, 15 articles, annexe de rétractation, bandeau « SANS VALEUR » |
| `facture-acompte-exemple.pdf` | 1 | émis | Même mise en page que le devis, + « Déjà réglé » / « Reste à payer » |

Chaque exemplaire est rendu **dans son état réel**, comme le ferait la route de
téléchargement. Le contrat reste un brouillon parce que le médiateur de la
consommation n'est exigé que pour un contrat : le devis et la facture, eux,
passent au définitif. Les numéros portent le préfixe `TEST-` hors production,
afin de ne jamais entamer la vraie série comptable.

⚠️ **Données entièrement fictives.** Aucune information de Kimberly & Jérémy
n'est reprise, aucune signature n'est reproduite. Les adresses sont en
`.invalid`, un domaine réservé qui ne peut pas recevoir de courrier.

Le script pose un régime de TVA et un médiateur fictifs **dans sa base
jetable** uniquement, pour pouvoir montrer un document émis. Dans la base de
développement, ni l'un ni l'autre n'est renseigné : la fiche affiche alors ses
motifs de blocage et aucun document ne devient définitif.
