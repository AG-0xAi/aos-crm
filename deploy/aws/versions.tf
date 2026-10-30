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

  # Remote state with locking (CRM-013 R3). Partial configuration on purpose:
  # bucket, key and region are passed with -backend-config at init time
  # (AWS_DEPLOYMENT_PLAN.md gives the exact command, and the bucket name is
  # account-specific, which does not belong in a public fork). `terraform init
  # -backend=false` ignores this block entirely, so static validation still
  # runs with no bucket, no credentials and no state.
  #
  # Locking is DynamoDB, not S3's native lockfile: `use_lockfile` arrived in
  # Terraform 1.10 and the pinned toolchain this stack is validated with is
  # 1.9.8, which rejects the argument outright ("An argument named
  # use_lockfile is not expected here" -- measured, see AWS_DEPLOYMENT_PLAN.md).
  # required_version below still admits 1.9.x, so the attribute cannot be used
  # until that floor moves. Upgrade path: raise required_version to >= 1.11,
  # repin the container, then replace dynamodb_table with use_lockfile = true
  # and delete the table.
  #
  # Declared here rather than left to flags because an init without a lock is
  # an init that can corrupt state when two people apply at once, and a flag
  # nobody passes is a lock nobody has.
  backend "s3" {
    encrypt        = true
    dynamodb_table = "aos-crm-tfstate-lock"
  }
}
