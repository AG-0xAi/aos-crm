output "role_arn" {
  description = "ARN of the deploy role. Goes into the \"beta\" GitHub Environment as the AWS_DEPLOY_ROLE_ARN variable (README.md)."
  value       = aws_iam_role.deploy.arn
}
