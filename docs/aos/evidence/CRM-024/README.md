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
