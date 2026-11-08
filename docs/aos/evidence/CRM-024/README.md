# CRM-024 evidence (08/11/2026)

R4: static validation only, no `terraform apply`, no real AWS mutation. One
command below (marked explicitly) reached AWS by surprise; everything else
ran exactly as planned, with commands and exit codes transcribed from the
real run, not written by hand afterward.

Terraform CLI used everywhere below: `hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd`
(1.9.8, the same pinned digest `deploy/aws/README.md` and
`AWS_DEPLOYMENT_PLAN.md` R4 already use). actionlint:
`rhysd/actionlint:latest` (resolved to v1.7.12 at pull time).

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
