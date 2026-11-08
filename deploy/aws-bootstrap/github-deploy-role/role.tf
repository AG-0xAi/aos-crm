# R1: trust narrowed to exactly one repository and one GitHub Environment,
# through the account's existing OIDC provider (data.tf). `aud` pins the
# audience GitHub's own token issuer sets for AWS
# (aws-actions/configure-aws-credentials's documented value); `sub` pins the
# claim GitHub mints only for a run dispatched against the named
# Environment, never for a plain branch/PR run and never for a fork's run
# (GitHub does not hand a fork's workflow an OIDC token scoped to this
# repo's environment). No wildcard in either condition.
data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.trust.json

  tags = {
    Name = var.role_name
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "aos-crm-${var.app_environment}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.permissions.json
}
