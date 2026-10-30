# ElastiCache Valkey, not ElastiCache Redis OSS: deploy/local/compose.yaml
# pins redis:7.4.12, and its comment records that 7.4.x is RSALv2/SSPLv1
# (not BSD-3 like 7.2.x) -- fine for the local single-tenant image, tracked
# in docs/aos/bootstrap/LICENSE_COMPLIANCE.md for CRM-006. Valkey is AWS's
# BSD-3-licensed, wire-protocol-compatible fork (the same upstream
# maintainers forked after the Redis Ltd. license change), so BullMQ talks
# to it unchanged while staying clear of that licensing question for a
# managed service the founder pays for directly.

resource "aws_elasticache_subnet_group" "this" {
  name       = "aos-crm-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

# BullMQ's queues are durable state, not a cache: deploy/local/compose.yaml's
# redis service sets `--maxmemory-policy noeviction` for exactly this reason
# (its comment: eviction would silently drop queued/repeatable jobs under
# memory pressure, and the stack "comes back looking fine"). The managed
# equivalent is this parameter group, not a command-line flag -- same
# policy, same reasoning, so AWS never evicts a queued job key either. The
# trade-off is explicit too: under memory pressure Valkey refuses new
# writes (OOM) instead of silently dropping jobs. redis_node_type (no
# default, variables.tf) must be sized with that headroom in mind.
resource "aws_elasticache_parameter_group" "this" {
  name   = "aos-crm-${var.environment}"
  family = "valkey7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# Private queue store (R1): no public endpoint, AUTH token required, TLS
# in transit. Single node / no automatic failover for a minimal staging
# footprint -- the founder can turn on a replica once cost is approved.
resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "aos-crm-${var.environment}"
  description          = "aos-crm ${var.environment} BullMQ queue + cache store"

  engine         = "valkey"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = 6379

  parameter_group_name = aws_elasticache_parameter_group.this.name
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.redis.id]

  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}
