# Auditoría de telemetría: fase estática

Fecha: 27 de octubre de 2026. Versión: `twenty/v2.51.0`. **No hay aplicación ejecutándose ni comprobación de tráfico. No se declara cero telemetría. No se han aplicado todavía cambios funcionales.**

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

## Prueba requerida antes de aceptar

1. Comprobar valores efectivos y configuración del cliente en la instancia limpia.
2. Capturar tráfico saliente del servidor, worker y navegador desde el primer arranque, incluida el alta inicial.
3. Ejercitar login, contactos, empresas, oportunidades, relaciones, reinicio, jobs y errores controlados.
4. Registrar destino, proceso, finalidad, resultado y clasificación de cada conexión. Cero conexiones a destinos de tracking no autorizado en los flujos cubiertos.
5. Repetir tras reinicio y comprobar que los overrides persistidos no reactivan proveedores.
6. Conservar health checks, logs de seguridad y depuración local; verificar que la funcionalidad esencial sigue operativa.

No se conectaron Google/Microsoft/IA ni se enviaron datos del CRM. Las consultas de GitHub y OSV realizadas durante esta inspección transmitieron referencias públicas de código y versiones de dependencias, no datos de clientes. No sustituyen una captura de red de la aplicación. Contenidos remotos, avatares, soporte, CAPTCHA, webhooks e integraciones necesitan inventario adicional durante la ejecución.
