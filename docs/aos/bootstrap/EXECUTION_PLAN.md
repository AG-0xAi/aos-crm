# Orden aprobado de ejecución

El founder aprobó la radiografía y el inicio por CRM-001 con **«go» el 27 de octubre de 2026**. La aprobación está registrada mediante `decision.recorded` en el único bus `.aos/`. No se volverá a pedir este visto bueno.

Se han registrado siete specs con contratos SHALL/MUST y escenarios GIVEN/WHEN/THEN en `.aos/pack/aos-crm/specs/`. CRM-001 se desglosa en procedencia y host para que un requisito de elevación no bloquee trabajo estático independiente. El alcance completo declarado es este bootstrap, no todo el futuro producto SaaS; ninguna spec se ha marcado done por desglosarla.

| Track | Spec / capability | Resultado falsable | Dependencias |
| --- | --- | --- | --- |
| CRM-001 | crm-provenance / provenance | Fork AG-0xAi/aos-crm verificado; upstream/base/historia preservados; comprobador de procedencia y gate medido | Mapa aprobado |
| CRM-001-HOST | crm-host-runtime / host-runtime | Linux y runtime operativos sobre el mismo checkout/bus; preflight reproducible y smoke aislado; si falta elevación/reinicio queda incompleto | crm-provenance |
| CRM-002 | crm-local-security / local-security | Contexto de build sin AOS/secretos; Compose loopback, volúmenes propios, secretos seguros y drivers de código desactivados | crm-provenance; validación estática puede avanzar sin host listo |
| CRM-003 | crm-privacy / privacy | Perfil único server/worker, ambas variables false, Sentry/exportadores apagados y política de overrides DB probada | crm-provenance; evidencia de tráfico queda para CRM-005 |
| CRM-004 | crm-source-runtime / source-runtime | Build propio, baseline, migraciones de datos nuevos, servidor/worker/DB/Redis saludables, primer admin y gate real de aplicación | crm-host-runtime, crm-local-security, crm-privacy |
| CRM-005 | crm-functional-acceptance / functional-acceptance | Login, CRUD relacionado, persistencia/reinicio, workers, API/MCP con permisos y captura de salida de servidor/worker/navegador | crm-source-runtime |
| CRM-006 | crm-bootstrap-delivery / bootstrap-delivery | Runbook, licencias, integraciones, propuesta AWS, deuda, revisión independiente y reporte A-M sobre resultados reales | crm-functional-acceptance |

Se comienza con un worker de procedencia en una rama `codex/`, sobre el checkout existente y sin publicación de su rama. No habrá workers concurrentes compartiendo árbol/índice. Si se usa paralelismo después, cada worker tendrá un worktree del mismo bus y ficheros disjuntos; el alcance del gate también se comprobará.

Antes de ejecutar la aplicación o construir imágenes deben estar preparados host, configuración segura y privacidad. Un gate inicial de procedencia no acredita build, E2E ni cero telemetría. No se aceptan recibos vacíos ni se escriben retornos a mano.

La aprobación no autoriza recursos AWS, gasto, cuentas reales, activación Enterprise, servicios públicos, merge propio ni reinicios forzados. Si Windows requiere elevación/interacción, se preparará y verificará primero el comando concreto y se continuará con tareas independientes.
