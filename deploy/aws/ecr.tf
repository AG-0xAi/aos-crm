# One repository: the twenty-docker Dockerfile's `twenty` target builds a
# single image used by both the server and worker services (deploy/local/
# compose.yaml, the x-aos-crm-app anchor), distinguished only by the command
# override, exactly like this stack's ecs.tf task definitions.

resource "aws_ecr_repository" "app" {
  name                 = "aos-crm-${var.environment}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
