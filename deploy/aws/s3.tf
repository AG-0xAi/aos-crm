# Private file store (R1). No STORAGE_S3_ACCESS_KEY_ID/SECRET is declared
# anywhere in this stack on purpose: packages/twenty-server/src/engine/
# core-modules/file-storage/file-storage-driver.factory.ts only builds a
# static-key S3Driver credential when STORAGE_S3_ACCESS_KEY_ID is set;
# left unset, it falls back to fromNodeProviderChain(), which on ECS
# resolves to this task's IAM role (iam.tf) over the task metadata
# endpoint -- no static AWS key for S3 access at all.

resource "aws_s3_bucket" "files" {
  bucket = "aos-crm-${var.environment}-files-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "aos-crm-${var.environment}-files"
  }
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket = aws_s3_bucket.files.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "deny_insecure_transport" {
  bucket = aws_s3_bucket.files.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.files.arn,
          "${aws_s3_bucket.files.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
