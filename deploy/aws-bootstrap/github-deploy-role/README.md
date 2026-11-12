# GitHub deploy role (CRM-024)

Small, standalone Terraform stack that creates exactly one thing: the IAM
role `aos-crm-beta-deploy-github`, trusted only through the account's
existing GitHub Actions OIDC provider, for `.github/workflows/deploy-beta.yaml`
to assume. It is deliberately separate from `deploy/aws`: that stack is the
beta application itself, applied repeatedly as `image_digest` changes; this
one is applied once (and only re-applied if the trust or permission policy
itself needs to change), by a human, with the founder's OK.

**This track validates the IaC statically and never applies it.** No AWS
credential, no `plan` and no `apply` ran from this worker -- same invariant
as `../../aws/README.md`.

## What it needs that is not in the repo

- `aws_account_id` (12 digits): the account `deploy/aws` runs in.
- `state_bucket_name`: the S3 bucket `deploy/aws`'s backend uses (the same
  bucket name passed to that stack's `terraform init -backend-config`).

Both are account-specific and therefore not committed, exactly like
`domain_name` in `../../aws/variables.tf`. Pass them with `-var` or a
`terraform.tfvars` here (gitignored the same way).

## How the infrastructure session applies it

From a machine with SSO credentials for this account (the same session that
applies `deploy/aws`), with the founder's explicit OK:

```sh
cd deploy/aws-bootstrap/github-deploy-role
terraform init
terraform plan \
  -var="aws_account_id=<12-digit account id>" \
  -var="state_bucket_name=<the deploy/aws state bucket>"
# review the plan, then:
terraform apply \
  -var="aws_account_id=<12-digit account id>" \
  -var="state_bucket_name=<the deploy/aws state bucket>"
terraform output -raw role_arn
```

`terraform plan` is the first command here that reaches AWS: the OIDC
provider lookup (`data.tf`) needs real credentials, which is exactly why
R4's evidence could not include a real plan output and instead carries a
static rendering of the trust and permission policy documents.

## What goes into GitHub, and where

All four live on the GitHub **Environment** named `beta` (Settings →
Environments → beta), not as repository-wide secrets/variables -- that is
what makes the trust policy's `environment:beta` claim meaningful.

| Name | Kind | Value |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | Environment variable | `terraform output -raw role_arn` above |
| `AWS_REGION` | Environment variable | the region `deploy/aws` runs in (`eu-west-1`) |
| `AWS_TFSTATE_BUCKET` | Environment variable | the same `state_bucket_name` passed above |
| `AWS_TFVARS` | Environment secret | the full contents of `deploy/aws/terraform.tfvars` |

