# AWS: propuesta preliminar, sin despliegue

Fecha: 27 de octubre de 2026. **Solo análisis. No se han creado recursos, credenciales, infraestructura ejecutable ni costes AWS.** La arquitectura definitiva queda pendiente de las mediciones locales, presupuesto, región y requisitos de clientes.

| Opción | Encaje y coste operativo a evaluar |
| --- | --- |
| EC2 + contenedores | Menor cambio respecto al Compose local; requiere administrar host, parches, capacidad y recuperación. Comparar coste total, no solo la VM |
| ECS con Fargate | Servicios separados para servidor y worker; tareas con CPU/memoria/red/IAM declarados. Evita administrar hosts, pero exige dimensionado y control de coste por tareas, red y servicios asociados |
| Servicios administrados | RDS PostgreSQL, caché/colas Redis compatible y S3 privado; simplifican algunas operaciones a cambio de coste fijo y requisitos de compatibilidad |

ECS/Fargate es el candidato a evaluar para separar escalado del servidor y workers; no se ha elegido tamaño ni aprobado arquitectura. [Capacidades de Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).

## Fronteras propuestas

- Entrada HTTPS por dominio y balanceador; aplicación en red privada cuando corresponda. DB y Redis sin exposición pública. MCP bajo la misma autenticación y autorización, con límites y registro de acceso.
- RDS en versión PostgreSQL compatible con la referencia fijada, TLS, backups y recuperación a un punto temporal. Probar extensiones, permisos y migraciones: RDS restringe acceso administrativo respecto a un PostgreSQL del host. [RDS PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html).
- S3 privado para archivos con permisos mínimos, cifrado, retención y restauración. Pasar de storage local a driver S3 mediante migración verificada, no copiar archivos sin reconciliar referencias.
- Secret manager e identidades IAM por servicio; evitar claves AWS estáticas. Separar claves de firma y cifrado con estrategia de rotación/recuperación.
- Logs y métricas bajo control AOS, con destino, retención y costes explícitos. La propuesta de observabilidad AWS requiere autorización y no reactiva Sentry/telemetría del fabricante.
- Funciones de terceros fuera del servidor/worker. El driver Lambda existente necesita roles, almacenamiento y límites propios; no basta renombrar `LOCAL`. El intérprete requiere un sandbox aprobado, manteniéndose desactivado hasta entonces. [Entorno de ejecución Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html).

Los esquemas por workspace no equivalen a aislamiento comercial de tenants. Antes de SaaS se requieren pruebas negativas entre workspaces en API, jobs, archivos, búsqueda y herramientas IA; decidir aislamiento adicional según riesgo del cliente. Evaluar qué controles necesarios dependen de Enterprise y resolver su licencia antes de prometerlos.

## Transición reproducible pendiente

1. Aceptar primero el CRM local construido por SHA y su perfil de privacidad.
2. Medir RAM/CPU, latencia, concurrencia y colas; acordar región, presupuesto y objetivos de recuperación con el founder.
3. Construir una vez en CI aislada, con contexto mínimo, SBOM, avisos legales y artefacto identificado por digest; pruebas y aprobación humana antes de publicar/desplegar.
4. Restaurar datos de prueba en staging, ejecutar migraciones una sola vez, comprobar integridad y rollback/restauración. Separar migración de despliegue de workers.
5. Probar backup completo de PostgreSQL, archivos y secretos necesarios para descifrar; fijar RPO/RTO a partir de pruebas, no de una expectativa.
6. Revisar HTTPS, auth, aislamiento, licencias, privacidad, retención y control de salida. Solo después preparar una orden LIVE explícita.

Falta CI/CD del fork, estimación con precios de la región elegida, backups probados y la propia instalación local. No se generó Terraform/CloudFormation que pudiera confundirse con infraestructura validada ni se implementó billing o tenancy comercial.

## CRM-011 — IaC validada, sin aplicar (29 de octubre de 2026)

Terraform en `deploy/aws/**` (`deploy/aws/README.md` tiene el detalle operativo). **Esta fase no
crea nada en AWS**: solo `terraform fmt`/`init -backend=false`/`validate` y un escaneo propio de
secretos, con comandos y códigos de salida reales más abajo. `terraform plan`/`apply` quedan para
cuando el founder dé la orden LIVE con credenciales -- que esta fase nunca tuvo.

### Arquitectura (R1)

- **ECR** con un solo repositorio (`aws_ecr_repository.app`): la misma imagen `twenty` que
  `deploy/local/compose.yaml` usa para server y worker, distinguida solo por el comando,
  referenciada siempre por digest (`var.image_digest`, sin valor por defecto).
- **ECS Fargate**: servicios `server` y `worker`, más una tarea de migración separada
  (`aws_ecs_task_definition.migrate`). El `entrypoint.sh` oficial
  (`packages/twenty-docker/twenty/entrypoint.sh`) corre `database:init:prod`/`upgrade`/
  `cron:register:all` de forma incondicional antes de arrancar Nest; `compose.yaml` midió 8,6 min
  (516 s) para eso en local. La tarea de migración hace exactamente ese trabajo
  (`DISABLE_DB_MIGRATIONS=false`, `DISABLE_CRON_JOBS_REGISTRATION=false`) y termina con
  `command = ["true"]` en vez de arrancar el servidor; server y worker arrancan con ambas
  banderas en `true` para no repetirlo en cada despliegue ni en cada réplica. La tarea de
  migración se corre con `aws ecs run-task`, nunca como `aws_ecs_service` (ver comandos abajo).
- **RDS PostgreSQL 16.15** privada (`publicly_accessible = false` fijo en el recurso, no una
  variable: no es una decisión del founder), backups automáticos y PITR
  (`db_backup_retention_days > 0`, forzado por `validation`).
- **ElastiCache Valkey**, no ElastiCache Redis OSS: mismo protocolo que BullMQ ya habla, pero
  licencia BSD-3, evitando la pregunta RSALv2/SSPLv1 que el propio `compose.yaml` señala para
  `redis:7.4.12` (ver `LICENSE_COMPLIANCE.md`, CRM-006). Grupo de parámetros propio
  (`aws_elasticache_parameter_group.this`) con `maxmemory-policy = noeviction`: mismo motivo que
  el `--maxmemory-policy noeviction` del Redis local -- las colas de BullMQ son estado, no caché;
  perder trabajos en cola silenciosamente bajo presión de memoria es peor que rechazar escrituras.
- **S3 privado**: bloqueo público total, cifrado SSE-KMS, política que niega cualquier tráfico
  sin TLS (`aws_s3_bucket_policy.deny_insecure_transport`).
- **ALB HTTPS con ACM**: TLS 1.3 forzado (`ELBSecurityPolicy-TLS13-1-2-2021-06`); el único
  listener de aplicación es el 443, el 80 solo redirige.
- **Secrets Manager** e **IAM**: ver R2.
- **Logs** con retención explícita (`var.log_retention_days`, 30 días por defecto) en los tres
  grupos (server/worker/migrate) -- nunca "no expira".
- **Alarma de AWS Budgets** (`aws_budgets_budget.monthly`) sobre el límite que fije el founder,
  con aviso al 80% real y al 100% pronosticado.

**Health check del ALB, coherente con el arranque lento, no con una suposición optimista:** el
target group usa `unhealthy_threshold = 5` (no falla rápido en el primer arranque) y
`alb_health_check_grace_period_seconds` (300 s por defecto, `variables.tf`) está documentado ahí
mismo como una cifra conservadora, no medida -- separar la migración del arranque del servicio
debería acortar mucho el arranque frente a los 8,6 min locales, pero nadie ha medido ese arranque
en ECS todavía. Re-medir en el primer arranque LIVE antes de confiar en el valor o de activar
cualquier automatización que dependa de él (autoscaling, despliegues rolling más agresivos).

### Privacidad y seguridad (R2)

Mismo perfil que `deploy/local/privacy.env`, reproducido en `ecs.tf`'s `local.privacy_env` porque
las definiciones de tarea de ECS reciben variables de entorno inline, no un `env_file`:

| Variable | Valor | Origen |
| --- | --- | --- |
| `TELEMETRY_ENABLED` | `false` | `privacy.env` |
| `ANALYTICS_ENABLED` | `false` | `privacy.env` |
| `MARKETPLACE_CATALOG_SYNC_CRON_ENABLED` | `false` | `privacy.env` |
| `IS_CONFIG_VARIABLES_IN_DB_ENABLED` | `false` | `privacy.env` |
| `EXCEPTION_HANDLER_DRIVER` | `CONSOLE` | `privacy.env` |
| `METER_DRIVER` / `SENTRY_DSN` / `SENTRY_FRONT_DSN` / `ENTERPRISE_KEY` / `ENTERPRISE_VALIDITY_TOKEN` | `""` (vacío explícito) | `privacy.env` |
| `LOGIC_FUNCTION_TYPE` / `CODE_INTERPRETER_TYPE` | `DISABLED` | `privacy.env` / SEC-01 |
| `IS_MULTIWORKSPACE_ENABLED` | `false` | `privacy.env` / `LOCAL_SETUP.md` |

Ninguna de estas pasa por Secrets Manager porque ninguna es secreta: es el mismo contrato
versionado que `privacy.env` ya es. Lo que sí viene de Secrets Manager, inyectado solo por el
bloque `secrets` de la definición de tarea (nunca por `environment`, que cualquiera con permiso
para `DescribeTaskDefinition` lee en texto plano):

| Variable de entorno | Secreto | Generado por |
| --- | --- | --- |
| `PG_DATABASE_URL` | `aos-crm/<env>/pg-database-url` | `random_password.db` + el endpoint de RDS, compuestos en `secret_string` |
| `REDIS_URL` | `aos-crm/<env>/redis-url` | `random_password.redis_auth` + el endpoint de ElastiCache |
| `ENCRYPTION_KEY` | `aos-crm/<env>/encryption-key` | `random_password.encryption_key` |

Ningún valor es un literal escrito a mano: los tres se generan con `random_password` en el momento
de aplicar y no existen en el repo (el escaneo R3 de abajo lo comprueba). El acceso a S3
(`STORAGE_TYPE=s3`) tampoco lleva `STORAGE_S3_ACCESS_KEY_ID`/`SECRET`: dejarlas sin definir hace
que `file-storage-driver.factory.ts` caiga a `fromNodeProviderChain()`, que en ECS resuelve al rol
de tarea de cada servicio (`aws_iam_role.ecs_task_server` / `ecs_task_worker`, con permisos solo
sobre el bucket propio) sin ninguna clave AWS estática -- la misma razón de fondo detrás del
pedido de R1 de "IAM... sin claves estáticas". La tarea `migrate` tiene su propio rol
(`aws_iam_role.ecs_task_migrate`) sin ese permiso: nunca llama al driver de almacenamiento, solo
corre migraciones y registro de cron (`ecs.tf`).

DB y Redis nunca públicos: `aws_db_instance.this.publicly_accessible = false` fijo, y
`aws_elasticache_replication_group.this` solo acepta tráfico de `aws_security_group.ecs_tasks`
(nunca de internet). MCP solo por HTTPS: el único listener de aplicación es
`aws_lb_listener.https` (443); el 80 solo redirige. Alta pública cerrada: mismo mecanismo que
`LOCAL_SETUP.md` (`IS_MULTIWORKSPACE_ENABLED=false` + el alta única del primer admin hecha a mano
tras el primer deploy, no una variable de Terraform).

