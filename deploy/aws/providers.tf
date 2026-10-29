provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "aos-crm"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
