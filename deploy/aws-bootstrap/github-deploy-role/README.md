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
- `permissions_boundary_arn`: the account's `aos-limite-roles` managed
  policy ARN. Same value passed to `deploy/aws` (CRM-027) -- this role is
  itself an `aos-*` role and the account's own IAM setup rejects creating
  one without it (variables.tf's validation catches a missing/malformed
  value before that point).

All three are account-specific and therefore not committed, exactly like
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
  -var="state_bucket_name=<the deploy/aws state bucket>" \
  -var="permissions_boundary_arn=<arn:aws:iam::<account id>:policy/aos-limite-roles>"
# review the plan, then:
terraform apply \
  -var="aws_account_id=<12-digit account id>" \
  -var="state_bucket_name=<the deploy/aws state bucket>" \
  -var="permissions_boundary_arn=<arn:aws:iam::<account id>:policy/aos-limite-roles>"
terraform output -raw role_arn
```

**The first `deploy-beta.yaml` run through this role is also the
infrastructure session's or the founder's to trigger**, not CI's own
initiative: until the founder authorizes it, nobody dispatches the workflow
against the real `beta` environment, even though the role and the GitHub
Environment already exist (BETA_RUNBOOK.md, "Desplegar y volver atrás desde
GitHub").

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
| `SIGNUP_WEBHOOK_URL` | Environment secret | the value of `deploy/aws`'s `signup_webhook_url` variable (BETA_RUNBOOK.md §10) -- passed to the plan step as `TF_VAR_signup_webhook_url`, never written into `AWS_TFVARS` or echoed |

Consider also requiring the founder as a reviewer of the `beta` environment
(Settings → Environments → beta → "Required reviewers"): that makes every
dispatch of `deploy-beta.yaml` wait for an explicit approval before the role
is ever assumed, which is the "founder's OK each time" the spec asks for
(`specs/despliegue-github/spec.md`'s Purpose).

## Permissions boundary

Since 08/11/2026 every `aos-*` role in the account must carry the managed
policy `aos-limite-roles` as its permissions boundary (CRM-027) -- `role.tf`
sets `permissions_boundary = var.permissions_boundary_arn` on this role too,
and `variables.tf` rejects `plan`/`apply` outright if the ARN is missing or
malformed. A boundary is a ceiling, not a grant: it only matters once a
role's own policy tries to go past it, so every action in `policy.tf` was
checked against the boundary's JSON document (kept outside the repo; read,
never copied in) statement by statement:

- `ServiciosDeLasCargas` (`Allow`, `NotAction` on `iam:*`/`organizations:*`/
  `account:*`/`sso*`/`identitystore:*`/`identity-sync:*`/`sts:*`/`signin:*`,
  `Resource: *`) covers every non-IAM action this policy grants -- ECR, ECS
  (including `TagResource`), RDS, ElastiCache, S3, Secrets Manager, Budgets,
  CloudWatch Logs, EC2, ELBv2, ACM, Route 53, SESv2 and the two DynamoDB
  state-lock actions. None of this policy's actions belong to a service the
  boundary excludes from that statement.
- `LeerIamYQuienSoy` (`Allow`, `iam:Get*`, `iam:List*`, `sts:GetCallerIdentity`,
  `Resource: *`) covers every `iam:Get*`/`iam:List*` action this policy
  grants (`IamReadBetaRolesForPlanRefresh`, `IamReadBetaSesUserForPlanRefresh`).
- `PasarRolesDeAosASusServicios` (`Allow`, `iam:PassRole` on `role/aos-*`,
  condition `iam:PassedToService` in `ecs-tasks.amazonaws.com`/
  `ec2.amazonaws.com`/`backup.amazonaws.com`) covers this policy's one
  `iam:PassRole` statement (`PassBetaTaskRolesToEcsOnly`, scoped to the ECS
  task role ARN pattern, `ecs-tasks.amazonaws.com` only -- a subset of what
  the boundary allows).
- Nothing in `policy.tf` touches an `iam:*` write (`Create*`/`Put*`/`Delete*`/
  `Attach*`/`Detach*`/`Update*`), `organizations:*`, `account:*`, any `sso*`,
  `sts:*` beyond `GetCallerIdentity`, or `signin:*` -- the boundary would deny
  all of those, and the CI IAM stop (`.github/workflows/deploy-beta.yaml`)
  fails the run before `apply` if a plan ever tries one anyway.
- The boundary's `Deny` statement (`cloudtrail:StopLogging`/`DeleteTrail`/
  `UpdateTrail`/`PutEventSelectors`, GuardDuty/Config/Access-Analyzer
  deletion and update actions, `ec2:ModifyInstanceMetadataOptions`) names no
  action this policy grants.

## Permissions, by service

The full statements and their scoping live in `policy.tf`; this is the final
action list per service, for anyone auditing the role without reading HCL.
Writes are always a named action, never a wildcard, scoped to
`aos-crm-<app_environment>*` resources (or the beta's state object/lock row).
Reads are a `Describe*`/`List*`/`Get*`/`View*` wildcard, scoped the same way
wherever the service supports resource-level permissions for reads at all;
where a specific action has none in that service's own IAM reference table
(documented in `policy.tf`, statement by statement), it is named explicitly
on `*` instead of folded into the wildcard, so the wildcard never quietly
widens past the beta's own resources.

| Service | Writes (named) | Reads (wildcarded, scope) |
| --- | --- | --- |
| ECR | `GetAuthorizationToken` (`*`, no resource type); `BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `BatchGetImage`, `GetDownloadUrlForLayer` | `Describe*`, `List*`, `Get*` (repository ARN) |
| ECS | `RegisterTaskDefinition` (`*`, no resource type); `RunTask`, `UpdateService`, `TagResource` | `Describe*`, `List*` (cluster/service/task-definition ARNs); `DescribeTaskDefinition`, `DescribeTasks`, `DescribeServices` named on `*` (no resource type) |
| IAM | `PassRole` (ECS task role ARN pattern only, `PassedToService=ecs-tasks.amazonaws.com`) | `Get*`, `List*` (every `aos-crm-<app_environment>-*` role ARN, the SES SMTP user ARN) |
| RDS | -- | `Describe*`, `List*` (DB instance and subnet group ARNs) |
| ElastiCache | -- | `Describe*`, `List*` (replication group/subnet group/parameter group ARNs); `DescribeCacheClusters` named on `*` (no resource type) |
| S3 (files + logic-function-layers buckets) | -- | `Get*`, `List*` (both bucket ARNs) |
| S3 (Terraform state) | `GetObject`, `PutObject`, `ListBucket` (the beta's own state key/bucket) | -- |
| Secrets Manager | -- | `Describe*`, `Get*`, `List*` (`aos-crm/<app_environment>/*` secret ARN pattern) |
| CloudWatch Logs | -- | `List*` (log-group ARN pattern); `DescribeLogGroups` named on `*` (no resource type) |
| Budgets | -- | `View*`, `List*` (budget ARN) |
| EC2, ELBv2, ACM, Route 53, SESv2 | -- | `Describe*`/`List*`/`Get*` named on `*` (none of these five services has resource-level permissions for reads at all) |
| DynamoDB (state lock) | `GetItem`, `PutItem`, `DeleteItem` (the beta's own lock table) | -- |

## Refresh reads, by resource type

Self-check: every `resource`/`data` block in `../../aws/*.tf` that reaches
AWS, the read actions its refresh calls, and the `policy.tf` statement that
grants them. Resources with no AWS-facing read (`random_password`, and the
`aws_iam_policy_document` data sources, which are rendered locally) are
left out.

| Resource type (`deploy/aws`) | Refresh reads | Granted by |
| --- | --- | --- |
| `aws_vpc`, `aws_subnet`, `aws_internet_gateway`, `aws_nat_gateway`, `aws_eip`, `aws_route_table`, `aws_route_table_association` (`network.tf`) | `ec2:Describe*` | `NoResourceLevelPermissionReadForPlanRefresh` (`*`: none of these support resource-level permissions) |
| `data.aws_availability_zones.available` (`network.tf`) | `ec2:DescribeAvailabilityZones` | `NoResourceLevelPermissionReadForPlanRefresh` |
| `aws_security_group`, `aws_security_group_rule` (`security-groups.tf`) | `ec2:Describe*` (security groups/rules/network interfaces/tags) | `NoResourceLevelPermissionReadForPlanRefresh` |
| `aws_acm_certificate`, `aws_acm_certificate_validation` (`alb-acm.tf`) | `acm:Describe*`, `List*`, `Get*` | `NoResourceLevelPermissionReadForPlanRefresh` (ACM has no resource-level permissions) |
| `aws_lb`, `aws_lb_target_group`, `aws_lb_listener`, `aws_lb_listener_rule` (`alb-acm.tf`, `favicon-redirects.tf`) | `elasticloadbalancing:Describe*` | `NoResourceLevelPermissionReadForPlanRefresh` (ELBv2 has no resource-level permissions) |
| `data.aws_route53_zone.this`, `aws_route53_record` (all) (`data.tf`, `alb-acm.tf`, `ses.tf`) | `route53:Get*`, `List*` | `NoResourceLevelPermissionReadForPlanRefresh` (Route 53 has no resource-level permissions) |
| `aws_ecr_repository`, `aws_ecr_lifecycle_policy` (`ecr.tf`) | `ecr:Describe*`, `List*`, `Get*` | `EcrReadForPlanRefresh` (scoped to the repository ARN) |
| `aws_ecs_cluster` (`ecs.tf`) | `ecs:DescribeClusters`, `ListTagsForResource` | `EcsReadForPlanRefresh` (scoped) |
| `aws_ecs_task_definition` (migrate/server/worker, `ecs.tf`) | `ecs:DescribeTaskDefinition` (`*`, no resource type), `ListTagsForResource` (scoped) | `EcsReadWithNoResourceLevelPermission` + `EcsReadForPlanRefresh` |
| `aws_ecs_service` (server/worker, `ecs.tf`) | `ecs:DescribeServices` (`*`, no resource type), `ListTagsForResource` (scoped) | `EcsReadWithNoResourceLevelPermission` + `EcsReadForPlanRefresh` |
| `aws_iam_role` (execution/server/worker/migrate, `iam.tf`), `aws_iam_role` (logic-function execution, `logic-function.tf`, CRM-035), `aws_iam_role_policy`, `aws_iam_role_policy_attachment` | `iam:GetRole`, `GetRolePolicy`, `ListRolePolicies`, `ListAttachedRolePolicies`, `ListRoleTags`, `ListInstanceProfilesForRole` | `IamReadBetaRolesForPlanRefresh` (scoped to the `aos-crm-<app_environment>-*` role ARN pattern) |
| `aws_cloudwatch_log_group` (server/worker/migrate, `logs.tf`) | `logs:ListTagsForResource` (scoped), `logs:DescribeLogGroups` (`*`, no resource type) | `LogsReadForPlanRefresh` + `LogsReadWithNoResourceLevelPermission` |
| `aws_db_instance`, `aws_db_subnet_group` (`rds.tf`) | `rds:Describe*`, `List*` | `RdsReadForPlanRefresh` (scoped) |
| `aws_elasticache_subnet_group`, `aws_elasticache_parameter_group` (`redis.tf`) | `elasticache:Describe*`, `List*` | `ElastiCacheReadForPlanRefresh` (scoped) |
| `aws_elasticache_replication_group` (`redis.tf`) | `elasticache:DescribeReplicationGroups`, `ListTagsForResource` (scoped); `DescribeCacheClusters` (`*`, no resource type -- reads the member cluster for `engine_version_actual`) | `ElastiCacheReadForPlanRefresh` + `ElastiCacheReadWithNoResourceLevelPermission` |
| `aws_s3_bucket`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_versioning`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_policy` (`files`, `s3.tf`) | `s3:Get*`, `List*` | `S3ReadForPlanRefresh` (scoped to the files bucket ARN) |
| `aws_s3_bucket`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_ownership_controls`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_lifecycle_configuration` (`logic_function_layers`, `logic-function.tf`, CRM-035) | `s3:Get*`, `List*` | `S3ReadForPlanRefresh` (scoped to the logic-function-layers bucket ARN) |
| `aws_secretsmanager_secret`, `aws_secretsmanager_secret_version` (`secrets.tf`, `ses.tf`, `logic-function.tf`, 7 secrets) | `secretsmanager:Describe*`, `Get*`, `List*` | `SecretsManagerReadForPlanRefresh` (scoped to `aos-crm/<app_environment>/*`) |
| `aws_budgets_budget` (`budgets.tf`) | `budgets:ViewBudget`, `ListTagsForResource` | `BudgetsReadForPlanRefresh` (scoped) |
| `aws_sesv2_email_identity`, `aws_sesv2_email_identity_mail_from_attributes` (`ses.tf`) | `sesv2:Get*`, `List*` | `NoResourceLevelPermissionReadForPlanRefresh` (sesv2 has no resource-level permissions) |
| `aws_iam_user`, `aws_iam_user_policy`, `aws_iam_access_key` (`ses_smtp`, `ses.tf`) | `iam:GetUser`, `GetUserPolicy`, `ListUserPolicies`, `ListAttachedUserPolicies`, `ListAccessKeys` | `IamReadBetaSesUserForPlanRefresh` (scoped to the `*-ses-smtp` user ARN pattern) |
| `data.aws_caller_identity.current` (`data.tf`) | `sts:GetCallerIdentity` | none needed -- every authenticated principal can call it on itself, no IAM grant required |

`lambda:GetFunction` is not in this table on purpose: Terraform does not
manage the Lambda functions `LOGIC_FUNCTION_TYPE=LAMBDA` creates
(`logic-function.tf`'s own comment) -- nothing in `deploy/aws`'s state ever
refreshes a `aws_lambda_function`, so this role has no business reading one.

## Re-applying after a permission change

If `deploy/aws` starts managing a new resource type, or the workflow needs a
new action, this stack is the one to change -- never widen the role by hand
in the console. Re-run `terraform plan`/`apply` here the same way, with the
founder's OK, and the running `deploy-beta.yaml` workflow does not need any
change: it only ever reads `AWS_DEPLOY_ROLE_ARN`.
