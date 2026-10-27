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
