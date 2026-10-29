#!/bin/sh
# CRM-011 R3: fail if a 12-digit AWS account ID, an AKIA/ASIA access key ID,
# or a hardcoded secret-looking literal shows up under deploy/aws/. Plain
# POSIX sh + grep so it runs the same inside the pinned Terraform container
# (no Node, no AWS CLI) and on a bare WSL/CI shell. Exits 1 and prints every
# match on failure; exits 0 and prints nothing on success.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

fail=0

report() {
  description="$1"
  pattern="$2"
  shift 2
  matches="$(grep -RnE --include='*.tf' --include='*.tfvars' --include='*.tfvars.example' --include='*.md' "$pattern" "$@" . 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    echo "SECRET SCAN: $description"
    echo "$matches"
    fail=1
  fi
}

# 12 consecutive digits as a standalone token: the shape of an AWS account ID.
report "possible AWS account ID literal" '(^|[^0-9])[0-9]{12}([^0-9]|$)' \
  --exclude-dir=.terraform

# AKIA (long-term) / ASIA (temporary/STS) access key ID shape.
report "possible AWS access key ID literal" '\b(AKIA|ASIA)[A-Z0-9]{16}\b' \
  --exclude-dir=.terraform

# A string literal assigned to an attribute/variable whose name reads as a
# secret, with no `${...}` interpolation anywhere in the value. This repo's
# own secrets.tf assigns e.g. `secret_string = "postgres://...${random_
# password.db.result}..."` -- legitimate, since the value is composed at
# apply time from random_password/aws_*, never a literal credential. A
# plain quoted constant with no interpolation at all, on an attribute named
# like a secret, is what this flags.
candidates="$(grep -RniE --include='*.tf' --include='*.tfvars' --include='*.tfvars.example' \
  --exclude-dir=.terraform \
  '(password|secret|token|api_key|apikey|private_key)[a-zA-Z_]*[[:space:]]*=[[:space:]]*"[^"]+"' \
  . 2>/dev/null || true)"
if [ -n "$candidates" ]; then
  literal_only="$(printf '%s\n' "$candidates" | grep -vF '${' || true)"
  if [ -n "$literal_only" ]; then
    echo "SECRET SCAN: possible hardcoded secret literal"
    echo "$literal_only"
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  exit 0
fi

echo "SECRET SCAN: FAILED -- see matches above" >&2
exit 1
