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
