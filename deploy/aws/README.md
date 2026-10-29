# AOS-CRM staging on AWS (CRM-011)

Terraform for a private staging deployment of AOS-CRM: ECS Fargate (server +
worker, from the ECR image by digest), a one-off migration task, RDS
PostgreSQL 16, ElastiCache Valkey, private S3, an HTTPS ALB with ACM, Secrets
Manager, least-privilege IAM, explicit log retention and an AWS Budgets
alarm. See `.aos/pack/aos-crm/specs/aws-staging/spec.md` for the contract and
`docs/aos/bootstrap/AWS_DEPLOYMENT_PLAN.md` for cost, deploy/rollback/backup/
teardown commands and what the founder still has to decide.

**This phase validates the IaC statically. It never runs `terraform plan` or
`terraform apply`, and nothing here has created an AWS resource.**

## Validate (no AWS credentials, no plan/apply)

```sh
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
sh scripts/scan-secrets.sh
```

Pin the Terraform CLI to a digest (not a moving tag) when running these in a
container, e.g.:

```sh
docker run --rm -v "$PWD:/w" -w /w \
  hashicorp/terraform@sha256:<digest> fmt -check -recursive
```

## Required variables

`aws_region`, `domain_name`, `budget_amount_usd`, `budget_alert_email`,
`server_cpu`, `server_memory`, `worker_cpu`, `worker_memory`,
`server_desired_count`, `worker_desired_count`, `db_instance_class`,
`db_allocated_storage_gb`, `redis_node_type` and `image_digest` have no
default (see `variables.tf` for why). Copy `terraform.tfvars.example` to
`terraform.tfvars` (gitignored) and fill in real values before a real
`plan`/`apply` -- which still requires the founder's explicit LIVE order and
AWS credentials neither this track nor this repo ever holds.
