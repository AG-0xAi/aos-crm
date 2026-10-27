# Perfil local seguro (CRM-002)

Fecha: 27 de octubre de 2026. Alcance: configuración estática de
`deploy/local/`, `.claude/`, `.dockerignore`, `.gitignore`, `.yarnrc.yml` y
`packages/twenty-docker/twenty/Dockerfile`. **No se instalaron dependencias
del CRM, no se construyó la imagen de aplicación y no se arrancó ningún
servicio** (server/worker/db/redis). Lo que sí corrió de verdad: el
validador estático (`scripts/aos/verify-local-config.mjs`), el self-test de
`scripts/aos/local.ps1`, y `docker compose config` contra
`deploy/local/compose.yaml` vía la distro `AOS-CRM-Ubuntu-24.04` (medición
de esquema, sin build/up). Ver `.aos/reports/CRM-002.md` para comandos y
códigos de salida exactos.

## Perfil

- **Build desde fuente, no imagen moving.** `deploy/local/compose.yaml`
  construye `packages/twenty-docker/twenty/Dockerfile` (target `twenty`)
  sobre el pin `twenty/v2.51.0` / `15e4826d3b5fc5867baeabeeb42b253892b2d4da`.
  Nunca referencia `twentycrm/twenty` ni una etiqueta `:latest`.
- **Cuatro servicios dedicados a aos-crm:** `server`, `worker`, `db`
  (`postgres:16`), `redis` (`redis:7`), red `aos-crm-local` y volúmenes
  `aos-crm-local-db` / `aos-crm-local-storage`, todos exclusivos — nada
  compartido con otro producto sobre este mismo bus (SEC-02).
- **Un solo puerto, loopback, verificado libre.** Solo `server` publica
  puerto, como `127.0.0.1:${AOS_CRM_WEB_PORT:-43000}:3000`; comprobado
  libre en este host con un bind real de `TcpListener` antes de fijarlo
  como valor por defecto (ver CRM-002.md). `db`/`redis` no declaran
  `ports:` — alcanzables solo por la red `aos-crm-local`.
- **Sin privilegiado, sin socket de Docker.** Ningún servicio usa
  `privileged: true` ni monta `/var/run/docker.sock`.
- **Drivers de ejecución forzados a `DISABLED`** (`LOGIC_FUNCTION_TYPE`,
  `CODE_INTERPRETER_TYPE`) directamente en `compose.yaml`, no delegado a
  `privacy.env`: con `NODE_ENV=production` ya es el default del código
  (`config-variables.ts:751-754,874-876`), pero este perfil no depende de
  ese default implícito sobreviviendo un cambio futuro del Dockerfile
  (SEC-01).
- **Workspace único.** `IS_MULTIWORKSPACE_ENABLED=false` fijado en
  compose: tras el alta del primer admin no se puede abrir un segundo
  workspace. No se fija `SIGN_IN_PREFILLED` (queda en su default de
  código `false`, sin prellenar credenciales de demo) ni
  `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS` (su interacción con
  `IS_MULTIWORKSPACE_ENABLED=false` no se verificó end-to-end; queda
  pendiente, no inventado).
- **Migraciones: mecanismo oficial, sin comandos inventados.** El
  `entrypoint.sh` de la imagen (`packages/twenty-docker/twenty/entrypoint.sh`)
  ya corre `yarn database:init:prod` si falta el esquema `core`, seguido de
  `cache:flush`/`upgrade`/`cache:flush`, cuando `DISABLE_DB_MIGRATIONS` no es
  `"true"`. `server` lo deja correr (`DISABLE_DB_MIGRATIONS: "false"`);
  `worker` lo tiene en `"true"` para no competir con el server, igual que
  `packages/twenty-docker/docker-compose.yml` upstream. Ninguna migración se
  ejecutó en este track: no hay DB real levantada todavía.

## Contrato de privacidad (`deploy/local/privacy.env`, CRM-003)

`compose.yaml` consume `deploy/local/privacy.env` vía `env_file:` en
`server` y `worker`. **Este archivo no se crea en CRM-002** — es el
contrato de CRM-003 (telemetría/analítica/sincronización de catálogo/config
en DB). Se comprobó en vivo, con Docker Compose 5.6.1 real sobre
`AOS-CRM-Ubuntu-24.04`, que su ausencia bloquea el arranque antes de que
cualquier servicio corra: `docker compose -f deploy/local/compose.yaml
config --quiet` (sin flags de omisión) falla con `required variable ... is
missing a value` para los secretos de `deploy/local/.env` — que tampoco
existe todavía — exactamente el fallo cerrado de R2.1. Por separado,
`docker compose config --quiet --no-interpolate --no-env-resolution` (que
no necesita ninguno de los dos archivos) valida que el esquema del YAML es
correcto. Evidencia completa en CRM-002.md.

