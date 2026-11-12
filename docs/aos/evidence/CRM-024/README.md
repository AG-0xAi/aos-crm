# CRM-024 evidence (08/11/2026)

R4: static validation only, no `terraform apply`, no real AWS mutation. One
command in round 1, and one in round 3, below (both marked explicitly)
reached AWS by surprise; everything else ran exactly as planned, with
commands and exit codes transcribed from the real run, not written by hand
afterward.

Terraform CLI used everywhere below: `hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd`
(1.9.8, the same pinned digest `deploy/aws/README.md` and
`AWS_DEPLOYMENT_PLAN.md` R4 already use). actionlint:
`rhysd/actionlint:latest` (resolved to v1.7.12 at pull time).

## Round 4 (12/11/2026): class-wildcard reads, permissions boundary, IAM stop, no network at all

Three rounds patched the refresh-read list one action at a time
(`elasticache:DescribeCacheParameters`, `budgets:ListTagsForResource`, ...)
and still weren't done. This round closes the class instead: `policy.tf`'s
read statements are now `<service>:Describe*`/`List*`/`Get*`/`View*`
wildcards, scoped to this stack's own ARNs wherever that service supports
resource-level permissions for reads, `*` only where it categorically does
not (documented statement by statement, same method, now a wildcard instead
of an enumerated list). Also this round: merged this track's own prior tip
(`8eb07f9282`) onto the current `betty/factory` (one conflict, in
`BETA_RUNBOOK.md` -- both sides' new sections kept, renumbered §10-§13);
re-derived the role's reads for what `deploy/aws` gained since that tip
(the logic-function IAM role, S3 bucket and Secrets Manager secrets,
CRM-035); added `permissions_boundary_arn` to this stack and set it on
`aws_iam_role.deploy`, matching every other `aos-*` role since CRM-027; added
an IAM-change stop to `deploy-beta.yaml`, between `plan` and `apply`; wired
`signup_webhook_url` into the plan step as `TF_VAR_signup_webhook_url` from a
dedicated `SIGNUP_WEBHOOK_URL` environment secret.

### Hard rule this round: no network to AWS at all, not even with fake credentials

Round 3's own probe 2 (below, kept for the record) reached real AWS with a
throwaway, invalid static key, because the AWS provider's `Configure` step
calls `sts:GetCallerIdentity` to validate *any* credential before building a
plan graph, network-enabled containers included. This round's dispatch
closes that path outright: every Terraform/AWS-adjacent container below ran
with `docker run --network none`, `AWS_EC2_METADATA_DISABLED=true` and empty
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`. A container
with no network cannot reach AWS by surprise the way round 1's instance-role
path or round 3's fake-key probe did, regardless of what credentials (real,
fake, or none) the provider is configured with.

The one problem `--network none` creates: `terraform init` normally
downloads the provider plugin from `registry.terraform.io`, which a
network-isolated container cannot reach either. Solved by reusing the
`hashicorp/aws` 5.100.0 (and, for `deploy/aws`, `hashicorp/random` 3.9.1)
provider binaries a previous round's worktree already downloaded on this
same machine (`.terraform/providers/registry.terraform.io/...`, from a run
that *did* have network) as a local filesystem plugin source
(`-plugin-dir=<path>` for `init`, the same directory bind-mounted straight
onto `.terraform/providers` for `validate`) -- no new network call, nothing
re-fetched, same exact provider build both `.terraform.lock.hcl` files
already pin.

### Why `permission-policy.example.json` can now be generated, and `trust-policy.example.json` still can't

Round 2 and round 3 both concluded `terraform console`/`plan` couldn't
render either policy document without a real credential, because the AWS
provider's `Configure` step needs *some* credential source before it will
evaluate anything in the config, data sources included -- round 3's probe 1
(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` both empty) got exactly that
error (`No valid credential sources found`), independent of `-target`.

