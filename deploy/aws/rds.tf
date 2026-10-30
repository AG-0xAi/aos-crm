resource "aws_db_subnet_group" "this" {
  name       = "aos-crm-${var.environment}"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}

# Private PostgreSQL 16 with backups and PITR (R1). publicly_accessible is
# hardcoded false, not a variable: "DB never public" is an invariant the
# spec sets, not a founder choice (AWS_DEPLOYMENT_PLAN.md invariants).
resource "aws_db_instance" "this" {
  identifier     = "aos-crm-${var.environment}"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  max_allocated_storage = 0 # no storage autoscaling surprise without founder approval

  db_name  = "aos_crm_${var.environment}"
  username = "aos_crm"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-03:30"
  maintenance_window      = "mon:04:00-mon:04:30"
  multi_az                = var.db_multi_az

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = !var.db_deletion_protection
  final_snapshot_identifier = var.db_deletion_protection ? "aos-crm-${var.environment}-final" : null

  copy_tags_to_snapshot = true

  tags = {
    Name = "aos-crm-${var.environment}"
  }
}