**SSL hacia RDS (fix1, 30/10/2026).** RDS Postgres 16 fuerza SSL por defecto (`rds.force_ssl`) y
rechaza una conexión en claro con `no pg_hba.conf entry for host ... no encryption` -- así falló la
tarea `migrate` en el primer intento de aplicar la beta. `local.privacy_env` (`ecs.tf`), común a
`migrate`/`server`/`worker`, añade `PG_SSL_ALLOW_SELF_SIGNED=true`: es el único interruptor que
hace que los tres clientes pg de Twenty cifren la conexión (`ssl: { rejectUnauthorized: false }`)
en `core.datasource.ts:75`, `raw.datasource.ts:13` y
`workspace-data-source.service.ts:152`. Twenty no expone una opción para fijar o verificar la CA
de RDS (`config-variables.ts:1478`), así que la conexión queda cifrada pero sin validar la cadena
de certificados del servidor; verificarla exigiría un cambio en el núcleo, fuera de esta spec. El
`psql` que el propio `entrypoint.sh` de `packages/twenty-docker/twenty` usa para detectar si la
base está vacía no necesita ese ajuste: `PG_DATABASE_URL` no lleva `sslmode`, así que libpq usa su
valor por defecto `prefer`, que intenta TLS primero y solo cae a texto plano si el servidor no lo
ofrece; como RDS exige TLS, ese intento siempre tiene éxito, igual que el pool de Node.

**Regla de entrada 80/tcp en el security group del ALB (fix1, 30/10/2026).** El listener
`aws_lb_listener.http_redirect` (80 -> 443, `alb-acm.tf`) ya existía, pero `aws_security_group.alb`
solo abría 443 de entrada: `http://<dominio>/` no llegaba ni al listener, el ALB descartaba el
paquete antes de poder devolver el 301. `security-groups.tf` añade una regla de entrada 80/tcp
desde `0.0.0.0/0` (solo sirve para redirigir: el listener de 80 nunca reenvía a un target group).
Sin bloque IPv6: esta VPC no tiene CIDR IPv6 y el ALB usa el `ip_address_type` por defecto
(`ipv4`, ver `network.tf` y `aws_lb.this` en `alb-acm.tf`) -- añadir `ipv6_cidr_blocks = ["::/0"]`
el día que el stack adopte dual-stack, no antes.

**Cifrado en tránsito de ElastiCache (fix1, 30/10/2026, confirmado sin cambios).**
`aws_elasticache_replication_group.this` ya declaraba `transit_encryption_enabled = true`
(`redis.tf`) y `secrets.tf` ya compone `REDIS_URL` con el esquema `rediss://` -- ya eran
coherentes entre sí. `redis-client.service.ts` pasa esa URL tal cual a `new IORedis(redisUrl,
...)`, e ioredis activa TLS automáticamente para el esquema `rediss://` sin configuración
adicional. No hizo falta ningún cambio de Terraform aquí; se deja constancia porque el pedido de
fix1 pedía comprobarlo explícitamente, no porque hubiera un defecto.

### Validación (R3)

Comandos reales, ejecutados el 29 de octubre de 2026 dentro de la distro WSL dedicada
(`AOS-CRM-Ubuntu-24.04`), en un contenedor de `hashicorp/terraform` fijado por digest (Terraform
v1.9.8), sin ninguna variable `AWS_*` en el entorno del contenedor -- no se pasó `-e` ni se montó
`~/.aws`. El host sí tiene un `AWS_BEARER_TOKEN_BEDROCK` (token de Bedrock, no de esta cuenta AWS,
para otro propósito); como `docker run` no hereda variables del shell salvo con `-e`/`--env-file`
y aquí no se usó ninguno de los dos, el contenedor nunca lo vio.

```
$ docker pull hashicorp/terraform:1.9
Digest: sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd
# docker run ... version -> Terraform v1.9.8

$ docker run --rm -v "$PWD:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (sin salida: todo ya canónico)

$ docker run --rm -v "$PWD:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
exit 0 ("Terraform has been successfully initialized!"; instaló hashicorp/aws 5.100.0 y
hashicorp/random 3.9.1 desde el Terraform Registry -- descarga de proveedores, no llamada a la
API de AWS)

$ docker run --rm -v "$PWD:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
exit 0 ("Success! The configuration is valid.")

$ sh deploy/aws/scripts/scan-secrets.sh
exit 0 (sin coincidencias: ni ID de cuenta de 12 dígitos, ni AKIA/ASIA, ni literal de secreto)
```

`terraform validate` falló una vez antes de llegar a este resultado: `aws_security_group.alb` y
`aws_security_group.ecs_tasks` se referenciaban entre sí dentro de sus propios bloques
`ingress`/`egress` inline, lo que Terraform reconoce como un ciclo de dependencias
(`Error: Cycle: aws_security_group.alb, aws_security_group.ecs_tasks`) y rechaza antes de tocar
AWS. Se resolvió moviendo esas dos reglas cruzadas a `aws_security_group_rule` independientes
(`security-groups.tf`): ninguno de los dos grupos de seguridad depende ya del otro en su propia
definición, solo las reglas sueltas dependen de ambos. Lección registrada abajo.

### Coste estimado (staging mínimo)

