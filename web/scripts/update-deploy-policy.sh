#!/usr/bin/env bash
#
# Reaplica la política IAM del usuario de despliegue (yt-data-deploy) sin
# tocar sus credenciales.
#
# Existe aparte de setup-github-secrets.sh porque aquel crea una access key
# nueva en cada ejecución (AWS solo permite 2 por usuario) y obliga a resubir
# los secretos del repo. Cuando lo único que cambia son los permisos —porque
# infra/dynamodb.yml estrena una propiedad que exige una acción nueva— esto es
# lo que hay que ejecutar.
#
#   ./scripts/update-deploy-policy.sh --profile radamuz
#
# Después, relanza el workflow "Deploy infra (DynamoDB)" en GitHub Actions.
#
# La política es la MISMA que la de setup-github-secrets.sh: si tocas una,
# toca la otra.
#
set -euo pipefail

PROFILE=""
REGION="eu-west-1"
USER_NAME="yt-data-deploy"
POLICY_NAME="yt-data-deploy"
STACK_NAME="yt-data"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --region)  REGION="${2:-}"; shift 2 ;;
    --stack)   STACK_NAME="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: $0 --profile <perfil> [--region r] [--stack s]"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$PROFILE" ]] && { echo "error: --profile es obligatorio" >&2; exit 1; }

aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "==> Cuenta $ACCOUNT_ID, región $REGION, usuario $USER_NAME"

if ! aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "error: el usuario '$USER_NAME' no existe. Ejecuta antes scripts/setup-github-secrets.sh." >&2
  exit 1
fi

# Sin verbos de datos (GetItem/PutItem/Query…): quien despliega la
# infraestructura no tiene por qué poder leer el historial de nadie.
#
# UpdateTimeToLive / DescribeTimeToLive hacen falta desde que la tabla declara
# TimeToLiveSpecification (infra/dynamodb.yml), que es lo que caduca las
# particiones desechables del modo demo.
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

echo "==> Política '$POLICY_NAME' actualizada."
echo
echo "Comprueba que la acción ya está permitida:"
echo "  aws iam simulate-principal-policy --profile $PROFILE \\"
echo "    --policy-source-arn arn:aws:iam::$ACCOUNT_ID:user/$USER_NAME \\"
echo "    --action-names dynamodb:UpdateTimeToLive \\"
echo "    --resource-arns arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/$STACK_NAME \\"
echo "    --query 'EvaluationResults[0].EvalDecision' --output text"
echo
echo "Y relanza el workflow 'Deploy infra (DynamoDB)' en GitHub Actions."
