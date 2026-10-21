#!/usr/bin/env bash
#
# Crea (o reconcilia) el usuario IAM de runtime que usa la app en Vercel, con
# permisos SOLO de datos sobre la tabla del stack, e imprime las variables de
# entorno listas para pegar en Vercel.
#
# Ejecutar DESPUÉS de que el workflow deploy-infra.yml haya creado el stack:
# lee el ARN real de la tabla de los outputs para acotar la política.
#
#   ./scripts/setup-aws.sh --profile radamuz
#   ./scripts/setup-aws.sh --profile radamuz --new-key   # rotar credenciales
#
# Idempotente. Sin --new-key no crea claves nuevas si el usuario ya existe
# (AWS limita a 2 access keys por usuario).
#
set -euo pipefail

PROFILE=""
REGION="eu-west-1"
STACK_NAME="yt-data"
USER_NAME="yt-data-vercel"
POLICY_NAME="yt-data-vercel"
NEW_KEY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --region)  REGION="${2:-}"; shift 2 ;;
    --stack)   STACK_NAME="${2:-}"; shift 2 ;;
    --new-key) NEW_KEY="true"; shift ;;
    -h|--help)
      echo "Uso: $0 --profile <perfil> [--region r] [--stack s] [--new-key]"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$PROFILE" ]] && { echo "error: --profile es obligatorio" >&2; exit 1; }

aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

echo "==> Leyendo outputs del stack '$STACK_NAME'…"
TABLE_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='TableArn'].OutputValue" --output text)
TABLE_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)

if [[ -z "$TABLE_ARN" || "$TABLE_ARN" == "None" ]]; then
  echo "error: no se encuentra el stack '$STACK_NAME'. Lanza antes el workflow 'Deploy infra (DynamoDB)'." >&2
  exit 1
fi
echo "    Tabla: $TABLE_NAME"

if ! aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  aws iam create-user --user-name "$USER_NAME" >/dev/null
  echo "==> Usuario IAM '$USER_NAME' creado."
  NEW_KEY="true"
fi

# Solo verbos de datos, y acotados a esta tabla. Nada de CreateTable/DeleteTable:
# si estas credenciales se filtran, no se puede destruir la infraestructura.
#
# Nota: el aislamiento ENTRE usuarios de la app no lo da IAM (todos comparten
# estas credenciales), lo da la clave de partición, que el servidor calcula a
# partir de la sesión. Ver lib/services/videoService.ts.
POLICY_DOC=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
                 "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:DescribeTable"],
      "Resource": ["$TABLE_ARN", "$TABLE_ARN/index/*"]
    }
  ]
}
JSON
)
aws iam put-user-policy --user-name "$USER_NAME" \
  --policy-name "$POLICY_NAME" --policy-document "$POLICY_DOC"
echo "==> Política de datos aplicada a '$USER_NAME'."

echo
echo "──────────────────────────────────────────────────────────────"
echo " Variables para Vercel → Settings → Environment Variables"
echo " (marca Production, Preview y Development)"
echo "──────────────────────────────────────────────────────────────"
echo "AWS_REGION=$REGION"
echo "DYNAMODB_TABLE=$TABLE_NAME"

if [[ "$NEW_KEY" == "true" ]]; then
  CREDS=$(aws iam create-access-key --user-name "$USER_NAME" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  echo "AWS_ACCESS_KEY_ID=$(echo "$CREDS" | cut -f1)"
  echo "AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | cut -f2)"
  echo
  echo " ⚠️  El secret solo se muestra ahora. Cópialo antes de cerrar."
else
  echo "AWS_ACCESS_KEY_ID=<la que ya tengas; usa --new-key para rotarla>"
  echo "AWS_SECRET_ACCESS_KEY=<idem>"
fi

cat <<'TXT'

Y además, del OAuth client de Google (ver README):
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=<client id>
AUTH_GOOGLE_SECRET=<client secret>
AUTH_TRUST_HOST=true

No definas AUTH_URL.
TXT
