# Offline check of the ECS environment for the captcha switch (CRM-042).
# The AWS provider is mocked, so this needs no credentials and touches no
# account. Run from deploy/aws: terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::000000000000:role/test"
    }
  }

  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:eu-west-1:000000000000:secret:test"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:eu-west-1:000000000000:log-group:test"
    }
  }

  mock_resource "aws_acm_certificate" {
    defaults = {
      arn                       = "arn:aws:acm:eu-west-1:000000000000:certificate/test"
      domain_validation_options = []
    }
  }

  mock_data "aws_availability_zones" {
    defaults = {
      names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
    }
  }
}

variables {
  permissions_boundary_arn = "arn:aws:iam::000000000000:policy/test-boundary"
  domain_name              = "example.test"
  route53_zone_id          = "Z0000000000000000000"
  dmarc_rua_email          = "dmarc@example.test"
  image_digest             = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  budget_alert_email       = "alerts@example.test"
  server_cpu               = 512
  server_memory            = 1024
  worker_cpu               = 512
  worker_memory            = 1024
  server_desired_count     = 1
  worker_desired_count     = 1
  db_instance_class        = "db.t4g.micro"
  db_allocated_storage_gb  = 20
  redis_node_type          = "cache.t4g.micro"
}

run "captcha_off_leaves_variables_out_of_the_environment" {
  command = apply

  plan_options {
    target = [
      aws_acm_certificate.this,
      aws_ecs_task_definition.migrate,
      aws_ecs_task_definition.server,
      aws_ecs_task_definition.worker,
    ]
  }

  variables {
    captcha_driver   = ""
    captcha_site_key = ""
  }

  assert {
    condition = alltrue([
      for def in [
        aws_ecs_task_definition.migrate.container_definitions,
        aws_ecs_task_definition.server.container_definitions,
        aws_ecs_task_definition.worker.container_definitions,
      ] : !strcontains(def, "CAPTCHA_")
    ])
    error_message = "With captcha off, no CAPTCHA_* variable may reach a task definition: an empty CAPTCHA_DRIVER fails the server's enum validation at boot."
  }
}

run "captcha_on_passes_driver_and_site_key" {
  command = apply

  plan_options {
    target = [
      aws_acm_certificate.this,
      aws_ecs_task_definition.migrate,
      aws_ecs_task_definition.server,
      aws_ecs_task_definition.worker,
    ]
  }

  variables {
    captcha_driver     = "TURNSTILE"
    captcha_site_key   = "1x00000000000000000000AA"
    captcha_secret_key = "1x0000000000000000000000000000000AA"
  }

  assert {
    condition = alltrue([
      for def in [
        aws_ecs_task_definition.migrate.container_definitions,
        aws_ecs_task_definition.server.container_definitions,
        aws_ecs_task_definition.worker.container_definitions,
      ] : strcontains(def, "\"CAPTCHA_DRIVER\"") && strcontains(def, "\"CAPTCHA_SITE_KEY\"")
    ])
    error_message = "With captcha on, every task definition must carry CAPTCHA_DRIVER and CAPTCHA_SITE_KEY."
  }
}
