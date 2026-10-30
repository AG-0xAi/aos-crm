# CRM-017: outbound email through Amazon SES, same account and region as the
# rest of this stack. Twenty only ships two email drivers, LOGGER and SMTP
# (packages/twenty-server/src/engine/core-modules/twenty-config/
# config-variables.ts:515-579); ecs.tf wires EMAIL_DRIVER=SMTP to SES's SMTP
# endpoint, never the SES API directly -- Twenty's nodemailer-based SMTP
# driver has no AWS SDK call to authorize, so the IAM user below is scoped to
# ses:SendRawEmail only, for whoever holds its derived SMTP credentials.

locals {
  ses_mail_from_domain = "mail.${var.domain_name}"
  email_from_address   = "${var.email_from_local_part}@${var.domain_name}"
}

# R1: domain identity with Easy DKIM. Omitting signing_attributes_origin
# defaults to AWS_SES (Easy DKIM, the only non-BYODKIM origin);
# next_signing_key_length is stated explicitly rather than left to whatever
# AWS currently defaults an unspecified block to.
resource "aws_sesv2_email_identity" "this" {
  email_identity = var.domain_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = {
    Name = "aos-crm-${var.environment}-ses"
  }
}

# Three CNAME records Easy DKIM asks for, one per token.
resource "aws_route53_record" "ses_dkim" {
  count = 3

  zone_id = local.route53_zone_id
  name    = "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = ["${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# R1: custom MAIL FROM domain, so the envelope-from (and therefore the SPF
# check a receiving server runs) lands on mail.<domain_name> instead of a
# shared amazonses.com subdomain. USE_DEFAULT_VALUE falls back to the
# amazonses.com MAIL FROM while this subdomain's own MX/SPF below have not
# propagated yet, instead of bouncing mail outright.
resource "aws_sesv2_email_identity_mail_from_attributes" "this" {
  email_identity         = aws_sesv2_email_identity.this.email_identity
  mail_from_domain       = local.ses_mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = local.route53_zone_id
  name    = local.ses_mail_from_domain
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = local.route53_zone_id
  name    = local.ses_mail_from_domain
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com ~all"]
}

# R1: DMARC at p=none (monitor-only). This beta is not ready to have mail
# dropped or quarantined on a misconfigured alignment edge case; rua is
# opt-in via var.dmarc_rua_email.
resource "aws_route53_record" "dmarc" {
  zone_id = local.route53_zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 300
  records = [
    var.dmarc_rua_email != "" ? "v=DMARC1; p=none; rua=mailto:${var.dmarc_rua_email}" : "v=DMARC1; p=none"
  ]
}

# R1: optional external mailbox at the apex (for example Hostinger),
# independent of SES -- a different record name than ses_mail_from_mx/
# ses_mail_from_spf above, so neither ever overwrites the other.
resource "aws_route53_record" "apex_mailbox_mx" {
  count = length(var.apex_mailbox_mx_records) > 0 ? 1 : 0

  zone_id = local.route53_zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 300
  records = var.apex_mailbox_mx_records
}

resource "aws_route53_record" "apex_mailbox_spf" {
  count = var.apex_mailbox_spf_value != "" ? 1 : 0

  zone_id = local.route53_zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 300
  records = [var.apex_mailbox_spf_value]
}

# CRM-018 fix1: the CNAMEs that same provider asks for -- its DKIM keys, and
# autodiscover/autoconfig if it publishes them. for_each keyed by the record
# name, not count: adding or removing one name later then touches that record
# alone instead of renumbering (and so recreating) the others. The names that
# would collide with SES's DKIM, its MAIL FROM domain, _dmarc or the CRM's own
# hosts are refused by the variable's own validation (variables.tf), where the
# message can name the record it would have broken.
resource "aws_route53_record" "apex_mailbox_cname" {
  for_each = var.apex_mailbox_cname_records

  zone_id = local.route53_zone_id
  name    = "${each.key}.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [each.value]
}

# R2: the only grant this user has, anywhere in the account -- sending
# through SES's SMTP endpoint, as the one address this stack sends as.
# ses:FromAddress is one of the documented SES condition keys for
# SendRawEmail, so it applies here, not just to the simpler Send*Email
# actions.
data "aws_iam_policy_document" "ses_smtp_send" {
  statement {
    effect    = "Allow"
    actions   = ["ses:SendRawEmail"]
    resources = [aws_sesv2_email_identity.this.arn]

    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [local.email_from_address]
    }
  }
}

resource "aws_iam_user" "ses_smtp" {
  name = "aos-crm-${var.environment}-ses-smtp"
}

resource "aws_iam_user_policy" "ses_smtp_send" {
  name   = "send-raw-email"
  user   = aws_iam_user.ses_smtp.name
  policy = data.aws_iam_policy_document.ses_smtp_send.json
}

# ses_smtp_password_v4 is the provider's own conversion of this access key's
# secret into an SES SMTP password (AWS's documented SigV4-derived
# algorithm) -- never a literal credential in this repo, same reasoning as
# secrets.tf's random_password values (R4, scripts/scan-secrets.sh).
resource "aws_iam_access_key" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
}

resource "aws_secretsmanager_secret" "ses_smtp_user" {
  name        = "aos-crm/${var.environment}/ses-smtp-user"
  description = "SMTP username (IAM access key id) for the aos-crm ${var.environment} server/worker EMAIL_SMTP_USER."

  tags = {
    Name = "aos-crm-${var.environment}-ses-smtp-user"
  }
}

resource "aws_secretsmanager_secret_version" "ses_smtp_user" {
  secret_id     = aws_secretsmanager_secret.ses_smtp_user.id
  secret_string = aws_iam_access_key.ses_smtp.id
}

resource "aws_secretsmanager_secret" "ses_smtp_password" {
  name        = "aos-crm/${var.environment}/ses-smtp-password"
  description = "SMTP password (SigV4-derived from the IAM secret key) for the aos-crm ${var.environment} server/worker EMAIL_SMTP_PASSWORD."

  tags = {
    Name = "aos-crm-${var.environment}-ses-smtp-password"
  }
}

resource "aws_secretsmanager_secret_version" "ses_smtp_password" {
  secret_id     = aws_secretsmanager_secret.ses_smtp_password.id
  secret_string = aws_iam_access_key.ses_smtp.ses_smtp_password_v4
}
