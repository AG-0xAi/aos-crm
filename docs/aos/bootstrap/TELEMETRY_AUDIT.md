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

## CRM-003-fix1: cierre del hueco de exportación remota (METER_DRIVER/OTLP)

La revisión del coordinador (`.aos/reports/CRM-003-coordinator-review.md`) reprodujo que `deploy/local/privacy.env` no fijaba `METER_DRIVER` ni `OTLP_COLLECTOR_METRICS_ENDPOINT_URL`: agregar `METER_DRIVER=opentelemetry` junto a un endpoint OTLP remoto pasaba el contrato del perfil y el chequeo de "sin secretos" sin que ninguno de los dos lo detectara (evidencia: `.aos/onboarding/bootstrap-2026-10-27/privacy-exporter-observation.json`). `METER_DRIVER` es CSV (`parse-array-env-var.ts`) contra el enum real `opentelemetry|console|prometheus` (`metrics/types/meter-driver.type.ts`); vacío/ausente ya cae al default oficial `[]` (ningún exportador), pero el perfil no lo expresaba, así que un valor remoto podía colarse sin que el contrato lo notara.

`deploy/local/privacy.env` y `scripts/aos/verify-privacy.mjs` ahora fijan explícitamente, como placeholders vacíos (no secretos, no credenciales): `METER_DRIVER=`, `SENTRY_DSN=`, `SENTRY_FRONT_DSN=`, `ENTERPRISE_KEY=`, `ENTERPRISE_VALIDITY_TOKEN=`. El chequeo de "sin secretos" ya no los prohíbe por nombre (antes rechazaba `SENTRY_DSN`/`SENTRY_FRONT_DSN`/`ENTERPRISE_KEY` incluso vacíos, y `ENTERPRISE_VALIDITY_TOKEN` habría caído por el sufijo `_TOKEN`); un valor NO vacío para cualquiera de esas cinco claves sigue siendo rechazado por el contrato (`checkPrivacyEnvContract`, por nombre, nunca por valor impreso). `OTLP_COLLECTOR_METRICS_ENDPOINT_URL` no es una clave de `TwentyConfigService` (la lee `instrument.ts` directo de `process.env`) y por eso no es obligatoria en el perfil, pero si se expresa debe quedar vacía: el chequeo de "sin secretos" la rechaza si aparece con un valor no vacío, independientemente de `METER_DRIVER`.

Re-probado contra las funciones puras actuales con el mismo fixture sintético del root (`METER_DRIVER=opentelemetry` + el endpoint OTLP del reporte): ambos chequeos ahora rechazan (`profileContractAccepted=false`, `noSecretsCheckAccepted=false`). La evidencia inicial (`privacy-exporter-observation.json`) se conserva sin tocar; este re-probado fue ad-hoc (no se agregó un segundo artefacto de evidencia, fuera del alcance acotado de este fix) y se reporta en `.aos/reports/CRM-003-fix1.md`.

## Nota aparte: DocumentViewer (MS Office Online) y CVE disputado de TXTRenderer

Ver `.aos/reports/DOCUMENT-VIEWER-triage.md` (triage previo, no tocado por CRM-003). Resumen para no confundir con telemetría: `DocumentViewer.tsx` usa `@cyntler/react-doc-viewer@1.17.1`; para archivos MS Office con URL privada (`127.0.0.1`/`localhost`/IP privada/`.local`/`.internal`, función `isPrivateUrl`), Twenty ya evita el iframe de `view.officeapps.live.com` y ofrece descarga en su lugar — confirmado por lectura de `packages/twenty-front/src/modules/activities/files/components/DocumentViewer.tsx:118-150,277-283`. Esto es una integración funcional condicional existente, no un mecanismo de tracking, y no se ha modificado ni se debe modificar sin motivo. La verificación en navegador de que el caso MS Office con URL privada efectivamente no contacta a Microsoft, y la decisión sobre el CVE disputado del `TXTRenderer` (interpolación JSX, no `dangerouslySetInnerHTML`, pendiente de prueba React/browser con texto sintético), quedan para CRM-005 según el triage ya registrado.

## CRM-005: destinos observados en ejecución (navegador, servidor y worker)

Fecha de medición: 29 de octubre de 2026. Esto ya **no** es inspección estática: son peticiones observadas, con la herramienta que las observó indicada en cada caso. Sigue sin declararse "cero telemetría": lo que hay es un inventario de los destinos vistos en ventanas concretas, y los límites de esas ventanas están escritos abajo.

### Lo que el navegador pidió de verdad (antes del arreglo de CRM-005)

Medido con el navegador del propio arnés (Chromium headless con su sandbox activo, imagen oficial de Playwright fijada por digest, `scripts/aos/browser-acceptance.mjs`), que registra **cada** petición a un host que no sea loopback como metadato (método, esquema, host, ruta — nunca query string, cuerpo ni cabeceras). Una sesión completa de login + alta de empresa/persona/oportunidad sobre la imagen construida **antes** del arreglo pidió:

