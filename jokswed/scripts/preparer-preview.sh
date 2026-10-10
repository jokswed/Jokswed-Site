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
  echo "✓ Branche preview prête : $(git rev-parse --short HEAD)"
fi

echo
echo "Vérifications :"
echo "  fichiers sous jokswed/ : $(git ls-tree -r --name-only HEAD jokswed | wc -l | tr -d ' ')"
# ⚠️ `.env.example` EST UN GABARIT, ET IL DOIT ÊTRE SUIVI : c'est lui qui
#    documente les variables attendues. Le motif précédent l'attrapait et
#    refusait toute poussée. On écarte donc les exemples par leur nom, et on
#    relit malgré tout leur contenu : un gabarit où quelqu'un aurait collé une
#    vraie valeur serait un secret publié.
SECRETS=$(git ls-tree -r --name-only HEAD \
  | grep -E '(^|/)\.env($|\.)' \
  | grep -vE '\.env\.(example|sample|template)$' \
  | wc -l | tr -d ' ' || true)
if [ "${SECRETS:-0}" != "0" ]; then
  echo "  ✗ un fichier .env est suivi — NE PAS POUSSER"
  git ls-tree -r --name-only HEAD | grep -E '(^|/)\.env($|\.)' \
    | grep -vE '\.env\.(example|sample|template)$' | sed 's/^/     /'
  exit 1
fi
SUSPECTS=0
for f in $(git ls-tree -r --name-only HEAD | grep -E '\.env\.(example|sample|template)$' || true); do
  # Une clé Resend ou Brevo complète, ou une chaîne pointant un vrai hôte
  # Neon : dans un gabarit, ce ne peut être qu'un oubli.
  if git show "HEAD:$f" | grep -qE 're_[A-Za-z0-9]{12,}|xkeysib-[A-Za-z0-9]{12,}|postgres(ql)?://[^@[:space:]]*@[^/[:space:]]*neon\.tech'; then
    echo "  ✗ $f semble contenir une vraie valeur — NE PAS POUSSER"
    SUSPECTS=1
  fi
done
[ "$SUSPECTS" = "0" ] || exit 1
echo "  ✓ aucun fichier .env suivi (hors gabarits, relus et sans valeur réelle)"

cat <<'FIN'

À faire maintenant, à la main :

  cd ../jokswed-preview
  git push -u origin preview

Vercel déploiera automatiquement une Preview depuis cette branche.
`main` — et donc le site en production — n'est pas touché.
FIN
