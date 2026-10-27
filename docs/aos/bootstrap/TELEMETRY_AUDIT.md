# Auditoría de telemetría: fase estática

Fecha: 27 de octubre de 2026. Versión: `twenty/v2.51.0`. **No hay aplicación ejecutándose ni comprobación de tráfico. No se declara cero telemetría.** CRM-003 (ver sección propia más abajo) creó `deploy/local/privacy.env` y `scripts/aos/verify-privacy.mjs`; no se tocó código de producto ni Compose/local.ps1 (CRM-002).

| Mecanismo | Evidencia / valor predeterminado | Datos y destino | Acción propuesta |
| --- | --- | --- | --- |
| Eventos de alta self-host | `config-variables.ts:957`, `telemetry.service.ts:23`, `telemetry.listener.ts`; `TELEMETRY_ENABLED=true` | POST a `https://twenty-telemetry.com/api/v2/selfHostingEvent`; el tipo contempla email/nombre, identificadores de usuario/workspace/servidor, URL y locale | Fijar explícitamente `false` en servidor y worker; probar que `publish` no hace HTTP |
| Analítica | `config-variables.ts:925`, config del cliente, módulos de event logs/ClickHouse; `ANALYTICS_ENABLED=false` | Backend de analítica configurado, no debe equipararse automáticamente con un SaaS externo | Fijar `false`; comprobar propagación a `/client-config`, UI, jobs y métricas de uso |
| Sentry backend | `src/instrument.ts:59`; se inicializa si `EXCEPTION_HANDLER_DRIVER=SENTRY`; predeterminado `CONSOLE` | DSN configurado. Incluye `sendDefaultPii`, trazas y grabación de entradas/salidas de IA cuando está activo | Mantener `CONSOLE`, DSN vacío, sin proveedor remoto |
| Sentry frontend/replay | `SentryInitEffect.tsx:28`; depende de DSN de cliente, no de las dos variables anteriores | `SENTRY_FRONT_DSN`; configura identidad de usuario, replay de sesiones 0,1 y replay tras error 1,0 | Vaciar DSN y comprobar config efectiva persistida; probar ausencia de inicialización y requests |
| OpenTelemetry | `instrument.ts`, `METER_DRIVER=[]` | Endpoint OTLP configurable; Prometheus local si se elige ese driver | Sin exportador remoto; logs técnicos locales. No publicar 9464 sin gate |
| Licencia Enterprise | `enterprise-plan.service.ts:293-330,680`; refresh requiere clave firmada válida | `https://twenty.com/api/enterprise/validate`; metadatos incluyen conteos, URL e email de contacto | No configurar Enterprise. No eliminar ni eludir controles comerciales. Si se contrata, tratar la comunicación de licencia como autorización independiente |
| Catálogo de apps | `MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=true`, `APP_REGISTRY_URL`, `APP_REGISTRY_CDN_URL` | npm registry y unpkg; comunicación funcional de catálogo/paquetes, distinta del tracking | Desactivar sync automático en el bootstrap hasta decidir su uso; no instalar apps de terceros |
| Herramientas de desarrollo | Yarn, Nx, gestores de paquetes y MCP de desarrollo | Descarga de paquetes, posibles diagnósticos de herramientas | Configurar `YARN_ENABLE_TELEMETRY=0`, `NX_NO_CLOUD=true`, `NX_DAEMON=false`; inventariar sus descargas separadas del tráfico de la app |

## Configuración persistida

`TwentyConfigService.get()` da preferencia a valores almacenados en DB para variables que no sean env-only. `IS_CONFIG_VARIABLES_IN_DB_ENABLED` predetermina `true`. Por ello, un `.env` con `false` no demuestra por sí solo el valor efectivo si existe un override persistido.

El perfil inicial debe elegir y probar una política: usar entorno exclusivamente (`IS_CONFIG_VARIABLES_IN_DB_ENABLED=false`) o inspeccionar y fijar también las variables persistidas. Al desactivar configuración en DB hay que verificar los efectos en admin panel y datos como `SERVER_ID`; no cambiarlo silenciosamente. `EXCEPTION_HANDLER_DRIVER` y el driver de métricas son env-only, pero Sentry frontend llega por configuración del cliente.

Servidor y worker comparten módulos y configuración. Deben recibir el mismo perfil de privacidad. El frontend consume `/client-config`; hay que observar su respuesta real, no solo los archivos de entorno.

## CRM-003: política de precedencia DB y evidencia estática

Política elegida para el perfil local: **entorno exclusivamente** (`IS_CONFIG_VARIABLES_IN_DB_ENABLED=false` en `deploy/local/privacy.env`), no "inspeccionar y fijar también las variables persistidas". Motivo: con la política de inspección, cada clave persistida (`core.configVariable`) seguiría siendo una superficie a revisar por separado y a perpetuidad; con el driver de BD fuera del grafo de módulos, no hay superficie que revisar porque el camino de lectura no existe.

Mecanismo confirmado por lectura directa del código pinneado (no por inferencia), verificado estáticamente por `scripts/aos/verify-privacy.mjs`:

