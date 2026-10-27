# Inspección inicial de seguridad

Fecha: 27 de octubre de 2026. Alcance: árbol del commit `15e4826d3b5fc5867baeabeeb42b253892b2d4da`, configuración de desarrollo/contenedores, rutas representativas de autenticación/autorización, secretos por patrones y avisos públicos. No es un pentest ni una certificación de aislamiento.

## Hallazgos

| ID | Severidad AOS | Estado y evidencia | Tratamiento propuesto |
| --- | --- | --- | --- |
| SEC-01 | Alta | Confirmado: con `NODE_ENV=development`, `LOGIC_FUNCTION_TYPE` y `CODE_INTERPRETER_TYPE` predeterminan `LOCAL` (`config-variables.ts:751,874`). Python declara explícitamente ejecución sin sandbox. Las funciones Node heredan el entorno del servidor salvo `NODE_OPTIONS` en `local-child-process-runner.service.ts` | Fijar ambos a `DISABLED` antes del primer arranque; no ejecutar código de usuarios ni instalar apps con hooks hasta disponer de aislamiento |
| SEC-02 | Alta | Confirmado: `docker-compose.dev.yml` publica `5432:5432` y `6379:6379` sin bind loopback; PostgreSQL usa contraseña de ejemplo y Redis no declara autenticación | Compose propio, puertos loopback si son necesarios, red/volúmenes exclusivos y secretos generados; preferir DB y Redis sin publicación al host |
| SEC-03 | Alta | Confirmado: `setup-dev-env.sh` altera contraseña del PostgreSQL detectado; `--reset` puede hacer `flushall` y eliminar bases `default`/`test` | No usarlo contra servicios compartidos. Arranque reproducible exclusivo de AOS |
| SEC-04 | Alta | Confirmado: telemetría predeterminada activa y Sentry independiente puede enviar PII y entradas/salidas de IA | Véase `TELEMETRY_AUDIT.md`; configuración y verificación antes del arranque |
| SEC-05 | Alta | Confirmado: `.dockerignore` excluye `.git`, algunos `.env` y node_modules, pero no `.aos/`, `.claude/` ni `.codegraph-aos/` | Excluir el bus, evidencias y material de agentes antes de construir o enviar contexto a un builder |
| SEC-06 | Alta | Riesgo confirmado de configuración: `.mcp.json` propone herramientas por `npx`, algunas sin versión fija; Playwright usa `--no-sandbox` | No se activaron. Revisar y fijar herramientas de desarrollo antes de usarlas |
| SEC-07 | Alta | Requiere verificación: el lockfile coincide con avisos de dependencias de runtime y desarrollo; incluye avisos críticos de herramientas ajenas al servidor CRM | Triage por alcance, actualización mínima, baseline y tests. No arrancar Storybook/Next auxiliares vulnerables. Véase `DEPENDENCY_AUDIT.md` |
| SEC-08 | Media | Confirmado: `POST /oauth/register` es público, aplica rate limit, acepta clientes públicos sin secreto y scopes predeterminados amplios. Coincide con la superficie del aviso GHSA-pg47-7c3r-fwfx | Mantener local, no autorizar clientes externos; revisar política de registro/consentimiento antes de exponer MCP/OAuth |
| SEC-09 | Alta condicional | Requiere verificación: `user-workspace.service.ts:682-699` oculta invitaciones sin email verificado solo si se exige verificación; todavía existe la rama que devuelve `personalInviteToken`. El aviso de takeover declara afectadas versiones hasta 2.47.0, pero no identifica parche | No declarar el problema resuelto solo por número de versión. Probar el flujo sobre 2.51.0 y mantener un workspace local sin invitaciones externas |
| SEC-10 | Media | Confirmado: `SecureHttpClientService` puede registrar URL de salida junto con workspace/usuario; no se ha probado saneado de parámetros sensibles | Mantener logs locales, revisar redacción, permisos y retención antes de conectar proveedores |

