# HTTPS-only entry point (R1, R2: MCP only over HTTPS). No listener on 80
# other than the redirect below: this stack never serves plaintext HTTP.

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}

# Automatic only when route53_zone_id is set (variables.tf); otherwise the
# founder's DNS provider is unknown and outputs.tf prints the CNAME to add
# by hand.
resource "aws_route53_record" "acm_validation" {
  for_each = var.route53_zone_id == null ? {} : {
    for dvo in aws_acm_certificate.this.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count = var.route53_zone_id == null ? 0 : 1

  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.acm_validation : record.fqdn]
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
  certificate_arn   = aws_acm_certificate.this.arn

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
