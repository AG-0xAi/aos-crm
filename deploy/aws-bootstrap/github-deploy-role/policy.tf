# R1: no `*:*` anywhere below, no IAM user or access key creation, and every
# resource that CAN be named is named "aos-crm-<app_environment>*" --
# deploy/aws's own naming convention, reproduced here as ARNs built from
# var.aws_region/var.aws_account_id/var.app_environment, never a hardcoded
# account id. Two kinds of statement:
#   - WRITE statements grant exactly the mutations a routine "new
#     image_digest" redeploy performs, verbatim (R1's own enumerated list):
#     push to the beta ECR repository, register/run/update the beta's own ECS
#     task definitions and services, tag those same resources, and PassRole
#     limited to the beta's own IAM roles. A write verb is always listed by
#     its exact action name -- never behind a wildcard, even a narrow one.
#   - READ statements exist only so `terraform plan`/`apply` can refresh the
#     rest of deploy/aws's state without erroring. Round 3 chased three of
#     these one action at a time (`elasticache:DescribeCacheParameters`,
#     `budgets:ListTagsForResource`, ...) and still wasn't done -- this round
#     closes the class instead: each AWS service deploy/aws touches gets one
#     statement granting that service's Describe*/List*/Get*/View* as a
#     wildcard, so a refresh read Terraform starts calling tomorrow (a new
#     provider version, a new sub-resource) is already covered. A wildcard
#     read statement is scoped to this stack's own beta ARNs whenever that
#     service supports resource-level permissions for reads at all; where it
#     categorically does not (documented per statement, from each service's
#     own IAM reference table), the statement's Resource is "*" -- still
#     Describe*/List*/Get*/View* only, never a write verb riding along.
#     A handful of individual actions are named explicitly instead of
#     wildcarded even inside an otherwise-scoped statement: these are the
#     specific actions a service's IAM reference documents as having no
#     resource type at all (so they could only ever be granted on "*"), kept
#     out of the scoped wildcard so that wildcard does not quietly widen to
#     "*" for the whole service.
locals {
  ecr_repository_arn              = "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/aos-crm-${var.app_environment}"
  ecs_cluster_arn                 = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:cluster/aos-crm-${var.app_environment}"
  ecs_task_definition_arn_pattern = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/aos-crm-${var.app_environment}-*"
  ecs_service_arn_pattern         = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/aos-crm-${var.app_environment}/aos-crm-${var.app_environment}-*"
  ecs_task_role_arn_pattern       = "arn:aws:iam::${var.aws_account_id}:role/aos-crm-${var.app_environment}-ecs-task-*"

  # Every IAM role deploy/aws creates -- the four ECS task roles (iam.tf) and
  # the Lambda logic-function execution role (logic-function.tf, CRM-035) --
  # shares this one prefix. Read-only (Get*/List*): broad enough to cover
  # today's roles and whatever role deploy/aws names the same way next.
  # iam:PassRole stays scoped to ecs_task_role_arn_pattern only (R1: "the
  # beta task roles only") -- the logic-function execution role is never
  # passed by anything this CI role calls (Terraform does not manage the
  # Lambda functions that assume it, logic-function.tf's own comment).
  iam_role_arn_pattern = "arn:aws:iam::${var.aws_account_id}:role/aos-crm-${var.app_environment}-*"
  iam_user_arn_pattern = "arn:aws:iam::${var.aws_account_id}:user/aos-crm-${var.app_environment}-*"

  secret_arn_pattern = "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:aos-crm/${var.app_environment}/*"

  s3_files_bucket_arn                = "arn:aws:s3:::aos-crm-${var.app_environment}-files-${var.aws_account_id}"
  s3_logic_function_layers_bucket_arn = "arn:aws:s3:::aos-crm-${var.app_environment}-logic-function-layers-${var.aws_account_id}"
}