| Destino observado | Origen en el código | Clasificación | Autorización |
| --- | --- | --- | --- |
| `GET https://twenty-icons.com/ensayos-sinteticos.invalid`, `/airbnb.com`, `/anthropic.com`, `/stripe.com`, `/figma.com`, `/notion.com`, `/aos-mcp-probe.invalid` | el identificador de imagen de los campos LINKS (`getImageIdentifierFieldValue` → `getLinkFaviconUrl`), con el **dominio de cada empresa de la tabla** en la ruta. Este camino **sí** lee el flag: lo que estaba en `true` era el valor efectivo, porque la imagen en ejecución no tenía `ALLOW_REQUESTS_TO_TWENTY_ICONS` fijado y el default upstream es `true` | Dependencia funcional de terceros (iconos), **con el dominio del registro en la ruta** | **No autorizada** en este perfil: cerrada con `ALLOW_REQUESTS_TO_TWENTY_ICONS=false` en `privacy.env` |
| *(no observado en esta sesión, probado por render)* | `BackgroundMockTableRow`, `OnboardingImportPreviewCompanies` y `LinkIconWithLinkOverlay` construían la URL **sin leer el flag**, y el estado inicial del frontend defaultaba a `true`. La sesión de navegador de esta medición no llegó a renderizar esos tres sitios (fondo de la pantalla de acceso, vista previa de onboarding y favicon de enlace del menú), así que su bypass se demuestra renderizando los componentes reales en `scripts/aos/verify-front-icons.mjs`, no con esta captura | Igual que la anterior, pero **inmune al flag**: apagarlo en el perfil no los habría detenido | Cerrada con las tres guardas y el estado inicial fail-closed de CRM-005 |
| `GET https://twentyhq.github.io/placeholder-images/workspaces/twenty-logo.png` | constante upstream `twenty-front/.../navigation-drawer/constants/DefaultWorkspaceLogo.ts` | Activo decorativo servido por GitHub Pages; se pide en **cada carga** mientras el workspace no tenga logo propio | **Fuera del Scope registrado de CRM-005** (cuatro ficheros de frontend). Se reporta aquí, no se parchea en silencio. Opciones para su dueño: subir un logo propio al workspace, o servir el placeholder desde el propio servidor |

La petición de iconos es la que motivó el arreglo: no es analítica, pero envía el **nombre de dominio del cliente** a un tercero en cada render, y el perfil local no lo había autorizado. El estado inicial del frontend defaultaba a `true`, así que la primera petición salía incluso antes de que `/client-config` respondiera (medido por render en `scripts/aos/verify-front-icons.mjs`, no deducido).

### Destinos de herramientas de construcción y pruebas (inventariados aparte)

No son tráfico de la aplicación: son descargas de herramientas, y por eso van en su propia lista.

| Destino | Qué se trae | Cuándo |
| --- | --- | --- |
| `mcr.microsoft.com` | imagen oficial de Playwright `v1.60.0-noble`, fijada por digest `sha256:9bd26ad9…b948` | una vez, al preparar el navegador del arnés |
| `registry.npmjs.org` | el paquete `playwright@1.60.0` dentro de esa imagen; los `@types/*` que `twenty-front` necesita y solo `twenty-server` declara; `npx rimraf` dentro de los builds de librerías | en los `docker build` del arnés |
| `raw.githubusercontent.com` | el perfil seccomp oficial de Playwright (`utils/docker/seccomp_profile.json`, tag `v1.60.0`), sha256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`, versionado en `scripts/aos/playwright-seccomp-profile.json` | una vez |

### Captura de red (tcpdump) de servidor, worker y navegador

`scripts/aos/capture-traffic.mjs` levanta `tcpdump` dentro de la distro que ejecuta el stack — el servidor, el worker y el contenedor del navegador comparten ese espacio de red — con filtro `port 53 or (ip and (src pública o dst pública))`, snaplen 128 y **sin fichero pcap**: lo que queda en disco son marcas de tiempo, direcciones, puertos, flags TCP y nombres de consulta DNS. Nunca cuerpos, cabeceras de autorización, cookies ni HAR. El propio comando tiene un `--self-test` que falla si alguien le añade `-w`, `-A`/`-X` o un snaplen de paquete completo.

Resultados por ventana en `docs/aos/bootstrap/FUNCTIONAL_EVIDENCE.md` (comandos, códigos de salida y destinos observados). Límites de esta técnica, que no se compensan con más capturas: una captura prueba lo que pasó **en su ventana**, nunca la ausencia de tráfico fuera de ella; TLS no se descifra, así que un destino se clasifica por nombre y puerto, no por lo que se envió; y el navegador del founder en Windows **no** cruza este espacio de red, así que su tráfico no está en estas capturas (el navegador del arnés sí).

## Prueba requerida antes de aceptar

1. Comprobar valores efectivos y configuración del cliente en la instancia limpia.
2. Capturar tráfico saliente del servidor, worker y navegador desde el primer arranque, incluida el alta inicial.
3. Ejercitar login, contactos, empresas, oportunidades, relaciones, reinicio, jobs y errores controlados.
4. Registrar destino, proceso, finalidad, resultado y clasificación de cada conexión. Cero conexiones a destinos de tracking no autorizado en los flujos cubiertos.
5. Repetir tras reinicio y comprobar que los overrides persistidos no reactivan proveedores.
6. Conservar health checks, logs de seguridad y depuración local; verificar que la funcionalidad esencial sigue operativa.

No se conectaron Google/Microsoft/IA ni se enviaron datos del CRM. Las consultas de GitHub y OSV realizadas durante esta inspección transmitieron referencias públicas de código y versiones de dependencias, no datos de clientes. No sustituyen una captura de red de la aplicación. Contenidos remotos, avatares, soporte, CAPTCHA, webhooks e integraciones necesitan inventario adicional durante la ejecución.
