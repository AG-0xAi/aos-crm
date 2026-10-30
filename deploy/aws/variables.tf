# Sizes, domain and the alert address still have NO default here on purpose
# (CRM-011 R1/R3.1): a real value would either commit the founder to a choice
# nobody approved yet, or (domain/account/email) identify the business in a
# public fork. `terraform validate` only type-checks these; it does not
# require a value. A real `plan`/`apply` does, via terraform.tfvars
# (gitignored, see deploy/aws/.gitignore) or -var.
#
# Region and budget DO have defaults now: the founder decided both on
# 29/10/2026 for the beta (eu-west-1, 500 USD/month), and neither identifies
# the business. A default that records a decision already made is the
# opposite of a default that invents one.

# ---------------------------------------------------------------------------
# Founder decisions (AWS_DEPLOYMENT_PLAN.md R4)
# ---------------------------------------------------------------------------

variable "aws_region" {
  description = <<-EOT
    AWS region for every resource in this stack. Defaults to the region the
    founder chose for the beta on 29/10/2026 (Ireland). Override only with a
    deliberate decision: moving region moves where the data lives.
  EOT
  type        = string
  default     = "eu-west-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must look like an AWS region code, e.g. eu-west-1."
  }
}

variable "domain_name" {
  description = <<-EOT
    Public domain this stack serves. It is the apex of the beta's namespace,
    not a host: the certificate covers it and "*.<domain>", the API lives at
    "api.<domain>", sign-in at "app.<domain>" and every workspace at
    "<workspace>.<domain>" (ecs.tf). Since CRM-018 the apex itself serves
    nothing of the CRM and can be handed to an external landing with
    apex_a_records below. A hosted zone for exactly this name must exist in
    the account (data.tf looks it up), so passing a subdomain only works if
    that subdomain is itself a delegated zone. The founder owns this decision;
    no placeholder default ships here so a real domain is never accidentally
    committed to this public fork.
  EOT
  type        = string

  validation {
    condition     = length(var.domain_name) > 0 && !can(regex("example\\.com$", var.domain_name))
    error_message = "domain_name must be a real domain the founder controls, not empty and not the example.com placeholder."
  }
}

variable "route53_zone_id" {
  description = <<-EOT
    Optional override for the Route 53 hosted zone that holds domain_name.
    Left null (default), the stack looks the public zone up by name
    (data.aws_route53_zone.this, data.tf), which is what the beta needs: the
    domain is registered in this account and registration already created its
    zone. Set it only when that lookup is ambiguous or wrong -- a private zone
    with the same name, a delegated subdomain, a zone created by hand next to
    the registrar's. It no longer switches DNS management on or off: ACM
    validation and the ALB alias records are always managed here (CRM-013 R2).
  EOT
  type        = string
  default     = null
}

variable "apex_a_records" {
  description = <<-EOT
    Addresses to answer the apex (domain_name) with, when the apex is served
    by something outside this stack -- the Betty landing (CRM-018 R2, founder
    30/10/2026). Empty (default) keeps the apex as the alias A record to the
    ALB it has been since CRM-013, so the default plan is empty. Set it to the
    A record the landing host publishes and the apex becomes a plain A record
    pointing there; nothing else in the stack moves, because the API lives at
    api.<domain>, sign-in at app.<domain> and each workspace at its own
    subdomain, all of them still on the wildcard (alb-acm.tf). No real value
    ships here: the address belongs to whoever hosts the landing, and this
    fork is public.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for record in var.apex_a_records :
      can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}$", record))
    ])
    error_message = "apex_a_records must contain IPv4 addresses: it populates an A record."
  }
}

variable "www_cname_target" {
  description = <<-EOT
    Hostname `www.<domain_name>` should be a CNAME to, when the landing serves
    www as well (CRM-018 R2). Null (default) creates no www record at all, so
    the default plan is empty and www keeps resolving through the wildcard to
    the ALB exactly as today. Set it to the CNAME target the landing host
    publishes: an explicit record beats the wildcard in Route 53, so only www
    moves. No real value ships here, same reason as apex_a_records.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.www_cname_target == null ? true : can(regex("^[a-z0-9.-]+$", var.www_cname_target))
    error_message = "www_cname_target must be a hostname, not a URL."
  }
}

