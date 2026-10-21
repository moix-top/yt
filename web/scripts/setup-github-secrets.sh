#!/usr/bin/env bash
#
# Crea el usuario IAM que usa el pipeline de GitHub Actions para desplegar el
# stack de CloudFormation (deploy-infra.yml) y sube sus credenciales como
# secretos del repo con `gh`.
#
# Está separado del usuario de runtime a propósito: este puede crear y modificar
# la tabla pero NO leer ni escribir datos; el de Vercel (scripts/setup-aws.sh)
# puede leer y escribir datos pero no tocar la infraestructura.
#
#   ./scripts/setup-github-secrets.sh --profile radamuz --repo moix-top/yt
#
# Idempotente: se puede volver a ejecutar. Ojo: cada ejecución crea una access
# key nueva (AWS permite 2 por usuario como máximo).
#
set -euo pipefail

PROFILE=""
REGION="eu-west-1"
REPO=""
USER_NAME="yt-data-deploy"
POLICY_NAME="yt-data-deploy"
STACK_NAME="yt-data"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --region)  REGION="${2:-}"; shift 2 ;;
    --repo)    REPO="${2:-}"; shift 2 ;;
    --stack)   STACK_NAME="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: $0 --profile <perfil> --repo <owner/repo> [--region r] [--stack s]"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$PROFILE" || -z "$REPO" ]] && { echo "error: --profile y --repo son obligatorios" >&2; exit 1; }

aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "==> Cuenta $ACCOUNT_ID, región $REGION, repo $REPO"

if ! aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  aws iam create-user --user-name "$USER_NAME" >/dev/null
  echo "==> Usuario IAM '$USER_NAME' creado."
fi

# Sin verbos de datos (GetItem/PutItem/Query…): quien despliega la
# infraestructura no tiene por qué poder leer el historial de nadie.
POLICY_DOC=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["cloudformation:*"],
      "Resource": "arn:aws:cloudformation:$REGION:$ACCOUNT_ID:stack/$STACK_NAME/*"
    },
    { "Effect": "Allow", "Action": ["cloudformation:ValidateTemplate"], "Resource": "*" },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DescribeTable",
                 "dynamodb:UpdateContinuousBackups", "dynamodb:DescribeContinuousBackups",
                 "dynamodb:UpdateTimeToLive", "dynamodb:DescribeTimeToLive",
                 "dynamodb:TagResource", "dynamodb:ListTagsOfResource"],
      "Resource": "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/$STACK_NAME*"
    }
  ]
}
JSON
)
aws iam put-user-policy --user-name "$USER_NAME" \
  --policy-name "$POLICY_NAME" --policy-document "$POLICY_DOC"

echo "==> Creando access key y subiéndola como secretos de GitHub…"
CREDS=$(aws iam create-access-key --user-name "$USER_NAME" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
KEY_ID=$(echo "$CREDS" | cut -f1)
SECRET=$(echo "$CREDS" | cut -f2)

gh secret set AWS_ACCESS_KEY_ID --repo "$REPO" --body "$KEY_ID"
gh secret set AWS_SECRET_ACCESS_KEY --repo "$REPO" --body "$SECRET"

echo "==> Listo. Ya puedes lanzar el workflow 'Deploy infra (DynamoDB)' en GitHub."
echo "    Después, ejecuta ./scripts/setup-aws.sh --profile $PROFILE"