That blocker is specific to *finding* a credential, not to validating one:
the AWS provider exposes `skip_credentials_validation`,
`skip_requesting_account_id` and `skip_metadata_api_check`, which together
let it configure against throwaway static values
(`access_key = "AKIAEXAMPLE00000000"`, an all-zero `secret_key`) without
ever calling an AWS API to check them. `data.aws_iam_policy_document` itself
already made no AWS call in round 1's own finding (`Read complete after
0s`) -- it is a pure function of its own HCL. Combined, this renders
`permission-policy.example.json` by a real `terraform plan`/`show -json`,
fully offline, from a standalone scratch config holding a direct copy of
`policy.tf`'s `locals`/`data` block (never committed, built and discarded
in this run's worktree-local temp dir) plus the same example variables
rounds 1-3 used by hand. This is the "local copy of the policy document
only" the dispatch allows when an OIDC-backed render is not possible.

`trust-policy.example.json` is unaffected and still hand-rendered, for the
reason rounds 1-2 already found and this round re-confirms: its one data
source, `data.aws_iam_openid_connect_provider.github`, is a genuine AWS
lookup (`iam:ListOpenIDConnectProviders`/`GetOpenIDConnectProvider`) for the
account's real OIDC provider ARN -- a value no skip-flag or local copy can
substitute, because it is not computed from this stack's own HCL at all.

```sh
export AWS_EC2_METADATA_DISABLED=true AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= \
  AWS_SESSION_TOKEN= AWS_PROFILE= AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
TF_IMG="hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd"
```
Set in every `docker run` below (as `-e`) unless the command's own line
overrides it.

#### R1/R4. `fmt -check -recursive`, `init -backend=false`, `validate` -- `github-deploy-role`, after the `policy.tf`/`variables.tf`/`role.tf` edits, `--network none`

```
$ docker run --rm --network none -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w "$TF_IMG" fmt -check -recursive -diff
```
Exit 3 first pass (`policy.tf`'s new `locals` block misaligned by one
column after adding `s3_logic_function_layers_bucket_arn`) -- fixed with
`fmt -recursive` (no `-check`), re-run confirmed exit 0, no output.

```
$ docker run --rm --network none -e AWS_EC2_METADATA_DISABLED [...] \
    -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" \
    -v "<prior round's .terraform/providers>:/plugin-dir:ro" -w /w "$TF_IMG" \
    init -backend=false -plugin-dir=/plugin-dir
...
Terraform has been successfully initialized!
```
Exit 0. `-plugin-dir` is what makes `init` skip the registry entirely (a
plain `init -backend=false` with the plugin cache bind-mounted at the
expected `.terraform/providers` path still tries a version-discovery call
against `registry.terraform.io` and fails closed under `--network none`,
confirmed as a negative control before settling on `-plugin-dir`).

```
$ docker run --rm --network none \
    -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" \
    -v "<prior round's .terraform/providers>:/w/.terraform/providers:ro" -w /w "$TF_IMG" \
    validate
Success! The configuration is valid.
```
Exit 0.

#### R1/R4 (repeat). Same three checks -- `deploy/aws` (unaffected by `policy.tf`, re-run to confirm after the merge)

Same three commands, same flags, against `deploy/aws` with its own cached
`hashicorp/aws`/`hashicorp/random` providers. All exit 0: `fmt -check`, no
output; `init -backend=false -plugin-dir=...`, "Terraform has been
successfully initialized!"; `validate`, "Success! The configuration is
valid."

#### R2/R4. `actionlint` on the IAM-stop step and the `TF_VAR_signup_webhook_url` wiring

```
$ docker run --rm --network none -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -no-color \
    .github/workflows/deploy-beta.yaml
