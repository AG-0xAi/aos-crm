provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "aos-crm"
      Component   = "github-deploy-role"
      ManagedBy   = "terraform"
    }
  }
}
