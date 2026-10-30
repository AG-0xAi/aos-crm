# No static AWS key anywhere in this file (R1):
#  - ecs_task_execution: what ECS itself uses to pull the image from ECR,
#    write to CloudWatch Logs, and resolve the `secrets` block below into
#    the running container's environment. Shared by server, worker and
#    migrate: these are ECS control-plane grants (image pull, log stream
#    creation, secret-to-env resolution), not application data access, so
#    sharing it does not widen any task's blast radius.
#  - ecs_task_server / ecs_task_worker / ecs_task_migrate: one role per
#    service (R1), what the application code inside *that* container (the
#    AWS SDK) assumes at runtime -- see s3.tf's comment on
#    fromNodeProviderChain(). server and worker run the same image and both
#    reach the shared file-storage driver (server for direct API
#    uploads/downloads, worker for async jobs such as CSV import/export and
#    attachment processing), so they need the same S3 + SSE-KMS access;
#    kept as two roles rather than one shared role so a future permission
#    change to one does not have to touch the other. migrate only runs
#    database:init/upgrade/cron:register (ecs.tf) -- it never calls the
#    storage driver, so its role gets no inline policy at all: everything
#    it actually needs (secrets resolved into env, logs written) comes from
#    ecs_task_execution above, not from the task role.

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "aos-crm-${var.environment}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_task_execution_secrets" {
  statement {
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.pg_database_url.arn,
      aws_secretsmanager_secret.redis_url.arn,
      aws_secretsmanager_secret.encryption_key.arn,
      aws_secretsmanager_secret.ses_smtp_user.arn,
      aws_secretsmanager_secret.ses_smtp_password.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_task_execution_secrets.json
}

resource "aws_iam_role" "ecs_task_server" {
  name               = "aos-crm-${var.environment}-ecs-task-server"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "ecs_task_worker" {
  name               = "aos-crm-${var.environment}-ecs-task-worker"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

# No inline policy on purpose: the migrate task only runs
# database:init/upgrade/cron:register (ecs.tf) and never calls the storage
# driver, so it gets no S3/KMS grant that ecs_task_server/worker need and it
# does not.
resource "aws_iam_role" "ecs_task_migrate" {
  name               = "aos-crm-${var.environment}-ecs-task-migrate"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "ecs_task_s3" {
  statement {
    sid       = "ListOwnBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.files.arn]
  }

  statement {
    sid    = "ReadWriteOwnObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.files.arn}/*"]
  }

  statement {
    sid    = "UseBucketDefaultKmsKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]
    resources = ["arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alias/aws/s3"]
  }
}

resource "aws_iam_role_policy" "ecs_task_server_s3" {
  name   = "files-bucket-access"
  role   = aws_iam_role.ecs_task_server.id
  policy = data.aws_iam_policy_document.ecs_task_s3.json
}

resource "aws_iam_role_policy" "ecs_task_worker_s3" {
  name   = "files-bucket-access"
  role   = aws_iam_role.ecs_task_worker.id
  policy = data.aws_iam_policy_document.ecs_task_s3.json
}
