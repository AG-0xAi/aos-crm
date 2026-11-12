# Looked up, not created (R1): every AWS account that has ever run
# `aws-actions/configure-aws-credentials` with OIDC, or been set up for GitHub
# Actions OIDC at all, already has this provider -- creating a second one for
# the same URL fails outright. This is also the one data source in this
# stack that reaches AWS: `terraform validate` never resolves it, but
# `terraform plan` does, which is why R4's evidence cannot include a real
# plan without credentials (deploy/aws/README.md documents the same
# distinction for its own aws_route53_zone lookup).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