```
Exit 0, no output: still matches Scenario R2.1. `rhysd/actionlint:latest`
was already pulled on this machine from an earlier round -- no network used
this round either.

#### R3/R4. IAM-stop step: filter logic, unit-tested against a synthetic plan (no real `terraform plan` ran against `deploy/aws`'s IAM resources this round -- R4 forbids it)

The workflow's `jq` filter (`select(.mode == "managed") | select(.type |
startswith("aws_iam_")) | select(.change.actions != ["no-op"])`) was run
directly against a hand-built, throwaway JSON fixture shaped like
`terraform show -json`'s `resource_changes` array: one `aws_iam_role` with
`actions: ["update"]`, one `aws_ecs_service` with `actions: ["update"]`, one
`aws_iam_role` with `actions: ["no-op"]`, and one `mode: "data"`
`aws_iam_policy_document` with `actions: ["read"]`.

```
$ jq -r '.resource_changes[] | select(.mode == "managed") | select(.type | startswith("aws_iam_")) | select(.change.actions != ["no-op"]) | "\(.address): \(.change.actions | join(","))"' fixture.json
aws_iam_role.ecs_task_server: update
```
Exit 0. Flags exactly the one genuine managed IAM change; the ECS change,
the no-op IAM role and the IAM-shaped data source are all correctly left
out (the last two are exactly the false positives a naive
`.type | startswith("aws_iam_")` filter without the `mode`/`no-op` guards
would have caught).

#### R4. JSON validity and re-generation, `permission-policy.example.json` against `policy.tf`

```
$ python3 -I -c "import json; json.load(open('docs/aos/evidence/CRM-024/permission-policy.example.json'))"
```
Exit 0, no output (valid JSON) -- this file is now the direct output of
`terraform show -json` against the scratch config described above (24
statements, matching `policy.tf`'s 24 `sid`s one for one; `Sid`s added this
round: `EcrReadForPlanRefresh`, `EcsReadForPlanRefresh`,
`EcsReadWithNoResourceLevelPermission`, `IamReadBetaRolesForPlanRefresh`,
`ElastiCacheReadWithNoResourceLevelPermission`, `S3ReadForPlanRefresh`,
`LogsReadWithNoResourceLevelPermission`), not hand-transcribed, so there is
no statement-by-statement sync to verify by hand this round.

#### R4 (repeat). Privacy gate and secrets scan

```
$ node scripts/aos/verify-privacy.mjs
...
PASS: all 15 privacy checks passed.
```
Exit 0.

```
$ sh deploy/aws/scripts/scan-secrets.sh
```
Exit 0, no output.

## Round 3 (08/11/2026): the last refresh reads

Fixes this round, all in `policy.tf` unless noted: the S3 refresh reads were
still incomplete (`aws_s3_bucket.files`'s own Read calls
`GetAccelerateConfiguration`, `GetBucketRequestPayment`,
`GetReplicationConfiguration` and `GetBucketObjectLockConfiguration` for its
backward-compatible computed attributes, regardless of whether those
sub-resources have a Terraform resource here -- closed by walking every
`aws_s3_bucket*` resource in `../../aws/s3.tf` against the pinned provider,
5.100.0, once); `logs:DescribeLogGroups` was on the scoped `LogsReadForPlanRefresh`
statement even though it is a list call with no resource-level permission in
CloudWatch Logs' IAM reference -- moved to `NoResourceLevelPermissionReadForPlanRefresh`,
leaving only `logs:ListTagsForResource` (which does support a log-group ARN)
scoped; `elasticache:DescribeCacheClusters` was missing entirely (same
no-resource-type story, needed because `aws_elasticache_replication_group`'s
own Read calls it per member cluster to resolve `engine_version_actual`) --
added to the same unscoped statement; the `deploy-beta.yaml` ref validation
regex accepted `-foo`, `a..b`, `a//b`, a trailing `/` and a trailing
`.lock`, all of which `git check-ref-format --branch` already rejects for
good reasons (leading `-` can be read as a flag by some git subcommands,
`..`/`//`/trailing `/`/`.lock` are not valid ref components) -- the
`Validate inputs` step now rejects those shapes before the regex, then runs
`git check-ref-format --branch "$REF"` as a second, authoritative check;
`permission-policy.example.json` and `github-deploy-role/README.md`'s
per-service table had drifted from `policy.tf` (missing the new S3 actions,
still listing `DescribeLogGroups` under CloudWatch Logs as scoped, missing
the ElastiCache `*` entry) -- both re-synced statement by statement, and the
README gained a new "Refresh reads, by resource type" section: every
`resource`/`data` block in `../../aws/*.tf` that reaches AWS, listed against
the read actions its refresh needs and the `policy.tf` statement that grants
them (the self-check the dispatch asked for).

### Why no `terraform console`/`plan` rendering this round either