variable "external_record_ttl" {
  description = <<-EOT
    TTL in seconds for the apex and www records once they point outside this
    stack (apex_a_records / www_cname_target). Alias records have no TTL, so
    this is unused while both keep their defaults. 300 is short enough that
    rolling the apex back to the ALB takes minutes, not hours -- which is the
    whole rollback story for the landing switch (BETA_RUNBOOK.md).
  EOT
  type        = number
  default     = 300

  validation {
    condition     = var.external_record_ttl >= 60 && var.external_record_ttl <= 86400
    error_message = "external_record_ttl must be between 60 and 86400 seconds."
  }
}

variable "budget_amount_usd" {
  description = <<-EOT
    Monthly USD ceiling for the AWS Budgets alarm. Defaults to the ceiling the
    founder set for the beta on 29/10/2026 (500 USD/month), which is well
    above the estimate in AWS_DEPLOYMENT_PLAN.md: it is an alarm, not a cap --
    AWS does not stop the stack when it fires.
  EOT
  type        = number
  default     = 500

  validation {
    condition     = var.budget_amount_usd > 0
    error_message = "budget_amount_usd must be a positive number."
  }
}

variable "budget_alert_email" {
  description = <<-EOT
    Email address AWS Budgets notifies when actual or forecasted spend
    crosses the configured thresholds. No default: an email address is
    founder-identifying, like the region/domain/budget it rides alongside.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email must look like an email address."
  }
}

variable "dmarc_rua_email" {
  description = <<-EOT
    Optional mailbox that receives DMARC aggregate reports (rua=mailto:...)
    on the _dmarc.<domain_name> TXT record ses.tf creates with p=none
    (CRM-017 R1). Empty (default) omits the rua tag entirely. No default
    value ships here for the same reason as budget_alert_email: a real
    address is founder-identifying.
  EOT
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Sizes (tamaños) -- no default, same reasoning as above
# ---------------------------------------------------------------------------

variable "server_cpu" {
  description = "Fargate vCPU units (1024 = 1 vCPU) for the server task. Suggested minimal staging starting point: 512."
  type        = number

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.server_cpu)
    error_message = "server_cpu must be a valid Fargate CPU value (256, 512, 1024, 2048 or 4096)."
  }
}

variable "server_memory" {
  description = "Fargate memory (MiB) for the server task. Suggested minimal staging starting point: 1024."
  type        = number

  validation {
    condition     = var.server_memory >= 512
    error_message = "server_memory must be at least 512 MiB."
  }
}

variable "worker_cpu" {
  description = "Fargate vCPU units (1024 = 1 vCPU) for the worker task. Suggested minimal staging starting point: 512."
  type        = number

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.worker_cpu)
    error_message = "worker_cpu must be a valid Fargate CPU value (256, 512, 1024, 2048 or 4096)."
  }
}

variable "worker_memory" {
  description = "Fargate memory (MiB) for the worker task. Suggested minimal staging starting point: 1024."
  type        = number

  validation {
    condition     = var.worker_memory >= 512
    error_message = "worker_memory must be at least 512 MiB."
  }
}

variable "server_desired_count" {
  description = "Number of running server tasks. Suggested minimal staging starting point: 1 (no HA)."
  type        = number

  validation {
    condition     = var.server_desired_count >= 1
    error_message = "server_desired_count must be at least 1."
  }
}

variable "worker_desired_count" {
  description = "Number of running worker tasks. Suggested minimal staging starting point: 1."
  type        = number

  validation {
    condition     = var.worker_desired_count >= 1
    error_message = "worker_desired_count must be at least 1."
  }
}

variable "db_instance_class" {
  description = "RDS instance class, e.g. db.t4g.micro for a minimal staging footprint. No default: instance class is a cost/performance trade-off for the founder."
  type        = string

  validation {
    condition     = can(regex("^db\\.", var.db_instance_class))
    error_message = "db_instance_class must be an RDS instance class, e.g. db.t4g.micro."
  }
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB. Suggested minimal staging starting point: 20 (the RDS PostgreSQL minimum)."
  type        = number

  validation {
    condition     = var.db_allocated_storage_gb >= 20
    error_message = "db_allocated_storage_gb must be at least 20 GB (RDS PostgreSQL minimum)."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type, e.g. cache.t4g.micro for a minimal staging footprint. No default: node type sizing is the founder's cost/performance call."
  type        = string

  validation {
    condition     = can(regex("^cache\\.", var.redis_node_type))
    error_message = "redis_node_type must be an ElastiCache node type, e.g. cache.t4g.micro."
  }
}

variable "image_digest" {
  description = <<-EOT
    Immutable digest (sha256:...) of the image already pushed to the ECR
    repository this stack creates, e.g. the digest
    scripts/aos/verify-image-provenance.mjs already validates locally. No
    default: a stale digest silently reused across deploys defeats the
    whole point of pinning by digest (CRM-004).
  EOT
  type        = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest must look like sha256:<64 hex chars>."
  }
}

