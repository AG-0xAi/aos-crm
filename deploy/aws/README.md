# AOS-CRM on AWS (CRM-011 staging, CRM-013 beta)

Terraform for a private deployment of AOS-CRM: ECS Fargate (server + worker,
from the ECR image by digest), a one-off migration task, RDS PostgreSQL 16,
ElastiCache Valkey, private S3, an HTTPS ALB with an ACM certificate for the
domain and its wildcard, Route 53 alias records, Secrets Manager,
least-privilege IAM, explicit log retention and an AWS Budgets alarm.

CRM-013 turns this into the beta environment: Twenty runs with multi-workspace
on and workspace creation limited to server admins, so each user gets their own
`<workspace>.<domain>` space and only the operator can create one. See
`.aos/pack/aos-crm/specs/aws-beta/spec.md` for the contract and
`docs/aos/bootstrap/AWS_DEPLOYMENT_PLAN.md` for the ordered deploy procedure,
cost, rollback/backup/teardown, the deploy permission set and the limits that
come from Twenty's own code.

**This track validates the IaC statically. It never runs `terraform plan` or
`terraform apply`, and nothing here has created an AWS resource.**

## Validate (no AWS credentials, no plan/apply)

```sh
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
sh scripts/scan-secrets.sh
```

`init -backend=false` is what keeps this credential-free: the `backend "s3"`
block in `versions.tf` is a partial configuration and that flag skips it
entirely. Pin the Terraform CLI to a digest (not a moving tag) when running
these in a container, e.g.:

```sh
docker run --rm -v "$PWD:/w" -w /w \
  hashicorp/terraform@sha256:<digest> fmt -check -recursive
```

## Remote state

State lives in S3 with a DynamoDB lock table. The bucket, key and region are
passed at init time, not committed (the bucket name is account-specific):

```sh
terraform init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="key=aos-crm/beta/terraform.tfstate" \
  -backend-config="region=eu-west-1"
```

`AWS_DEPLOYMENT_PLAN.md` has the commands that create the bucket and the table
before the first init, and why locking is DynamoDB rather than S3's native
lockfile with the pinned Terraform version.

## Required variables

`domain_name`, `budget_alert_email`, `server_cpu`, `server_memory`,
`worker_cpu`, `worker_memory`, `server_desired_count`, `worker_desired_count`,
`db_instance_class`, `db_allocated_storage_gb`, `redis_node_type` and
`image_digest` have no default (see `variables.tf` for why). `aws_region`
(eu-west-1) and `budget_amount_usd` (500) default to the founder's beta
decisions of 29/10/2026. Copy `terraform.tfvars.example` to `terraform.tfvars`
(gitignored) and fill in the real values before a real `plan`/`apply` -- which
still requires the founder's explicit LIVE order and AWS credentials neither
this track nor this repo ever holds.
