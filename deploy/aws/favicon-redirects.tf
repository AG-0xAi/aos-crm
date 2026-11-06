# Browsers and assistants (ChatGPT shows a broken image next to the
# connector) request the site icon at fixed root paths without reading the
# page's <link rel="icon">. Twenty's frontend falls back to index.html for any
# unknown path, so those requests got HTML with a 200. Until the app serves
# these files itself (CRM-019 fix2), the load balancer redirects them to the
# Betty icons the image already ships under /brand/logo/.

resource "aws_lb_listener_rule" "favicon" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type = "redirect"

    redirect {
      path        = "/brand/logo/favicon-32.png"
      query       = ""
      status_code = "HTTP_301"
    }
  }

  condition {
    path_pattern {
      values = ["/favicon.ico", "/favicon.png"]
    }
  }

  tags = {
    Name = "aos-crm-${var.environment}-favicon"
  }
}

resource "aws_lb_listener_rule" "apple_touch_icon" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 11

  action {
    type = "redirect"

    redirect {
      path        = "/brand/logo/favicon-180.png"
      query       = ""
      status_code = "HTTP_301"
    }
  }

  condition {
    path_pattern {
      values = ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"]
    }
  }

  tags = {
    Name = "aos-crm-${var.environment}-apple-touch-icon"
  }
}