# ---------------------------------------------------------------------------
# Everything below is operational boilerplate, not a founder/business
# decision, so a generic, non-identifying default is safe to ship.
# ---------------------------------------------------------------------------

variable "environment" {
  description = "Short environment tag applied to every resource."
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  description = "CIDR block for the staging VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread the public/private subnets across."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2
    error_message = "availability_zone_count must be at least 2 for the ALB and RDS subnet groups."
  }
}

variable "container_port" {
  description = "Port the twenty-server image listens on (NODE_PORT in deploy/local/compose.yaml)."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "ALB target group health check path, matching deploy/local/compose.yaml's server healthcheck."
  type        = string
  default     = "/healthz"
}

variable "alb_health_check_grace_period_seconds" {
  description = <<-EOT
    ECS service health_check_grace_period_seconds for the server service.
    Not a measured number (see AWS_DEPLOYMENT_PLAN.md): local measured 8.6
    min (516 s) for a cold boot that runs migrate+upgrade+cron-register
    inline (deploy/local/compose.yaml start_period). This stack splits that
    into the one-off "migrate" task (ecs.tf) so the server/worker services
    boot with DISABLE_DB_MIGRATIONS=true and should start far faster, but
    nobody has timed that boot on ECS yet. 300 s is a deliberately
    conservative placeholder, not evidence; re-measure on the first LIVE
    boot and adjust before trusting ALB-driven autoscaling or deploys.
  EOT
  type        = number
  default     = 300
}

variable "db_engine_version" {
  description = "RDS PostgreSQL engine version, matching the postgres:16.15 pin in deploy/local/compose.yaml."
  type        = string
  default     = "16.15"
}

variable "db_backup_retention_days" {
  description = "RDS automated backup retention (days). Must be > 0 for point-in-time recovery (R1)."
  type        = number
  default     = 7

  validation {
    condition     = var.db_backup_retention_days > 0
    error_message = "db_backup_retention_days must be greater than 0 for point-in-time recovery."
  }
}

variable "db_multi_az" {
  description = "Whether RDS runs a standby replica in a second AZ. Off by default for a minimal staging footprint; the founder can turn it on once cost is approved."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "RDS deletion protection. Off by default so a staging teardown (AWS_DEPLOYMENT_PLAN.md) does not need a manual API call first; the founder should turn this on once staging holds data worth protecting."
  type        = bool
  default     = false
}

variable "redis_engine_version" {
  description = "ElastiCache Valkey engine version."
  type        = string
  default     = "7.2"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for server/worker/migrate log groups (R1: explicit retention, never unlimited)."
  type        = number
  default     = 30
}

variable "ecs_container_insights" {
  description = "Whether to enable ECS Container Insights (extra CloudWatch cost) on the cluster."
  type        = bool
  default     = false
}

variable "email_from_local_part" {
  description = <<-EOT
    Local part of EMAIL_FROM_ADDRESS (ecs.tf composes it with var.domain_name
    into local.email_from_address, ses.tf). Generic, non-identifying default:
    change only if the founder wants a different sender than
    no-reply@<domain_name>.
  EOT
  type        = string
  default     = "no-reply"
}

variable "apex_mailbox_mx_records" {
  description = <<-EOT
    Optional MX records for an external mailbox provider receiving mail at
    the apex of var.domain_name (for example Hostinger), each formatted as
    Route 53 expects an MX record value: "<priority> <mail server host>".
    Empty (default) creates no apex MX record. Never collides with SES: the
    MAIL FROM MX ses.tf creates lives at mail.<domain_name>, a different
    record name.
  EOT
  type        = list(string)
  default     = []
}

variable "apex_mailbox_spf_value" {
  description = <<-EOT
    Optional full SPF TXT value for the apex of var.domain_name, covering an
    external mailbox provider's own outbound mail (for example
    "v=spf1 include:_spf.hostinger.com ~all" for Hostinger). Empty (default)
    creates no apex SPF record. Never overwrites SES's own SPF record
    (ses.tf), which lives at mail.<domain_name>, a different record name.
  EOT
  type        = string
  default     = ""
}
