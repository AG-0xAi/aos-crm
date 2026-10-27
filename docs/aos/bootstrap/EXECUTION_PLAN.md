# Orden propuesto de ejecución

Esta es una propuesta para revisión del founder tras la radiografía. **No son specs registradas ni autorizaciones de dispatch.** La épica `crm-bootstrap` sigue sin desglosar y no despachable. No se modificó `specs.json`.

El contrato `AGENTS.md`, sección 0, establece: "Specs y dispatch solo DESPUÉS de que el founder vea el mapa y apruebe por dónde empezar". La autorización inicial permite inspeccionar; esta revisión concreta fija el alcance de implementación antes de despachar.

| Orden / track propuesto | Resultado falsable | Dependencias y gate |
| --- | --- | --- |
| CRM-001: procedencia y preflight | Fork remoto correcto o bloqueo demostrado; referencias/SHA y orientación preservados; host Linux operativo sobre el mismo bus | Aprobación del mapa, namespace confirmado, preparación WSL/runtime por vía autorizada. Git ancestry, remotos y preflight reproducibles |
| CRM-002: entorno local seguro | Build context excluye AOS/secretos; Compose/entorno propios con localhost, volúmenes exclusivos, credenciales seguras y drivers de código desactivados | CRM-001; triage de dependencias críticas alcanzables antes de ejecutar componentes. Validación de configuración más pruebas enfocadas |
| CRM-003: privacidad | Ambas variables en false, Sentry y exportadores externos desactivados; política explícita de overrides DB; logs locales operativos | CRM-001; configuración disjunta del Compose de CRM-002. Tests de no envío y propagación al cliente. Parches al core solo si configuración oficial resulta insuficiente |
| CRM-004: construcción y primer arranque | Construcción propia, migraciones de instancia limpia, servidor/worker/DB/Redis saludables y primer admin seguro | CRM-002 y CRM-003; ejecutar baseline y fijar gate real en `.aos/verify.json` con comandos comprobados. No aceptar PASS por gate vacío |
| CRM-005: aceptación funcional y tráfico | Login; contacto/empresa/oportunidad relacionados; persistencia tras reinicio; workers; API/MCP rechazan anónimo y respetan permisos; tráfico sin tracking no autorizado en flujos cubiertos | CRM-004; navegador, HTTP, DB y captura de salida de los tres procesos. Guardar evidencia sin secretos |
| CRM-006: documentación y revisión | Runbook reproducible, registro de licencias/integraciones, propuesta AWS, estrategia de upgrades, deuda y After-Commit Report completos | Resultados de anteriores; revisión independiente AOS de fronteras, contrato, efectos, tests, deuda, alcance y siguiente paso. Reejecutar gates antes de PR |

CRM-002 y CRM-003 solo podrán ir en paralelo si sus ficheros y configuración quedan realmente disjuntos. Usar `aos dispatch`/`aos worker` y, donde el arnés lo soporte, un worktree por worker sobre **el mismo bus**. No usar subagentes externos al bus. No despachar mientras WSL/runtime y la política de primer arranque sigan sin resolver.

Al aprobar el mapa, crear contratos SHALL/MUST y GIVEN/WHEN/THEN, estimar esfuerzo, declarar ficheros/gates y dependencias en el pack canónico. La aprobación no autoriza AWS, gasto, cuentas reales, activación Enterprise ni publicación pública de servicios.

La recomendación prioritaria es comenzar por CRM-001 y preparar WSL/runtime, conservando este checkout y el bus. En paralelo solo cabe análisis seguro que no dependa del entorno ni amplíe el producto.
