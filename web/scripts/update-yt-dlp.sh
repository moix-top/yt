#!/usr/bin/env bash
#
# Baja la última versión oficial de yt-dlp a web/.bin/yt-dlp, que es la que usa
# la página de Descargas si existe. La de apt se queda vieja enseguida y
# YouTube la rompe (HTTP 403): ejecútalo cuando las descargas empiecen a fallar.
#
#   web/scripts/update-yt-dlp.sh
set -euo pipefail

BIN="$(cd "$(dirname "$0")/.." && pwd)/.bin"
mkdir -p "$BIN"
curl -fsSL -o "$BIN/yt-dlp.tmp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
chmod +x "$BIN/yt-dlp.tmp"
mv "$BIN/yt-dlp.tmp" "$BIN/yt-dlp"
echo "yt-dlp $("$BIN/yt-dlp" --version) en $BIN/yt-dlp"