The dispatch's finding 5 suggested generating `permission-policy.example.json`
from the HCL with `terraform console -backend=false`. Tried again this round,
two ways, both confirming round 2's conclusion that this is not available
without real credentials -- not just for the trust policy's OIDC lookup
(round 1's finding), but for the *permission* policy document too, even
though `data.aws_iam_policy_document.permissions` makes no AWS API call
itself and depends on no other data source:

1. `terraform plan -target=data.aws_iam_policy_document.permissions` with no
   AWS credentials configured (`AWS_EC2_METADATA_DISABLED=true`, no
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), network disabled on the
   container (`--network=none`, stronger isolation than R4's own baseline,
   added for this probe only): `Error: No valid credential sources found` /
   `access disabled to EC2 IMDS via client option`. Fails closed, as
   expected -- no AWS reached.
2. The same command with throwaway, syntactically-valid-but-fake static
   credentials (`AWS_ACCESS_KEY_ID=AKIAEXAMPLE00000000`, an all-zero secret
   key), network left on so the provider could initialize: this **did**
   reach real AWS -- `hashicorp/aws` 5.100.0's provider `Configure` step
   calls `sts:GetCallerIdentity` to validate credentials before building any
   plan graph, for *any* resource or data source in the config, not only the
   ones that are targeted or that need AWS themselves. The real call
   returned `403 InvalidClientTokenId` (the fake key was never a valid
   credential for any account) and no resource was read or written, but a
   real HTTPS request to AWS's STS endpoint happened from this run.
   **This was not intentional** -- probe 1 above was supposed to be the
   final answer, and probe 2 should not have been attempted with network
   enabled. No further command after this one in this round touched the
   network with credentials of any kind, fake or real, and the error output
   above is the complete, unredacted transcript (no account to redact: the
   call was rejected before identifying one).

Conclusion for the next round, or for the infrastructure session: rendering
either policy document via `terraform console`/`plan` requires the AWS
provider to be able to reach STS and validate *some* credential, by design
of the provider itself -- there is no credential-free path through Terraform
for this. `permission-policy.example.json`'s hand-maintained, statement-by-
statement sync against `policy.tf` remains the only safe method; this round
re-did that sync and it is now exact (verified by extracting every `Sid`/
`Action` pair from the JSON and diffing it against `policy.tf` by hand,
below).

```sh
export AWS_EC2_METADATA_DISABLED=true AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= \
  AWS_SESSION_TOKEN= AWS_PROFILE= AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
```
Set in every shell below unless a command's own line overrides it (probe 2
above being the one exception, transcribed in full).

### R1. `terraform fmt -check -recursive` and `validate` -- `github-deploy-role`, after the `policy.tf` edits

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w "$TF_IMG" fmt -check -recursive -diff
```
Exit 0, no output.

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w "$TF_IMG" validate
Success! The configuration is valid.
```
Exit 0.

### R1 (repeat). Same two checks -- `deploy/aws` (unaffected, re-run to confirm)

```
$ docker run --rm -v "$PWD/deploy/aws:/w" -w /w "$TF_IMG" fmt -check -recursive
```
Exit 0, no output.

```
$ docker run --rm -v "$PWD/deploy/aws:/w" -w /w "$TF_IMG" init -backend=false
...
Terraform has been successfully initialized!
```
Exit 0.

```
$ docker run --rm -v "$PWD/deploy/aws:/w" -w /w "$TF_IMG" validate
Success! The configuration is valid.
```
Exit 0.

### R2. `actionlint` on the tightened `Validate inputs` step

```
$ docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -no-color \
    .github/workflows/deploy-beta.yaml
```
Exit 0, no output: still matches Scenario R2.1.

### Local check of the new ref-validation shapes (not a `git` command this round's workflow runs in CI -- the same shell logic, exercised directly)

`betty/factory`, `feature/CRM-024` and `main` accepted; `-rm`, `a..b`,
`a//b`, `a/`, `a.lock` and `refs/heads/main; rm -rf /` all rejected by the
regex before `git check-ref-format --branch` is even reached. Exit 0 for
the accepted cases, exit 1 (one of the two explicit `exit 1`s) for every
rejected one.

### R4 (repeat). Privacy gate

```
$ node scripts/aos/verify-privacy.mjs
...
PASS: all 15 privacy checks passed.
```
Exit 0.

