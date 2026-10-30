# HTTPS-only entry point (R1, R2: MCP only over HTTPS). No listener on 80
# other than the redirect below: this stack never serves plaintext HTTP.

locals {
  # data.aws_route53_zone.this only exists when var.route53_zone_id is null
  # (data.tf); everything below reads this instead of either one.
  route53_zone_id = var.route53_zone_id != null ? var.route53_zone_id : data.aws_route53_zone.this[0].zone_id
}

# One certificate for the apex and every workspace subdomain (CRM-013 R2):
# the beta gives each user their own `<workspace>.<domain>` host, so a
# per-user certificate would mean a Terraform change (and a new validation)
# every time the operator creates a workspace. One wildcard covers every host
# this stack serves since CRM-018 -- `api.`, `app.` and each workspace -- so
# moving the API off the apex needed no certificate change. The apex stays as
# the certificate's own domain_name because the wildcard does not cover it
# (`*.betty.example` matches `app.betty.example` but never `betty.example`)
# and ACM cannot change it without reissuing: harmless to keep serving it on
# the listener even after the apex record leaves for the landing. It also
# does not cover a second label (`a.b.<domain>`), which this stack never
# serves.
resource "aws_acm_certificate" "this" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}

# Always created now that the zone is resolved from var.domain_name: CRM-011's
# "no Route 53, print the CNAME and add it by hand" mode is gone, because the
# beta's domain is registered in this account's Route 53.
#
# ACM issues ONE validation CNAME covering both a name and its wildcard, so
# these two for_each entries normally carry an identical record; allow_overwrite
# keeps the second write idempotent instead of failing on a duplicate, and if
# ACM ever returns distinct records both still get created. for_each is keyed by
# dvo.domain_name (known at plan time from the certificate's own config) and not
# by the record name, which is only known after the certificate exists.
resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.this.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = local.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.acm_validation : record.fqdn]
}

# aws_lb_listener.https below reads this instead of aws_acm_certificate.this.arn
# directly: aws_acm_certificate_validation.this's certificate_arn output only
# resolves once ACM reports the certificate ISSUED, so a first apply cannot
# attach it to the listener while it is still PENDING_VALIDATION. The apply
# therefore waits for DNS validation to finish -- it has to be left to
# complete, not just started (AWS_DEPLOYMENT_PLAN.md).
locals {
  certificate_arn = aws_acm_certificate_validation.this.certificate_arn
}

resource "aws_lb" "this" {
  name               = "aos-crm-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}

# The wildcard is what makes a new beta user reachable without touching
# Terraform: the server picks the workspace from the request host
# (workspace-domains.service.ts's resolveWorkspaceAndPublicDomain), so
# `<workspace>.<domain>`, `app.<domain>` and `api.<domain>` are the same ALB
# and the same ECS service (CRM-013 R2).
#
# The apex is the one host that can leave (CRM-018 R2). Left at its default it
# keeps aliasing the ALB exactly as before; set var.apex_a_records and it
# becomes a plain A record at the external host instead. This is written as a
# `dynamic "alias"` block inside the SAME resource rather than two
# count-guarded resources on purpose: changing the resource address would make
# Terraform plan a destroy/create of the live apex record, and R2 asks for a
# plan that is empty with the defaults.
#
# Alias (not CNAME) in the default case because the apex of a zone cannot hold
# a CNAME; evaluate_target_health stays false since the ALB's own target group
# health check already decides what it serves.
resource "aws_route53_record" "apex" {
  zone_id = local.route53_zone_id
  name    = var.domain_name
  type    = "A"

  records = length(var.apex_a_records) > 0 ? var.apex_a_records : null
  ttl     = length(var.apex_a_records) > 0 ? var.external_record_ttl : null

  dynamic "alias" {
    for_each = length(var.apex_a_records) > 0 ? [] : [1]

    content {
      name                   = aws_lb.this.dns_name
      zone_id                = aws_lb.this.zone_id
      evaluate_target_health = false
    }
  }
}

# `www` has no record of its own by default: the wildcard above already
# answers for it with the ALB, which is why this resource is absent from the
# plan until var.www_cname_target is set. An explicit record wins over the
# wildcard in Route 53, so setting it moves only `www` to the external host
# and leaves every other subdomain on the ALB.
resource "aws_route53_record" "www" {
  count = var.www_cname_target == null ? 0 : 1

  zone_id = local.route53_zone_id
  name    = "www.${var.domain_name}"
  type    = "CNAME"
  ttl     = var.external_record_ttl
  records = [var.www_cname_target]
}

resource "aws_route53_record" "wildcard" {
  zone_id = local.route53_zone_id
  name    = "*.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

resource "aws_lb_target_group" "server" {
  name        = "aos-crm-${var.environment}-server"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"

  # Coherent with the slow cold boot: deploy/local/compose.yaml measured
  # 8.6 min with migrations inline. ecs.tf's migrate task now runs that
  # work out-of-band, so the server service itself starts with
  # DISABLE_DB_MIGRATIONS=true and should come up far faster -- but that
  # boot has not been timed on ECS yet. unhealthy_threshold stays at the
  # AWS default (do not fail fast on first boot); re-measure before LIVE.
  health_check {
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }

  tags = {
    Name = "aos-crm-${var.environment}-server"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
