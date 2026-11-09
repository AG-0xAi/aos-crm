# CRM-035: Lambda driver for workflow CODE steps (LOGIC_FUNCTION_TYPE=LAMBDA),
# least privilege. This file only creates what the platform session CAN
# create: the Lambda execution role, the layer-upload bucket and two empty
# secrets. It cannot create an IAM user or an access key (the account denies
# that to this session), so the AWS SDK client the driver authenticates as
# comes from a separate IAM user the founder creates by hand with
# deploy/aws-bootstrap/logic-function-user/create-user.sh, which also writes
# the two secrets below. var.logic_function_type defaults to "DISABLED": this
# file alone enables nothing until that script has run AND the founder sets
# logic_function_type = "LAMBDA" (BETA_RUNBOOK.md, "Funciones de workflows en
# Lambda").

locals {
  # Mirrors LOGIC_FUNCTION_LAMBDA_NAME_PREFIX (ecs.tf): every Lambda
  # function/layer/tag name the driver creates starts with this, so the
  # CloudShell script's IAM policy can scope lambda:* to
  # function:<prefix>*/layer:<prefix>* instead of needing function:* across
  # the whole account (CRM-035 R1,
  # packages/twenty-server/.../drivers/lambda/utils/validate-lambda-name-prefix.util.ts
  # fails the driver at construction if this ever gets too long for a
  # function name).
  logic_function_name_prefix = "aos-crm-${var.environment}-lf-"
}

data "aws_iam_policy_document" "logic_function_exec_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "logic_function_exec" {
  name                 = "aos-crm-${var.environment}-logic-function-exec"
  assume_role_policy   = data.aws_iam_policy_document.logic_function_exec_assume_role.json
  permissions_boundary = var.permissions_boundary_arn
}

# No VPC config on this role or on any function that assumes it: a workflow
# CODE step only ever sees the payload the server/worker SDK layer sends it
# (lambda.driver.ts's InvokeCommand), never RDS/Redis directly, so there is no
# ENI to attach, no NAT cost, and no network path from a compromised function
# back into the stack's private subnets. CloudWatch Logs is the only
# permission this role needs, scoped to the log groups Lambda creates for
# prefixed functions (Lambda names each function's log group
# /aws/lambda/<FunctionName> automatically).
data "aws_iam_policy_document" "logic_function_exec_logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.logic_function_name_prefix}*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.logic_function_name_prefix}*:*",
    ]
  }
}

resource "aws_iam_role_policy" "logic_function_exec_logs" {
  name   = "lambda-logs"
  role   = aws_iam_role.logic_function_exec.id
  policy = data.aws_iam_policy_document.logic_function_exec_logs.json
}

# Where the driver's yarn-install Lambda uploads a dependency layer zip
# before PublishLayerVersionCommand reads it back by S3Bucket/S3Key
# (lambda-layer-manager.service.ts's createDepsLayer / lambda-aws-client.
# service.ts's generatePresignedUploadUrl). The SDK layer never touches this
# bucket -- it is built and published in memory (rebuildSdkLayer).
resource "aws_s3_bucket" "logic_function_layers" {
  bucket = "aos-crm-${var.environment}-logic-function-layers-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "aos-crm-${var.environment}-logic-function-layers"
  }
}

resource "aws_s3_bucket_public_access_block" "logic_function_layers" {
  bucket = aws_s3_bucket.logic_function_layers.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logic_function_layers" {
  bucket = aws_s3_bucket.logic_function_layers.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logic_function_layers" {
  bucket = aws_s3_bucket.logic_function_layers.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Safe to expire after 30 days, unlike the `files` bucket (s3.tf), which
# holds user data with no retry path: a layer zip here is a build artifact
# PublishLayerVersionCommand consumes once, at creation time (Lambda copies
# the content into the published layer version; nothing reads this object
# back afterwards). getLambdaDepsLayerName
# (packages/twenty-server/.../drivers/lambda/utils/get-lambda-deps-layer-name.
# util.ts) keys the object on the application's yarn.lock checksum, so if a
# workflow ever needs that exact dependency set again after the object
# expired, ensureDepsLayer (lambda-layer-manager.service.ts) just re-uploads
# and republishes it -- expiring this object never destroys something the
# running stack cannot regenerate.
resource "aws_s3_bucket_lifecycle_configuration" "logic_function_layers" {
  bucket = aws_s3_bucket.logic_function_layers.id

  rule {
    id     = "expire-old-layer-archives"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }
  }
}

# Created empty on purpose (CRM-035 R4): the value is an AWS access key this
# platform session cannot mint (the account denies iam:CreateUser /
# iam:CreateAccessKey to it), so only the founder's CloudShell script
# (deploy/aws-bootstrap/logic-function-user/create-user.sh) ever calls
# secretsmanager:PutSecretValue on these two ARNs. Deliberately no
# aws_secretsmanager_secret_version resource here: adding one would fight the
# script on every apply, either clobbering what it wrote back to empty or
# forcing a plan diff that never settles.
resource "aws_secretsmanager_secret" "logic_function_access_key_id" {
  name        = "aos-crm/${var.environment}/logic-function-access-key-id"
  description = "AWS access key id for the IAM user the Lambda driver's AWS SDK client authenticates as. Written by create-user.sh, not by Terraform."

  tags = {
    Name = "aos-crm-${var.environment}-logic-function-access-key-id"
  }
}

resource "aws_secretsmanager_secret" "logic_function_secret_access_key" {
  name        = "aos-crm/${var.environment}/logic-function-secret-access-key"
  description = "AWS secret access key counterpart of logic-function-access-key-id. Written by create-user.sh, not by Terraform."

  tags = {
    Name = "aos-crm-${var.environment}-logic-function-secret-access-key"
  }
}