1. `packages/twenty-server/src/engine/core-modules/twenty-config/twenty-config.module.ts:14-19` — `TwentyConfigModule.forRoot()` lee `process.env.IS_CONFIG_VARIABLES_IN_DB_ENABLED !== 'false'` **antes** de que Nest construya el grafo de módulos, y solo entonces decide si `imports` incluye `DatabaseConfigModule.forRoot()`. Con el flag en `false`, ese módulo nunca se importa: el provider `DatabaseConfigDriver` no existe en absoluto para esta instancia del proceso.
2. `packages/twenty-server/src/engine/core-modules/twenty-config/twenty-config.service.ts:26-54` — el constructor de `TwentyConfigService` recibe `databaseConfigDriver` como `@Optional()`; al no existir el provider, llega `undefined`. `isDatabaseDriverActive` se calcula una sola vez ahí como `isConfigVariablesInDbEnabled && !!this.databaseConfigDriver` — ambos operandos son falsy, así que queda `false` para toda la vida del proceso.
3. Mismo archivo, `get<T>(key)` (líneas 56-70): si `isDatabaseDriverActive` es `false`, la rama que llama a `this.databaseConfigDriver.get(key)` ni se evalúa; cae directo a `return this.environmentConfigDriver.get(key)`.

Consecuencia concreta: una fila que una sesión anterior hubiera persistido en `core.configVariable` (por ejemplo, reactivando `TELEMETRY_ENABLED` desde el panel admin) **no puede resurgir en silencio**, porque el único código capaz de leer esa tabla nunca se instancia en este proceso — no es que el valor se ignore en tiempo de lectura, es que el camino de lectura no existe. Esto es distinto de (y más fuerte que) simplemente fijar `TELEMETRY_ENABLED=false` en el entorno mientras la BD sigue activa para otras claves.

`EXCEPTION_HANDLER_DRIVER` lleva además `isEnvOnly: true` en su metadata (`config-variables.ts`), así que ni siquiera con la política de BD activa sería override-able — pertenece a una categoría de variables que la propia Twenty excluye de persistencia, independiente de nuestra elección de perfil.

Efectos aún NO verificados en runtime (pendientes de CRM-004/CRM-005, no se afirman aquí): comportamiento del panel admin con configuración en BD desactivada, valor y estabilidad de `SERVER_ID` entre reinicios, y cualquier endpoint que hoy asuma que `set`/`update`/`delete` de `TwentyConfigService` están disponibles (con el driver ausente, esas tres llamadas lanzan `ConfigVariableException` por `validateDatabaseDriverActive`; no se ha ejercitado ese camino).

Propagación a cliente confirmada por lectura de código (`client-config.service.ts`): `sentry.dsn` viene de `SENTRY_FRONT_DSN` (sin configurar en este perfil → cadena vacía/`undefined`) y `analyticsEnabled` viene de `ANALYTICS_ENABLED` (`false`). `SentryInitEffect.tsx` solo hace `await import('@sentry/react')` e `init(...)` si `isNonEmptyString(sentryConfig?.dsn)`; con el DSN vacío, el SDK de Sentry nunca se carga en el navegador. Ninguna de estas dos rutas se ha observado todavía contra una respuesta real de `/client-config` — eso es CRM-004/CRM-005.

Cron de Enterprise (`EnterpriseKeyValidationCronJob`) y de marketplace: el primero **siempre se registra** (no tiene `isEnabled` condicional en `cron-register-all.command.ts`), pero tanto `refreshValidityToken()` como `reportSeats()` (`enterprise-plan.service.ts`) retornan `false` antes de cualquier `fetch(...)` cuando `ENTERPRISE_KEY` no está configurado — este perfil no lo configura ni lo debe configurar. El segundo (`MarketplaceCatalogSync`) sí se excluye por completo del registro cuando `MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false`: no es que el job se registre y no haga nada, es que nunca se agenda.

## Nota aparte: DocumentViewer (MS Office Online) y CVE disputado de TXTRenderer

Ver `.aos/reports/DOCUMENT-VIEWER-triage.md` (triage previo, no tocado por CRM-003). Resumen para no confundir con telemetría: `DocumentViewer.tsx` usa `@cyntler/react-doc-viewer@1.17.1`; para archivos MS Office con URL privada (`127.0.0.1`/`localhost`/IP privada/`.local`/`.internal`, función `isPrivateUrl`), Twenty ya evita el iframe de `view.officeapps.live.com` y ofrece descarga en su lugar — confirmado por lectura de `packages/twenty-front/src/modules/activities/files/components/DocumentViewer.tsx:118-150,277-283`. Esto es una integración funcional condicional existente, no un mecanismo de tracking, y no se ha modificado ni se debe modificar sin motivo. La verificación en navegador de que el caso MS Office con URL privada efectivamente no contacta a Microsoft, y la decisión sobre el CVE disputado del `TXTRenderer` (interpolación JSX, no `dangerouslySetInnerHTML`, pendiente de prueba React/browser con texto sintético), quedan para CRM-005 según el triage ya registrado.

## Prueba requerida antes de aceptar

1. Comprobar valores efectivos y configuración del cliente en la instancia limpia.
2. Capturar tráfico saliente del servidor, worker y navegador desde el primer arranque, incluida el alta inicial.
3. Ejercitar login, contactos, empresas, oportunidades, relaciones, reinicio, jobs y errores controlados.
4. Registrar destino, proceso, finalidad, resultado y clasificación de cada conexión. Cero conexiones a destinos de tracking no autorizado en los flujos cubiertos.
5. Repetir tras reinicio y comprobar que los overrides persistidos no reactivan proveedores.
6. Conservar health checks, logs de seguridad y depuración local; verificar que la funcionalidad esencial sigue operativa.

No se conectaron Google/Microsoft/IA ni se enviaron datos del CRM. Las consultas de GitHub y OSV realizadas durante esta inspección transmitieron referencias públicas de código y versiones de dependencias, no datos de clientes. No sustituyen una captura de red de la aplicación. Contenidos remotos, avatares, soporte, CAPTCHA, webhooks e integraciones necesitan inventario adicional durante la ejecución.
