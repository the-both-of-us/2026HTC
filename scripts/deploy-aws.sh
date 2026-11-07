#!/usr/bin/env bash
# Deploys OryxLearn to Amazon ECS Express Mode. Safe to run again: it creates what
# is missing and updates the rest. Needs `aws login` and a running Docker.
#
#   scripts/deploy-aws.sh                         deploys to ca-central-1
#   AWS_REGION=us-west-2 scripts/deploy-aws.sh    deploys somewhere else
#
# Secret values are read from .env.local and .env.voice and only ever go to AWS
# Secrets Manager, through a private temp file. This script prints names, not values.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_REGION="${AWS_REGION:-ca-central-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""

APP=oryxlearn
CLUSTER=default
PORT=3000
# The AI routes can take 120 s. An ALB's default 60 s idle timeout would cut them off.
ALB_IDLE_SECONDS=130
SECRET_NAMES=(CEREBRAS_API_KEY GROQ_API_KEY GEMINI_API_KEY BEDROCK_API_KEY SESSION_SECRET DEEPGRAM_API_KEY ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID)
# Optional settings that aren't secret, passed as plain environment variables.
PLAIN_NAMES=(GEMINI_MODEL BEDROCK_REGION BEDROCK_MODEL)

step() { printf '\n==> %s\n' "$1"; }

# Prints a value from the env files, ignoring comments. The files are never run as code.
env_value() {
  local file value
  for file in .env.local .env.voice; do
    [ -f "$file" ] || continue
    value=$(grep -E "^(export )?$1=" "$file" | tail -n 1 | cut -d= -f2-) || true
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    if [ -n "$value" ]; then printf '%s' "$value"; return 0; fi
  done
}

ensure_role() { # name, service allowed to assume it
  aws iam get-role --role-name "$1" >/dev/null 2>&1 || aws iam create-role --role-name "$1" \
    --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$2\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
  aws iam get-role --role-name "$1" --query Role.Arn --output text
}

step "Checking AWS and Docker"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
docker info >/dev/null
echo "Account $ACCOUNT, region $AWS_REGION"
if [ "$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'length(Vpcs)' --output text)" = "0" ]; then
  echo "This region has no default VPC, which Express Mode needs. Run: aws ec2 create-default-vpc" >&2
  exit 1
fi

BUCKET="${S3_BUCKET:-$APP-$ACCOUNT-$AWS_REGION}"
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
SERVICE_ARN="arn:aws:ecs:$AWS_REGION:$ACCOUNT:service/$CLUSTER/$APP"

step "S3 bucket $BUCKET (private)"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

step "ECR repository $APP"
aws ecr describe-repositories --repository-names "$APP" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$APP" >/dev/null

step "IAM roles"
EXECUTION_ROLE=$(ensure_role "$APP-execution" ecs-tasks.amazonaws.com)
INFRASTRUCTURE_ROLE=$(ensure_role "$APP-infrastructure" ecs.amazonaws.com)
TASK_ROLE=$(ensure_role "$APP-task" ecs-tasks.amazonaws.com)

