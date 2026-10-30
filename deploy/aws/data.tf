data "aws_caller_identity" "current" {}

# Hosted zone of var.domain_name (CRM-013 R2). The beta's domain is registered
# in Route 53 inside this same account and registration already created its
# public hosted zone, so Terraform looks that zone up instead of creating a
# second one -- two zones for one name would answer with different name
# servers and whichever the registrar points at wins, silently.
# var.route53_zone_id stays available as an explicit override for when the
# name lookup is not unambiguous (a private zone with the same name, a
# delegated subdomain, a zone in another account).
data "aws_route53_zone" "this" {
  count = var.route53_zone_id == null ? 1 : 0

  name         = var.domain_name
  private_zone = false
}
