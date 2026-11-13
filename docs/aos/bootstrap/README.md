# AOS-CRM: radiografía inicial

Fecha: 27 de octubre de 2026. Estado en ese momento: **inspección estática; bootstrap incompleto**.
**El estado medido de hoy, con lo satisfecho y lo pendiente de cada requisito del contrato de
cierre (CRM-041), está en [DELIVERY.md](DELIVERY.md).** El resto de este documento y los que enlaza
siguen siendo la fotografía de esa fecha, conservada como fue escrita.

Twenty está incorporado en este mismo checkout, con su historial, sobre `twenty/v2.51.0`, commit `15e4826d3b5fc5867baeabeeb42b253892b2d4da`. No se han instalado dependencias, iniciado servicios, creado usuarios ni conectado cuentas externas. El fork remoto es `AG-0xAi/aos-crm`, con `origin` en ese fork y `upstream` en Twenty. El control de procedencia y sus casos negativos pasaron; no equivalen a pruebas de aplicación.

Esta carpeta documenta lo observado y el trabajo propuesto. No acredita aceptación AOS, build, seguridad integral ni funcionamiento del CRM.

| Documento | Contenido |
| --- | --- |
| [DELIVERY.md](DELIVERY.md) | Estado medido de hoy frente al contrato de cierre (CRM-041): qué satisface cada requisito y qué sigue pendiente |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Componentes, fronteras, datos y arranque declarado |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Hallazgos confirmados, riesgos y cobertura pendiente |
| [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) | Consulta del lockfile a OSV y clasificación inicial |
| [TELEMETRY_AUDIT.md](TELEMETRY_AUDIT.md) | Rutas de salida, controles y pruebas pendientes |
| [LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md) | AGPL, MIT, excepción de aplicaciones y Enterprise |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Integraciones presentes y requisitos |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Estado real de la máquina y estrategia propuesta |
| [AWS_DEPLOYMENT_PLAN.md](AWS_DEPLOYMENT_PLAN.md) | Alternativas y transición futura, sin recursos creados |
| [UPSTREAM_STRATEGY.md](UPSTREAM_STRATEGY.md) | Procedencia, historial, fork y actualizaciones |
| [EXECUTION_PLAN.md](EXECUTION_PLAN.md) | Orden aprobado y contratos registrados |
| [DEFERRED_LEDGER.md](DEFERRED_LEDGER.md) | Bloqueos, riesgo y siguiente acción |
| [LESSONS.md](LESSONS.md) | Lecciones de esta inspección |
| [INSPECTION_REPORT.md](INSPECTION_REPORT.md) | Informe de fase con estructura A-M y límites de verificación |

La orden completa y las evidencias locales están en `.aos/onboarding/bootstrap-2026-10-27/`. Ese directorio permanece excluido de Git. El alta administrativa anterior se conserva en `.aos/onboarding/` y el único pack sigue siendo `.aos/pack/aos-crm/`.

El founder aprobó el mapa con «go» el 27 de octubre de 2026. La ejecución continúa por [EXECUTION_PLAN.md](EXECUTION_PLAN.md), con siete specs y contratos registrados en el pack canónico. Los informes de inspección conservan la fotografía anterior a esa aprobación.
