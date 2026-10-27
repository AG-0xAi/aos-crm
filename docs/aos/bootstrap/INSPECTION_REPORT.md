# After-Commit Report: fase de radiografía

27 de octubre de 2026. **Bootstrap incompleto. Este informe describe la inspección inicial y no una instalación aceptada.** El hash de entrega y la salida final del grafo se conservan además en el After-Commit Report local bajo `.aos/onboarding/bootstrap-2026-10-27/`.

## A. Executive summary

Se incorporó Twenty con historia en el proyecto existente, se fijó release/SHA y se inspeccionaron arquitectura, configuración, seguridad, licencias, telemetría, dependencias e integraciones. Hay un mapa concreto y seis tracks propuestos. No se instalaron dependencias, no se construyeron imágenes y no se inició el CRM. La siguiente fase necesita aprobación del mapa según AGENTS y resolver el prerrequisito Linux local.

## B. Project registration

Alta anterior reutilizada, sin segundo producto, pack ni bus. Proyecto: `C:\Users\Andrés\Documents\AOS-CRM`; pack `.aos/pack/aos-crm/`. Sin entregas pendientes ni workers activos al iniciar. La consulta del monitor compartido devolvió HTTP401. Una comprobación posterior a la inspección confirmó HTTP200 en publicación y lectura directa del panel del producto; el401 preexistente no bloquea este producto. La épica sigue pending y no se movió progreso aceptado artificialmente.

## C. Repository

Upstream `https://github.com/twentyhq/twenty.git`; base `twenty/v2.51.0`, SHA `15e4826d3b5fc5867baeabeeb42b253892b2d4da`; 17.313 commits de historia alcanzable, no superficial, blobs históricos bajo demanda. Rama `codex/bootstrap-inspection`. No hay fork remoto/origin todavía. Namespace candidato: `AG-0xAi`, observado mediante API y pendiente de confirmación como destino.

## D. Architecture inspection

Monorepo Nx/Yarn/TypeScript; frontend React/Vite y servidor NestJS/TypeORM; PostgreSQL, Redis/BullMQ y worker separado. APIs GraphQL/REST/MCP y plataforma de apps/workflows/agentes. Separación de datos por workspace sobre esquemas PostgreSQL y capa de autorización común. Detalle y rutas: `ARCHITECTURE.md`.

## E. Security findings

Confirmados: drivers locales sin sandbox en desarrollo; publicación dev de DB/Redis sin loopback; script de setup que puede alterar servicios compartidos; telemetría predeterminada; contexto Docker sin exclusiones AOS; herramientas MCP dev sin versión fija/sandbox. Pendientes: alcance de avisos de dependencias, OAuth público e invitaciones. No se reprodujeron exploits. El barrido de secretos no confirmó credenciales operativas; los cinco patrones se clasificaron como datos embebidos y pruebas, con cobertura limitada al árbol actual. Ver `SECURITY_AUDIT.md`.

## F. Telemetry audit

`TELEMETRY_ENABLED=true` y `ANALYTICS_ENABLED=false` por defecto. Sentry backend/frontend y replay tienen controles independientes. La configuración en DB puede prevalecer sobre entorno; Enterprise y catálogo son salidas adicionales con condiciones propias. No se aplicó parche ni configuración de ejecución. No hay captura de tráfico ni afirmación de cero telemetría. Ver `TELEMETRY_AUDIT.md`.

## G. Local environment

Windows, Node host 24.16.0, aproximadamente 23,4 GiB RAM; WSL informa no instalado y Docker no aparece en PATH. No hay URL de aplicación ni administrador. Se propone construir código en Linux/WSL sobre el mismo bus, con servicios/volúmenes exclusivos, secretos generados y acceso loopback. Los puertos propuestos todavía no se han comprobado. Ver `LOCAL_SETUP.md`.

## H. Test results

Se verificaron ancestry y estado no shallow, código y manifiestos, patrones de secretos, 4.880 resoluciones npm contra OSV (13 lotes sin error), 63 detalles de avisos, preservación de bloques AOS, arrays de hooks, guard de merge con entradas simuladas, exclusiones Git, enlaces locales y whitespace del diff. El primer grafo agotó la cota de diez minutos; la recuperación usando el mismo módulo AOS con plazo mayor terminó con exit 0: 34.624 archivos, 343.598 nodos y 901.447 aristas. Status actualizado y consulta de `TelemetryService` en el archivo real de este repo comprobados; evidencia guardada localmente.

No se ejecutaron build, tests del CRM, migraciones, navegador, CRUD, reinicio, persistencia, worker ni pruebas de red. `.aos/verify.json` continúa vacío; no se generó un recibo PASS vacío ni un `worker.return`. No hay baseline funcional para atribuir futuros fallos a cambios de AOS.

## I. License considerations

Core AGPL, toolkit/bibliotecas MIT y archivos Enterprise separados; 552 archivos front/server marcados Enterprise. La excepción de aplicaciones permite separación bajo sus condiciones; no exonera modificaciones del core. Se conservaron avisos y no se desbloquearon funciones. Faltan SBOM final, revisión jurídica y decisiones sobre componentes comerciales. Ver `LICENSE_COMPLIANCE.md`.

## J. AWS readiness

Propuesta preliminar para evaluar EC2/ECS-Fargate, RDS, Redis compatible, S3, secretos, aislamiento de funciones, backups y transición por imagen/SHA. No hay recursos, costes, credenciales ni IaC aplicada. Falta medir local y aprobar región/presupuesto. Ver `AWS_DEPLOYMENT_PLAN.md`.

## K. Deferred ledger

Estado posterior a esta fotografía: mapa aprobado con go, siete contratos registrados, fork creado y publicación/lectura del panel comprobadas. Prioridad: WSL/runtime, configuración segura/privacidad y triage alcanzable de dependencias antes de arrancar. Pendientes gate de aplicación, pruebas funcionales/red, backups y revisión final. Ver `DEFERRED_LEDGER.md`.

## L. Commits

La entrega de esta fase agrupa exclusivamente documentación, orientación, exclusiones de runtime y conservación del guard preparado. El código de aplicación, manifiestos, lockfile y licencias upstream permanecen sin modificaciones respecto a la base fijada. El hash y número real de archivos se obtienen de `git show --stat` después del commit y constan en el informe local final. No se hizo push, PR ni merge.

## M. Next recommended step

Aprobar el mapa y comenzar CRM-001: preparar el entorno Linux sobre el checkout/bus existente y concretar el origen del fork. A continuación, registrar contratos AOS y ejecutar el orden de `EXECUTION_PLAN.md`, sin habilitar servicios o integraciones externas fuera del alcance.