Claves que CRM-003 debe fijar en `privacy.env` (nombres confirmados en
`config-variables.ts`; valores por defecto medidos en `TELEMETRY_AUDIT.md`):
`TELEMETRY_ENABLED=false` (default del código: `true`),
`ANALYTICS_ENABLED=false` (ya es el default),
`MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false` (default: `true`),
`IS_CONFIG_VARIABLES_IN_DB_ENABLED=false` (default: `true`; sin esto, un
valor persistido en DB puede pisar silenciosamente lo que diga este
archivo — ver `TELEMETRY_AUDIT.md` "Configuración persistida"). El driver
de excepciones (`EXCEPTION_HANDLER_DRIVER=CONSOLE`) y el de correo
(`EMAIL_DRIVER`, `EMAILING_DOMAIN_DRIVER`) ya son `CONSOLE`/`LOGGER`/`LOG`
por defecto en el código: no hacen falta en `privacy.env` salvo que CRM-003
decida fijarlos explícitamente por auditabilidad.

`scripts/aos/local.ps1` exige exactamente esas cuatro claves con esos
valores antes de permitir `-Action Start`/`Restart` (fail-closed: host,
`deploy/local/.env`, `privacy.env`, puerto libre — las cuatro deben pasar o
no se llama a `docker compose up`). Se confirmó en vivo contra el estado
real de este checkout (sin `privacy.env` ni `.env`, con host ya listo por
CRM-001-HOST): `-Action Start` responde `BLOCKED (fail-closed), no
build/up attempted` y nunca invoca `docker compose`. Ver CRM-002.md.

## Driver de correo local

