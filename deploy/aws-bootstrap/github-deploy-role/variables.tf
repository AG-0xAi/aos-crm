# No account id, ARN or domain is a literal anywhere in this stack (R1):
# aws_account_id and state_bucket_name are account-specific and come in as
# variables, exactly like domain_name in ../../aws/variables.tf; everything
# else below is a public, non-identifying naming convention already in this
# fork (the "aos-crm-beta*" resource names deploy/aws itself creates).

variable "aws_region" {
  description = "AWS region the beta stack (deploy/aws) runs in. Same founder decision as deploy/aws/variables.tf's aws_region (eu-west-1)."
  type        = string
  default     = "eu-west-1"
}

variable "aws_account_id" {
  description = <<-EOT
    AWS account id the beta stack runs in. No default: an account id is
    founder-identifying, like domain_name in ../../aws/variables.tf. Used only
    to compose ARNs for the permission policy below (RDS, ElastiCache, ECS,
    IAM, Secrets Manager, Budgets, the state lock table) -- never written to a
    resource name or to the trust policy, which is scoped by the OIDC
    provider's own ARN (data.tf) and never needs the account id spelled out.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account id."
  }
}

variable "app_environment" {
  description = <<-EOT
    Environment name the beta stack (deploy/aws) was applied with
    (var.environment there). Every resource this role's permission policy
    scopes by name is built from this, e.g. "aos-crm-<app_environment>". Not
    founder-identifying: "beta" is already the name used throughout this
    fork's docs and code.
  EOT
  type        = string
  default     = "beta"
}

variable "github_repo" {
  description = "GitHub org/repo this role's trust policy admits, as \"org/repo\". Public: it is the name of this fork."
  type        = string
  default     = "AG-0xAi/aos-crm"
}

variable "github_environment" {
  description = <<-EOT
    GitHub Environment name the trust policy's `sub` claim is scoped to
    (R1: "repo:<github_repo>:environment:<github_environment>"). Must match
    the `environment:` the deploy-beta.yaml workflow declares, so only a run
    dispatched against that protected environment can assume this role.
  EOT
  type        = string
  default     = "beta"
}

variable "role_name" {
  description = "Name of the IAM role this stack creates. Fixed by R1 to aos-crm-beta-deploy-github; exposed as a variable only so a second environment (e.g. a future staging-from-CI) can reuse this stack under a different name."
  type        = string
  default     = "aos-crm-beta-deploy-github"
}

variable "state_bucket_name" {
  description = <<-EOT
    Name of the S3 bucket holding deploy/aws's remote state (its
    versions.tf `backend "s3"` block, bucket passed at `init` time). No
    default: an S3 bucket name is globally unique and account-specific, so it
    is as founder-identifying as an account id. Used to scope this role's
    s3:GetObject/PutObject/ListBucket to exactly the beta's state key, never
    to the whole bucket.
  EOT
  type        = string
}

variable "state_key_prefix" {
  description = "Key prefix of the beta's state inside state_bucket_name, matching the `key` passed to `terraform init -backend-config` in deploy/aws (AWS_DEPLOYMENT_PLAN.md R4)."
  type        = string
  default     = "aos-crm/beta"
}

variable "state_lock_table_name" {
  description = "DynamoDB table deploy/aws's backend locks state with (its versions.tf `dynamodb_table` attribute). Already a public, non-identifying name in this fork, hence the default."
  type        = string
  default     = "aos-crm-tfstate-lock"
}
