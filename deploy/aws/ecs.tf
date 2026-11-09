locals {
  image = "${aws_ecr_repository.app.repository_url}@${var.image_digest}"

  # Same privacy profile as deploy/local/privacy.env (R2), reproduced here
  # because ECS task definitions take environment variables inline, not an
  # env_file. Empty-string values mirror privacy.env's explicit-empty
  # placeholders (METER_DRIVER, SENTRY_DSN, SENTRY_FRONT_DSN,
  # ENTERPRISE_KEY, ENTERPRISE_VALIDITY_TOKEN): stating "off" rather than
  # omitting the key, same reasoning as that file's own comments.
  #
  # The beta (CRM-013 R1) changes exactly one thing in that profile --
  # multi-workspace is now on, with creation limited to server admins -- and
  # adds the host/proxy/mail settings that mode needs. Everything privacy.env
  # turns off stays off: an empty ENTERPRISE_KEY still means
  # MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY (5, see
  # max-workspaces-without-organization-key.constant.ts) caps how many
  # workspaces this instance will ever create, which
  # AWS_DEPLOYMENT_PLAN.md states as a beta limit rather than working around.
  privacy_env = {
    TELEMETRY_ENABLED                     = "false"
    ANALYTICS_ENABLED                     = "false"
    MARKETPLACE_CATALOG_SYNC_CRON_ENABLED = "false"
    IS_CONFIG_VARIABLES_IN_DB_ENABLED     = "false"
    EXCEPTION_HANDLER_DRIVER              = "CONSOLE"
    METER_DRIVER                          = ""
    SENTRY_DSN                            = ""
    SENTRY_FRONT_DSN                      = ""
    ENTERPRISE_KEY                        = ""
    ENTERPRISE_VALIDITY_TOKEN             = ""
    # Private S3 driver (s3.tf), task-role credentials only (no static
    # STORAGE_S3_ACCESS_KEY_ID/SECRET -- see that file's comment).
    STORAGE_TYPE      = "s3"
    STORAGE_S3_NAME   = aws_s3_bucket.files.bucket
    STORAGE_S3_REGION = var.aws_region
    # One workspace per beta user, created only by the operator (CRM-013 R1),
    # replacing CRM-011's IS_MULTIWORKSPACE_ENABLED=false. These two flags are
    # also what keeps public signup closed, so there is still no separate
    # "signup disabled" switch:
    #  - multi-workspace on makes the server resolve the workspace from the
    #    request host (config-variables.ts:2184, read by
    #    workspace-domains.service.ts's resolveWorkspaceAndPublicDomain);
    #  - creation limited to server admins makes
    #    sign-in-up.service.ts's assertWorkspaceCreationAllowed refuse a new
    #    workspace unless the signed-in user has canAccessFullAdminPanel, and
    #    assertSignUpWithoutWorkspaceAllowed refuse a signup that has no
    #    pending invitation or approved access domain
    #    (get-sign-up-without-workspace-decision.util.ts returns
    #    'requiresDestination'). Both are bypassed only while zero workspaces
    #    exist, which is the operator's one-time first signup.
    # Upstream already defaults the second flag to true
    # (config-variables.ts:588); stated here because the beta depends on it.
    IS_MULTIWORKSPACE_ENABLED                      = "true"
    IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS = "true"
    # Host that serves sign-in and the OAuth /authorize screen when a request
    # arrives on the API host: domain-server-config.service.ts's getBaseUrl()
    # prefixes FRONTEND_URL's hostname with DEFAULT_SUBDOMAIN while
    # multi-workspace is on, and
    # get-subdomain-and-custom-domain-from-hostname.util.ts maps that same
    # subdomain back to "no workspace" so it never collides with a user's
    # workspace. Upstream default ('app', config-variables.ts:1225) stated
    # rather than inherited.
    DEFAULT_SUBDOMAIN = "app"
    # The API lives on its own subdomain (CRM-018, founder 30/10/2026): the
    # apex is being handed to the Betty landing, so nothing Twenty emits may
    # point at it. `api` is safe to take because twenty-shared's
    # RESERVED_SUBDOMAINS lists it, so no workspace can ever claim that host;
    # the wildcard record and the wildcard certificate (alb-acm.tf) already
    # cover it, so this needs no new DNS and no new certificate. It is also
    # the host oauth-discovery.controller.ts's isApiHost() compares the
    # request host against to decide whether /authorize lives on this host or
    # on DEFAULT_SUBDOMAIN's.
    #
    # FRONTEND_URL stays the apex ON PURPOSE, and is never emitted as a link:
    # it is the `frontDomain` every request host is parsed against (the util
    # above) and the base getBaseUrl() prefixes with DEFAULT_SUBDOMAIN while
    # multi-workspace is on. Keeping it here is what makes sign-in resolve to
    # app.<domain> and a workspace to <workspace>.<domain>. Setting it to
    # app.<domain> instead would make getBaseUrl() emit app.app.<domain> and
    # every workspace <workspace>.app.<domain>.
    SERVER_URL   = "https://api.${var.domain_name}"
    FRONTEND_URL = "https://${var.domain_name}"
    # The ALB terminates TLS, so X-Forwarded-Proto must be honoured or every
    # getRequestBaseUrl() consumer would advertise http:// on an HTTPS-only
    # stack: the OAuth issuer and authorization_servers
    # (oauth-discovery.controller.ts) and the resource_metadata pointer the
    # /mcp 401 returns (mcp-auth.guard.ts). Upstream's default already trusts
    # RFC1918 peers (config-variables.ts:1667, applied in main.ts:69) and the
    # ALB reaches the tasks from inside var.vpc_cidr (10.42.0.0/16), so this
    # pins the behaviour the stack depends on instead of inheriting it.
    TRUST_PROXY = "loopback, linklocal, uniquelocal"
    # AGPL section 13: the sign-in license notice links to the exact source
    # of the deployed image (CRM-019 LicenseNotice.tsx) and shows its version.
    SOURCE_CODE_URL = var.source_code_url
    APP_VERSION     = var.app_version
    # Outbound mail through SES (CRM-017, founder request 30/10/2026), in
    # three stages the operator moves through with tfvars, never with a code
    # change (BETA_RUNBOOK.md §8). SMTP is the only other driver Twenty
    # ships (config-variables.ts:515-579) and LOGGER is its default
    # (:531): with var.outbound_email_enabled = false -- the default, and
    # what the beta runs today -- every message stays in the WORKER's log
    # (EmailService.send only enqueues; email-sender.job.ts is what prints
    # it, measured 30/10), which is what the runbook's invite-and-reset-by-
    # hand procedure reads.
    # Turning it on needs no new infrastructure: ses.tf creates the domain
    # identity, its DNS records and the aos-crm-<env>-ses-smtp IAM user
    # whose derived SMTP credentials EMAIL_SMTP_USER/EMAIL_SMTP_PASSWORD
    # resolve from local.app_secrets below (via Secrets Manager, never a
    # plaintext value in this block) either way. It waits on SES leaving
    # the sandbox, where only addresses verified one by one receive
    # anything at all.
    #
    # The SMTP endpoint and port are stated in both stages on purpose: they
    # are derived from var.aws_region, hold no credential, and are inert
    # while EMAIL_DRIVER is LOGGER, so flipping the switch changes one
    # value here instead of reshaping this block.
    EMAIL_DRIVER       = var.outbound_email_enabled ? "SMTP" : "LOGGER"
    EMAIL_SMTP_HOST    = "email-smtp.${var.aws_region}.amazonaws.com"
    EMAIL_SMTP_PORT    = "587"
    EMAIL_FROM_ADDRESS = local.email_from_address
    EMAIL_FROM_NAME    = "Betty"
    # Stage 3, and the one that can lock people out rather than just fail
    # to send: checkIsEmailVerified (auth.service.ts:260-266, called from
    # :186, :225 and auth.resolver.ts:1021) refuses the sign-in of any user
    # whose isEmailVerified is still false. Every account the beta has
    # today was created without email, so this stays false (upstream's own
    # default, config-variables.ts:100) until those rows are verified AND
    # mail actually sends -- var.email_verification_required's validation
    # (variables.tf) refuses the second half of that on its own.
    #
    # MAX_WORKSPACES=0 is CRM-015's own contract ("empty or 0 = no limit")
    # and is set in every stage; setting it ahead of that track landing is
    # harmless -- config-variables.ts's validateSync (:2628-2634) does not
    # reject unrecognised env keys.
    IS_EMAIL_VERIFICATION_REQUIRED = tostring(var.email_verification_required)
    MAX_WORKSPACES                 = "0"
    # SEC-01 (SECURITY_AUDIT.md): forced regardless of any upstream
    # default, same as deploy/local/compose.yaml's x-aos-crm-env anchor.
    LOGIC_FUNCTION_TYPE   = "DISABLED"
    CODE_INTERPRETER_TYPE = "DISABLED"
    # RDS Postgres 16 enforces SSL by default (rds.force_ssl) and rejects a
    # plaintext connection outright ("no pg_hba.conf entry ... no
    # encryption") -- the migrate task below hit exactly that during the
    # 30/10 beta apply. Twenty's pg clients only add `ssl:
    # {rejectUnauthorized: false}` when this flag is true
    # (core.datasource.ts:75, raw.datasource.ts:13,
    # workspace-data-source.service.ts:152); Twenty has no CA-pinning
    # option (config-variables.ts:1478), so the connection ends up
    # encrypted but not verifying RDS's certificate chain. Verifying it
    # would need a core change, out of this spec (AWS_DEPLOYMENT_PLAN.md).
    PG_SSL_ALLOW_SELF_SIGNED = "true"
    # Operator's own lead funnel (CRM-034, founder request 09/11/2026): the
    # server and worker POST a JSON event here on every invitation/sign-up.
    # Empty (default) disables it; it rides the plain environment rather
    # than Secrets Manager (var.signup_webhook_url, variables.tf) since it
    # needs no IAM grant.
    SIGNUP_WEBHOOK_URL = var.signup_webhook_url
  }

  # The ECS "secrets" block resolves each entry's `valueFrom` through
  # ecs_task_execution (iam.tf) at container start; none of these ever sit
  # in the task definition's plaintext `environment` block (see secrets.tf).
  #
  # The two SMTP credentials ride the same switch as EMAIL_DRIVER above: a
  # sending password that no driver can use is a credential sitting in the
  # environment of three task families for nothing, and the environment of a
  # process is exactly what a crash dump, a debug endpoint or a container
  # escape reads first. The secrets themselves and the execution role's
  # grant on them (ses.tf, iam.tf) stay unconditional, so turning mail on is
  # still only a tfvars change -- no new secret, no IAM edit.
  app_secrets = concat(
    [
      { name = "PG_DATABASE_URL", valueFrom = aws_secretsmanager_secret.pg_database_url.arn },
      { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
      { name = "ENCRYPTION_KEY", valueFrom = aws_secretsmanager_secret.encryption_key.arn },
    ],
    var.outbound_email_enabled ? [
      { name = "EMAIL_SMTP_USER", valueFrom = aws_secretsmanager_secret.ses_smtp_user.arn },
      { name = "EMAIL_SMTP_PASSWORD", valueFrom = aws_secretsmanager_secret.ses_smtp_password.arn },
    ] : []
  )
}

resource "aws_ecs_cluster" "this" {
  name = "aos-crm-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.ecs_container_insights ? "enabled" : "disabled"
  }
}