No se ha confirmado un riesgo crítico ejecutable durante la instalación revisada. Esto no equivale a aprobar toda la cadena de suministro: todavía no se inspeccionaron los paquetes descargados ni se instaló nada. Si el triage confirma una ruta crítica alcanzable, su ejecución queda bloqueada hasta mitigación.

## Secretos

Se ejecutó `git grep` sobre el árbol versionado para IDs AWS, formatos de tokens GitHub, claves Stripe live y marcadores de clave privada. El script solo guarda ruta, línea y categoría, nunca el valor. Cinco coincidencias brutas: las dos de los bundles de Yarn están dentro del mismo data URI base64 embebido de 168.685 caracteres, no en una configuración AWS; las otras tres son fixtures/aserciones de integración. Su clasificación queda en `secret-scan.json`/`secret-triage.json` de las evidencias locales. No se ha identificado una credencial operativa real en esta muestra.

Los `.env` versionados encontrados son ejemplos y archivos de pruebas/e2e; no se crearon entornos reales. No se hizo un escaneo de entropía, de toda la historia ni una consulta de validez contra proveedores. Por tanto no se declara ausencia de secretos en todo el historial. Cualquier secreto real confirmado se tratará como P0 y se escalará al propietario sin rotarlo automáticamente.

## Controles observados y límites

- `.yarnrc.yml` activa modo hardened, restricciones de antigüedad y `enableScripts: false`; el motor Yarn separado de aplicaciones también tiene `enableScripts: false`. No se encontraron lifecycle scripts `preinstall/install/postinstall/prepare` en los manifiestos inspeccionados. No habilitar scripts globalmente para resolver un fallo de instalación.
- Imagen principal: usuario 1000, sin `privileged` ni montaje del socket Docker en el Compose revisado. Son controles de contenedor, no aislamiento suficiente para código no confiable.
- CORS resuelve orígenes permitidos con credenciales; el wildcard de las demás respuestas no implica por sí solo acceso con cookies en navegador. Verificar con pruebas de origen/CSRF, no por coincidencia de texto.
- MCP exige autenticación y aplica contexto de workspace. Esto no sustituye pruebas negativas de API keys, permisos ni aislamiento entre workspaces.
- El cliente HTTP seguro valida resolución DNS/IP y redirecciones; hay un cliente interno explícitamente no protegido y flags de excepción. Se requiere comprobar sus consumidores antes de conectar fuentes no confiables.
- La capa ORM limita objetos/campos/filas. El barrido identificó las fronteras; no probó exhaustivamente inyección SQL, rutas, bypass de autorización, archivos o concurrencia.
- `SecretEncryptionService` implementa sobres versionados AES-GCM y conserva métodos CTR legacy con advertencia sobre rotación. No se rotaron claves ni se probó recuperación; se debe comprobar el uso efectivo del formato versionado al preparar backups y actualizaciones.

## Avisos del propio Twenty

Se recuperaron 14 avisos públicos de la API de GitHub. Los avisos de SQL injection anteriores a 2.15, credenciales anteriores a 2.7, IDOR anterior a 2.9 y webhooks anteriores a 2.19 tienen rangos que no incluyen 2.51.0. Esto se basa en rangos declarados, no en reproducir sus exploits. Se conservó el JSON completo local para revisar cada condición. OAuth e invitaciones reciben tratamiento separado en SEC-08/09.

Fuentes: [avisos de Twenty](https://github.com/twentyhq/twenty/security/advisories), [webhooks](https://github.com/twentyhq/twenty/security/advisories/GHSA-qf3h-pmgc-fcw6), [invitaciones](https://github.com/twentyhq/twenty/security/advisories/GHSA-m4vm-35cw-44rq), [OAuth DCR](https://github.com/twentyhq/twenty/security/advisories/GHSA-pg47-7c3r-fwfx). La lista de exclusiones del scanner upstream no se adopta como exclusión de AOS: aquí también se revisa la configuración local y de construcción.
