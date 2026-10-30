# Explicit retention on every log group (R1): CloudWatch Logs never expires
# by default, and an unbounded group is an unbounded, unreviewed cost and
# a quiet place for PII to sit indefinitely.

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/aos-crm-${var.environment}/server"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/aos-crm-${var.environment}/worker"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/aos-crm-${var.environment}/migrate"
  retention_in_days = var.log_retention_days
}
