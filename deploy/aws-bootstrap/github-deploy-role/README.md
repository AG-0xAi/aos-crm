# GitHub deploy role (CRM-024)

Small, standalone Terraform stack that creates exactly one thing: the IAM
role `aos-crm-beta-deploy-github`, trusted only through the account's
existing GitHub Actions OIDC provider, for `.github/workflows/deploy-beta.yaml`
to assume. It is deliberately separate from `deploy/aws`: that stack is the
beta application itself, applied repeatedly as `image_digest` changes; this
one is applied once (and only re-applied if the trust or permission policy
itself needs to change), by a human, with the founder's OK.

**This track validates the IaC statically and never applies it.** No AWS
credential, no `plan` and no `apply` ran from this worker -- same invariant
as `../../aws/README.md`.

## What it needs that is not in the repo

- `aws_account_id` (12 digits): the account `deploy/aws` runs in.
- `state_bucket_name`: the S3 bucket `deploy/aws`'s backend uses (the same
  bucket name passed to that stack's `terraform init -backend-config`).

Both are account-specific and therefore not committed, exactly like
`domain_name` in `../../aws/variables.tf`. Pass them with `-var` or a
`terraform.tfvars` here (gitignored the same way).

## How the infrastructure session applies it

From a machine with SSO credentials for this account (the same session that
applies `deploy/aws`), with the founder's explicit OK:

```sh
cd deploy/aws-bootstrap/github-deploy-role
terraform init
terraform plan \
  -var="aws_account_id=<12-digit account id>" \
  -var="state_bucket_name=<the deploy/aws state bucket>"
# review the plan, then:
terraform apply \
  -var="aws_account_id=<12-digit account id>" \
  -var="state_bucket_name=<the deploy/aws state bucket>"
terraform output -raw role_arn
```

`terraform plan` is the first command here that reaches AWS: the OIDC
provider lookup (`data.tf`) needs real credentials, which is exactly why
R4's evidence could not include a real plan output and instead carries a
static rendering of the trust and permission policy documents.

## What goes into GitHub, and where

All four live on the GitHub **Environment** named `beta` (Settings →
Environments → beta), not as repository-wide secrets/variables -- that is
what makes the trust policy's `environment:beta` claim meaningful.

| Name | Kind | Value |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | Environment variable | `terraform output -raw role_arn` above |
| `AWS_REGION` | Environment variable | the region `deploy/aws` runs in (`eu-west-1`) |
| `AWS_TFSTATE_BUCKET` | Environment variable | the same `state_bucket_name` passed above |
| `AWS_TFVARS` | Environment secret | the full contents of `deploy/aws/terraform.tfvars` |

Consider also requiring the founder as a reviewer of the `beta` environment
(Settings → Environments → beta → "Required reviewers"): that makes every
dispatch of `deploy-beta.yaml` wait for an explicit approval before the role
is ever assumed, which is the "founder's OK each time" the spec asks for
(`.aos-spec/despliegue-github/spec.md`'s Purpose).

## Re-applying after a permission change

If `deploy/aws` starts managing a new resource type, or the workflow needs a
new action, this stack is the one to change -- never widen the role by hand
in the console. Re-run `terraform plan`/`apply` here the same way, with the
founder's OK, and the running `deploy-beta.yaml` workflow does not need any
change: it only ever reads `AWS_DEPLOY_ROLE_ARN`.