Fuentes oficiales, fecha de acceso 29 de octubre de 2026. Las páginas públicas de precios de AWS
cargan sus tablas por región con JavaScript; lo que esta sesión pudo extraer de forma estática
quedó en la región que cada página usó en sus propios ejemplos (**US East, N. Virginia**, salvo
NAT Gateway en US East, Ohio), no en una región UE. Antes de fijar `budget_amount_usd`, recalcular
con la [AWS Pricing Calculator](https://calculator.aws/) sobre la región real que elija el
founder.

| Recurso | Tarifa (fuente, fecha de acceso) | Supuesto | Coste/mes |
| --- | --- | --- | --- |
| Fargate `server` | $0.04048/vCPU-h + $0.00445/GB-h ([aws.amazon.com/fargate/pricing](https://aws.amazon.com/fargate/pricing/), 2026-10-29, US East N. Virginia) | 0,5 vCPU / 1 GB, 730 h | ~$18.03 |
| Fargate `worker` | idem | 0,5 vCPU / 1 GB, 730 h | ~$18.03 |
| ALB | $0.0225/h + $0.008/LCU-h ([aws.amazon.com/elasticloadbalancing/pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), 2026-10-29, US East N. Virginia) | 730 h, ~1 LCU medio | ~$22.27 |
| NAT Gateway | $0.045/h + $0.045/GB ([aws.amazon.com/vpc/pricing](https://aws.amazon.com/vpc/pricing/), 2026-10-29, US East Ohio) | 730 h, ~10 GB/mes procesados | ~$33.30 |
| Secrets Manager | $0.40/secreto/mes + $0.05/10.000 llamadas ([aws.amazon.com/secrets-manager/pricing](https://aws.amazon.com/secrets-manager/pricing/), 2026-10-29) | 3 secretos, <10.000 llamadas | ~$1.25 |
| CloudWatch Logs | $0.50/GB ingerido + $0.03/GB-mes almacenado ([aws.amazon.com/cloudwatch/pricing](https://aws.amazon.com/cloudwatch/pricing/), 2026-10-29) | ~2 GB/mes, 30 días de retención | ~$1.06 |
| ECR | $0.10/GB-mes ([aws.amazon.com/ecr/pricing](https://aws.amazon.com/ecr/pricing/), 2026-10-29) | ~2 GB almacenados | ~$0.20 |
| **Subtotal con tarifa verificada** | | | **~$94.14** |
| RDS `db.t4g.micro` (cómputo + 20 GB gp3) | **no verificado** -- `aws.amazon.com/rds/postgresql/pricing/` no cargó cifras por instancia/GB en esta sesión (tabla dinámica) | 730 h + 20 GB | *calcular en AWS Pricing Calculator* |
| ElastiCache `cache.t4g.micro` | **no verificado** -- misma razón, `aws.amazon.com/elasticache/pricing/` | 730 h | *calcular en AWS Pricing Calculator* |
| S3 Standard | **no verificado** -- misma razón, `aws.amazon.com/s3/pricing/` | ~5 GB | *calcular en AWS Pricing Calculator* |
| AWS Budgets | **no verificado** el número exacto de presupuestos gratuitos; probablemente ~$0 para un único presupuesto | 1 alarma | *~$0, no verificado* |

El subtotal con tarifa verificada (~$94/mes) ya es solo una parte del total: un staging mínimo
completo probablemente cae entre $110 y $160/mes, pero esa cifra mezcla tarifas reales con
estimaciones sin fuente y **no debe tratarse como el presupuesto a aprobar** sin antes
recalcular con la Pricing Calculator en la región elegida. La tarea de migración (`migrate`) no
está en esta tabla: corre minutos por despliegue, no 730 h/mes.

### Despliegue, rollback, backup y destrucción (para cuando haya orden LIVE)

**Despliegue inicial:**

1. `aws sso login --profile <perfil>` (credenciales temporales -- ver "Credenciales" abajo).
2. `terraform init` con un backend remoto real (el founder decide cuál antes; `versions.tf` no
   trae uno fijado a propósito).
3. `terraform plan -var-file=terraform.tfvars` y revisión humana del plan antes de cualquier
   `apply`.
4. `terraform apply` crea la infraestructura, incluido el ECR vacío. Si `route53_zone_id` está
   puesto, este mismo apply espera a que ACM valide el certificado por DNS antes de terminar
   (`aws_acm_certificate_validation`, de la que ahora depende el listener HTTPS) -- no basta con
   que el comando empiece, hay que dejarlo terminar. Sin `route53_zone_id`, el apply adjunta el
   certificado al listener en estado `PENDING_VALIDATION`; no hace falta un segundo apply, pero
   el HTTPS real no funciona hasta el paso 7.
5. Construir y publicar la imagen por digest en `terraform output ecr_repository_url`; fijar
   `image_digest` a ese digest y volver a aplicar (o pasar `-var image_digest=...`).
6. Migrar una sola vez, antes de que el servicio sirva tráfico real:
   `aws ecs run-task --cluster <cluster> --task-definition $(terraform output -raw ecs_migrate_task_definition_arn) --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...]}"`
   y esperar a que el task termine con `exitCode: 0` (`aws ecs describe-tasks`) antes de
   continuar.
7. DNS: si `route53_zone_id` está puesto, el certificado ya quedó validado durante el paso 4 (no
   hay nada más que hacer aquí para el certificado). Si no, usar
   `terraform output acm_validation_records` para crear la CNAME a mano en el proveedor de DNS
   real y esperar a que ACM la confirme (`aws acm describe-certificate`, estado `ISSUED`) -- el
   listener ya tiene el ARN del certificado desde el paso 4, así que no hace falta volver a
   aplicar. En ambos casos, `terraform output alb_dns_name` da el CNAME/alias final de
   `domain_name`.

**Redeploy con una imagen nueva:** repetir los pasos 5 y 6 (migrar primero), luego
`terraform apply` actualiza `server`/`worker` a la imagen nueva con un rolling deployment de ECS.

**Rollback:**

- Imagen: volver `image_digest` al digest anterior conocido y `terraform apply` -- ECS hace un
  rolling deployment hacia atrás sin perder infraestructura.
- Migración: Twenty no declara sus migraciones reversibles por CLI; si una migración sale mal, la
  única vía fiable es restaurar desde el PITR más cercano al momento previo (ver Backups), no un
  "down" automático.
- Infraestructura: `terraform plan` antes de cualquier `apply` que reduzca o destruya recursos;
  nunca `apply` sin revisión humana del plan.

**Restauración de backup:**

- RDS: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier aos-crm-<env> --target-db-instance-identifier aos-crm-<env>-restored --restore-time <timestamp ISO 8601>`
  crea una instancia nueva, no sobrescribe la viva; repuntar `PG_DATABASE_URL` (secrets.tf) a la
  restaurada solo después de validar su integridad.
- S3: con versionado activado (`aws_s3_bucket_versioning.files`), restaurar una versión anterior
  de un objeto es `aws s3api copy-object` desde su `VersionId`; no hay snapshot de bucket completo
  en esta fase (replicación cross-region queda fuera de alcance).
- Redis/Valkey: BullMQ trata las colas como estado reconstruible -- el server re-registra los
  cron jobs al arrancar, igual que en local -- así que esta fase no documenta restauración de
  snapshot de ElastiCache: ningún dato de negocio vive solo ahí.

**Destrucción:** `terraform destroy -var-file=terraform.tfvars`. Si `db_deletion_protection` está
en `true`, desactivarlo primero con un `apply` separado; `terraform` deja un
`final_snapshot_identifier` cuando sí lo está. Confirmar con el founder que ningún backup final es
necesario antes de destruir, o esperar a que ese snapshot final exista.

### Qué decide el founder

- `aws_region` -- se mencionó una región UE; sin decidir cuál (`eu-west-1`, `eu-central-1`, ...).
  También determina qué tarifas reales aplican (ver "Coste estimado").
- `domain_name` -- dominio real; no existe todavía en este fork público.
- `budget_amount_usd` / `budget_alert_email` -- techo de gasto mensual y quién recibe la alarma.
- Tamaños (`server_cpu`/`memory`, `worker_cpu`/`memory`, `*_desired_count`, `db_instance_class`,
  `db_allocated_storage_gb`, `redis_node_type`) -- coste contra margen de capacidad;
  `terraform.tfvars.example` solo sugiere puntos de partida mínimos, no los fija.
- `route53_zone_id` (opcional) -- si Route 53 es el registrador real del dominio.

### Credenciales: SSO temporal, no claves estáticas

Ningún comando de esta fase usó una credencial de AWS -- ni siquiera `init`/`validate`, que solo
descargan proveedores del Terraform Registry, no llaman a la API de AWS. Cuando haya orden LIVE:

1. Quien administre la cuenta crea un Permission Set en **AWS IAM Identity Center** (sucesor de
   AWS SSO) con el privilegio mínimo que este stack necesita, y lo asigna al equipo.
2. Cada persona corre `aws configure sso` una vez y luego `aws sso login --profile <perfil>` por
   sesión: credenciales temporales (horas), nunca un `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
   de usuario IAM de larga duración.
3. Terraform usa ese perfil (`AWS_PROFILE=<perfil>` o `profile = "<perfil>"` en el provider) sin
   que ninguna clave estática toque el repo, un commit o un log.

### Lecciones

**Síntoma:** `terraform validate` falla con `Error: Cycle: aws_security_group.alb,
aws_security_group.ecs_tasks` antes de crear nada.
**Causa:** dos reglas que se referencian mutuamente (`alb` egress -> `ecs_tasks`; `ecs_tasks`
ingress -> `alb`) declaradas como bloques `ingress`/`egress` inline dentro de cada
`aws_security_group`, así que cada recurso depende de la definición completa del otro.
**Fix:** mover las dos reglas cruzadas a `aws_security_group_rule` independientes
(`security-groups.tf`); los bloques inline solo quedan para reglas de una sola dirección.
**Regla:** cuando dos security groups deban aceptarse mutuamente, usar `aws_security_group_rule`
(o el equivalente moderno `aws_vpc_security_group_*_rule`) para esa pareja desde el principio, no
bloques inline -- un ciclo entre dos grupos de seguridad es casi siempre así, no una excepción de
este stack.

**Síntoma:** las páginas públicas de precios de AWS (`aws.amazon.com/<servicio>/pricing/`) no dan
cifras por instancia/GB fiables para WebFetch: sus tablas regionales cargan por JavaScript y el
HTML estático que se extrae solo trae los ejemplos ilustrativos (casi siempre en US East).
**Causa:** la extracción de esta sesión no ejecuta JavaScript ni abre la Pricing Calculator.
**Fix:** citar lo que sí vino en el HTML estático (con URL y fecha) y marcar el resto "no
verificado" en vez de inventar una cifra o asumir que la región US East aplica a la región real.
**Regla:** para un presupuesto que alguien va a aprobar, un número "no verificado" con la fuente
que falló documentada es más honesto y más útil que una cifra inventada con apariencia de
precisión.

## CRM-013 — entorno beta multi-espacio, validado sin aplicar (29-30 de octubre de 2026)

Orden del founder del 29/10: un entorno beta en AWS para que unos amigos tengan al día siguiente
cada uno su propio espacio y conecten su ChatGPT. Decisiones suyas: región **eu-west-1**
(Irlanda), alarma de presupuesto **500 USD/mes**, dominio comprado en Route 53 dentro de la cuenta
del CRM (el registro ya creó su zona alojada). **Este track tampoco crea nada en AWS**: no usó
ninguna credencial de AWS y no ejecutó `plan` ni `apply`. Lo aplica el coordinador con credenciales
SSO temporales siguiendo el procedimiento de R4.

Sobre CRM-011 cambia exactamente esto: multi-espacio activo con creación limitada a
administradores del servidor, certificado y DNS para el dominio y su comodín, estado remoto con
bloqueo, y región/presupuesto con valor por defecto. El resto del stack (RDS privada, Valkey, S3
privado, Secrets Manager, IAM por servicio, retención de logs, tarea de migración separada) no se
toca.

### R1 — Multi-espacio: qué variables son y de dónde sale cada una

Todo lo de abajo está leído del código de Twenty incorporado en este repo, no de la documentación
del fabricante. Las rutas son relativas a la raíz del repo.

| Variable (valor en `ecs.tf`) | Qué hace, según el código |
| --- | --- |
| `IS_MULTIWORKSPACE_ENABLED = "true"` | Por defecto `false` (`packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts:2184`). Con `true`, `resolveWorkspaceAndPublicDomain` resuelve el espacio a partir del host de la petición (`.../domain/workspace-domains/services/workspace-domains.service.ts:112`); con `false` ese mismo método devuelve el único espacio existente. |
| `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS = "true"` | Ya es el valor por defecto (`config-variables.ts:588`); se declara porque la beta depende de él. `assertWorkspaceCreationAllowed` (`.../auth/services/sign-in-up.service.ts:496`) rechaza crear espacio salvo que el usuario autenticado tenga `canAccessFullAdminPanel`, y solo se salta esa comprobación cuando hay **cero** espacios (`:503`). |
| `DEFAULT_SUBDOMAIN = "app"` | Valor por defecto de upstream (`config-variables.ts:1225`, exigido por `@ValidateIf` solo en multi-espacio, `:1224`). `getBaseUrl()` antepone este subdominio al host de `FRONTEND_URL` (`.../domain/domain-server-config/services/domain-server-config.service.ts:19-30`), y `get-subdomain-and-custom-domain-from-hostname.util.ts` mapea ese mismo subdominio de vuelta a "sin espacio", así que `app.<dominio>` nunca choca con el espacio de nadie. |
| `FRONTEND_URL = "https://<dominio>"` | `config-variables.ts:1200`. Es el `frontDomain` contra el que se resuelve cada subdominio: en el util anterior, `hostname.endsWith(".<frontDomain>")` da el subdominio, y ese subdominio se busca en `workspace.subdomain` (`workspace-domains.service.ts:173`). Por eso va el **ápex**, no `app.<dominio>`. |
| `SERVER_URL = "https://<dominio>"` | `config-variables.ts:1650`. Es el host de API con el que `isApiHost()` compara el host de la petición (`.../application/application-oauth/controllers/oauth-discovery.controller.ts:91-95`). |
| `TRUST_PROXY = "loopback, linklocal, uniquelocal"` | Valor por defecto de upstream (`config-variables.ts:1667`), aplicado en `packages/twenty-server/src/main.ts:64-69`. Sin él, `getRequestBaseUrl` (`packages/twenty-server/src/utils/get-request-base-url.util.ts:4-5`) devolvería `http://` detrás del ALB y el `issuer` de OAuth y el puntero de `resource_metadata` anunciarían HTTP en un stack que solo sirve HTTPS. El ALB alcanza las tareas desde dentro de `var.vpc_cidr` (10.42.0.0/16), que es RFC1918 y por tanto `uniquelocal`. |
| `EMAIL_DRIVER = "LOGGER"` | Valor por defecto de upstream (`config-variables.ts:531`). No sale correo de la cuenta; ver "correo" más abajo. |

**Dónde vive `/mcp`:** en el mismo servidor y por tanto en **cualquiera** de esos hosts.
`@Controller(ApiPath.Mcp)` (`packages/twenty-server/src/engine/api/mcp/controllers/mcp-core.controller.ts:44`)
con `ApiPath.Mcp = 'mcp'` (`packages/twenty-shared/src/types/ApiPath.ts:17`), registrado para todos
los métodos en `packages/twenty-server/src/app.module.ts:133`. Solo acepta **POST**
(`mcp-core.controller.ts:65`), así que una comprobación con GET da 404 y no prueba nada. Sin
credencial válida, `McpAuthGuard` pone
`WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"` y
lanza 401 (`.../api/mcp/guards/mcp-auth.guard.ts:27-40`), donde `<base>` es el host de la petición.

**Dónde se publica la pantalla de autorización OAuth:** es una ruta del frontend,
`AppPath.Authorize = '/authorize'` (`packages/twenty-shared/src/types/AppPath.ts:36`, página
`packages/twenty-front/src/pages/auth/Authorize.tsx`, montada en
`packages/twenty-front/src/modules/app/hooks/useCreateWorkspaceAppRouter.tsx:243`), servida por el
mismo contenedor que la API porque la imagen `twenty` incluye el frontend compilado
(`packages/twenty-docker/twenty/Dockerfile:206`). Qué host anuncia el descubrimiento depende de por
dónde entre la petición (`oauth-discovery.controller.ts:23-63`):

- en el ápex (= `SERVER_URL`, host de API): `issuer` es el ápex y `authorization_endpoint` apunta a
  `https://app.<dominio>/authorize?iss=https://<dominio>`, porque el host de API no tiene frontend
  de espacio;
- en un subdominio de espacio: `issuer` y `authorization_endpoint` son ese mismo subdominio
  (`https://alice.<dominio>/authorize`), que es donde el usuario tiene su sesión y sus datos.

### R2 — Dominio, subdominios y certificado

- La zona alojada se **busca** por `var.domain_name` (`data.aws_route53_zone.this`, `data.tf`); no se
  crea. El registro del dominio en Route 53 ya creó la zona pública, y una segunda zona con el mismo
  nombre respondería con otros servidores de nombres sin avisar. `var.route53_zone_id` sigue
  existiendo como anulación explícita (zona privada homónima, subdominio delegado), ya no como
  interruptor de "gestiono DNS o no".
- Un solo certificado ACM cubre el dominio **y** `*.<dominio>` (`subject_alternative_names` en
  `alb-acm.tf`), validado por DNS con los registros que Terraform crea en esa zona. El comodín no
  cubre el ápex: hacen falta los dos nombres. Tampoco cubre dos niveles (`a.b.<dominio>`), que este
  stack no sirve.
- El ápex y el comodín son registros **alias A** al ALB. Ese comodín es lo que hace que un espacio
  nuevo sea alcanzable sin tocar Terraform: el servidor saca el espacio del host, así que
  `alice.<dominio>`, `app.<dominio>` y el ápex son el mismo ALB y el mismo servicio ECS.
- Solo HTTPS: el único listener de aplicación sigue siendo el 443 con TLS 1.3
  (`ELBSecurityPolicy-TLS13-1-2-2021-06`); el 80 solo redirige con 301. El listener lee
  `aws_acm_certificate_validation.this.certificate_arn`, que no resuelve hasta que ACM da el
  certificado por `ISSUED`: el primer `apply` espera a la validación DNS, hay que dejarlo terminar.

### R3 — Región, presupuesto, estado remoto, permiso de despliegue y correo

**Región y presupuesto** ya tienen valor por defecto en `variables.tf` (`eu-west-1`, `500`) porque
son decisiones tomadas, no suposiciones; `terraform.tfvars.example` fija además
`environment = "beta"`. El presupuesto es una **alarma, no un tope**: AWS no apaga nada cuando se
cruza (aviso al 80% real y al 100% pronosticado, `budgets.tf`). AWS Budgets necesita además que la
cuenta tenga activado el acceso de IAM a la información de facturación; sin eso, el `apply` falla al
crear el presupuesto aunque el permission set esté bien.

**Estado remoto con bloqueo.** `versions.tf` declara `backend "s3"` con configuración parcial:
`encrypt` y `dynamodb_table` en el repo, y `bucket`/`key`/`region` por `-backend-config` (el nombre
del bucket es específico de la cuenta y no va a un fork público). `terraform init -backend=false`
ignora el bloque entero, así que la validación estática sigue corriendo sin bucket, sin credenciales
y sin estado — comprobado en R4 después de añadirlo.

El bloqueo es **DynamoDB y no el lockfile nativo de S3**: `use_lockfile` llegó en Terraform 1.10 y
el contenedor fijado con el que se valida este stack es 1.9.8, que lo rechaza. Medido, no supuesto:

```
$ docker run --rm -v /tmp/tfprobe:/w -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init
Initializing the backend...
Error: Unsupported argument
  on main.tf line 6, in terraform:
   6:     use_lockfile = true
An argument named "use_lockfile" is not expected here.
```

`required_version` sigue admitiendo 1.9.x, así que el atributo no se puede usar hasta subir ese
suelo. Camino de subida, escrito también en `versions.tf`: subir `required_version` a `>= 1.11`,
re-fijar el contenedor, cambiar `dynamodb_table` por `use_lockfile = true` y borrar la tabla.

**Crear el backend antes del primer `init`** (una sola vez, con credenciales SSO):

```sh
aws s3api create-bucket --bucket <bucket-de-estado> --region eu-west-1 \
  --create-bucket-configuration LocationConstraint=eu-west-1
aws s3api put-bucket-versioning --bucket <bucket-de-estado> \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket <bucket-de-estado> \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket <bucket-de-estado> \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws dynamodb create-table --table-name aos-crm-tfstate-lock --region eu-west-1 \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

El versionado del bucket no es decorativo: es la única forma de recuperar un estado que se escriba
a medias. `LockID` es el nombre de clave que exige el backend S3, no una elección.

**Permission set de despliegue (IAM Identity Center).** `PowerUserAccess` cubre todo lo que este
stack crea salvo IAM, porque su `NotAction` excluye `iam:*` (solo deja
`CreateServiceLinkedRole`/`DeleteServiceLinkedRole`/`ListRoles`), y este stack crea cuatro roles de
tarea (`iam.tf`) y los pasa a ECS. La política en línea que se añade al permission set, limitada a
los roles del proyecto:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageAosCrmRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:UpdateAssumeRolePolicy"
      ],
      "Resource": "arn:aws:iam::*:role/aos-crm-*"
    },
    {
      "Sid": "PassAosCrmRolesToEcsOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/aos-crm-*",
      "Condition": {
        "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" }
      }
    },
    {
      "Sid": "ReadIamForPlanRefresh",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:ListRoleTags",
        "iam:ListInstanceProfilesForRole",
        "iam:GetPolicy",
        "iam:GetPolicyVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

`PassRole` va en su propia sentencia con la condición `iam:PassedToService`: metido en la primera,
la condición también se evaluaría para `CreateRole` —que no aporta esa clave— y denegaría la
creación de roles. La lectura de IAM va sin recorrer `Resource` porque `plan` refresca roles y
políticas que no creó él (la política gestionada `AmazonECSTaskExecutionRolePolicy`, por ejemplo).
Nada de claves estáticas: `aws sso login` por sesión, igual que en CRM-011.

**Actualización (CRM-027, 08/11/2026):** el permission set de despliegue ya no es `PowerUserAccess`,
es `AOS-Agente`, y desde esa misma fecha todo rol `aos-*` de la cuenta lleva la política gestionada
`aos-limite-roles` como permissions boundary (`var.permissions_boundary_arn`, sin valor por defecto
en `deploy/aws/variables.tf`, obligatoria en `terraform.tfvars`). Quitarle el boundary a un rol está
denegado a los agentes, así que un `plan` sin esta variable falla en `validate`, no en `apply`.

**Correo saliente: no hay driver** (decisión del founder, 29/10). `EMAIL_DRIVER=LOGGER` es el valor
por defecto de upstream y no envía nada: `LoggerDriver.send` escribe el correo entero —asunto, texto
y HTML— en el log del servidor
(`packages/twenty-server/src/engine/core-modules/email/drivers/logger.driver.ts`). Consecuencias que
el operador tiene que asumir, no descubrir:

- Las invitaciones y los restablecimientos de contraseña **no llegan al buzón de nadie**: el enlace
  queda en el grupo de logs del servidor en CloudWatch, y el operador lo pasa por su cuenta. El
  operador *es* el mecanismo de restablecimiento.
- Ese enlace es una credencial de un solo uso: quien pueda leer los logs puede usarla. El grupo de
  logs tiene 30 días de retención por defecto (`var.log_retention_days`); tratar el acceso de
  lectura a CloudWatch como acceso a cuentas de la beta.

**Preparado para superarse, pero todavía vigente (CRM-017 + CRM-018 fix1, 30/10/2026):** el founder
pidió que las invitaciones llegaran al correo, y CRM-017 montó SES para eso (ver su sección más
abajo: dominio de envío, credenciales SMTP y salida del sandbox). Pero el interruptor está **apagado
por defecto** (`var.outbound_email_enabled = false`, «CRM-018 fix1» al final), que es lo que está
desplegado: **este bloque sigue describiendo el estado actual**, y deja de describirlo el día que el
founder encienda la etapa 2.

### R4 — Validación (sin credenciales) y procedimiento del coordinador

Comandos reales del 30 de octubre de 2026, en la distro WSL dedicada
(`AOS-CRM-Ubuntu-24.04`), en el contenedor de `hashicorp/terraform` fijado por digest (Terraform
v1.9.8, confirmado con `version`), sin ninguna variable `AWS_*` y sin montar `~/.aws` — ningún
`-e`, ningún `--env-file`, así que el contenedor no vio el `AWS_BEARER_TOKEN_BEDROCK` del host. El
montaje va con la **ruta absoluta** del directorio, no con `$PWD` tras un `cd`, por la razón de la
segunda lección de abajo.

```
$ docker run --rm -v "<ruta>/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (sin salida: todo canónico)

$ docker run --rm -v "<ruta>/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
exit 0 ("Terraform has been successfully initialized!"; reutilizó hashicorp/aws 5.100.0 y
hashicorp/random 3.9.1 del lock file -- y lo hizo con el bloque `backend "s3"` ya declarado, que es
lo que R3 pedía comprobar)

$ docker run --rm -v "<ruta>/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
exit 0 ("Success! The configuration is valid.")

$ sh <ruta>/deploy/aws/scripts/scan-secrets.sh
exit 0 (sin coincidencias)
```

El `exit 0` del escaneo no se dio por bueno sin más: con un fichero de control sembrado a propósito
en `deploy/aws` (un literal con pinta de contraseña y un número de 12 dígitos) el mismo comando
devolvió `exit 1` listando las dos coincidencias, y volvió a dar `exit 0` al borrarlo. Un escaneo
que no se ha visto fallar nunca no es un escaneo, es un `exit 0`.

`validate` no llama a AWS: no resuelve `data.aws_route53_zone.this` ni comprueba que la zona exista.
Que el dominio tenga zona en la cuenta es lo primero que descubre el `plan`.

**Procedimiento, en este orden.** Lo corre el coordinador con credenciales SSO temporales, desde
`deploy/aws`, tras `aws sso login --profile <perfil>`. Cada paso dice qué se espera ver; un paso que
no da eso se para ahí.

1. **Requisitos previos:** permission set asignado, acceso de IAM a facturación activado en la
   cuenta, y `terraform.tfvars` copiado del `.example` con `domain_name` y `budget_alert_email`
   reales. Comprobar que la zona existe:
   `aws route53 list-hosted-zones-by-name --dns-name <dominio> --query 'HostedZones[0].[Name,Id]'`.
2. **Backend:** los comandos de R3 (bucket + tabla), una sola vez por cuenta.
3. **Init:**
   `terraform init -backend-config="bucket=<bucket-de-estado>" -backend-config="key=aos-crm/beta/terraform.tfstate" -backend-config="region=eu-west-1"`.
4. **Crear solo el ECR** para poder subir la imagen antes de que existan los servicios que la
   necesitan:
   `terraform apply -target=aws_ecr_repository.app -var="image_digest=sha256:0000000000000000000000000000000000000000000000000000000000000000"`,
   revisando el plan antes de confirmar. Ese digest de relleno solo pasa la validación de formato de
   la variable; en un apply con `-target` nadie lo lee. Deja `terraform output -raw ecr_repository_url`.
5. **Construir la imagen desde un commit concreto y subirla por digest** (desde la raíz del repo,
   sobre el commit que se quiera desplegar, sin cambios sin commitear):

   ```sh
   git rev-parse HEAD                      # anotar este SHA: es lo que queda desplegado
   aws ecr get-login-password --region eu-west-1 \
     | docker login --username AWS --password-stdin <id-cuenta>.dkr.ecr.eu-west-1.amazonaws.com
   docker build --target twenty -f packages/twenty-docker/twenty/Dockerfile \
     -t <ecr_repository_url>:$(git rev-parse --short HEAD) .
   docker push <ecr_repository_url>:$(git rev-parse --short HEAD)
   aws ecr describe-images --repository-name aos-crm-beta \
     --image-ids imageTag=$(git rev-parse --short HEAD) \
     --query 'imageDetails[0].imageDigest' --output text
   ```

   El target es `twenty` (servidor **más** frontend compilado, `Dockerfile:206`): el ALB sirve la
   aplicación y la API por el mismo contenedor. El digest que imprime el último comando es el que
   va en `image_digest` — nunca una etiqueta, que se puede mover.
6. **Apply completo:** `terraform plan -var="image_digest=sha256:<digest del paso 5>"`, revisión
   humana, y `terraform apply` con la misma variable. Este apply espera a que ACM valide por DNS;
   hay que dejarlo terminar (minutos), no basta con arrancarlo.
7. **Migrar una sola vez, antes de servir tráfico real:**

   ```sh
   aws ecs run-task --cluster $(terraform output -raw ecs_cluster_name) \
     --task-definition $(terraform output -raw ecs_migrate_task_definition_arn) \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnet_ids | tr -d '[]\" ' )],securityGroups=[$(terraform output -raw ecs_tasks_security_group_id)],assignPublicIp=DISABLED}"
   ```

   Esperar a que la tarea termine con `exitCode: 0` (`aws ecs describe-tasks --cluster ... --tasks <arn>`)
   antes de seguir. Si sale distinto de 0, el log está en el grupo `migrate`; no continuar.
8. **Comprobaciones de humo** (todas desde fuera, con el dominio real):

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' https://<dominio>/healthz            # 200
   curl -sS -o /dev/null -w '%{http_code}\n' http://<dominio>/                    # 301 al 443
   curl -sS -D - -o /dev/null -X POST https://<dominio>/mcp \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'                          # 401 + WWW-Authenticate
   curl -sS https://<dominio>/.well-known/oauth-authorization-server | jq .issuer # "https://<dominio>"
   curl -sS https://<dominio>/.well-known/oauth-protected-resource/mcp | jq .resource
   curl -sS -o /dev/null -w '%{http_code}\n' https://app.<dominio>/               # 200
   ```

   Lo que tiene que cumplirse, no solo "responder": el 401 de `/mcp` trae
   `WWW-Authenticate: Bearer resource_metadata="https://<dominio>/.well-known/oauth-protected-resource/mcp"`;
   el `issuer` del descubrimiento es `https://<dominio>` (si sale `http://`, `TRUST_PROXY` no está
   llegando y hay que pararse ahí); y `resource` es `https://<dominio>/mcp`. Un subdominio de espacio
   solo responde 200 **después** del paso 9: antes, el espacio no existe y el servidor contesta
   workspace-not-found, que a cambio ya prueba que el comodín de DNS y el certificado funcionan.
9. **Primer espacio y primer administrador del servidor.** El primer alta es la única que no exige
   nada: con cero espacios, `assertWorkspaceCreationAllowed` se salta la restricción
   (`sign-in-up.service.ts:503`) y `getSignUpWithoutWorkspaceDecision` devuelve `allowed`
   (`.../auth/utils/get-sign-up-without-workspace-decision.util.ts`). El operador entra en
   `https://app.<dominio>`, se registra con su correo y crea su espacio.

   Ese usuario **no es** administrador del servidor todavía: el alta siempre escribe
   `canAccessFullAdminPanel: false` (`sign-in-up.service.ts:300`) y la única vía de código para
   cambiarlo (`updateServerAdminAccess`, `.../admin-panel/admin-panel.resolver.ts:227-230`) exige ya
   ser administrador (`AdminPanelGuard`). Fuera del sembrador de desarrollo nada lo concede, así que
   el primero se marca en la base de datos, con una tarea única que usa la definición del
   **servidor** (arranca con `DISABLE_DB_MIGRATIONS=true`, así que `entrypoint.sh:5` se salta las
   migraciones y hace `exec` del comando que se le pasa) y el `psql` que ya trae la imagen
   (`Dockerfile:117-124`):

   ```json
   { "containerOverrides": [ { "name": "server", "command": ["sh","-c",
     "psql \"$PG_DATABASE_URL\" -v ON_ERROR_STOP=1 -c \"UPDATE core.\\\"user\\\" SET \\\"canAccessFullAdminPanel\\\" = true WHERE email = 'OPERADOR@DOMINIO'\""
   ] } ] }
   ```

   ```sh
   aws ecs run-task --cluster $(terraform output -raw ecs_cluster_name) \
     --task-definition $(terraform output -raw ecs_server_task_definition_arn) \
     --launch-type FARGATE --network-configuration "<el mismo del paso 7>" \
     --overrides file://admin-override.json
   ```

   `PG_DATABASE_URL` lo inyecta el bloque `secrets` de la definición de tarea desde Secrets Manager
   (`ecs.tf`), así que la contraseña no aparece en el comando, ni en el historial, ni en el JSON.
   Borrar `admin-override.json` después: lleva el correo del operador. Comprobar que la fila cambió
   (`... -c "SELECT email, \"canAccessFullAdminPanel\" FROM core.\"user\""`) antes de dar el paso por
   hecho; un `exitCode: 0` sin ver la fila no prueba nada. Después, cerrar sesión y volver a entrar
   para que el token lleve el permiso nuevo.
10. **Un espacio por amigo.** Ya como administrador del servidor, el operador crea cada espacio él
    mismo: autenticado, la mutación `signUpInNewWorkspace`
    (`.../auth/auth.resolver.ts:687-702`) acepta `displayName` y `subdomain`, y
    `assertWorkspaceCreationAllowed` la deja pasar solo porque tiene `canAccessFullAdminPanel`. Si no
    se pasa `subdomain`, `SubdomainManagerService.generateSubdomain`
    (`.../domain/subdomain-manager/services/subdomain-manager.service.ts:36-48`) lo deriva del correo
    o del nombre, con un nombre aleatorio de reserva: para la beta conviene fijarlo a mano
    (`alice`, `bob`) porque es la URL que el amigo va a usar.

    Después invita al amigo a **su** espacio (ajustes del espacio, invitación por correo). Con
    multi-espacio y creación limitada, un amigo que intente registrarse por su cuenta recibe
    `requiresDestination` y solo pasa si tiene invitación pendiente o dominio de acceso aprobado
    (`assertSignUpWithoutWorkspaceAllowed`, `sign-in-up.service.ts:442-471`): esa invitación es lo
    que le da entrada, y nada más la da. Como no hay correo saliente, el enlace de invitación
    (`.../workspace-invitation/services/workspace-invitation.service.ts:350-360`, construido sobre la
    URL del espacio) sale en el log del servidor y es el operador quien lo entrega.
11. **Qué pone cada amigo en ChatGPT:** la URL del conector MCP de **su** espacio,
    `https://<su-subdominio>.<dominio>/mcp`. Desde ese host, el descubrimiento devuelve su propio
    subdominio como `issuer` y manda el `/authorize` a su propio frontend
    (`oauth-discovery.controller.ts:28-35`), que es donde tiene sesión y datos. El ápex
    (`https://<dominio>/mcp`) responde igual a nivel de protocolo, pero su `/authorize` sale en
    `app.<dominio>`, el host "sin espacio": sirve para la comprobación de humo del paso 8, no como
    URL de usuario.

**Redespliegue con imagen nueva:** pasos 5, 7 y 6 en ese orden (construir, migrar, aplicar). Migrar
antes de que el servicio nuevo sirva tráfico, igual que en CRM-011.

**Rollback:** volver `image_digest` al digest anterior y `apply` (ECS hace el rolling hacia atrás).
Las migraciones de Twenty no son reversibles por CLI: si una sale mal, la vía fiable es restaurar
por PITR al momento previo, no un "down". Nada de `apply` sin leer el plan.

**Destrucción:** `terraform destroy`. Dos cosas propias de este stack: si `db_deletion_protection`
está en `true`, desactivarlo primero con un `apply` aparte; y los registros de validación de ACM son
dos recursos de Terraform que normalmente apuntan al **mismo** registro DNS (ACM emite un solo CNAME
para un nombre y su comodín), así que si Route 53 rechaza el segundo borrado por no encontrarlo,
sacar ese recurso del estado (`terraform state rm 'aws_route53_record.acm_validation["*.<dominio>"]'`)
y repetir. El bucket de estado y la tabla de bloqueo no los gestiona Terraform: se borran a mano, al
final y a conciencia.

### Límites de la beta (decirlos antes, no descubrirlos)

- **Cinco espacios como máximo, contando el del operador.** Sin clave Enterprise válida
  —`ENTERPRISE_KEY` está vacío a propósito en el perfil de privacidad—
  `assertWorkspaceCountWithinLimit` rechaza crear a partir de
  `MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = 5`
  (`sign-in-up.service.ts:534-552`, `.../auth/constants/max-workspaces-without-organization-key.constant.ts:1`).
  Es decir: el operador más **cuatro** amigos. Un quinto amigo exige decisión de licencia del
  founder, no un cambio de Terraform.
- **Correo saliente: montado y apagado** (CRM-017 + fix1, 30/10/2026). SES está creado, pero
  `var.outbound_email_enabled` es `false` por defecto, así que invitaciones y restablecimientos
  **siguen pasando por el operador**. Encenderlo espera a que SES salga del sandbox; exigir
  verificación de correo espera además a que los usuarios actuales estén verificados.
- **El arranque del servidor en ECS sigue sin medirse**: `alb_health_check_grace_period_seconds`
  (300 s) sigue siendo una cifra conservadora, no una medición, igual que en CRM-011. Medirlo en el
  primer arranque real.
- **Coste:** la tabla de CRM-011 sigue siendo la referencia; la beta añade una zona alojada de Route
  53 y un certificado ACM (los certificados públicos usados en un ELB no se facturan; la zona y las
  consultas sí, tarifa **no verificada en esta sesión**). Los 500 USD/mes dejan margen de sobra
  sobre ese orden de magnitud, que es justo para lo que sirve una alarma.
- **Aislamiento entre espacios:** sigue siendo el de Twenty (esquema por espacio), con las pruebas
  negativas entre espacios todavía pendientes (ver arriba en este documento). Vale para amigos en una
  beta; no es aislamiento comercial de clientes.

### Lecciones

**Síntoma:** `terraform init` falla con `Error: Unsupported argument ... use_lockfile` al declarar
el backend S3 con bloqueo nativo.
**Causa:** el bloqueo nativo del backend S3 (`use_lockfile`) existe desde Terraform 1.10, y el
contenedor fijado con el que se valida este stack es 1.9.8; `required_version` además sigue
admitiendo toda la serie 1.9.
**Fix:** bloqueo con `dynamodb_table` y el camino de subida escrito en `versions.tf` (subir
`required_version`, re-fijar contenedor, cambiar el atributo, borrar la tabla).
**Regla:** antes de usar una capacidad de Terraform leída en la documentación, comprobarla contra la
versión **fijada** del proyecto —un `init` en un directorio temporal lo dice en dos segundos—, no
contra la última versión publicada.

**Síntoma:** `terraform fmt -check -recursive` y `terraform validate` devolvieron `exit 0` sobre un
directorio que no contenía la configuración. Se vio porque el `init` de la misma tanda contestó
`Terraform initialized in an empty directory! The directory has no Terraform configuration files` —
`fmt` y `validate` sobre nada también son `exit 0`, y no lo dicen.
**Causa:** el comando se escribió como `cd <dir> && docker run ... -v "$PWD:/w" ...` dentro de un
`wsl.exe -- bash -lc '...'`, y en este arnés el `cd` no llega al proceso siguiente: los pasos
encadenados se ejecutan en shells distintos, así que `$PWD` era el directorio de partida. El mismo
efecto hace que una variable asignada en el comando (`x=hello; echo "$x"`) se lea vacía y que un
`echo "exit=$?"` final informe 0 aunque el paso anterior fallara.
**Fix:** montar y apuntar con **rutas absolutas** en una sola invocación, sin `cd`, sin variables
intermedias, y tomar el código de salida del resultado de la herramienta, no de un `echo "$?"`.
**Regla:** `exit 0` de una herramienta que recorre ficheros no prueba nada si no se ha comprobado
que vio los ficheros. Lo que vale como evidencia es un mensaje que solo puede salir del trabajo real
("Using previously-installed hashicorp/aws v5.100.0", "Success! The configuration is valid.") o un
control sembrado que haga fallar la herramienta a propósito.

**Síntoma:** `git grep -- packages/twenty-front/src <patrón>` devuelve cero resultados para símbolos
que sí existen, y se concluye que el frontend no tiene esa pantalla.
**Causa:** el directorio de trabajo había cambiado a `deploy/aws` en un paso anterior, y los
pathspec de `git grep` son relativos al directorio actual, no a la raíz del repo: el patrón se buscó
en una ruta que no existe.
**Regla:** una afirmación del tipo "el repo no tiene X" se emite después de comprobar `pwd` (o con
`git -C <raíz>`); un cero sin contexto de directorio no es un cero.

**Síntoma (fix1, 30/10/2026):** la tarea `migrate` sale con `exit 1` en el primer intento real de
aplicar la beta: `no pg_hba.conf entry for host "10.x", user "aos_crm", database "aos_crm_beta",
no encryption`.
**Causa:** RDS Postgres 16 fuerza SSL por defecto (`rds.force_ssl`) y el `local.privacy_env` de
`ecs.tf` no llevaba ningún interruptor de SSL, así que el cliente pg de Twenty se conectaba en
claro.
**Fix:** `PG_SSL_ALLOW_SELF_SIGNED=true` en `local.privacy_env` (común a `migrate`/`server`/
`worker`), que es el único flag que Twenty expone para cifrar hacia Postgres
(`core.datasource.ts:75`, `raw.datasource.ts:13`, `workspace-data-source.service.ts:152`); no
verifica la CA de RDS porque Twenty no expone esa opción (`config-variables.ts:1478`).
**Regla:** `terraform validate` no abre ninguna conexión a RDS ni a Redis -- un stack que valida
limpio puede seguir fallando en el primer `run-task` real contra un motor que fuerza TLS por
defecto. Comprobar los flags de seguridad por defecto del motor gestionado (RDS, ElastiCache)
contra lo que el cliente de la aplicación necesita, no solo contra lo que Terraform acepta.

**Síntoma (fix1, 30/10/2026):** `http://<dominio>/` no responde (ni siquiera con el 301 esperado)
aunque `aws_lb_listener.http_redirect` existe.
**Causa:** `aws_security_group.alb` solo tenía una regla de entrada (443/tcp); sin una regla para
80/tcp el propio security group descarta el paquete antes de que llegue a ningún listener, exista
o no.
**Fix:** regla de entrada 80/tcp desde `0.0.0.0/0` en `aws_security_group.alb`
(`security-groups.tf`), coherente con que ese puerto solo redirige y nunca reenvía a un target
group.
**Regla:** un listener de ALB declarado en Terraform no basta para que el tráfico llegue: el
security group del load balancer necesita su propia regla de entrada para cada puerto que
cualquiera de sus listeners escuche, redirect-only incluido.

## CRM-017 — correo saliente con SES y verificación de correo (30 de octubre de 2026)

Orden del founder del 30/10: que las invitaciones lleguen al correo real, no solo al log del
servidor. Twenty solo habla dos drivers de correo —`LOGGER` y `SMTP`
(`packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts:515-579`)— y
Amazon SES, en la misma cuenta y región que el resto del stack (`var.aws_region`, por defecto
`eu-west-1`), expone un endpoint SMTP sin que el stack necesite llamar a su API directamente.
**Este track tampoco crea nada en AWS**: no usó ninguna credencial de AWS, no ejecutó `plan` ni
`apply`. Lo aplica el coordinador, igual que CRM-011/CRM-013.

Sobre CRM-013 cambia exactamente esto: `EMAIL_DRIVER` pasa de `LOGGER` a `SMTP`, aparece una
identidad de dominio en SES con sus registros DNS, un usuario IAM con una única acción concedida
(`ses:SendRawEmail`) sobre esa identidad, dos secretos nuevos en Secrets Manager (usuario y
contraseña SMTP) y dos variables de entorno más (`IS_EMAIL_VERIFICATION_REQUIRED`,
`MAX_WORKSPACES`). El resto del stack no se toca.

### R1 — Dominio de envío

`ses.tf` crea una sola identidad de dominio (`aws_sesv2_email_identity.this`, sobre
`var.domain_name`) con Easy DKIM y sus tres registros DNS CNAME (uno por token de
`dkim_signing_attributes[0].tokens`), un subdominio MAIL FROM propio (`mail.<dominio>`) con su MX
(`10 feedback-smtp.<región>.amazonses.com`) y su SPF (`v=spf1 include:amazonses.com ~all`), y un
registro DMARC en `_dmarc.<dominio>` con `p=none` (monitor, ni cuarentena ni rechazo) y un
`rua=mailto:...` opcional si se da `var.dmarc_rua_email`. Todos los registros se crean en la misma
zona que ya resuelve `data.aws_route53_zone.this` (`data.tf`, CRM-013 R2) -- ninguna zona nueva.

Por qué un MAIL FROM propio y no el de `amazonses.com` por defecto: pone el `envelope-from` (lo que
SPF comprueba de verdad) en un nombre del propio dominio en vez de un subdominio compartido de
Amazon; `behavior_on_mx_failure = "USE_DEFAULT_VALUE"` cae al MAIL FROM de `amazonses.com` mientras
el MX/SPF de `mail.<dominio>` no hayan propagado, en vez de rechazar correo durante ese margen.

Buzón externo en el ápex (opcional, `var.apex_mailbox_mx_records` / `var.apex_mailbox_spf_value`,
vacíos por defecto): pensado para un proveedor como Hostinger que sirva `usuario@<dominio>` sin
relación con SES. Nunca pisa nada de SES porque vive en un nombre de registro distinto (`<dominio>`
para el buzón externo; `mail.<dominio>` para el MAIL FROM de SES) -- ambos pueden coexistir en la
misma zona sin conflicto de Route 53.

### R2 — Credenciales SMTP y configuración de Twenty

`ses.tf` crea un usuario IAM `aos-crm-${var.environment}-ses-smtp` sin ningún otro permiso en la
cuenta salvo `ses:SendRawEmail` sobre la identidad del dominio, con la condición `ses:FromAddress`
fijada a `local.email_from_address` (`<var.email_from_local_part>@<dominio>`, por defecto
`no-reply@<dominio>`) -- una de las claves de condición que SES documenta para `SendRawEmail`, no
solo para los `Send*Email` más simples, así que aplica aquí. `aws_iam_access_key` deriva la
contraseña SMTP con el atributo `ses_smtp_password_v4` que el propio proveedor de Terraform calcula
(la conversión SigV4 que documenta AWS): ningún literal, igual que `secrets.tf` ya hacía con
`random_password`. Usuario y contraseña se guardan en dos secretos de Secrets Manager
(`aos-crm/<env>/ses-smtp-user`, `aos-crm/<env>/ses-smtp-password`) y se inyectan como
`EMAIL_SMTP_USER`/`EMAIL_SMTP_PASSWORD` en el bloque `secrets` de `server` y `worker`
(`ecs.tf`, `local.app_secrets`) -- nunca como variable de entorno en claro; `iam.tf` añade sus ARN a
la política que ya deja leer los otros tres secretos al rol de ejecución.

`local.privacy_env` (`ecs.tf`) pasa a llevar:

| Variable | Valor |
| --- | --- |
| `EMAIL_DRIVER` | `SMTP` |
| `EMAIL_SMTP_HOST` | `email-smtp.<región>.amazonaws.com` |
| `EMAIL_SMTP_PORT` | `587` |
| `EMAIL_FROM_ADDRESS` | `<var.email_from_local_part>@<dominio>` (por defecto `no-reply@<dominio>`) |
| `EMAIL_FROM_NAME` | `Betty` |

> **Corregido después, antes de aplicar nada:** `EMAIL_DRIVER` no se quedó fijo en `SMTP`. Depende de
> `var.outbound_email_enabled`, que por defecto es `false` y deja `LOGGER`, el valor que está
> desplegado. Ver «CRM-018 fix1» al final de este documento.

Las cuatro primeras existen en `config-variables.ts:515-579`; `EMAIL_FROM_NAME` también, en ese
mismo rango (valor por defecto de upstream `"Felix from Twenty"`).

### R3 — Verificación y límites

`local.privacy_env` añade `IS_EMAIL_VERIFICATION_REQUIRED = "true"` (`config-variables.ts:100`,
`false` por defecto en upstream) -- tiene sentido ahora que existe un remitente verificado de
verdad, no antes.

> **Corregido después, antes de aplicar nada:** tampoco se quedó fijo en `"true"`. Depende de
> `var.email_verification_required`, `false` por defecto, y Terraform rechaza ponerla en `true` sin
> el correo activo. Encenderla con los usuarios actuales sin verificar les niega la entrada
> (`checkIsEmailVerified`). Ver «CRM-018 fix1» al final de este documento.

También `MAX_WORKSPACES = "0"`: ese contrato ("vacío o 0 = sin límite") es de
CRM-015, en paralelo a este track y todavía sin aterrizar en `packages/twenty-server` en el momento
de escribir esto; fijar la variable de entorno aquí no rompe nada porque `validateSync`
(`config-variables.ts:2628-2634`) no exige que cada clave exista en la clase `ConfigVariables` --
una variable que el código aún no lee simplemente no hace nada hasta que CRM-015 aterrice.

### R4 — Sandbox de SES, salida a producción, permission set y validación

**Sandbox de SES.** Toda cuenta nueva de SES en una región nueva empieza en el sandbox: solo puede
enviar **desde** y **hacia** identidades verificadas, con un tope de 200 mensajes/24h y 1
mensaje/segundo. La identidad de dominio de R1 resuelve el lado del remitente una vez que el DNS
propague y SES la marque verificada; mientras el sandbox siga activo, cada destinatario de prueba
(el amigo que recibe la invitación) también tiene que estar verificado a mano
(`aws sesv2 create-email-identity --email-identity <correo-del-amigo>`, confirmando el enlace que
llega a ese correo), o la beta sigue, en la práctica, limitada al operador probándose a sí mismo.

**Pedir la salida a producción.** La pide el coordinador, con credenciales SSO, una vez que el
dominio esté verificado:

```sh
aws sesv2 put-account-details \
  --mail-type TRANSACTIONAL \
  --website-url https://<dominio> \
  --use-case-description "Invitaciones de workspace y restablecimiento de contraseña para una beta cerrada de un CRM (Twenty), amigos invitados por el operador, sin envío masivo ni marketing." \
  --additional-contact-email-addresses '["<correo-de-contacto>"]' \
  --production-access-enabled
```

AWS revisa la solicitud (minutos a días, no instantáneo); hasta que la apruebe, el sandbox sigue
rigiendo -- no hay forma de saltárselo con Terraform ni con ninguna otra llamada.

**Ampliación del permission set de despliegue.** La política en línea que CRM-013 R3 ya documentó
(`ManageAosCrmRoles` + `PassAosCrmRolesToEcsOnly` + `ReadIamForPlanRefresh`) no cubre usuarios IAM,
solo roles: `ses.tf` crea un `aws_iam_user`, así que el coordinador necesita una sentencia más,
limitada igual que las otras a nombres `aos-crm-*`. Política completa, lista para pegar en
sustitución de la que ya tenía el permission set:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageAosCrmRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:UpdateAssumeRolePolicy"
      ],
      "Resource": "arn:aws:iam::*:role/aos-crm-*"
    },
    {
      "Sid": "PassAosCrmRolesToEcsOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/aos-crm-*",
      "Condition": {
        "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" }
      }
    },
    {
      "Sid": "ReadIamForPlanRefresh",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:ListRoleTags",
        "iam:ListInstanceProfilesForRole",
        "iam:GetPolicy",
        "iam:GetPolicyVersion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManageAosCrmSmtpUsers",
      "Effect": "Allow",
      "Action": [
        "iam:CreateUser",
        "iam:DeleteUser",
        "iam:GetUser",
        "iam:TagUser",
        "iam:UntagUser",
        "iam:PutUserPolicy",
        "iam:GetUserPolicy",
        "iam:DeleteUserPolicy",
        "iam:ListUserPolicies",
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:ListAccessKeys"
      ],
      "Resource": "arn:aws:iam::*:user/aos-crm-*"
    }
  ]
}
```

`CreateAccessKey`/`DeleteAccessKey`/`ListAccessKeys` toman el ARN del usuario como recurso, igual
que las acciones de usuario; por eso comparten el mismo `Resource` con el resto de la sentencia en
vez de necesitar `"*"`.

**Actualización (CRM-027, 08/11/2026):** `ManageAosCrmSmtpUsers` ya no está al alcance de los
agentes: el permission set `AOS-Agente` no concede `iam:CreateUser`/`iam:CreateAccessKey` ni el
resto de esta sentencia. Rotar el usuario SMTP de SES (`aws_iam_user.ses_smtp`, `ses.tf`) pasa por
el founder, no por un apply de un agente.

**Comprobaciones tras el `apply`** (coordinador, con SSO, después de dejar correr el `apply` y
esperar a que el DNS propague -- minutos, no segundos):

```sh
aws sesv2 get-email-identity --email-identity <dominio> \
  --query '{verified: VerifiedForSendingStatus, dkim: DkimAttributes.Status, mailFrom: MailFromAttributes}'
```

Lo que tiene que verse, no solo "responder": `verified: true`, `dkim: "SUCCESS"` (no `PENDING` ni
`FAILED`) y `MailFromAttributes.MailFromDomainStatus: "SUCCESS"`. Después, un correo de prueba a
una dirección que ya esté verificada (obligatorio mientras siga en sandbox):

```sh
aws sesv2 send-email \
  --from-email-address-identity-arn "$(terraform output -raw ses_email_identity_arn)" \
  --from-email-address "<var.email_from_local_part>@<dominio>" \
  --destination '{"ToAddresses":["<correo-verificado-de-prueba>"]}' \
  --content '{"Simple":{"Subject":{"Data":"aos-crm SES test"},"Body":{"Text":{"Data":"CRM-017 post-apply check"}}}}'
```

Un `MessageId` en la respuesta no basta: hay que ver el correo llegar a esa bandeja (o, si el
sandbox todavía frena por verificación de destinatario, el rechazo concreto que lo explique) antes
de dar el paso por hecho.

**Validación estática (sin credenciales de AWS), 30 de octubre de 2026.** Mismo contenedor fijado
por digest que CRM-011/CRM-013 (Terraform v1.9.8), sin ninguna variable `AWS_*` ni `~/.aws`
montado, dentro de la distro WSL dedicada (`AOS-CRM-Ubuntu-24.04`), rutas absolutas y sin `cd`
(misma razón que CRM-011 R3). Una diferencia frente a las validaciones anteriores, registrada como
lección abajo: el `-v` que monta `deploy/aws` directamente sobre la ruta de Windows
(`/mnt/c/...`) deja `init` colgado minutos instalando el proveedor `hashicorp/aws` (más de 150 MB),
porque esa escritura cruza la capa DrvFs de WSL2; se sincronizó el mismo contenido, byte a byte
(`diff -rq` sin diferencias, excluyendo `.terraform`/`.terraform.lock.hcl`), a una ruta nativa de
la distro (`/tmp`) y se corrió ahí:

```
$ docker run --rm -v /tmp/crm017-tf-validate:/w -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (sin salida: todo canónico)

$ docker run --rm -v /tmp/crm017-tf-validate:/w -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
exit 0 ("Terraform has been successfully initialized!"; "Using previously-installed
hashicorp/aws v5.100.0" / "...random v3.9.1" en la segunda corrida, con el bloque `backend "s3"`
ya declarado en `versions.tf`)

$ docker run --rm -v /tmp/crm017-tf-validate:/w -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
exit 0 ("Success! The configuration is valid.")

$ sh scripts/scan-secrets.sh
exit 0 (sin coincidencias)
```

El escaneo se comprobó contra un control sembrado a propósito (una clave con forma `AKIA...` de 20
caracteres añadida a `ses.tf`): devolvió `exit 1` señalando exactamente esa línea, y volvió a
`exit 0` al quitarla -- mismo método que documentó CRM-013 R4, repetido aquí porque `ses.tf` es un
fichero nuevo que ese control nunca había cubierto.

### Lecciones

**Síntoma:** `terraform init -backend=false` no termina (minutos sin avanzar, `docker stats`
muestra la misma cifra de `NET I/O`/`BLOCK I/O` sin crecer) cuando el volumen montado es una ruta
de Windows bajo `/mnt/c/...` dentro de WSL2.
**Causa:** el proveedor `hashicorp/aws` 5.100.0 instala un binario de varios cientos de MB; WSL2
traduce ese volumen por DrvFs (9p), que es mucho más lento que un filesystem nativo para escribir
un fichero grande de una sola vez -- la descarga en sí termina en segundos (confirmado con
`docker stats`: `NET I/O` deja de crecer enseguida), es la escritura posterior la que se queda
colgada.
**Fix:** copiar el contenido de `deploy/aws` a una ruta nativa de la distro (`/tmp`, dentro del
filesystem ext4 de WSL2) y correr los cuatro comandos ahí, confirmando antes con
`diff -rq --exclude=.terraform --exclude=.terraform.lock.hcl` que el contenido es idéntico al de la
ruta real.
**Regla:** si `terraform init` va a instalar un proveedor grande, no montar el directorio de
trabajo directamente sobre una ruta `/mnt/c/...` en WSL2 -- usar una ruta nativa de la distro y
sincronizar, o aceptar varios minutos de escritura silenciosa antes de que el comando devuelva
nada.

## CRM-018 — el CRM fuera del dominio raíz (30 de octubre de 2026)

Orden del founder del 30 de octubre de 2026: sacar el CRM de la raíz del dominio para publicar ahí
la landing (en Vercel). Contrato: `.aos/pack/aos-crm/specs/api-subdominio/spec.md`. Nada se aplicó
en este track: la validación de abajo es estática y sin credenciales, y el `apply` es del
coordinador.

Punto de partida (CRM-013): `SERVER_URL` y `FRONTEND_URL` eran los dos el ápex, y el registro A del
ápex era un alias al ALB.

### R1 — Dónde estaba la raíz en el código, y por qué basta con mover `SERVER_URL`

**La decisión: `SERVER_URL=https://api.<dominio>` y `FRONTEND_URL` se queda en el ápex.** No hizo
falta ningún cambio en el código de Twenty. El razonamiento, con las rutas que lo sostienen:

`FRONTEND_URL` **nunca se emite como enlace**. Tiene exactamente dos usos:

| Uso | Dónde | Qué produce |
| --- | --- | --- |
| `frontDomain`: el sufijo contra el que se parsea y se compone cada host | `domain-server-config.service.ts:12-17, 59-65`; `get-subdomain-and-custom-domain-from-hostname.util.ts`; `workspace-domains.service.ts:253-261` (`getTwentyWorkspaceUrl`) | `<espacio>.<dominio>` |
| base de `getBaseUrl()`, que con multi-espacio activo le antepone `DEFAULT_SUBDOMAIN` | `domain-server-config.service.ts:19-30` | `app.<dominio>` |

Por eso **no se puede** poner `FRONTEND_URL=https://app.<dominio>`: `getBaseUrl()` emitiría
`app.app.<dominio>` y cada espacio viviría en `<espacio>.app.<dominio>`.

Todo lo que produce un enlace sale de uno de esos tres sitios, y ninguno es el ápex desnudo:

| Qué produce un enlace | Fichero y línea | A dónde apunta ahora |
| --- | --- | --- |
| Emisor OAuth y `/authorize` del descubrimiento | `application-oauth/controllers/oauth-discovery.controller.ts:26-35, 91-95` | el host de la petición; si es el de la API, `app.<dominio>/authorize?iss=…` |
| `iss` de la introspección de tokens | `application-oauth/oauth.service.ts:576, 608` | `SERVER_URL` → `api.<dominio>` |
| `resource_metadata` del 401 de `/mcp` | `api/mcp/guards/mcp-auth.guard.ts:26-36` | el host de la petición |
| Enlace de invitación, de verificación y de restablecimiento | `workspace-invitation.service.ts`, `auth.service.ts:771, 1050`, `email-verification.service.ts:83` | `buildWorkspaceURL()` / `getBaseUrl()` → espacio o `app.<dominio>` |
| `serverUrl` de las plantillas de correo | `workspace-invitation.service.ts:386`, `approved-access-domain.service.ts:117` | solo la base del **logo** del espacio (`send-invite-link.email.tsx:39`) → `api.<dominio>` |
| URLs de ficheros firmados y de subida | `file/file-url/file-url.service.ts:109, 121`; `file-upload-target.service.ts:119` | `api.<dominio>` |
| Callback SSO, OpenAPI, webhooks de Google/Microsoft | `sso.service.ts:191, 207`; `open-api.service.ts:99, 212`; `google-webhook-subscription.driver.ts:131`; `microsoft-webhook-subscription.driver.ts:63` | `api.<dominio>` |
| `window._env_` del front | `frontend/utils/render-frontend-html.util.ts:19` | **vacío**: el front usa `window.location.origin` (`twenty-front/src/config/index.ts:2`) |
| URL MCP de Ajustes > IA | `settings/mcp/components/SettingsMcpSetup.tsx:49` sobre `buildMcpServerUrl` | el origen de la ventana, es decir el espacio del usuario |
| Cookie de sesión | `user-session/services/user-session-cookie.service.ts:56-63` | sin atributo `domain`: queda atada al host que la emitió |
| Orígenes CORS con credenciales y comprobación CSRF | `user-session/utils/resolve-allowed-credentialed-origins.util.ts:85` | `SERVER_URL` y `FRONTEND_URL` — **ver el aviso de abajo** |

Que `api` sea seguro no es casualidad: `twenty-shared/src/constants/ReservedSubdomains.ts` lo
reserva (y también `www`), así que ningún espacio puede llamarse así. Una petición a
`api.<dominio>` se resuelve como «subdominio `api`, que no existe» y acaba igual que el ápex hoy:
sin espacio (`workspace-domains.service.ts:173-190`). Y el comodín y el certificado comodín ya lo
cubren, así que la mudanza no necesitó DNS ni certificado nuevos.

**Aviso de seguridad, para decidir antes de dar la raíz a la landing.**
`resolve-allowed-credentialed-origins.util.ts:85` deriva los orígenes de confianza de `SERVER_URL`
y `FRONTEND_URL` sin condición. Como `FRONTEND_URL` tiene que seguir siendo el ápex, el origen del
ápex sigue en esa lista, que alimenta tanto el CORS con credenciales
(`apply-credentialed-cors.util.ts:95-115`) como la comprobación de origen anti-CSRF
(`is-request-origin-allowed.util.ts:40`). Hoy es inofensivo porque el ápex es el propio CRM; cuando
lo sirva un tercero, el origen de ese tercero queda tratado como de confianza. No hay variable que
lo quite: `AUTH_COOKIE_ALLOWED_ORIGINS` solo añade. Quitarlo exige tocar ese fichero, que es código
compartido de Twenty y queda fuera de lo que CRM-018 modificó. **Decisión del founder.**

Del mismo tipo, menor: el front guarda el último espacio usado en una cookie con `domain` igual a
`.<dominio>` (`useLastAuthenticatedWorkspaceDomain.ts:17`), así que esa cookie se enviará también al
host de la landing. No lleva credenciales — un id de espacio y su URL —, pero conviene saberlo.

### R2 — La raíz, configurable sin tocar el resto

`deploy/aws/alb-acm.tf` y `deploy/aws/variables.tf`:

- `var.apex_a_records` (lista, vacía por defecto): con el valor por defecto, la raíz sigue siendo el
  **alias A al ALB** de siempre; con valores, pasa a ser un registro A al host externo.
- `var.www_cname_target` (string, `null` por defecto): sin valor **no existe el recurso**
  (`count = 0`), así que `www` lo sigue resolviendo el comodín contra el ALB; con valor, un CNAME
  explícito, que en Route 53 gana al comodín.
- `var.external_record_ttl` (300 por defecto): TTL de esos dos registros cuando apuntan fuera. Corto
  a propósito: es lo que hace que volver atrás tarde minutos.

El alias de la raíz se escribe como un bloque `dynamic "alias"` **dentro del recurso que ya existe**,
no como dos recursos con `count`, a propósito: cambiar la dirección del recurso haría que Terraform
planificase destruir y recrear el registro A de la raíz en producción, y el contrato pide que con
los valores por defecto el plan no cambie nada.

Ninguna variable trae un valor real por defecto: las direcciones son del host de la landing y este
fork es público. `terraform.tfvars.example` las deja comentadas con `REPLACE_ME`.

### R3 — Validación hecha (sin credenciales de AWS, 30 de octubre de 2026)

Mismo contenedor fijado por digest que CRM-011/CRM-013/CRM-017 (Terraform v1.9.8), dentro de la
distro `AOS-CRM-Ubuntu-24.04`, sin ninguna variable `AWS_*` ni `~/.aws` (comprobado en la misma
sesión: el conteo de variables `AWS_*` dio `0` y `~/.aws` no existe). Aplicada otra vez la lección
de CRM-017: el contenido se sincronizó a `/tmp/crm018-tf-validate`, ruta nativa de la distro, y se
comprobó idéntico con `diff -rq --exclude=.terraform --exclude=.terraform.lock.hcl` (sin
diferencias).

```
$ docker run --rm -v /tmp/crm018-tf-validate:/w -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (sin salida: todo canónico)

$ ... init -backend=false
exit 0 ("Terraform has been successfully initialized!"; aws v5.100.0, random v3.9.1)

$ ... validate
exit 0 ("Success! The configuration is valid.")

$ sh scripts/scan-secrets.sh
exit 0 (sin coincidencias)
```

**Las condiciones nuevas se midieron, no se dieron por buenas.** En `/tmp/crm018-tf-logic`, con el
`variables.tf` real y un fichero de solo salidas que reproduce expresión por expresión lo que hace
`alb-acm.tf` (sin proveedor ni recursos, así que `plan` corre sin credenciales):

| Entrada | `apex_alias_block_count` | `apex_records` | `apex_ttl` | `www_record_count` |
| --- | --- | --- | --- | --- |
| valores por defecto | 1 | — (null) | — (null) | 0 |
| `apex_a_records=["203.0.113.10"]`, `www_cname_target=landing.example.test` | 0 | `["203.0.113.10"]` | 300 | 1 |

Y las tres validaciones de variable rechazan la entrada mala con `exit 1`: un nombre de host en
`apex_a_records`, una URL en `www_cname_target` y un TTL de 5 segundos.

El script de humo `scripts/aos/verify-public-hosts.mjs` trae su propia autocomprobación sin red
(`--self-test`, `exit 0`): levanta un servidor local que imita los hosts desplegados y verifica no
solo que los casos buenos pasan, sino que los malos fallan — un emisor que nombra otro host, un
`resource_metadata` que nombra otro host, un `authorization_endpoint` en el ápex y un 200 que no es
el front del CRM. Contra un dominio que no resuelve devuelve `exit 1` con las seis comprobaciones en
`[FAIL]`: falla cerrado, no en silencio.

**Lo que NO se midió:** el `plan` real contra el estado aplicado de la beta, ni ninguna de las
comprobaciones contra el despliegue. Necesitan credenciales de AWS y el backend S3, que este track
no tiene. La afirmación «con los valores por defecto el plan no cambia nada» se sostiene en que la
dirección del recurso `aws_route53_record.apex` no cambia y en que `aws_route53_record.www` no tiene
instancias por defecto; **el coordinador tiene que verlo en su `plan`** antes de aplicar.

### R4 — Procedimiento del coordinador

El procedimiento en lenguaje llano, con el orden de aplicación, la URL MCP única, cómo reconectar
ChatGPT y Claude, cómo cambiar la raíz a la landing y cómo volver atrás, está en
[../product/BETA_RUNBOOK.md](../product/BETA_RUNBOOK.md) §7. Resumen para el coordinador:

1. **Primero la API.** `apply` con el cambio de `ecs.tf`: solo se redefine la tarea de ECS con
   `SERVER_URL=https://api.<dominio>` y el servicio se vuelve a desplegar. No hay DNS nuevo. En el
   `plan`, comprobar además que las definiciones de tarea nuevas siguen llevando `EMAIL_DRIVER` en
   `LOGGER`, `IS_EMAIL_VERIFICATION_REQUIRED` en `false` y ningún secreto SMTP: eso es lo que dice
   que el apply mueve la API y nada más (fix1, al final de esta sección).
2. **Comprobarlo** con `node scripts/aos/verify-public-hosts.mjs --domain <dominio>
   --workspace-host <espacio>.<dominio>`.
3. **La raíz, cuando la landing esté lista.** Rellenar `apex_a_records` y `www_cname_target` en
   `terraform.tfvars` y aplicar. El plan tiene que tocar **solo** esos dos registros; si toca algo
   más, parar.
4. **Comprobarlo otra vez**, ahora con `--require-apex-off`.
5. **Volver atrás** es quitar esas dos líneas y aplicar (minutos, por el TTL de 300).

Entre el paso 1 y el paso 3 conviene no apurar: los enlaces de fichero firmados emitidos antes del
paso 1 apuntan al ápex y dejan de funcionar cuando el ápex se va (caducan solos, son de vida corta).

**La URL del conector de cada usuario no cambia con esta mudanza y nunca fue la raíz:** es
`https://<espacio>.<dominio>/mcp`, la misma que la aplicación enseña en Ajustes > IA. El runbook
corrige además una afirmación anterior: pegar el host de la API **no** funciona como alternativa, y
dice por qué.

### Lecciones

**Síntoma:** el runbook de la beta afirmaba que un usuario podía conectar su cliente MCP al host
base de la API y que eso «funciona, pero hace pasar por el selector».
**Causa:** se dedujo del lado del servidor (`isApiHost` manda `/authorize` a `app.<dominio>`) sin
seguir el enlace hasta el front. En `app.<dominio>` el front monta el enrutador sin espacio
(`DomainShell.tsx:39`), que no tiene ruta `/authorize`; y la mutación que concede el permiso exige
un espacio en la sesión (`authorizeApp` con `@AuthWorkspace()`), cosa que ese host no da por diseño.
**Fix:** corregida la afirmación en BETA_RUNBOOK.md §6 con las rutas de las dos puertas que la
cierran, y dejada una sola URL de conector, la del espacio, que además coincide con la que muestra
Ajustes > IA.
**Regla:** una ruta de autorización no está comprobada hasta haber seguido el redirect hasta la
pantalla que la sirve. Que el servidor emita una URL no dice que esa URL exista.

**Síntoma:** la tentación de hacer el ápex configurable con dos recursos `aws_route53_record`
guardados por `count`, uno para el alias al ALB y otro para el host externo.
**Causa:** es la forma natural de escribirlo, pero añadir `count` a un recurso que ya está en el
estado cambia su dirección de `aws_route53_record.apex` a `aws_route53_record.apex[0]`, y Terraform
lo planifica como destruir y recrear — sobre el registro A de la raíz de un dominio en producción.
**Fix:** un solo recurso con un bloque `dynamic "alias"` y `records`/`ttl` condicionales, que
mantiene la dirección intacta.
**Regla:** antes de meter `count` o `for_each` en un recurso ya aplicado, mirar qué le pasa a su
dirección en el estado. Si cambia, o se evita el `count`, o hace falta un bloque `moved`.

### fix1 — El correo, por etapas, y el buzón del dominio (30 de octubre de 2026)

**Por qué hizo falta antes de aplicar CRM-018.** CRM-018 cambia `SERVER_URL` dentro del mismo
`local.privacy_env` de `ecs.tf` donde CRM-017 había dejado **fijos** `EMAIL_DRIVER = "SMTP"` e
`IS_EMAIL_VERIFICATION_REQUIRED = "true"`. Lo que está desplegado hoy usa `LOGGER` y no exige
verificación, así que aplicar CRM-018 tal cual no habría movido solo la API: habría encendido de
golpe la etapa 2 **y** la etapa 3 del correo, con SES todavía en el sandbox (los correos a
direcciones no verificadas una a una no llegan) y con todos los usuarios actuales sin
`isEmailVerified`, que es justo lo que `checkIsEmailVerified` (`auth.service.ts:260-266`, llamado en
`:186`, `:225` y `auth.resolver.ts:1021`) usa para negar la entrada. Un cambio de DNS habría
arrastrado un cambio de acceso.

**Lo que ahora decide cada etapa**, en `deploy/aws/variables.tf`:

| Variable | Tipo | Por defecto | Qué controla |
| --- | --- | --- | --- |
| `outbound_email_enabled` | bool | `false` | `EMAIL_DRIVER`: `SMTP` con `true`, `LOGGER` con `false` |
| `email_verification_required` | bool | `false` | `IS_EMAIL_VERIFICATION_REQUIRED` |

Los valores por defecto son **el estado desplegado hoy**, no una preferencia: con ellos el apply de
CRM-018 cambia la API de sitio y nada más. `email_verification_required` lleva una `validation` que
la rechaza sin `outbound_email_enabled` (Terraform >= 1.9 permite que una validación mire otra
variable, y `versions.tf` ya exige `>= 1.9.0`): exigir verificación cuando el enlace de verificación
solo llega al log es echar a todo el mundo fuera. `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` y
`MAX_WORKSPACES = "0"` se quedan en las tres etapas: ninguna envía nada por sí sola.

**Las credenciales SMTP viajan con el interruptor.** `local.app_secrets` inyecta
`EMAIL_SMTP_USER`/`EMAIL_SMTP_PASSWORD` solo con `outbound_email_enabled = true`. Razón: una
contraseña de envío que ningún driver va a usar es una credencial sentada en el entorno de tres
familias de tareas sin motivo, y el entorno de un proceso es lo primero que lee un volcado, un
endpoint de depuración o una fuga del contenedor. Los secretos y el permiso del rol de ejecución
sobre ellos (`ses.tf`, `iam.tf`) **siguen siendo incondicionales**, así que encender el correo no
necesita crear un secreto ni tocar IAM: sigue siendo una línea de `tfvars`.

**El buzón del dominio.** CRM-017 ya dejaba `apex_mailbox_mx_records` y `apex_mailbox_spf_value`.
fix1 añade `apex_mailbox_cname_records` (`map(string)`, vacío por defecto) para los CNAME que pide el
proveedor del buzón: sus firmas DKIM y, si los publica, `autodiscover`/`autoconfig`. Las claves son
nombres **relativos** a `domain_name` y el recurso es `for_each` keyed por nombre, no `count`, para
que añadir o quitar uno más adelante no renumere —y por tanto no recree— los demás. Un CNAME no
convive con un registro de otro tipo en el mismo nombre, así que la variable valida y **rechaza**:

- un nombre con la forma de los DKIM de SES (32 alfanuméricos + `._domainkey`), que son los que crea
  `aws_route53_record.ses_dkim`. Los del proveedor del buzón tienen nombre de palabra y pasan;
- `mail`, el dominio MAIL FROM de SES, que ya tiene un MX y un TXT;
- `_dmarc`, la política que CRM-017 dejó en `p=none`;
- `api`, `app` y `www`, los hosts del propio CRM;
- una clave con `domain_name` ya pegado detrás, que es el error de copiar y pegar más probable;
- un destino escrito como URL en vez de como host.

`terraform.tfvars.example` documenta el formato con valores genéricos (`example.net`), porque este
fork es público.

#### Validación de fix1 (sin credenciales, 30 de octubre de 2026)

Mismo contenedor fijado por digest (Terraform v1.9.8) en la distro `AOS-CRM-Ubuntu-24.04`, conteo de
variables `AWS_*` = `0` y `~/.aws` inexistente (comprobado en la misma sesión). Contenido copiado a
`/tmp/crm018fix1-validate`, ruta nativa de la distro, y comprobado idéntico con `diff -rq
--exclude=.terraform --exclude=.terraform.lock.hcl` (exit 0).

```
$ ... fmt -check -recursive        exit 0 (sin salida)
$ ... init -backend=false          exit 0 (aws v5.100.0, random v3.9.1)
$ ... validate                     exit 0 ("Success! The configuration is valid.")
$ sh scripts/scan-secrets.sh       exit 0 (sin coincidencias)
```

**Las etapas se midieron con un `plan` de verdad, no se razonaron.** En `/tmp/crm018fix1-logic`, con
el `variables.tf` real y un fichero de solo salidas que copia expresión por expresión lo que
calculan `ecs.tf` y `ses.tf` (sin proveedor ni recursos, así que `plan` corre sin backend y sin
credenciales):

| Entrada | `email_driver` | `is_email_verification_required` | Secretos inyectados |
| --- | --- | --- | --- |
| valores por defecto | `LOGGER` | `false` | los 3 de siempre, sin SMTP |
| `outbound_email_enabled=true` | `SMTP` | `false` | los 3 + `EMAIL_SMTP_USER` + `EMAIL_SMTP_PASSWORD` |
| las dos en `true` | `SMTP` | `true` | los 3 + los 2 de SMTP |

Y los rechazos, los siete con `exit 1` y con el mensaje que les toca: `email_verification_required`
sin `outbound_email_enabled`; un CNAME en `_dmarc`, en `mail`, con forma de token DKIM de SES y en
`api`; una clave con el dominio pegado detrás; y un destino con `https://`. El caso bueno del mapa
sí produce los dos registros, con el dominio añadido
(`providerkey-a._domainkey.<dominio> CNAME providerkey-a.dkim.example.net`).

**Lo que sigue sin medirse:** el `plan` contra el estado aplicado de la beta. La afirmación «con los
valores por defecto esto no cambia el correo» está medida sobre las expresiones, no sobre el estado:
el coordinador tiene que ver en su `plan` que las definiciones de tarea nuevas llevan `LOGGER`,
`IS_EMAIL_VERIFICATION_REQUIRED=false` y ningún secreto SMTP antes de aplicar.

#### Lección

**Síntoma:** un track (CRM-018) que solo tocaba DNS y una URL estaba a punto de cambiar también quién
puede entrar en la aplicación.
**Causa:** el track anterior (CRM-017) dejó su etapa 2 escrita como valores fijos en el bloque de
entorno compartido, en vez de como variables apagadas. Mientras nadie aplicase, el repo y lo
desplegado decían cosas distintas; el siguiente apply, de cualquier track que tocase ese bloque, se
llevaba la diferencia entera por delante.
**Fix:** las dos banderas pasan a variables cuyo valor por defecto **es el estado desplegado**, más
una validación que impide la combinación peligrosa.
**Regla:** una capacidad que el founder todavía no ha autorizado a encender no se escribe como valor
fijo en un bloque compartido. Se escribe como variable con el estado actual por defecto, y entonces
cada etapa es un `tfvars` y no una sorpresa en el apply de otro.
