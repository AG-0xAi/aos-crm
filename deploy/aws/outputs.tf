output "alb_dns_name" {
  description = "ALB DNS name. Point domain_name at this (CNAME, or an alias record if route53_zone_id is set) once validated."
  value       = aws_lb.this.dns_name
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.this.arn
}

output "acm_validation_records" {
  description = "DNS validation records to add by hand when route53_zone_id is not set."
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
    pg_database_url = aws_secretsmanager_secret.pg_database_url.arn
    redis_url       = aws_secretsmanager_secret.redis_url.arn
    encryption_key  = aws_secretsmanager_secret.encryption_key.arn
  }
}
