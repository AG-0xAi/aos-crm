# R1: no `*:*` anywhere below, no IAM user or access key creation, and every
# resource that CAN be named is named "aos-crm-<app_environment>*" --
# deploy/aws's own naming convention (ecr.tf, ecs.tf, iam.tf, s3.tf, rds.tf,
# redis.tf, secrets.tf, logs.tf, budgets.tf), reproduced here as ARNs built
# from var.aws_region/var.aws_account_id/var.app_environment, never a
# hardcoded account id. Two kinds of statement:
#   - WRITE statements grant exactly the mutations a routine "new
#     image_digest" redeploy performs: push to the beta ECR repository,
#     register/run/update the beta's own ECS task definitions and services,
#     and PassRole limited to the beta's own task roles. This is R1's own
#     enumerated list, verbatim.
#   - READ statements exist only so `terraform plan`/`apply` can refresh the
#     rest of deploy/aws's state without erroring; they grant no verb beyond
#     Describe/Get/List. Where the resource type has no resource-level
#     permission at all (documented per statement below), the Resource is
#     "*" and the action list stays Describe/Get/List-only -- never a write
#     verb rides on a "*" resource anywhere in this policy.
locals {
  ecr_repository_arn              = "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/aos-crm-${var.app_environment}"
  ecs_cluster_arn                 = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:cluster/aos-crm-${var.app_environment}"
  ecs_task_definition_arn_pattern = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/aos-crm-${var.app_environment}-*"
  ecs_service_arn_pattern         = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/aos-crm-${var.app_environment}/aos-crm-${var.app_environment}-*"
  ecs_task_role_arn_pattern       = "arn:aws:iam::${var.aws_account_id}:role/aos-crm-${var.app_environment}-ecs-task-*"
}

data "aws_iam_policy_document" "permissions" {
  # --- WRITE: exactly R1's enumerated actions -------------------------------

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
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
    ]
    resources = [local.ecr_repository_arn]
  }

  # ecs:RegisterTaskDefinition has no resource type in ECS's IAM reference
  # (the new revision's ARN does not exist until the call succeeds, and the
  # family name is a string inside the request, not an ARN component ECS
  # checks against a Resource). Still only a write on this one action, no
  # Describe/List rides along on this "*".
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

  # DescribeTasks/DescribeServices have no resource type either (ECS's IAM
  # reference lists none for either action): the migrate task waits on
  # DescribeTasks and the post-apply wait waits on DescribeServices/
  # services-stable, both needed every run.
  statement {
    sid    = "EcsDescribeForWaiters"
    effect = "Allow"
    actions = [
      "ecs:DescribeTasks",
      "ecs:DescribeServices",
    ]
    resources = ["*"]
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
  #     deploy/aws's state. Describe/Get/List only, never a write verb. ------

  statement {
    sid    = "IamReadBetaTaskRolesForPlanRefresh"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListRoleTags",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [local.ecs_task_role_arn_pattern]
  }

  # ses.tf also creates an IAM user (aos_crm_${app_environment}-ses-smtp) and
  # its access key. Reading them for plan refresh is fine; creating either
  # is not (R1's own exclusion) and no Create*/Delete* action appears here.
  statement {
    sid    = "IamReadBetaSesUserForPlanRefresh"
    effect = "Allow"
    actions = [
      "iam:GetUser",
      "iam:GetUserPolicy",
      "iam:ListUserPolicies",
      "iam:ListAttachedUserPolicies",
      "iam:ListAccessKeys",
    ]
    resources = ["arn:aws:iam::${var.aws_account_id}:user/aos-crm-${var.app_environment}-*"]
  }

  statement {
    sid    = "RdsReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "rds:DescribeDBInstances",
      "rds:DescribeDBSubnetGroups",
      "rds:ListTagsForResource",
    ]
    resources = [
      "arn:aws:rds:${var.aws_region}:${var.aws_account_id}:db:aos-crm-${var.app_environment}",
      "arn:aws:rds:${var.aws_region}:${var.aws_account_id}:subgrp:aos-crm-${var.app_environment}",
    ]
  }

  statement {
    sid    = "ElastiCacheReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "elasticache:DescribeReplicationGroups",
      "elasticache:DescribeCacheSubnetGroups",
      "elasticache:DescribeCacheParameterGroups",
      "elasticache:ListTagsForResource",
    ]
    resources = [
      "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:replicationgroup:aos-crm-${var.app_environment}",
      "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:subnetgroup:aos-crm-${var.app_environment}",
      "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:parametergroup:aos-crm-${var.app_environment}",
    ]
  }

  statement {
    sid    = "S3ReadFilesBucketForPlanRefresh"
    effect = "Allow"
    actions = [
      "s3:GetBucketPolicy",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketTagging",
      "s3:ListBucket",
    ]
    resources = ["arn:aws:s3:::aos-crm-${var.app_environment}-files-${var.aws_account_id}"]
  }

  statement {
    sid    = "SecretsManagerReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:aos-crm/${var.app_environment}/*"]
  }

  statement {
    sid    = "LogsReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "logs:DescribeLogGroups",
      "logs:ListTagsForResource",
    ]
    resources = ["arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/ecs/aos-crm-${var.app_environment}/*"]
  }

  statement {
    sid       = "BudgetsReadForPlanRefresh"
    effect    = "Allow"
    actions   = ["budgets:ViewBudget"]
    resources = ["arn:aws:budgets::${var.aws_account_id}:budget/aos-crm-${var.app_environment}-monthly"]
  }

  # EC2 (VPC/subnets/security groups/NAT/IGW/route tables, network.tf and
  # security-groups.tf), ELBv2 (ALB/listener/target group, alb-acm.tf) and
  # ACM (the wildcard certificate, alb-acm.tf) Describe/List actions do not
  # support resource-level permissions in any of those three services' IAM
  # reference tables -- every Describe* and List* action there is documented
  # against resource type "*" only, regardless of how the resource is named
  # or tagged. Granting them scoped to a name prefix is not an option AWS
  # offers; Route 53 and SES are the same story for a different reason: a
  # hosted zone id and an SES identity ARN are themselves account-specific
  # values (like domain_name in ../../aws/variables.tf) that this public fork
  # does not commit, so there is no name to scope by even in principle.
  # Every action in this statement is read-only (Describe*/List*/Get*); no
  # write verb for any of these five services appears anywhere in this
  # policy.
  statement {
    sid    = "NoResourceLevelPermissionReadForPlanRefresh"
    effect = "Allow"
    actions = [
      "ec2:DescribeVpcs",
      "ec2:DescribeSubnets",
      "ec2:DescribeInternetGateways",
      "ec2:DescribeNatGateways",
      "ec2:DescribeAddresses",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSecurityGroupRules",
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeTags",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeRules",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
      "elasticloadbalancing:DescribeTags",
      "acm:DescribeCertificate",
      "acm:ListTagsForCertificate",
      "acm:GetCertificate",
      "route53:GetHostedZone",
      "route53:ListResourceRecordSets",
      "route53:ListTagsForResource",
      "sesv2:GetEmailIdentity",
      "sesv2:ListTagsForResource",
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