# One-off migration task (R1): the official entrypoint
# (packages/twenty-docker/twenty/entrypoint.sh) always runs
# database:init:prod/upgrade/cron:register inline before `exec`-ing the
# real command, which deploy/local/compose.yaml measured at 8.6 min on a
# cold volume. Running that inline on every server task start (or on every
# one of server_desired_count replicas, racing each other) is both slow
# and unsafe. This task definition does only that work, with the DISABLE_*
# flags flipped the opposite way from the server/worker services below,
# then exits via `exec true` (busybox builtin in the node:alpine base)
# instead of booting Nest's HTTP server. It is never an aws_ecs_service:
# AWS_DEPLOYMENT_PLAN.md documents running it with `aws ecs run-task`
# before every deploy that changes image_digest or runs a new migration.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "aos-crm-${var.environment}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_migrate.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = local.image
      essential = true
      command   = ["true"]
      environment = [
        for k, v in merge(local.privacy_env, {
          DISABLE_DB_MIGRATIONS          = "false"
          DISABLE_CRON_JOBS_REGISTRATION = "false"
        }) : { name = k, value = v }
      ]
      secrets = local.app_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "server" {
  family                   = "aos-crm-${var.environment}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_server.arn

  container_definitions = jsonencode([
    {
      name      = "server"
      image     = local.image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      # Migrations/cron registration already ran in the migrate task above;
      # the server service must never race it or redo an 8.6 min boot on
      # every replica.
      environment = [
        for k, v in merge(local.privacy_env, {
          NODE_PORT                      = tostring(var.container_port)
          DISABLE_DB_MIGRATIONS          = "true"
          DISABLE_CRON_JOBS_REGISTRATION = "true"
        }) : { name = k, value = v }
      ]
      secrets = local.app_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "aos-crm-${var.environment}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_worker.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = local.image
      essential = true
      command   = ["yarn", "worker:prod"]
      environment = [
        for k, v in merge(local.privacy_env, {
          DISABLE_DB_MIGRATIONS          = "true"
          DISABLE_CRON_JOBS_REGISTRATION = "true"
        }) : { name = k, value = v }
      ]
      secrets = local.app_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "server" {
  name            = "aos-crm-${var.environment}-server"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.server_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = var.alb_health_check_grace_period_seconds

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "aos-crm-${var.environment}-worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }
}
