#!/usr/bin/env bash
#
# Crea la clave con la que se firman los APK y la sube como secretos del repo.
# Se ejecuta UNA vez. Guarda android-yt.jks y la contraseña en sitio seguro: si se
# pierde, el móvil no aceptará actualizaciones y habrá que desinstalar (perdiendo
# lo que no esté sincronizado).
#
#   android/scripts/setup-signing.sh --repo moix-top/yt
#
# Y, si quieres el arreglo automático con IA cuando upstream rompa los parches:
#   gh secret set GLM_API_KEY --repo moix-top/yt          # te pide el valor
#   gh variable set GLM_MODEL --repo moix-top/yt --body glm-5.3       # opcional
#   gh variable set GLM_BASE_URL --repo moix-top/yt --body https://…  # opcional
set -euo pipefail

REPO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    *) echo "Uso: $0 --repo <owner/repo>" >&2; exit 1 ;;
  esac
done
[[ -z "$REPO" ]] && { echo "error: --repo es obligatorio" >&2; exit 1; }

KS="android-yt.jks"
[[ -e "$KS" ]] && { echo "error: $KS ya existe; no lo sobrescribo" >&2; exit 1; }
PASS=$(openssl rand -base64 24)

keytool -genkeypair -keystore "$KS" -alias yt -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=yt.moix.top"

base64 -w0 "$KS" | gh secret set ANDROID_KEYSTORE_B64 --repo "$REPO"
gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO" --body "$PASS"
gh secret set ANDROID_KEY_PASSWORD --repo "$REPO" --body "$PASS"
gh secret set ANDROID_KEY_ALIAS --repo "$REPO" --body yt

echo "==> Secretos subidos. Guarda $KS y esta contraseña fuera del repo:"
echo "    $PASS"
