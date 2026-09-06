# Parcours JoksWed : état et raccordement

## Prêt dans cette branche

Collecte courte et complémentaire, validation serveur, transmission structurée par Resend au photographe, page d’information sur les données. Calcul des montants en centimes avec choix de TVA obligatoire et échéancier exact ; module testé mais pas encore relié à une interface d’émission.

## À construire et connecter

Stockage persistant des dossiers, espace privé du photographe, génération PDF, signature du professionnel après validation, envoi des documents, signature électronique client, calendrier, suivi de paiement et relances. Aucun de ces services n’est activé par cette branche.

## Informations nécessaires

- TVA : l’utilisateur doit vérifier. Ne pas reprendre automatiquement les 20 % des exemples.
- Identité commerciale : références EyesofJoks, site JoksWed. Ne pas transformer silencieusement les documents.
- Contrat : coordonnées du médiateur, délai des supports physiques et date du deuxième versement à préciser avant de figer le modèle.
- Options : ne pas généraliser le tarif engagement de 100 € d’un exemple sans validation.
- Choisir et connecter stockage, authentification et service de signature.
- Calendrier : confirmer Google affiché dans Apple Calendrier ou iCloud, sans déplacer les événements existants.
- Compléter les durées réelles de conservation et garanties de transferts hors EEE après vérification des comptes Vercel, Resend et Google avant publication de la notice. Cette branche ne constitue pas une validation juridique.

## Règles à implémenter pour la validation

1. Créer un brouillon sans signature ; ne jamais inventer des informations ou des prix manquants.
2. Afficher la prestation, les montants, la TVA et les échéances au photographe.
3. Avant validation du devis, demander « Ajouter au calendrier ? » oui/non. Si oui, vérifier calendrier et horaires. Aucune séance engagement dans le calendrier sans date convenue.
4. Enregistrer la validation du photographe sur une version immuable du document avec auteur et horodatage. La consultation d’un lien ne signe rien.
5. Toute modification invalide la validation. La signature reste en stockage privé côté serveur.
6. Validation distincte du devis et du contrat.
7. Créer « Option mariage — Prénoms » uniquement après validation et si choisi. Envois et événements doivent être idempotents pour éviter les doublons lors de reprises.
8. Recueillir chaque signature client et, séparément, l’autorisation facultative de publication des photographies.
9. Confirmer la réservation après signature des deux documents et encaissement vérifié de l’acompte. Mettre à jour le même événement. Sans connexion de paiement, le photographe confirme l’encaissement.
10. Déclencher la relance du solde seulement après confirmation de l’aperçu photo ; suspendre les relances après réponse, paiement, annulation ou contestation.
11. Une erreur calendrier ne doit pas recommencer la signature ni renvoyer le devis. Reprendre l’étape échouée indépendamment.

## Vérifications avant activation

Tester avec des données fictives et des destinataires de test explicitement désignés. Vérifier les autorisations de chaque dossier côté serveur, la signature des événements fournisseurs, les refus et modifications du photographe, les doublons réseau et les erreurs de messagerie. Ne jamais tester avec les coordonnées des PDF clients.

## Hébergement

Conserver Vercel, le répertoire racine `jokswed` et les variables Resend existantes. Tester d’abord une Preview Vercel. Aucune fusion en production tant que les informations de confidentialité ne sont pas complétées.
