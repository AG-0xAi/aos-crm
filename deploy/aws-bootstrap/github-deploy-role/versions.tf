terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state on purpose: this stack is applied by hand, rarely, from the
  # infrastructure session's machine (README.md), never from CI -- the
  # workflow this role enables only ever assumes the role, it never applies
  # this stack. A remote backend is a legitimate upgrade if the founder
  # wants this state shared too; nothing here blocks adding a `backend "s3"`
  # block later, same partial-configuration pattern as ../../aws/versions.tf.
}
