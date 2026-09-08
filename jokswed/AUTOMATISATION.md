# Parcours JoksWed — état au 8 septembre 2026

## Implémenté, à raccorder avant utilisation réelle

- Formulaire court et formulaire complémentaire. Resend continue à notifier le photographe.
- Avec WORKFLOW_ENABLED=true, les demandes sont enregistrées dans PostgreSQL avant la notification. La répétition d’une soumission portant le même identifiant ne crée pas un second dossier. Une notification manquante n’efface pas le dossier enregistré.
- Espace privé /gestion : authentification par mot de passe fort et cookie signé de huit heures, création manuelle pour les demandes issues des réseaux, liste et modification des dossiers.
- Trois formules, options à prix explicite, préparation en franchise de TVA par défaut, prix client inchangé. La confirmation du régime est exigée avant signature.
- Devis et contrat PDF à partir du dossier enregistré. Un brouillon reste non signé. Les conditions initiales sont une base adaptée du contrat fourni, à relire ; les mentions [À COMPLÉTER] empêchent la validation du contrat.
- Validation séparée des deux documents après consultation et confirmation de lecture. Le serveur vérifie la version consultée. L’image de signature du professionnel reste côté serveur. Cette apposition n’est pas une signature électronique certifiée par un prestataire.
- PDF validés conservés avec empreinte et date. Toute édition crée une nouvelle version et invalide les approbations courantes, tout en conservant les versions précédentes en historique.
- Envoi explicite du PDF validé aux signataires via Resend. L’envoi est réservé en base avant l’appel externe ; en cas d’incertitude, le dossier affiche « envoi à vérifier » sans renvoi automatique ni édition possible. La résolution de ce cas nécessite pour l’instant une vérification administrative du fournisseur et de la base.
- Choix Google visible dans Apple Calendrier confirmé par l’utilisateur. Oui/non obligatoire avant validation du devis. Si oui : horaires obligatoires, création d’une option après signature, sans invitation du client. Identifiant d’événement stable pour éviter les doublons ; reprise indépendante après échec.

## Pas encore implémenté

Signature électronique des clients par un prestataire, rapprochement des paiements, confirmation automatique de réservation, passage de l’événement « option » à « confirmé », relances et gestion des annulations. Ne pas annoncer ces fonctions comme actives.

## Mise en service Vercel

1. Créer une base PostgreSQL Neon, de préférence dans une région UE adaptée. Ajouter sa connexion DATABASE_URL dans Vercel, jamais dans Git. Exécuter scripts/database.sql via la console SQL du fournisseur ou scripts/init-database.mjs depuis un environnement autorisé.
2. Définir ADMIN_PASSWORD (secret aléatoire d’au moins 20 caractères), SESSION_SECRET (secret aléatoire distinct d’au moins 32 caractères), APP_URL (origine exacte, sans slash final). Les secrets ne sont jamais préfixés NEXT_PUBLIC_. Restreindre les accès aux paramètres Vercel et à la base.
3. Conserver RESEND_API_KEY et les adresses d’expédition/réception existantes. Utiliser un expéditeur vérifié. Les demandes sont reçues à jokswed@gmail.com ; aucun accès à la boîte Gmail n’est requis.
4. Fournir votre image de signature PNG via SIGNATURE_PNG_BASE64, côté serveur uniquement. Ne jamais la copier dans public/ ou dans Git.
5. Vérifier les coordonnées DOCUMENT_* : référence EyesofJoks conservée faute de décision sur le nom commercial. Ajouter le régime TVA confirmé dans chaque dossier avant émission.
6. Compléter les conditions : médiateur, délais des supports physiques et calendrier de paiement. Faire relire les modèles et l’information sur les données avant émission réelle.
7. Créer un calendrier Google « JoksWed » et afficher ce compte dans Apple Calendrier. Configurer un client OAuth Google, activer Calendar API, obtenir l’autorisation du propriétaire (scope calendar.events), puis placer GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN et GOOGLE_CALENDAR_ID dans Vercel. Ne jamais coller ces secrets dans la conversation ou dans le dépôt. Le parcours OAuth guidé n’est pas encore fourni par cette interface. Vérifier les restrictions du mode test Google et le renouvellement de l’autorisation avant un usage durable.
8. CALENDAR_TIMEZONE=Europe/Paris par défaut. Adapter le fuseau si les événements doivent être saisis dans un autre fuseau.
9. Sur une Preview Vercel, tester uniquement avec des données fictives et des comptes destinataires de test choisis. Tester accès privé, dépôt d’une demande, modification, refus, PDF, validation, envoi et calendrier réel dans ces comptes.
10. Compléter la notice de confidentialité avec Neon, les usages calendrier/documents, les durées de conservation et garanties de transferts réelles. Vérifier sauvegardes et suppression des dossiers. Activer WORKFLOW_ENABLED=true uniquement après ces raccordements.

## Limites de validation actuelles

Tests unitaires des règles métier, sessions, refus, versionnement et calculs ; compilation du site et inspection visuelle de PDF fictifs. Les intégrations Neon, Resend et Google ne sont pas validées avec des comptes réels ici : leurs identifiants ne sont pas fournis. Aucun vrai document client n’est envoyé ou signé pendant les tests. L’image utilisée dans le test de signature est un pixel fictif.

Conserver Vercel et le répertoire racine jokswed. Ne pas fusionner en production avant vérification des comptes et de la notice de confidentialité.
