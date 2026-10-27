# AOS-CRM: radiografía inicial

Fecha: 27 de octubre de 2026. Estado: **inspección estática; bootstrap incompleto**.

Twenty está incorporado en este mismo checkout, con su historial, sobre `twenty/v2.51.0`, commit `15e4826d3b5fc5867baeabeeb42b253892b2d4da`. No se han instalado dependencias, iniciado servicios, creado usuarios ni conectado cuentas externas. No existe todavía un fork remoto de AOS ni un `origin` configurado.

Esta carpeta documenta lo observado y el trabajo propuesto. No acredita aceptación AOS, build, seguridad integral ni funcionamiento del CRM.

| Documento | Contenido |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Componentes, fronteras, datos y arranque declarado |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Hallazgos confirmados, riesgos y cobertura pendiente |
| [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) | Consulta del lockfile a OSV y clasificación inicial |
| [TELEMETRY_AUDIT.md](TELEMETRY_AUDIT.md) | Rutas de salida, controles y pruebas pendientes |
| [LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md) | AGPL, MIT, excepción de aplicaciones y Enterprise |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Integraciones presentes y requisitos |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Estado real de la máquina y estrategia propuesta |
| [AWS_DEPLOYMENT_PLAN.md](AWS_DEPLOYMENT_PLAN.md) | Alternativas y transición futura, sin recursos creados |
| [UPSTREAM_STRATEGY.md](UPSTREAM_STRATEGY.md) | Procedencia, historial, remoto pendiente y actualizaciones |
| [EXECUTION_PLAN.md](EXECUTION_PLAN.md) | Orden propuesto antes de registrar specs y despachar |
| [DEFERRED_LEDGER.md](DEFERRED_LEDGER.md) | Bloqueos, riesgo y siguiente acción |
| [LESSONS.md](LESSONS.md) | Lecciones de esta inspección |
| [INSPECTION_REPORT.md](INSPECTION_REPORT.md) | Informe de fase con estructura A-M y límites de verificación |

La orden completa y las evidencias locales están en `.aos/onboarding/bootstrap-2026-10-27/`. Ese directorio permanece excluido de Git. El alta administrativa anterior se conserva en `.aos/onboarding/` y el único pack sigue siendo `.aos/pack/aos-crm/`.

La entrada para continuar es [EXECUTION_PLAN.md](EXECUTION_PLAN.md). `AGENTS.md`, sección 0, exige que el founder vea este mapa y apruebe por dónde empezar antes de crear specs o despachar. Ninguna de las propuestas de tracks de este informe es todavía una spec registrada.
