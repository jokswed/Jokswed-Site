#!/usr/bin/env bash
# =============================================================================
# PRÉPARER LA BRANCHE `preview` POUR VERCEL
# -----------------------------------------------------------------------------
# Le dépôt GitHub `jokswed/Jokswed-Site` range l'application dans un
# sous-dossier `jokswed/`, et c'est ce que Vercel a comme « Root Directory ».
# Le dépôt local, lui, a l'application à la racine. Ce script construit une
# branche `preview` dont l'arborescence correspond à ce que Vercel attend.
#
# ⚠️ IL NE POUSSE RIEN. Il prépare, affiche ce qu'il a fait, et s'arrête.
#    La commande de poussée est imprimée à la fin, à exécuter à la main.
#
# ⚠️ IL NE TOUCHE PAS À `main`, NI LOCALEMENT, NI À DISTANCE.
#    Le site actuellement en production reste intact tant que `preview`
#    n'est pas fusionnée — ce qui demande une validation explicite.
#
# Usage :  bash scripts/preparer-preview.sh
# =============================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Le dépôt a des modifications non validées. Validez-les d'abord."
  exit 1
fi

SOURCE="$(git rev-parse --abbrev-ref HEAD)"
echo "Branche source : $SOURCE ($(git rev-parse --short HEAD))"

echo "→ Récupération de origin/main…"
git fetch origin main --depth 50

PREPA="$RACINE/../jokswed-preview"
rm -rf "$PREPA"
git worktree prune
echo "→ Plan de travail séparé : $PREPA"
git worktree add -B preview "$PREPA" origin/main

# ⚠️ ON REMPLACE LE CONTENU DE `jokswed/`, ON NE FUSIONNE PAS.
# Fusionner l'ancien site et le nouveau laisserait traîner des fichiers que
# plus rien n'appelle — et c'est exactement ainsi qu'une page oubliée se
# retrouve en ligne.
cd "$PREPA"
rm -rf jokswed
mkdir -p jokswed

# `git archive` ne sort que les fichiers SUIVIS : ni node_modules, ni .next,
# ni .pgdev, ni .env.local. Aucun secret ne peut partir par ce chemin.
git -C "$RACINE" archive "$SOURCE" | tar -x -C jokswed

git add -A
if git diff --cached --quiet; then
  echo "✓ Rien à faire : `preview` est déjà à jour."
else
  git commit -q -m "chore(preview): application JoksWed v$(date +%Y%m%d) sous jokswed/

Contenu de la branche $SOURCE du dépôt de travail, placé à l'emplacement
attendu par Vercel (Root Directory = jokswed).

Ne touche pas à main : le site en production reste celui de main."
  echo "✓ Branche `preview` prête : $(git rev-parse --short HEAD)"
fi

echo
echo "Vérifications :"
echo "  fichiers sous jokswed/ : $(git ls-tree -r --name-only HEAD jokswed | wc -l | tr -d ' ')"
SECRETS=$(git ls-tree -r --name-only HEAD | grep -cE '(^|/)\.env($|\.)' || true)
if [ "${SECRETS:-0}" != "0" ]; then
  echo "  ✗ un fichier .env est suivi — NE PAS POUSSER"
  exit 1
fi
echo "  ✓ aucun fichier .env suivi"

cat <<'FIN'

À faire maintenant, à la main :

  cd ../jokswed-preview
  git push -u origin preview

Vercel déploiera automatiquement une Preview depuis cette branche.
`main` — et donc le site en production — n'est pas touché.
FIN
