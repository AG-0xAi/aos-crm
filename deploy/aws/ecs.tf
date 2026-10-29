locals {
  image = "${aws_ecr_repository.app.repository_url}@${var.image_digest}"

  # Same privacy profile as deploy/local/privacy.env (R2), reproduced here
  # because ECS task definitions take environment variables inline, not an
  # env_file. Empty-string values mirror privacy.env's explicit-empty
  # placeholders (METER_DRIVER, SENTRY_DSN, SENTRY_FRONT_DSN,
  # ENTERPRISE_KEY, ENTERPRISE_VALIDITY_TOKEN): stating "off" rather than
  # omitting the key, same reasoning as that file's own comments.
  privacy_env = {
    TELEMETRY_ENABLED                     = "false"
    ANALYTICS_ENABLED                     = "false"
    MARKETPLACE_CATALOG_SYNC_CRON_ENABLED = "false"
    IS_CONFIG_VARIABLES_IN_DB_ENABLED     = "false"
    EXCEPTION_HANDLER_DRIVER              = "CONSOLE"
    METER_DRIVER                          = ""
    SENTRY_DSN                            = ""
    SENTRY_FRONT_DSN                      = ""
    ENTERPRISE_KEY                        = ""
    ENTERPRISE_VALIDITY_TOKEN             = ""
    # Private S3 driver (s3.tf), task-role credentials only (no static
    # STORAGE_S3_ACCESS_KEY_ID/SECRET -- see that file's comment).
    STORAGE_TYPE      = "s3"
    STORAGE_S3_NAME   = aws_s3_bucket.files.bucket
    STORAGE_S3_REGION = var.aws_region
    # Closed signup (R2): same mechanism as LOCAL_SETUP.md, not a separate
    # flag -- getSignUpWithoutWorkspaceDecision refuses once a workspace
    # already exists and multiworkspace is off. The one-time first-admin
    # signup remains a manual operational step, done once after the first
    # LIVE deploy, same as local.
    IS_MULTIWORKSPACE_ENABLED = "false"
    # SEC-01 (SECURITY_AUDIT.md): forced regardless of any upstream
    # default, same as deploy/local/compose.yaml's x-aos-crm-env anchor.
    LOGIC_FUNCTION_TYPE   = "DISABLED"
    CODE_INTERPRETER_TYPE = "DISABLED"
    SERVER_URL            = "https://${var.domain_name}"
  }

  # The ECS "secrets" block resolves each entry's `valueFrom` through
  # ecs_task_execution (iam.tf) at container start; none of these ever sit
  # in the task definition's plaintext `environment` block (see secrets.tf).
  app_secrets = [
    { name = "PG_DATABASE_URL", valueFrom = aws_secretsmanager_secret.pg_database_url.arn },
    { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
    { name = "ENCRYPTION_KEY", valueFrom = aws_secretsmanager_secret.encryption_key.arn },
  ]
}

resource "aws_ecs_cluster" "this" {
  name = "aos-crm-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.ecs_container_insights ? "enabled" : "disabled"
  }
}

# One-off migration task (R1): the official entrypoint
# (packages/twenty-docker/twenty/entrypoint.sh) always runs
# database:init:prod/upgrade/cron:register inline before `exec`-ing the
# real command, which deploy/local/compose.yaml measured at 8.6 min on a
# cold volume. Running that inline on every server task start (or on every
# one of server_desired_count replicas, racing each other) is both slow
# and unsafe. This task definition does only that work, with the DISABLE_*
# flags flipped the opposite way from the server/worker services below,
# then exits via `exec true` (busybox builtin in the node:alpine base)
# instead of booting Nest's HTTP server. It is never an aws_ecs_service:
# AWS_DEPLOYMENT_PLAN.md documents running it with `aws ecs run-task`
# before every deploy that changes image_digest or runs a new migration.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "aos-crm-${var.environment}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = local.image
      essential = true
      command   = ["true"]
      environment = [
        for k, v in merge(local.privacy_env, {
          DISABLE_DB_MIGRATIONS          = "false"
          DISABLE_CRON_JOBS_REGISTRATION = "false"
        }) : { name = k, value = v }
      ]
      secrets = local.app_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "server" {
  family                   = "aos-crm-${var.environment}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "server"
      image     = local.image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      # Migrations/cron registration already ran in the migrate task above;
      # the server service must never race it or redo an 8.6 min boot on
      # every replica.
      environment = [
        for k, v in merge(local.privacy_env, {
          NODE_PORT                      = tostring(var.container_port)
          DISABLE_DB_MIGRATIONS          = "true"
          DISABLE_CRON_JOBS_REGISTRATION = "true"
        }) : { name = k, value = v }
      ]
      secrets = local.app_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "aos-crm-${var.environment}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = local.image
      essential = true
      command   = ["yarn", "worker:prod"]
      environment = [
        for k, v in merge(local.privacy_env, {
          DISABLE_DB_MIGRATIONS          = "true"
          DISABLE_CRON_JOBS_REGISTRATION = "true"
        }) : { name = k, value = v }
      ]
      secrets = local.app_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "server" {
  name            = "aos-crm-${var.environment}-server"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.server_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = var.alb_health_check_grace_period_seconds

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "aos-crm-${var.environment}-worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }
}