Consider also requiring the founder as a reviewer of the `beta` environment
(Settings → Environments → beta → "Required reviewers"): that makes every
dispatch of `deploy-beta.yaml` wait for an explicit approval before the role
is ever assumed, which is the "founder's OK each time" the spec asks for
(`specs/despliegue-github/spec.md`'s Purpose).

## Permissions, by service

The full statements and their scoping live in `policy.tf`; this is the final
action list per service, for anyone auditing the role without reading HCL.
Writes are scoped to `aos-crm-<app_environment>*` resources (or the beta's
state object/lock row); reads needed only so `terraform plan`/`apply` can
refresh the rest of `deploy/aws` are scoped the same way wherever the service
supports it, and to `*` only where the service's own IAM reference has no
resource-level permission for that action (documented in `policy.tf`,
statement by statement).

| Service | Actions |
| --- | --- |
| ECR | `GetAuthorizationToken`, `BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `BatchGetImage`, `GetDownloadUrlForLayer`, `DescribeRepositories`, `DescribeImages`, `ListTagsForResource`, `GetLifecyclePolicy`, `GetRepositoryPolicy` |
| ECS | `RegisterTaskDefinition`, `RunTask`, `UpdateService`, `DescribeTasks`, `DescribeServices`, `DescribeTaskDefinition`, `DescribeClusters`, `ListTagsForResource`, `TagResource` |
| IAM | `PassRole` (beta task roles only); `GetRole`, `GetRolePolicy`, `ListRolePolicies`, `ListAttachedRolePolicies`, `ListRoleTags`, `ListInstanceProfilesForRole` (beta task roles); `GetUser`, `GetUserPolicy`, `ListUserPolicies`, `ListAttachedUserPolicies`, `ListAccessKeys` (the SES SMTP user) |
| RDS | `DescribeDBInstances`, `DescribeDBSubnetGroups`, `ListTagsForResource` |
| ElastiCache | `DescribeReplicationGroups`, `DescribeCacheSubnetGroups`, `DescribeCacheParameterGroups`, `ListTagsForResource` (scoped); `DescribeCacheClusters` (no resource-level permission, `*`) |
| S3 (files bucket) | `GetBucketAcl`, `GetBucketCORS`, `GetBucketPolicy`, `GetBucketVersioning`, `GetEncryptionConfiguration`, `GetBucketLogging`, `GetLifecycleConfiguration`, `GetBucketOwnershipControls`, `GetBucketPublicAccessBlock`, `GetBucketTagging`, `GetBucketWebsite`, `GetAccelerateConfiguration`, `GetBucketRequestPayment`, `GetReplicationConfiguration`, `GetBucketObjectLockConfiguration`, `ListBucket` |
| S3 (Terraform state) | `GetObject`, `PutObject`, `ListBucket` |
| Secrets Manager | `DescribeSecret`, `GetResourcePolicy`, `ListSecretVersionIds`, `GetSecretValue` |
| CloudWatch Logs | `ListTagsForResource` (scoped to the log-group ARN pattern); `DescribeLogGroups` (no resource-level permission, `*`) |
| Budgets | `ViewBudget` |
| EC2 | `DescribeVpcs`, `DescribeVpcAttribute`, `DescribeSubnets`, `DescribeInternetGateways`, `DescribeNatGateways`, `DescribeAddresses`, `DescribeNetworkInterfaces`, `DescribeRouteTables`, `DescribeSecurityGroups`, `DescribeSecurityGroupRules`, `DescribeAvailabilityZones`, `DescribeTags` |
| ELBv2 | `DescribeLoadBalancers`, `DescribeLoadBalancerAttributes`, `DescribeListeners`, `DescribeRules`, `DescribeTargetGroups`, `DescribeTargetGroupAttributes`, `DescribeTargetHealth`, `DescribeTags` |
| ACM | `DescribeCertificate`, `ListTagsForCertificate`, `GetCertificate` |
| Route 53 | `GetHostedZone`, `ListHostedZonesByName`, `ListResourceRecordSets`, `ListTagsForResource` |
| SES (sesv2) | `GetEmailIdentity`, `ListTagsForResource` |
| DynamoDB (state lock) | `GetItem`, `PutItem`, `DeleteItem` |

## Refresh reads, by resource type

Self-check: every `resource`/`data` block in `../../aws/*.tf` that reaches
AWS, the read actions its refresh calls, and the `policy.tf` statement that
grants them. Resources with no AWS-facing read (`random_password`, and the
`aws_iam_policy_document` data sources, which are rendered locally) are
left out.

| Resource type (`deploy/aws`) | Refresh reads | Granted by |
| --- | --- | --- |
| `aws_vpc`, `aws_subnet`, `aws_internet_gateway`, `aws_nat_gateway`, `aws_eip`, `aws_route_table`, `aws_route_table_association` (`network.tf`) | `ec2:DescribeVpcs`, `DescribeVpcAttribute`, `DescribeSubnets`, `DescribeInternetGateways`, `DescribeNatGateways`, `DescribeAddresses`, `DescribeRouteTables`, `DescribeTags` | `NoResourceLevelPermissionReadForPlanRefresh` (`*`: none of these support resource-level permissions) |
| `data.aws_availability_zones.available` (`network.tf`) | `ec2:DescribeAvailabilityZones` | `NoResourceLevelPermissionReadForPlanRefresh` |
| `aws_security_group`, `aws_security_group_rule` (`security-groups.tf`) | `ec2:DescribeSecurityGroups`, `DescribeSecurityGroupRules`, `DescribeNetworkInterfaces` (ENI attachment), `DescribeTags` | `NoResourceLevelPermissionReadForPlanRefresh` |
| `aws_acm_certificate`, `aws_acm_certificate_validation` (`alb-acm.tf`) | `acm:DescribeCertificate`, `ListTagsForCertificate`, `GetCertificate` | `NoResourceLevelPermissionReadForPlanRefresh` (ACM has no resource-level permissions) |
| `aws_lb`, `aws_lb_target_group`, `aws_lb_listener`, `aws_lb_listener_rule` (`alb-acm.tf`, `favicon-redirects.tf`) | `elasticloadbalancing:DescribeLoadBalancers`, `DescribeLoadBalancerAttributes`, `DescribeListeners`, `DescribeRules`, `DescribeTargetGroups`, `DescribeTargetGroupAttributes`, `DescribeTargetHealth`, `DescribeTags` | `NoResourceLevelPermissionReadForPlanRefresh` (ELBv2 has no resource-level permissions) |
| `data.aws_route53_zone.this`, `aws_route53_record` (all) (`data.tf`, `alb-acm.tf`, `ses.tf`) | `route53:GetHostedZone`, `ListHostedZonesByName`, `ListResourceRecordSets`, `ListTagsForResource` | `NoResourceLevelPermissionReadForPlanRefresh` (Route 53 has no resource-level permissions) |
| `aws_ecr_repository`, `aws_ecr_lifecycle_policy` (`ecr.tf`) | `ecr:DescribeRepositories`, `DescribeImages`, `GetLifecyclePolicy`, `GetRepositoryPolicy`, `ListTagsForResource` | `EcrPushBetaRepository` (scoped to the repository ARN) |
| `aws_ecs_cluster` (`ecs.tf`) | `ecs:DescribeClusters`, `ListTagsForResource` | `EcsDescribeAndTagForPlanRefresh` (scoped) |
| `aws_ecs_task_definition` (migrate/server/worker, `ecs.tf`) | `ecs:DescribeTaskDefinition` (`*`, no resource type), `ListTagsForResource` (scoped) | `EcsDescribeTaskDefinitionForPlanRefresh` + `EcsDescribeAndTagForPlanRefresh` |
| `aws_ecs_service` (server/worker, `ecs.tf`) | `ecs:DescribeServices` (`*`, no resource type), `ListTagsForResource` (scoped) | `EcsDescribeForWaiters` + `EcsDescribeAndTagForPlanRefresh` |
| `aws_iam_role` (execution/server/worker/migrate), `aws_iam_role_policy`, `aws_iam_role_policy_attachment` (`iam.tf`) | `iam:GetRole`, `GetRolePolicy`, `ListRolePolicies`, `ListAttachedRolePolicies`, `ListRoleTags`, `ListInstanceProfilesForRole` | `IamReadBetaTaskRolesForPlanRefresh` (scoped to the `*-ecs-task-*` role ARN pattern) |
| `aws_cloudwatch_log_group` (server/worker/migrate, `logs.tf`) | `logs:ListTagsForResource` (scoped), `logs:DescribeLogGroups` (`*`, no resource type) | `LogsReadForPlanRefresh` + `NoResourceLevelPermissionReadForPlanRefresh` |
| `aws_db_instance`, `aws_db_subnet_group` (`rds.tf`) | `rds:DescribeDBInstances`, `DescribeDBSubnetGroups`, `ListTagsForResource` | `RdsReadForPlanRefresh` (scoped) |
| `aws_elasticache_subnet_group`, `aws_elasticache_parameter_group` (`redis.tf`) | `elasticache:DescribeCacheSubnetGroups`, `DescribeCacheParameterGroups`, `ListTagsForResource` | `ElastiCacheReadForPlanRefresh` (scoped) |
| `aws_elasticache_replication_group` (`redis.tf`) | `elasticache:DescribeReplicationGroups`, `ListTagsForResource` (scoped); `DescribeCacheClusters` (`*`, no resource type -- reads the member cluster for `engine_version_actual`) | `ElastiCacheReadForPlanRefresh` + `NoResourceLevelPermissionReadForPlanRefresh` |
| `aws_s3_bucket`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_versioning`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_policy` (`s3.tf`) | `s3:GetBucketAcl`, `GetBucketCORS`, `GetBucketPolicy`, `GetBucketVersioning`, `GetEncryptionConfiguration`, `GetBucketLogging`, `GetLifecycleConfiguration`, `GetBucketOwnershipControls`, `GetBucketPublicAccessBlock`, `GetBucketTagging`, `GetBucketWebsite`, `GetAccelerateConfiguration`, `GetBucketRequestPayment`, `GetReplicationConfiguration`, `GetBucketObjectLockConfiguration`, `ListBucket` | `S3ReadFilesBucketForPlanRefresh` (scoped to the files bucket ARN) |
| `aws_secretsmanager_secret`, `aws_secretsmanager_secret_version` (`secrets.tf`, `ses.tf`, 5 secrets) | `secretsmanager:DescribeSecret`, `GetResourcePolicy`, `ListSecretVersionIds`, `GetSecretValue` | `SecretsManagerReadForPlanRefresh` (scoped to `aos-crm/<env>/*`) |
| `aws_budgets_budget` (`budgets.tf`) | `budgets:ViewBudget` | `BudgetsReadForPlanRefresh` (scoped) |
| `aws_sesv2_email_identity`, `aws_sesv2_email_identity_mail_from_attributes` (`ses.tf`) | `sesv2:GetEmailIdentity`, `ListTagsForResource` | `NoResourceLevelPermissionReadForPlanRefresh` (sesv2 has no resource-level permissions) |
| `aws_iam_user`, `aws_iam_user_policy`, `aws_iam_access_key` (`ses_smtp`, `ses.tf`) | `iam:GetUser`, `GetUserPolicy`, `ListUserPolicies`, `ListAttachedUserPolicies`, `ListAccessKeys` | `IamReadBetaSesUserForPlanRefresh` (scoped to the `*-ses-smtp` user ARN pattern) |
| `data.aws_caller_identity.current` (`data.tf`) | `sts:GetCallerIdentity` | none needed -- every authenticated principal can call it on itself, no IAM grant required |

## Re-applying after a permission change

If `deploy/aws` starts managing a new resource type, or the workflow needs a
new action, this stack is the one to change -- never widen the role by hand
in the console. Re-run `terraform plan`/`apply` here the same way, with the
founder's OK, and the running `deploy-beta.yaml` workflow does not need any
change: it only ever reads `AWS_DEPLOY_ROLE_ARN`.