aws iam attach-role-policy --role-name "$APP-execution" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam attach-role-policy --role-name "$APP-infrastructure" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
# The execution role fetches secrets at startup, and only this app's.
aws iam put-role-policy --role-name "$APP-execution" --policy-name read-app-secrets --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT:secret:$APP/*\"}]}"
# The app itself can reach this one bucket and nothing else. ListBucket is what makes
# S3 report a missing key as NoSuchKey instead of AccessDenied.
aws iam put-role-policy --role-name "$APP-task" --policy-name use-app-bucket --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",\"Resource\":\"arn:aws:s3:::$BUCKET\"},{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/*\"}]}"

step "Secrets"
SECRET_DIR=$(umask 077; mktemp -d)
trap 'rm -rf "$SECRET_DIR"' EXIT
SECRET_FILE="$SECRET_DIR/value"
SECRET_PAIRS=""
for name in "${SECRET_NAMES[@]}"; do
  id="$APP/$name"
  value=$(env_value "$name")
  exists=$(aws secretsmanager describe-secret --secret-id "$id" --query ARN --output text 2>/dev/null || true)
  # Keep SESSION_SECRET stable across deploys, since changing it signs everyone out.
  if [ -z "$value" ] && [ -z "$exists" ] && [ "$name" = "SESSION_SECRET" ]; then
    value=$(openssl rand -base64 48)
    echo "$name: generated a new one"
  fi

  if [ -n "$value" ]; then
    printf '%s' "$value" > "$SECRET_FILE"
    if [ -n "$exists" ]; then
      aws secretsmanager put-secret-value --secret-id "$id" --secret-string "file://$SECRET_FILE" >/dev/null
    else
      aws secretsmanager create-secret --name "$id" --secret-string "file://$SECRET_FILE" >/dev/null
    fi
    echo "$name: saved"
  elif [ -n "$exists" ]; then
    echo "$name: keeping the one already in AWS"
  else
    echo "$name: not set, skipping"
    continue
  fi
  value=""
  arn=$(aws secretsmanager describe-secret --secret-id "$id" --query ARN --output text)
  SECRET_PAIRS="$SECRET_PAIRS$name=$arn"$'\n'
done

step "Building and pushing the arm64 image"
IMAGE="$REGISTRY/$APP:$(git rev-parse --short HEAD)-$(date +%s)"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker build --platform linux/arm64 -t "$IMAGE" .
docker push "$IMAGE" >/dev/null
echo "$IMAGE"

PLAIN_PAIRS="S3_BUCKET=$BUCKET"$'\n'"AWS_REGION=$AWS_REGION"$'\n'
for name in "${PLAIN_NAMES[@]}"; do
  value=$(env_value "$name")
  if [ -n "$value" ]; then PLAIN_PAIRS="$PLAIN_PAIRS$name=$value"$'\n'; fi
done

# Only names, ARNs and non-secret settings go into this.
CONTAINER=$(IMAGE="$IMAGE" PORT="$PORT" SECRET_PAIRS="$SECRET_PAIRS" PLAIN_PAIRS="$PLAIN_PAIRS" python3 -c '
import json, os
pairs = lambda name: [line.split("=", 1) for line in os.environ[name].splitlines() if line]
print(json.dumps({
    "image": os.environ["IMAGE"],
    "containerPort": int(os.environ["PORT"]),
    "environment": [{"name": k, "value": v} for k, v in pairs("PLAIN_PAIRS")],
    "secrets": [{"name": k, "valueFrom": v} for k, v in pairs("SECRET_PAIRS")],
}))')

# shellcheck disable=SC2054  # The commas belong to one --scaling-target value.
SETTINGS=(
  --execution-role-arn "$EXECUTION_ROLE"
  --task-role-arn "$TASK_ROLE"
  --health-check-path /api/health
  --primary-container "$CONTAINER"
  --cpu 1024
  --memory 2048
  --cpu-architecture ARM64
  --scaling-target minTaskCount=1,maxTaskCount=2,autoScalingMetric=AVERAGE_CPU,autoScalingTargetValue=60
)

STATUS=$(aws ecs describe-express-gateway-service --service-arn "$SERVICE_ARN" \
  --query service.status.statusCode --output text 2>/dev/null || echo NONE)

if [ "$STATUS" = "ACTIVE" ]; then
  step "Updating the Express service"
  aws ecs update-express-gateway-service --service-arn "$SERVICE_ARN" "${SETTINGS[@]}" >/dev/null
  echo "The new version replaces the old one over the next few minutes."
else
  step "Creating the Express service"
  # New IAM roles can take about a minute to be usable, so retry for a few minutes.
  for attempt in 1 2 3 4 5 6 7 8; do
    if aws ecs create-express-gateway-service --service-name "$APP" --cluster "$CLUSTER" \
      --infrastructure-role-arn "$INFRASTRUCTURE_ROLE" "${SETTINGS[@]}" >/dev/null; then
      break
    fi
    if [ "$attempt" = 8 ]; then echo "Could not create the service." >&2; exit 1; fi
    echo "Not ready yet, so trying again in 30 s ($attempt of 8)"
    sleep 30
  done
fi

step "Waiting for the site (the first deploy can take over 10 minutes)"
describe() {
  aws ecs describe-express-gateway-service --service-arn "$SERVICE_ARN" --query "$1" --output text 2>/dev/null || true
}
ENDPOINT=""
HEALTHY=no
for _ in $(seq 1 120); do
  ENDPOINT=$(describe 'service.activeConfigurations[0].ingressPaths[0].endpoint')
  if [ -n "$ENDPOINT" ] && [ "$ENDPOINT" != "None" ]; then
    URL="https://${ENDPOINT#https://}"
    if curl -fsS -m 10 "$URL/api/health" >/dev/null 2>&1; then HEALTHY=yes; break; fi
  fi
  sleep 15
done
if [ "$HEALTHY" = no ]; then
  echo "The site did not answer in 30 minutes. Check with:" >&2
  echo "  aws ecs monitor-express-gateway-service --service-arn $SERVICE_ARN --mode TEXT-ONLY --resource-view RESOURCE" >&2
  exit 1
fi

step "Raising the load balancer's idle timeout to $ALB_IDLE_SECONDS s"
# Express Mode's own role has no permission to change this attribute, so it stays as set.
# The ALB is shared with any other Express service in this VPC. There are none here.
REVISION=$(describe 'service.activeConfigurations[0].serviceRevisionArn')
ALB_ARN=$(aws ecs describe-service-revisions --service-revision-arns "$REVISION" \
  --query 'serviceRevisions[0].ecsManagedResources.ingressPaths[0].loadBalancer.arn' --output text)
aws elbv2 modify-load-balancer-attributes --load-balancer-arn "$ALB_ARN" \
  --attributes "Key=idle_timeout.timeout_seconds,Value=$ALB_IDLE_SECONDS" >/dev/null
ACTUAL=$(aws elbv2 describe-load-balancer-attributes --load-balancer-arn "$ALB_ARN" \
  --query "Attributes[?Key=='idle_timeout.timeout_seconds'].Value | [0]" --output text)
if [ "$ACTUAL" != "$ALB_IDLE_SECONDS" ]; then
  echo "The idle timeout is $ACTUAL s, so AI routes may be cut off." >&2
  exit 1
fi
echo "Idle timeout is $ACTUAL s"

step "Done"
echo "$URL"
