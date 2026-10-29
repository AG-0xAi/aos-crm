terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block on purpose: this phase only runs `terraform init
  # -backend=false` + `terraform validate` (CRM-011 R3), never `plan`/`apply`.
  # Before a real LIVE deploy, the founder picks a remote backend (S3 bucket +
  # DynamoDB lock table, or Terraform Cloud) and it gets added here explicitly
  # -- a local backend must never hold the only copy of staging state.
}
