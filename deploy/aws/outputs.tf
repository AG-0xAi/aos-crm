output "alb_dns_name" {
  description = "ALB DNS name. domain_name and *.domain_name already alias to it (alb-acm.tf); this is for debugging the ALB directly, not a step the operator has to wire up."
  value       = aws_lb.this.dns_name
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.this.arn
}

output "acm_validation_records" {
  description = "The DNS validation records Terraform created in the hosted zone (aws_route53_record.acm_validation). Informative: for checking what ACM asked for, not a manual step."
  value = [
    for dvo in aws_acm_certificate.this.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecs_migrate_task_definition_arn" {
  description = "Run with `aws ecs run-task` before every deploy; see AWS_DEPLOYMENT_PLAN.md."
  value       = aws_ecs_task_definition.migrate.arn
}

output "ecs_server_task_definition_arn" {
  description = "Server task definition. Also what the operator runs one-off commands from (`aws ecs run-task` with a container override): it boots with DISABLE_DB_MIGRATIONS=true, so the entrypoint execs the override instead of re-running migrations."
  value       = aws_ecs_task_definition.server.arn
}

# Both of these exist so the run-task commands in AWS_DEPLOYMENT_PLAN.md are
# copy-pasteable instead of ending in "...": awsvpcConfiguration needs the
# subnet and security group ids, and reading them out of the console by hand
# is how the wrong subnet ends up in a one-off task.
output "private_subnet_ids" {
  description = "Private subnets to run one-off Fargate tasks in (same as the services use)."
  value       = aws_subnet.private[*].id
}

output "ecs_tasks_security_group_id" {
  description = "Security group for one-off Fargate tasks (reaches RDS, Redis and the internet through NAT; not reachable from it)."
  value       = aws_security_group.ecs_tasks.id
}

output "rds_endpoint" {
  value     = aws_db_instance.this.address
  sensitive = true
}

output "redis_primary_endpoint" {
  value     = aws_elasticache_replication_group.this.primary_endpoint_address
  sensitive = true
}

output "s3_bucket_name" {
  value = aws_s3_bucket.files.bucket
}

output "secrets_manager_secret_arns" {
  value = {
    pg_database_url                  = aws_secretsmanager_secret.pg_database_url.arn
    redis_url                        = aws_secretsmanager_secret.redis_url.arn
    encryption_key                   = aws_secretsmanager_secret.encryption_key.arn
    ses_smtp_user                    = aws_secretsmanager_secret.ses_smtp_user.arn
    ses_smtp_password                = aws_secretsmanager_secret.ses_smtp_password.arn
    logic_function_access_key_id     = aws_secretsmanager_secret.logic_function_access_key_id.arn
    logic_function_secret_access_key = aws_secretsmanager_secret.logic_function_secret_access_key.arn
  }
}

output "logic_function_exec_role_arn" {
  description = "Lambda execution role (logic-function.tf). Pass to deploy/aws-bootstrap/logic-function-user/create-user.sh so its policy can grant iam:PassRole on exactly this ARN."
  value       = aws_iam_role.logic_function_exec.arn
}

output "logic_function_layers_bucket" {
  description = "S3 bucket the Lambda driver uploads dependency layer zips to (logic-function.tf)."
  value       = aws_s3_bucket.logic_function_layers.bucket
}

output "logic_function_name_prefix" {
  description = "LOGIC_FUNCTION_LAMBDA_NAME_PREFIX (ecs.tf). Pass to create-user.sh so its IAM policy scopes to function:<prefix>*/layer:<prefix>* instead of needing function:*."
  value       = local.logic_function_name_prefix
}

output "ses_email_identity_arn" {
  description = "SES domain identity ARN (ses.tf). Post-apply, check its verification and DKIM status with `aws sesv2 get-email-identity --email-identity <domain_name>`."
  value       = aws_sesv2_email_identity.this.arn
}

output "ses_mail_from_domain" {
  description = "Custom MAIL FROM subdomain (ses.tf). Same get-email-identity call reports its MX/SPF status alongside DKIM."
  value       = local.ses_mail_from_domain
}

output "ses_smtp_user_name" {
  description = "IAM user whose derived SMTP credentials the server/worker tasks use (EMAIL_SMTP_USER/EMAIL_SMTP_PASSWORD, ecs.tf). Not a secret by itself: the credentials live in Secrets Manager (secrets_manager_secret_arns above)."
  value       = aws_iam_user.ses_smtp.name
}
