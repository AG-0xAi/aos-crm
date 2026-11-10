#!/usr/bin/env bash
# CRM-035: run this from AWS CloudShell (the platform session cannot create
# an IAM user or an access key). Creates the IAM user the Lambda driver's AWS
# SDK client authenticates as, scopes its inline policy to exactly the
# actions/resources CRM-035's evidence table lists, and writes its access key
# straight into the two Secrets Manager secrets `deploy/aws/logic-function.tf`
# creates empty. Re-running is safe: the policy is always overwritten with
# this script's current template, and a second access key is only ever
# created with --rotate.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
policy_template="${script_dir}/policy-template.json"

usage() {
  cat <<'EOF'
Usage: create-user.sh --region <aws-region> --environment <env> \
  --name-prefix <prefix> --exec-role-arn <arn> --layer-bucket <bucket> \
  --permissions-boundary-arn <arn> [--rotate]

All of --name-prefix/--exec-role-arn/--layer-bucket come straight out of
`terraform output` in deploy/aws (logic_function_name_prefix,
logic_function_exec_role_arn, logic_function_layers_bucket).
--permissions-boundary-arn is the account's aos-limite-roles ARN (CRM-027).
--rotate replaces an existing access key instead of refusing to run.
EOF
}

region=""
environment=""
name_prefix=""
exec_role_arn=""
layer_bucket=""
permissions_boundary_arn=""
rotate="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --region)
      region="$2"
      shift 2
      ;;
    --environment)
      environment="$2"
      shift 2
      ;;
    --name-prefix)
      name_prefix="$2"
      shift 2
      ;;
    --exec-role-arn)
      exec_role_arn="$2"
      shift 2
      ;;
    --layer-bucket)
      layer_bucket="$2"
      shift 2
      ;;
    --permissions-boundary-arn)
      permissions_boundary_arn="$2"
      shift 2
      ;;
    --rotate)
      rotate="true"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$region" ] || [ -z "$environment" ] || [ -z "$name_prefix" ] ||
  [ -z "$exec_role_arn" ] || [ -z "$layer_bucket" ] || [ -z "$permissions_boundary_arn" ]; then
  echo "Missing one or more required arguments." >&2
  usage >&2
  exit 1
fi

account_id="$(aws sts get-caller-identity --query Account --output text)"
user_name="aos-crm-${environment}-logic-function"
access_key_id_secret_name="aos-crm/${environment}/logic-function-access-key-id"
secret_access_key_secret_name="aos-crm/${environment}/logic-function-secret-access-key"

policy_document="$(
  sed \
    -e "s#__REGION__#${region}#g" \
    -e "s#__ACCOUNT_ID__#${account_id}#g" \
    -e "s#__NAME_PREFIX__#${name_prefix}#g" \
    -e "s#__EXEC_ROLE_ARN__#${exec_role_arn}#g" \
    -e "s#__LAYER_BUCKET__#${layer_bucket}#g" \
    "$policy_template"
)"

if aws iam get-user --user-name "$user_name" >/dev/null 2>&1; then
  echo "User ${user_name} already exists; its inline policy will be overwritten below."
else
  echo "Creating user ${user_name}."
  # A permissions boundary only caps what the user's own identity-based
  # policy (put below) can grant -- it adds nothing by itself, and it does
  # not block any action this user takes as a *principal* (sign-in,
  # console access, calling an API its own policy allows). If
  # aos-limite-roles (CRM-027) were ever to disallow one of this policy's
  # actions, IAM would evaluate to the intersection of the two: the next
  # API call using that action would fail closed with AccessDenied, not
  # silently widen to whatever the boundary alone would have allowed.
  aws iam create-user \
    --user-name "$user_name" \
    --permissions-boundary "$permissions_boundary_arn" >/dev/null
fi

aws iam put-user-policy \
  --user-name "$user_name" \
  --policy-name "logic-function-lambda" \
  --policy-document "$policy_document"

existing_key_ids="$(aws iam list-access-keys --user-name "$user_name" --query 'AccessKeyMetadata[*].AccessKeyId' --output text)"

if [ -n "$existing_key_ids" ] && [ "$rotate" != "true" ]; then
  echo "User ${user_name} already has an access key. Re-run with --rotate to replace it." >&2
  exit 1
fi

previous_xtrace_state="$(set +o | grep xtrace)"
set +x

access_key_id=""
secret_access_key=""

# If put-secret-value fails after create-access-key already succeeded, this
# would otherwise leave a live access key that was never stored anywhere:
# nobody could use it, but nobody could find and delete it either. The trap
# deletes it and keeps the key out of the error output; `set +x` is reasserted
# here because a failing command re-enables the caller's xtrace state before
# the trap runs.
cleanup_new_key_on_failure() {
  set +x
  if [ -n "$access_key_id" ]; then
    aws iam delete-access-key --user-name "$user_name" --access-key-id "$access_key_id" >/dev/null 2>&1 || true
    echo "Failed to store the new access key in Secrets Manager; deleted the just-created access key to avoid leaving an orphaned credential. Re-run this script." >&2
  fi
}
trap cleanup_new_key_on_failure EXIT

access_key_pair="$(aws iam create-access-key --user-name "$user_name" --query '[AccessKey.AccessKeyId, AccessKey.SecretAccessKey]' --output text)"
access_key_id="${access_key_pair%%$'\t'*}"
secret_access_key="${access_key_pair#*$'\t'}"

# The key goes through a pipe, not argv, so it never shows up in `ps` while
# the call runs. printf adds no trailing newline to the stored value.
printf '%s' "$access_key_id" | aws secretsmanager put-secret-value \
  --secret-id "$access_key_id_secret_name" \
  --secret-string file:///dev/stdin >/dev/null
printf '%s' "$secret_access_key" | aws secretsmanager put-secret-value \
  --secret-id "$secret_access_key_secret_name" \
  --secret-string file:///dev/stdin >/dev/null

trap - EXIT
unset access_key_pair access_key_id secret_access_key
eval "$previous_xtrace_state"
unset previous_xtrace_state

if [ -n "$existing_key_ids" ]; then
  for old_key_id in $existing_key_ids; do
    aws iam delete-access-key --user-name "$user_name" --access-key-id "$old_key_id"
  done
fi

echo "user: ${user_name}"
echo "secret: ${access_key_id_secret_name}"
echo "secret: ${secret_access_key_secret_name}"
