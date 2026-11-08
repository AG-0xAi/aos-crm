# CRM-027: permissions boundary declared on the four task roles (08/11/2026)

Base commit `09fd0f4548`, worktree `.aos/worktrees/2026-11-08T16-32-54-609Z-CRM-027-8969baef`.
All commands run from the repo root unless noted; Docker with `--network none` (except `init`,
which needs the Terraform Registry), `--user "$(id -u):$(id -g)"`, `-e AWS_EC2_METADATA_DISABLED=true`
and no AWS credentials mounted or passed, same posture as `AWS_DEPLOYMENT_PLAN.md`'s own prior
runs. Terraform image pinned by digest, the same one already used in that doc:
`hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd`
(Terraform v1.9.8), already present locally so `init` made no registry call for the image itself,
only for the `aws`/`random` provider plugins (reused from the lock file, no new download).

## `terraform fmt -check -recursive`

```
$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (no output: everything already canonical)
```

## `terraform init -backend=false`

```
$ docker run --rm --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
exit 0 ("Terraform has been successfully initialized!"; reused hashicorp/aws 5.100.0 and
hashicorp/random 3.9.1 from the existing dependency lock file)
```

Run without `--network none`: `init` needs the Terraform Registry for providers. No `AWS_*`
variable was set and no AWS credentials were mounted, so this made no call to AWS itself.

## `terraform validate`

```
$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
exit 0 ("Success! The configuration is valid.")
```

`validate` does not accept a `-var` flag (confirmed: `docker run ... validate -var
permissions_boundary_arn=...` fails with "flag provided but not defined: -var") and, like every
other no-default variable in `variables.tf`, does not need one: it only type-checks
`permissions_boundary_arn`, it does not evaluate its validation block against a real value.

## `sh deploy/aws/scripts/scan-secrets.sh`

```
$ sh deploy/aws/scripts/scan-secrets.sh
exit 0 (no output: no 12-digit account id, no AKIA/ASIA access key id, no hardcoded secret literal)
```

The first draft of `terraform.tfvars.example` used the literal `123456789012` as the
`permissions_boundary_arn` placeholder (AWS's own documentation example account id). This scanner
treats any standalone 12-digit run across `deploy/aws/**/*.{tf,tfvars,tfvars.example,md}` as a
possible real account id with no allowlist, and the dispatch's own rule for this track is "never
write the boundary ARN or an account id in any file" — so that first draft failed this scan with:

```
SECRET SCAN: possible AWS account ID literal
./variables.tf:44:    error_message = "permissions_boundary_arn must look like an IAM policy ARN, e.g. arn:aws:iam::123456789012:policy/aos-limite-roles."
./terraform.tfvars.example:16:permissions_boundary_arn = "arn:aws:iam::123456789012:policy/aos-limite-roles"
SECRET SCAN: FAILED -- see matches above
```

Fixed by replacing the digit placeholder with `REPLACE_ME` (the same convention
`terraform.tfvars.example` already uses for `domain_name`/`budget_alert_email`) and by rewording
`variables.tf`'s `error_message` to describe the ARN shape in words instead of a concrete 12-digit
example. `scan-secrets.sh` itself was left untouched: the fix is in the two files that carried the
digits, not in the gate.

## `node scripts/aos/verify-privacy.mjs`

```
$ node scripts/aos/verify-privacy.mjs
PASS: all 15 privacy checks passed.
exit 0
```

Unaffected by this track (no `privacy.env`/telemetry file touched); run to confirm this change did
not regress it.

## Scope check: only four `aws_iam_role` resources exist

```
$ grep -rn 'aws_iam_role\b' --include='*.tf' deploy/aws/
```

Matched only `ecs_task_execution`, `ecs_task_server`, `ecs_task_worker` and `ecs_task_migrate` in
`iam.tf` (plus their own references in `ecs.tf`/`iam.tf`) — no fifth role exists anywhere else
under `deploy/aws`, so all four already in scope got the boundary and none was missed.

## Out of scope, left as-is

- `iam.tf`'s `UseBucketDefaultKmsKey` statement still authorizes on
  `arn:aws:kms:...:alias/aws/s3`. KMS grants authorize on the **key**, not the alias — an alias ARN
  in an IAM policy resolves to the underlying key at evaluation time, so this statement already
  reaches the right key. Changing it to the key's own ARN is a separate, unrelated cleanup; left
  untouched per the dispatch.
- `aws_iam_user.ses_smtp` (`ses.tf`) got no permissions boundary: the dispatch scoped this track to
  `aws_iam_role` resources only. IAM users are a different principal type for a boundary, and
  rotating that user is now out of agents' reach anyway (see the docs note below), so widening this
  track's scope to it was not warranted.