`EMAIL_DRIVER` (default `LOGGER`) y `EMAILING_DOMAIN_DRIVER` (default
`LOG`, documentado en `packages/twenty-server/.env.example:139` como "fakes
registration, verification and sends locally and never contacts a
provider") ya son no-egreso por defecto: no se configuró SMTP ni dominio de
envío. Límite real: el driver `LOGGER` escribe el contenido del correo
—incluyendo enlaces/tokens de verificación e invitación— en el log local del
server. Con `IS_MULTIWORKSPACE_ENABLED=false` y sin invitaciones externas
planeadas, el residuo queda contenido a un log local de un solo
admin local; no se cambió el driver ni se tocó código de envío (fuera del
Scope de este track). Tratar `docker compose logs`/el log local del server
como sensible mientras este driver esté activo.

## Aislamiento del agente (`.claude/`)

Las restricciones que antes solo vivían en `.claude/settings.local.json`
(no versionado) ahora están en `.claude/settings.json` (commiteado, llega
a cualquier worktree): `disabledMcpjsonServers: [context7, playwright,
postgres]` (los tres servidores de `.mcp.json` sin fijar versión o con
flags sin revisar — SEC-06), `disableClaudeAiConnectors: true`, y
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` / `DO_NOT_TRACK=1` /
`CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. CodeGraph no está en esa lista de
deshabilitados — sigue disponible; la inyección de su servidor MCP la hace
el arnés AOS fuera de este archivo, no se tocó. `SessionStart` se conservó
igual.

### Corrección del guard de merge (R1)

`.claude/hooks/aos-merge-guard.cjs` solo miraba `tool_name === 'Bash'`. Con
`CLAUDE_CODE_USE_POWERSHELL_TOOL=1` activo, una llamada con el mismo
`tool_input.command` pero `tool_name: 'PowerShell'` no pasaba por el
`if` y caía directo al `exit 0` final: el guard quedaba vigente para una
shell y ausente para la otra, pese a que el PreToolUse `matcher` disparaba
el hook igual para ambas (evidencia previa del coordinador en
`.aos/reports/merge-guard-shell-coverage.json`: Bash exit 2/bloqueado,
PowerShell exit 0/permitido, con la MISMA cadena sintética). Fix: el `if`
ahora cubre `tool === 'Bash' || tool === 'PowerShell'`, y
`.claude/settings.json` conecta el hook en forma `exec`
(`command: "node"`, `args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/aos-merge-guard.cjs"]`)
con `matcher: "Bash|PowerShell"` y `onFailure: "block"` — el hook falla
cerrado si no llega a arrancar, y `${CLAUDE_PROJECT_DIR}` se sustituye
igual en ambas shells porque no hay un shell intermedio reinterpretándolo
(forma exec, no forma de cadena; ver
https://code.claude.com/docs/en/hooks). Verificado en vivo contra el hook
real, con el proceso `node` del propio script armando la cadena de prueba
por piezas (`['gh','pr','merge','123'].join(' ')`) para que esta
verificación nunca aparezca como texto literal en el `tool_input.command`
de la llamada Bash/PowerShell que la ejecuta: bloquea `gh pr merge` y
`git push origin main` para **ambas** shells (exit 2) y deja pasar un
comando inocuo (`git status`) para ambas (exit 0). Comandos exactos en
CRM-002.md.

También se corrigió el mensaje del guard: decía "deja que el S-00 lo
revise y fusione", contradiciendo AGENTS.md §3 ("Fusionar su propio
trabajo... El merge es de un humano"). Ahora dice "el merge lo hace un
humano, nunca S-00 ni otro agente".

**Límite de cobertura, documentado, no resuelto:** el guard sigue siendo
un filtro de patrones conocidos sobre `tool_input.command` de las dos
herramientas que el `PreToolUse` de Claude Code reporta hoy (Bash,
PowerShell). Un merge por una tercera vía (otra shell, `curl` directo a la
API de GitHub, un comando construido para evadir el patrón) no está
cubierto, igual que el escáner de secretos de CRM-001 es un conjunto fijo
de patrones, no un análisis exhaustivo. La cobertura PowerShell de este
guard es local a este repo; llevar la misma corrección a la fábrica
compartida (el guard/plantilla que otros proyectos AOS heredan) es una
tarea separada, fuera de este track — se señala aquí para que no se
pierda, no se toca el guard global.

## Telemetría de build (R1)

`.yarnrc.yml` ahora declara `enableTelemetry: false` (clave oficial,
https://yarnpkg.com/configuration/yarnrc), preservando
`enableHardenedMode: true`, `enableScripts: false` y el age-gate ya
presentes. `packages/twenty-docker/twenty/Dockerfile` fija
`ENV YARN_ENABLE_TELEMETRY=0 NX_NO_CLOUD=true NX_DAEMON=false` en el stage
`node-base`, antes de cualquier `RUN yarn`/`RUN npx nx` en los stages que
derivan de él (`front-deps`, `server-deps`, `twenty-app-dev`) — no se tocó
el pin del SHA base, los stages, ni ningún `ARG`. `nx.json` ya tenía
`analytics: false` y runner local; no se modificó. Fuentes:
https://yarnpkg.com/advanced/telemetry, https://nx.dev/docs/reference/environment-variables.

## `.dockerignore` (SEC-05)

Ahora excluye `.aos`, `.codegraph-aos`, `.claude`, `.dispatch-bodies` y
`deploy/local/{.env,privacy.env}` (secretos reales), conservando
`deploy/local/.env.example` y todo lo que el Dockerfile referencia por
`COPY` explícito. `.gitignore` gana `/deploy/local/privacy.env`;
`deploy/local/.env` ya quedaba cubierto por el patrón existente
`**/**/.env` (comprobado con `git check-ignore -v`, ver CRM-002.md).

## Triage de dependencias (R3) — acotado, no exhaustivo

Alcance: solo lo necesario para decidir qué NO arrancar en este bootstrap;
no sustituye el triage completo de `DEPENDENCY_AUDIT.md`. Auxiliares
vulnerables confirmados en el lockfile (Next.js, Storybook, Electron) no
forman parte de este perfil: `compose.yaml` no define ni construye
Companion, website, ni Storybook — solo `server`/`worker`/`db`/`redis`.

**Corrección DOMPurify, incorporada aquí exactamente como la reportó el
coordinador** (no se repite el dato erróneo del informe inicial): hay
**tres** llamadas `sanitize*` en
`packages/twenty-server/src/engine/core-modules/email/utils/`, no dos —
`sanitizeFile`, `sanitizeOutboundEmailHtml` y
`sanitizeOutboundEmailSubject`. La tercera (`subject`) sí usa
`RETURN_DOM_FRAGMENT: true`, con `ALLOWED_ATTR: []`/`ALLOWED_TAGS: []` y
lectura posterior de `textContent`. Ninguna de las tres activa
`SAFE_FOR_TEMPLATES`, `IN_PLACE` ni `PARSER_MEDIA_TYPE:
application/xhtml+xml`. El advisory GHSA-cg2g-xh64-v4q7
(https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7)
exige `SAFE_FOR_TEMPLATES` + modo DOM + entrada con shadow root + evaluación
posterior como plantilla; su metadata actual (consultada 27/10/2026) marca
severidad Low y versión parcheada `3.4.17`, mientras el cuerpo narrativo
histórico todavía dice "no fix". Ningún modo DOM por sí solo confirma el
exploit; no se ejecutó PoC ni se instaló la dependencia. Pendiente real
(no de este track): confirmar si `3.4.17`+ ya está resuelto en el lockfile
o si hace falta una actualización acotada antes de habilitar correo
saliente.

No se repitieron las 4.880 consultas OSV del inventario inicial
(`DEPENDENCY_AUDIT.md`, evidencia en `.aos/onboarding/bootstrap-2026-10-27/`);
este track solo añadió la corrección de cobertura de callsites arriba.

## Pendientes explícitos

- `deploy/local/privacy.env` real — CRM-003.
- `docker compose up`/build real, migraciones reales, primer admin real,
  captura de tráfico — gate de aplicación (CRM-004/CRM-005 según
  AGENTS.md), no este track.
- Interacción `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS` ×
  `IS_MULTIWORKSPACE_ENABLED=false` sin verificar; no se fijó el flag.
- Llevar la cobertura PowerShell del merge-guard a la plantilla/fábrica
  compartida — tarea separada, otro canal.
- Confirmar versión de `dompurify` resuelta en el lockfile contra
  `3.4.17`+ antes de habilitar flujos de correo real.