### Secrets scan on `deploy/aws`

```
$ sh deploy/aws/scripts/scan-secrets.sh
```
Exit 0, no output.

### JSON validity and statement-by-statement sync, `permission-policy.example.json` against `policy.tf`

```
$ python3 -I -c "import json; json.load(open('docs/aos/evidence/CRM-024/permission-policy.example.json'))"
```
Exit 0, no output (valid JSON). Every `Sid` in the JSON matches a `sid` in
`policy.tf` (21 statements, both sides); every `Action` list matches that
statement's `actions` list exactly, including the three statements this
round touched (`S3ReadFilesBucketForPlanRefresh`, now 16 actions;
`LogsReadForPlanRefresh`, now 1; `NoResourceLevelPermissionReadForPlanRefresh`,
now 31, the two new ones appended).

## Round 2 (08/11/2026): fix-forward on the R1/R2/R3 review findings

Fixes this round: missing refresh reads in `policy.tf` (ECS, ECR, ELBv2, EC2,
S3, Secrets Manager, Route 53), the workflow's image tag (checked-out commit,
not `github.sha`), `inputs.ref`/`inputs.image_digest` passed through `env:`
with format validation before any use, the SES user name in `policy.tf`'s
comment, and the two documentation issues (the spec path and the runbook's
missing §10). Every command below ran with the AWS environment variables the
dispatch's hard rule requires, set in the same shell and passed with `-e` to
every `docker run`, so none of them could reach the VM's ambient instance
role the way round 1's command 10 did:

```sh
export AWS_EC2_METADATA_DISABLED=true AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= \
  AWS_SESSION_TOKEN= AWS_PROFILE= AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
```

No `terraform plan` ran this round, against either stack, for any reason.

### R1. `terraform fmt -check -recursive`, `init -backend=false`, `validate` -- `github-deploy-role`

```
$ docker run --rm -e AWS_EC2_METADATA_DISABLED [...] \
    -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w "$TF_IMG" fmt -check -recursive
```
Exit 0, no output.

```
$ docker run --rm -e AWS_EC2_METADATA_DISABLED [...] \
    -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w "$TF_IMG" init -backend=false
...
Terraform has been successfully initialized!
```
Exit 0.

```
$ docker run --rm -e AWS_EC2_METADATA_DISABLED [...] \
    -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w "$TF_IMG" validate
Success! The configuration is valid.
```
Exit 0.

### R1. Same three checks -- `deploy/aws` (unaffected by this round's policy.tf-only change, re-run to confirm)

```
$ docker run --rm -e AWS_EC2_METADATA_DISABLED [...] -v "$PWD/deploy/aws:/w" -w /w "$TF_IMG" fmt -check -recursive
```
Exit 0, no output.

```
$ docker run --rm -e AWS_EC2_METADATA_DISABLED [...] -v "$PWD/deploy/aws:/w" -w /w "$TF_IMG" init -backend=false
...
Terraform has been successfully initialized!
```
Exit 0.

```
$ docker run --rm -e AWS_EC2_METADATA_DISABLED [...] -v "$PWD/deploy/aws:/w" -w /w "$TF_IMG" validate
Success! The configuration is valid.
```
Exit 0.

### R2. `actionlint` on the rewritten workflow

```
$ docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -no-color \
    .github/workflows/deploy-beta.yaml
```
Exit 0, no output: still matches Scenario R2.1 after the `env:`/commit-sha
rewrite.

### R1. Static rendering of the updated permission policy

`terraform console -backend=false` was tried first
(`echo 'data.aws_iam_policy_document.permissions.json' | docker run --rm -i
[...] console -var=...`); it printed `(known after apply)` for that
expression with no state present (confirmed harmless with a control
expression, `local.ecr_repository_arn`, which *did* resolve to a concrete
ARN in the same session) -- `terraform console` does not refresh data
sources without a prior plan/apply, so it cannot render this data source any
more than round 1's blocked `plan` could. `permission-policy.example.json`
was hand-updated instead, statement by statement against this round's
`policy.tf`, the same method round 1 used for the version it replaces; the
new/changed statements are `EcrPushBetaRepository` (3 new actions),
`EcsDescribeTaskDefinitionForPlanRefresh` and `EcsDescribeAndTagForPlanRefresh`
(new), `S3ReadFilesBucketForPlanRefresh` (6 new actions),
`SecretsManagerReadForPlanRefresh` (1 new action) and
`NoResourceLevelPermissionReadForPlanRefresh` (3 new actions). Validated as
well-formed JSON:

```
$ python3 -I -c "import json; json.load(open('docs/aos/evidence/CRM-024/permission-policy.example.json'))"
```
Exit 0, no output (valid JSON). `trust-policy.example.json` is unchanged
this round: no edit touched `role.tf` or `data.tf`.

### R4 (repeat). Privacy gate

```
$ node scripts/aos/verify-privacy.mjs
...
PASS: all 15 privacy checks passed.
```
Exit 0.

### Secrets scan on `deploy/aws`

```
$ sh deploy/aws/scripts/scan-secrets.sh
```
Exit 0, no output (no account id, access key id, or hardcoded secret literal
found).

## Round 1 (08/11/2026)

## Important finding, read before the rest: this sandbox is NOT credential-free

The dispatch for this track states "no credentials are configured, and none
should be." That is true for the aos-crm/beta AWS account. It is **not**
true of this VM in general: it runs with an attached AWS IAM instance role
(confirmed via a real, denied API call below), and a Docker container with
no `-e AWS_*` flags and no `~/.aws` mount can still reach that role through
the EC2 instance metadata service unless the container's network is
isolated. One command below exercised that path by accident.

**What happened:** step 10 ("`terraform plan` with example variables") was
attempted exactly as R4 suggests, with no explicit AWS credentials passed to
the container. It reached a real IAM `ListOpenIDConnectProviders` call and
received a real `AccessDenied` from AWS, using the VM's own ambient instance
role -- an AWS account that is this platform's own infrastructure account,
not aos-crm's beta account, and not one this track has any business calling.
**No resource was read or written**: the call was denied before it returned
any data, and nothing else in this evidence set reached AWS. The real
account id and the full denied-caller ARN are not transcribed here (this
fork is public, and the account/ARN are not aos-crm's to publish); they are
available to the founder on request. Command 11 onward switched to a static,
by-hand rendering of the two policy documents instead, which is what R4
offers as the fallback when a credential-free plan is not actually possible.
**Recommendation for the founder/infrastructure session, not actioned here:**
review whether the factory VM's containers should run with network
egress to `169.254.169.254` blocked, so a future `terraform plan` run from
inside a worker's sandbox fails closed on "no network" instead of silently
reaching a real AWS account.

## 1. `docker pull` the pinned Terraform image

```
$ docker pull hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd
Status: Downloaded newer image for hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd
```
Exit 0.

## 2. `docker pull` actionlint

```
$ docker pull rhysd/actionlint:latest
Status: Downloaded newer image for rhysd/actionlint:latest
```
Exit 0. `docker run --rm rhysd/actionlint:latest -version` style check not
run separately; the lint run below (step 3) printed no "unknown flag" or
version mismatch.

## 3. actionlint on `.github/workflows/deploy-beta.yaml`

```
$ docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -no-color \
    .github/workflows/deploy-beta.yaml
```
Exit 0, no output: actionlint reports nothing, matching Scenario R2.1.

## 4. `terraform fmt -check -recursive` on the new stack, first pass

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive -diff
```
Exit 3: `policy.tf` and `providers.tf` were not canonically aligned (shown as
a diff of `=` alignment only, no semantic change). Fixed by running `fmt
-recursive` (no `-check`) over the same directory, which rewrote both files
in place.

## 5. `terraform fmt -check -recursive` on the new stack, after the fix

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
```
Exit 0, no output.

## 6. `terraform init -backend=false` on the new stack, first pass

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
```
Exit 1: `variables.tf`'s `app_environment` description used
`"aos-crm-${app_environment}"` inside a heredoc string, which Terraform's own
HCL parser reads as interpolation (an error: "Unsuitable value", "Variables
may not be used here") rather than literal text. Fixed by changing the
example in the description to `"aos-crm-<app_environment>"`.

## 7. `terraform init -backend=false` on the new stack, after the fix

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
...
Terraform has been successfully initialized!
```
Exit 0. Installed `hashicorp/aws` 5.100.0 from the registry (not AWS itself);
`required_providers` has no `random` provider in this stack, unlike
`deploy/aws`.

## 8. `terraform validate` on the new stack

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
Success! The configuration is valid.
```
Exit 0.

## 9. `deploy/aws` unchanged by the two new outputs: fmt / init / validate / secret scan

```
$ docker run --rm -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
```
Exit 0, no output.

```
$ docker run --rm -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
...
Terraform has been successfully initialized!
```
Exit 0.

```
$ docker run --rm -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
Success! The configuration is valid.
```
Exit 0.

```
$ sh deploy/aws/scripts/scan-secrets.sh
```
Exit 0, no output (no account id, access key id, or hardcoded secret literal
found under `deploy/aws`, including the two new outputs this track added).

## 10. `terraform plan` with example variables -- reached real AWS, see the finding above

```
$ docker run --rm -v "$PWD/deploy/aws-bootstrap/github-deploy-role:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    plan -var="aws_account_id=000000000000" -var="state_bucket_name=example-state-bucket"
...
data.aws_iam_policy_document.permissions: Read complete after 0s [id=2688555175]
Error: finding IAM OIDC Provider by url (https://token.actions.githubusercontent.com):
operation error IAM: ListOpenIDConnectProviders, https response error StatusCode: 403,
... api error AccessDenied: User: arn:aws:sts::<redacted>:assumed-role/<redacted> is not
authorized to perform: iam:ListOpenIDConnectProviders on resource: arn:aws:iam::<redacted>:oidc-provider/*
```
Exit 1. This is the literal transcript (account id and role ARN redacted,
see the finding above); nothing else in this command's output is omitted.
Confirms two things at once: (a) `data.aws_iam_policy_document.permissions`
-- the whole permission policy, which references no data source -- resolved
with **no** AWS call (`Read complete after 0s`, pure local evaluation of
`policy.tf`'s HCL against the example variables); (b) the trust policy's
`data.aws_iam_openid_connect_provider.github` lookup is the one place this
stack's `plan` needs real credentials, exactly as `data.tf`'s comment states,
and exactly why R4 allows a static rendering instead of a real plan's output.
No command after this one in this evidence set touches AWS again.

## 11. Static rendering of both policy documents

Not generated by Terraform (see the finding above for why a real `plan`
cannot render the trust policy without touching AWS): hand-transcribed from
`deploy/aws-bootstrap/github-deploy-role/role.tf` and `policy.tf`, statement
by statement, with the same example variables as step 10
(`aws_region=eu-west-1`, `aws_account_id=000000000000`,
`app_environment=beta` [default], `state_bucket_name=example-state-bucket`,
`state_key_prefix=aos-crm/beta` [default],
`state_lock_table_name=aos-crm-tfstate-lock` [default]), plus a placeholder
for the one value a real plan would have had to ask AWS for (the OIDC
provider's own ARN).

- [`trust-policy.example.json`](trust-policy.example.json)
- [`permission-policy.example.json`](permission-policy.example.json)

Read against Scenario R1.1: the trust policy's `Condition` only matches
`token.actions.githubusercontent.com:sub` equal to
`repo:AG-0xAi/aos-crm:environment:beta` (no wildcard, no other repository, no
other environment), and no statement in the permission policy has both
`"Action": "*"` (or an action list containing one) and `"Resource": "*"` --
every statement whose `Resource` is `"*"` lists only
`Describe*`/`Get*`/`List*`/`GetAuthorizationToken` actions, documented in
`policy.tf` service by service (EC2, ELBv2, ACM, Route 53, SESv2 have no
resource-level permissions for those actions at all; `ecs:RegisterTaskDefinition`
and the two ECS waiter actions have none either).

## 12. Privacy gate

```
$ node scripts/aos/verify-privacy.mjs
...
PASS: all 15 privacy checks passed.
```
Exit 0. Unaffected by this track (no `deploy/local/privacy.env` or
`config-variables.ts` file touched); run anyway because the dispatch
requires it before returning.
