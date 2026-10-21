#!/usr/bin/env bash
#
# Monta el árbol del fork: NewPipe en la versión pedida + overlay/ + patches/.
#
#   android/scripts/prepare.sh v0.29.1          # deja el árbol en android/upstream
#
# Sale con 2 si algún parche no aplica (el workflow lo distingue de un fallo de
# red para saber si tiene sentido pedirle el arreglo a la IA). Los parches se
# aplican con --3way: un cambio de upstream en líneas vecinas no los rompe.
set -euo pipefail

TAG="${1:?uso: prepare.sh <tag de NewPipe>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HERE/upstream"

rm -rf "$DIR"
git clone -q --depth 1 --branch "$TAG" https://github.com/TeamNewPipe/NewPipe.git "$DIR"
cd "$DIR"
# --3way necesita identidad y un commit base con el que comparar.
git config user.email "yt-bot@moix.top"
git config user.name "yt-bot"

cp -r "$HERE/overlay/." "$DIR/"

failed=0
for p in "$HERE"/patches/*.patch; do
  if git apply --3way "$p" 2>"$HERE/build/apply-$(basename "$p").log"; then
    echo "✓ $(basename "$p")"
  else
    echo "✗ $(basename "$p")"; cat "$HERE/build/apply-$(basename "$p").log"
    failed=1
  fi
done
[[ $failed -eq 0 ]] || exit 2
