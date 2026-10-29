# Security groups form a strict chain: internet -> alb -> ecs_tasks -> {rds,redis}.
# Nothing but the ALB ever has an internet-facing ingress rule (R1: DB/Redis
# never public; R2: MCP only over HTTPS, which the ALB terminates).
#
# alb and ecs_tasks reference each other (alb's egress targets ecs_tasks,
# ecs_tasks' ingress targets alb), which `terraform validate` rightly
# rejects as a cycle when both are inline `ingress`/`egress` blocks on the
# resources themselves. The two cross-referencing rules below are split
# into standalone aws_security_group_rule resources so neither security
# group's own definition depends on the other; only the rule resources do,
# and those can depend on both once each already exists.

resource "aws_security_group" "alb" {
  name        = "aos-crm-${var.environment}-alb"
  description = "Public HTTPS entry point for aos-crm ${var.environment}."
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS from the internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "aos-crm-${var.environment}-alb"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "aos-crm-${var.environment}-ecs-tasks"
  description = "Server, worker and migrate Fargate tasks for aos-crm ${var.environment}."
  vpc_id      = aws_vpc.this.id

  egress {
    description = "Outbound to RDS, Redis, ECR, Secrets Manager, S3 (via NAT)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "aos-crm-${var.environment}-ecs-tasks"
  }
}

resource "aws_security_group_rule" "alb_to_ecs_tasks" {
  description              = "ALB to ECS tasks on the container port"
  type                     = "egress"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = aws_security_group.ecs_tasks.id
}

resource "aws_security_group_rule" "ecs_tasks_from_alb" {
  description              = "ECS tasks from the ALB only, on the container port"
  type                     = "ingress"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group" "rds" {
  name        = "aos-crm-${var.environment}-rds"
  description = "RDS PostgreSQL for aos-crm ${var.environment}, reachable only from ECS tasks."
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "PostgreSQL from ECS tasks only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "aos-crm-${var.environment}-rds"
  }
}

resource "aws_security_group" "redis" {
  name        = "aos-crm-${var.environment}-redis"
  description = "ElastiCache Valkey for aos-crm ${var.environment}, reachable only from ECS tasks."
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Redis protocol from ECS tasks only"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "aos-crm-${var.environment}-redis"
  }
}
