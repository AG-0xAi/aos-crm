# R1/R4: a cost ceiling the founder actually set, with an alert, not a
# number estimated once and never watched again. Account-wide, not tag-
# filtered: a tag-based filter needs the "Project" tag activated as a cost
# allocation tag in the Billing console first (a manual step outside
# Terraform's reach, and only effective for charges after activation), so
# it would silently under-count spend before that happens. If this account
# ever hosts more than this one stack, revisit with a filter once that tag
# is active.

resource "aws_budgets_budget" "monthly" {
  name         = "aos-crm-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_amount_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
