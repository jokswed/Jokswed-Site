# JoksWed — Site officiel

Site vitrine de **JoksWed**, photographe de mariage — Paris & International.
Construit avec **Next.js 14** (React), sans dépendance superflue : rapide,
durable, facile à maintenir.

---

## 🚀 Mise en ligne sur Vercel (5 minutes)

1. Créez un compte gratuit sur [vercel.com](https://vercel.com).
2. Poussez ce dossier sur un dépôt GitHub (ou glissez-le directement via
   `npx vercel` dans un terminal).
3. Sur Vercel : **Add New → Project → Import** votre dépôt.
4. Vercel détecte Next.js automatiquement. Cliquez sur **Deploy**. C'est tout.
5. Ajoutez ensuite votre nom de domaine (ex. `jokswed.com`) dans
   **Settings → Domains**.

## 💻 Lancer le site en local

```bash
npm install     # une seule fois
npm run dev     # puis ouvrir http://localhost:3000
```

---

## ✏️ Modifier les TEXTES

**Un seul fichier à connaître : `content/site.js`.**
Tous les titres, paragraphes, avis, tarifs, questions de la FAQ, coordonnées…
s'y modifient entre guillemets. Aucune autre connaissance nécessaire.

## 🖼️ Remplacer les PHOTOS

Toutes les images sont dans `public/images/`, rangées par page :

| Dossier | Contenu |
|---|---|
| `images/hero.jpg` | grande image d'accueil |
| `images/accueil/` | mosaïque + photo de présentation |
| `images/portfolio/` | les 12 images du portfolio |
| `images/mariages/<nom>/` | cover + 8 photos par reportage |
| `images/a-propos/` | portrait + image d'ambiance |
| `images/contact/` | photo de la page contact |

Deux façons de faire :
- **La plus simple** : remplacez le fichier en gardant le même nom (`hero.jpg` → votre photo renommée `hero.jpg`).
- **Ou** : déposez vos fichiers et mettez à jour les chemins dans `content/site.js`.

Conseils : JPEG qualité ~80, largeur max 2400 px. Next.js convertit ensuite
automatiquement en AVIF/WebP et adapte la taille à chaque écran.

## ➕ Ajouter un reportage de mariage

1. Créez un dossier `public/images/mariages/<slug>/` avec `cover.jpg` et vos photos.
2. Dans `content/site.js`, copiez-collez un bloc du tableau `mariages` et
   adaptez `slug`, `titre`, `lieu`, `texte` et la liste `photos`.
3. La page `/mariages/<slug>` est créée automatiquement (menu, sitemap compris).

## 📬 Formulaire de contact

Par défaut, le formulaire ouvre le client mail du visiteur avec un message
prérempli (aucun serveur requis). Pour recevoir les messages directement :
créez un formulaire gratuit sur [formspree.io](https://formspree.io) et collez
votre identifiant dans `components/FormulaireContact.jsx` (constante
`FORMSPREE_ID`, tout est expliqué dans le fichier).

## 🎨 Ajuster les couleurs et polices

Le système de design tient dans les 30 premières lignes de
`app/globals.css` (variables `--blanc`, `--encre`, etc.). Les polices se
changent dans `app/layout.jsx`.

---

## 🧱 Structure du projet

```
app/                  → les pages (accueil, portfolio, mariages, tarifs…)
components/           → les briques réutilisables (header, galeries, formulaire…)
content/site.js       → ★ TOUT le contenu modifiable (textes + chemins d'images)
public/images/        → ★ toutes les photos
app/globals.css       → le système de design (couleurs, typographie, animations)
```

## ✅ Ce qui est déjà en place

- Design responsive (ordinateur, iPhone, Android, tablette)
- SEO complet : balises, métadonnées, Open Graph, `sitemap.xml`, `robots.txt`, données structurées schema.org
- Images optimisées automatiquement (AVIF/WebP, tailles adaptées, chargement progressif)
- Polices auto-hébergées (aucune requête externe)
- Animations fluides à 60 fps, désactivées si le visiteur préfère réduire les animations
- Accessibilité : navigation clavier, focus visibles, alternatives textuelles
- Page 404 personnalisée