data "aws_iam_policy_document" "permissions" {
  # --- WRITE: exactly R1's enumerated actions, every verb named exactly ----

  # ecr:GetAuthorizationToken has no resource type at all in ECR's IAM
  # reference -- every account's ECR API requires calling it on "*" before
  # any docker login, push or pull. It is a read/auth action, not a write
  # one: it grants no push, pull or repository mutation by itself.
  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushBetaRepository"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [local.ecr_repository_arn]
  }

  # ecs:RegisterTaskDefinition has no resource type in ECS's IAM reference
  # (the new revision's ARN does not exist until the call succeeds, and the
  # family name is a string inside the request, not an ARN component ECS
  # checks against a Resource).
  statement {
    sid       = "EcsRegisterTaskDefinition"
    effect    = "Allow"
    actions   = ["ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid    = "EcsRunMigrateTask"
    effect = "Allow"
    actions = [
      "ecs:RunTask",
    ]
    resources = [local.ecs_task_definition_arn_pattern]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.ecs_cluster_arn]
    }
  }

  statement {
    sid       = "EcsUpdateBetaServices"
    effect    = "Allow"
    actions   = ["ecs:UpdateService"]
    resources = [local.ecs_service_arn_pattern]
  }

  # ecs:TagResource is a write (and the only one among the three resource-ARN
  # Tag/Describe/List companions ecs.tf's provider calls on refresh) -- the
  # read half of that trio (DescribeClusters, ListTagsForResource) lives in
  # the wildcarded EcsReadForPlanRefresh statement below instead.
  statement {
    sid       = "EcsTagBetaResources"
    effect    = "Allow"
    actions   = ["ecs:TagResource"]
    resources = [local.ecs_cluster_arn, local.ecs_service_arn_pattern, local.ecs_task_definition_arn_pattern]
  }

  statement {
    sid       = "PassBetaTaskRolesToEcsOnly"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [local.ecs_task_role_arn_pattern]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # --- READ: only so terraform plan/apply can refresh the rest of
  #     deploy/aws's state, one wildcarded statement per AWS service. -------

  # ECR Describe*/List*/Get* all support resource-level permissions on a
  # repository ARN, except GetAuthorizationToken (EcrAuthToken, above) --
  # scoping this statement to the repository ARN already excludes it, no
  # explicit carve-out needed.
  statement {
    sid       = "EcrReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["ecr:Describe*", "ecr:List*", "ecr:Get*"]
    resources = [local.ecr_repository_arn]
  }

  # ecs:DescribeClusters and ecs:ListTagsForResource support resource-level
  # permissions (cluster/service/task-definition ARNs) and are covered by
  # this scoped wildcard. ecs:DescribeTaskDefinition, ecs:DescribeTasks and
  # ecs:DescribeServices have none in ECS's IAM reference at all -- named
  # explicitly on "*" instead of folded into the wildcard above, so that
  # wildcard does not have to widen to "*" for the rest of the service.
  # DescribeTasks/DescribeServices are also what the migrate-task wait and
  # the services-stable wait at the end of a deploy call, not just Terraform.
  statement {
    sid       = "EcsReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["ecs:Describe*", "ecs:List*"]
    resources = [local.ecs_cluster_arn, local.ecs_service_arn_pattern, local.ecs_task_definition_arn_pattern]
  }

  statement {
    sid    = "EcsReadWithNoResourceLevelPermission"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:DescribeServices",
    ]
    resources = ["*"]
  }

  # iam:Get*/iam:List* support resource-level permissions on a role or user
  # ARN. Scoped to every role deploy/aws names "aos-crm-<app_environment>-*"
  # (the four ECS task roles, iam.tf, and the Lambda logic-function execution
  # role, logic-function.tf/CRM-035) and to the SES SMTP user it creates
  # (ses.tf). Reading either is fine for plan refresh; creating, deleting or
  # modifying either is not (R1's own exclusion), and no such action appears
  # anywhere in this policy.
  statement {
    sid       = "IamReadBetaRolesForPlanRefresh"
    effect    = "Allow"
    actions   = ["iam:Get*", "iam:List*"]
    resources = [local.iam_role_arn_pattern]
  }

  statement {
    sid       = "IamReadBetaSesUserForPlanRefresh"
    effect    = "Allow"
    actions   = ["iam:Get*", "iam:List*"]
    resources = [local.iam_user_arn_pattern]
  }

  # rds:Describe*/List* support resource-level permissions on a DB instance
  # or subnet group ARN.
  statement {
    sid    = "RdsReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "rds:Describe*",
      "rds:List*",
    ]
    resources = [
      "arn:aws:rds:${var.aws_region}:${var.aws_account_id}:db:aos-crm-${var.app_environment}",
      "arn:aws:rds:${var.aws_region}:${var.aws_account_id}:subgrp:aos-crm-${var.app_environment}",
    ]
  }

  # elasticache:Describe*/List* support resource-level permissions on a
  # replication group, cache subnet group or cache parameter group ARN.
  # elasticache:DescribeCacheClusters is the one exception (no resource type
  # in ElastiCache's IAM reference -- aws_elasticache_replication_group's own
  # Read calls it per member cluster to resolve engine_version_actual): named
  # explicitly on "*" instead, so the wildcard above stays scoped.
  statement {
    sid    = "ElastiCacheReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "elasticache:Describe*",
      "elasticache:List*",
    ]
    resources = [
      "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:replicationgroup:aos-crm-${var.app_environment}",
      "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:subnetgroup:aos-crm-${var.app_environment}",
      "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:parametergroup:aos-crm-${var.app_environment}",
    ]
  }

  statement {
    sid       = "ElastiCacheReadWithNoResourceLevelPermission"
    effect    = "Allow"
    actions   = ["elasticache:DescribeCacheClusters"]
    resources = ["*"]
  }

  # s3:Get*/List* support resource-level permissions on a bucket ARN. Both
  # buckets deploy/aws's provider reads on every refresh (every Get* action
  # for the bucket's own backward-compatible computed attributes, regardless
  # of which sub-resources have a Terraform resource here, s3.tf's `files`
  # and logic-function.tf's `logic_function_layers`, CRM-035) are covered by
  # one wildcarded statement instead of the enumerated, drift-prone list
  # round 3 maintained by hand.
  statement {
    sid       = "S3ReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["s3:Get*", "s3:List*"]
    resources = [local.s3_files_bucket_arn, local.s3_logic_function_layers_bucket_arn]
  }

  # secretsmanager:Describe*/Get*/List* all support resource-level
  # permissions on a secret ARN -- one wildcard covers every secret under
  # aos-crm/<app_environment>/ (secrets.tf, ses.tf, logic-function.tf/CRM-035)
  # and whatever refresh read Terraform adds next (DescribeSecret,
  # GetResourcePolicy, GetSecretValue and ListSecretVersionIds today).
  statement {
    sid       = "SecretsManagerReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["secretsmanager:Describe*", "secretsmanager:Get*", "secretsmanager:List*"]
    resources = [local.secret_arn_pattern]
  }

  # logs:ListTagsForResource supports a log-group ARN; logs:DescribeLogGroups
  # is a list call with no resource-level permission in CloudWatch Logs' IAM
  # reference (it takes a name pattern, not an ARN) -- named explicitly on
  # "*" instead of folded into a wildcard.
  statement {
    sid       = "LogsReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["logs:List*"]
    resources = ["arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/ecs/aos-crm-${var.app_environment}/*"]
  }

  statement {
    sid       = "LogsReadWithNoResourceLevelPermission"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  # budgets:ViewBudget and budgets:ListTagsForResource both support
  # resource-level permissions on a budget ARN -- the wildcard closes the gap
  # round 3 found (ListTagsForResource was missing) and whatever read Budgets
  # adds next.
  statement {
    sid       = "BudgetsReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["budgets:View*", "budgets:List*"]
    resources = ["arn:aws:budgets::${var.aws_account_id}:budget/aos-crm-${var.app_environment}-monthly"]
  }

  # EC2 (VPC/subnets/security groups/NAT/IGW/route tables, network.tf and
  # security-groups.tf), ELBv2 (ALB/listener/target group, alb-acm.tf), ACM
  # (the wildcard certificate, alb-acm.tf), Route 53 (the hosted zone and
  # every record, data.tf/alb-acm.tf/ses.tf) and SESv2 (the domain identity,
  # ses.tf) do not support resource-level permissions for Describe*/List*/
  # Get* in any of those five services' IAM reference tables -- every one of
  # those actions is documented against resource type "*" only, regardless
  # of how the resource is named or tagged. Granting them scoped to a name
  # prefix is not an option AWS offers; a hosted zone id and an SES identity
  # ARN are also themselves account-specific values (like domain_name in
  # ../../aws/variables.tf) that this public fork does not commit, so there
  # is no name to scope by even in principle. Every action below is
  # read-only (Describe*/List*/Get*); no write verb for any of these five
  # services appears anywhere in this policy.
  statement {
    sid    = "NoResourceLevelPermissionReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "ec2:Describe*",
      "elasticloadbalancing:Describe*",
      "acm:Describe*",
      "acm:List*",
      "acm:Get*",
      "route53:Get*",
      "route53:List*",
      "sesv2:Get*",
      "sesv2:List*",
    ]
    resources = ["*"]
  }

  # --- Terraform remote state backend ---------------------------------------

  statement {
    sid       = "TerraformStateObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}/${var.state_key_prefix}/*"]
  }

  statement {
    sid       = "TerraformStateBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.state_key_prefix}/*"]
    }
  }

  statement {
    sid    = "TerraformStateLock"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${var.state_lock_table_name}"]
  }
}
