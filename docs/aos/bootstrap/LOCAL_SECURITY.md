# Perfil local seguro (CRM-002)

Fecha: 27 de octubre de 2026, actualizado en CRM-002-fix1 (misma fecha).
Alcance: configuración estática de `deploy/local/`, `.claude/`,
`.dockerignore`, `.gitignore`, `.yarnrc.yml` y
`packages/twenty-docker/twenty/Dockerfile`. **No se instalaron dependencias
del CRM, no se construyó la imagen de aplicación y no se arrancó ningún
servicio** (server/worker/db/redis). Lo que sí corrió de verdad: el
validador estático (`scripts/aos/verify-local-config.mjs`), el self-test de
`scripts/aos/local.ps1`, `docker compose config --format json` contra
`deploy/local/compose.yaml` vía la distro `AOS-CRM-Ubuntu-24.04` (esquema y
campos efectivos por servicio, sin build/up), y un build `FROM scratch`
descartable sobre un contexto sintético para verificar `.dockerignore`
contra Docker real (nunca el contexto/imagen del CRM). Ver
`.aos/reports/CRM-002-fix1.md` (y `.aos/reports/CRM-002.md` para la entrega
original) para comandos y códigos de salida exactos.

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

`deploy/local/privacy.env` es un **perfil no secreto, versionado y
reproducible** (telemetría/analítica/sincronización de catálogo/config en
DB) — no son credenciales. No está en `.gitignore` (se corrigió en CRM-002:
antes lo excluía por error, junto con un check en
`verify-local-config.mjs` que lo exigía ignorado); los secretos reales
del perfil local viven solo en `deploy/local/.env` (ese sí gitignorado,
comprobado con `git check-ignore`). `compose.yaml` consume
`deploy/local/privacy.env` vía `env_file:` en `server` y `worker`. **Este
archivo no se crea en CRM-002** — es el contrato de CRM-003. Se comprobó en
vivo, con Docker Compose 5.6.1 real sobre `AOS-CRM-Ubuntu-24.04`, que su
ausencia bloquea el arranque antes de que cualquier servicio corra:
`docker compose -f deploy/local/compose.yaml config --quiet` (sin flags de
omisión) falla con `required variable ... is missing a value` para los
secretos de `deploy/local/.env` — que tampoco existe todavía — exactamente
el fallo cerrado de R2.1. Por separado, `docker compose config --quiet
--no-interpolate --no-env-resolution --format json` (que no necesita
ninguno de los dos archivos) resuelve los anchors/merge keys de YAML en los
campos efectivos por servicio y es la base real de los checks de
`verify-local-config.mjs` descritos abajo. Evidencia completa en
CRM-002-fix1.md.

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

`scripts/aos/local.ps1` exige, antes de permitir `-Action Start`/`Restart`:
host listo, `deploy/local/.env` presente con sus tres claves sin
placeholder, `privacy.env` con las cuatro claves exactas, puerto loopback
configurado libre (o propio, ver abajo), `AOS_CRM_SERVER_URL` coherente con
`AOS_CRM_WEB_PORT`, **y además** `node scripts/aos/verify-local-config.mjs`
en verde — el chequeo de cuatro claves/presencia por sí solo ya no basta
(R2 original). Si `scripts/aos/verify-privacy.mjs` (CRM-003) todavía no
existe, el gate bloquea honestamente con un mensaje distinto a "falló": "no
delivered yet", para no confundir ausencia con fallo. Ninguna de las dos
verificaciones dispara `aos verify` completo (procedencia/GitHub) en cada
arranque — solo los dos verificadores locales. Se confirmó en vivo contra
el estado real de este checkout (sin `privacy.env` ni `.env`, con host ya
listo por CRM-001-HOST): `-Action Start` responde `BLOCKED (fail-closed),
no build/up attempted` y nunca invoca `docker compose`. Ver
CRM-002-fix1.md.

### Validación de Compose contra la salida normalizada de Docker (R3)

Los checks de `compose.yaml` en `verify-local-config.mjs` ya no son regex
sobre el YAML crudo: corren `docker compose config --no-interpolate
--no-env-resolution --format json`, que resuelve los *anchors*/merge keys
(`<<: *aos-crm-env`) en los campos efectivos de cada servicio sin
interpolar ninguna variable (nunca necesita, ni puede leer, un secreto
real). Esto cierra dos huecos reales que una regex de "primera coincidencia
sobre texto" no detecta: (1) un driver forzado a `DISABLED` solo en el
*anchor*/en `server`, pero sobrescrito en el bloque propio de `worker`
después del merge — la regex encontraba el `DISABLED` del anchor y daba
PASS igual; (2) un segundo puerto publicado (comodín o en `db`/`redis`)
tras uno loopback correcto en `server` — la regex de puertos solo miraba la
primera línea `-` tras `ports:`. Los checks cubren todos los puertos de
todos los servicios, drivers efectivos de `server` Y `worker`, red/volumen/
proyecto dedicados, y ausencia de `privileged`/socket de Docker, todo desde
el JSON ya resuelto. Sin WSL/Docker alcanzable, estos checks se reportan
`[INFO] ... not measured` (igual que el chequeo de `.dockerignore` contra
Docker real) — nunca un PASS falso por volver a una regex más débil.

### Puerto propio vs. ajeno (R4)

`local.ps1` ya no fija `43000` a ciegas: lee `AOS_CRM_WEB_PORT` de
`deploy/local/.env` (con `43000` solo como *fallback* si el archivo o la
clave no existen) y valida que `AOS_CRM_SERVER_URL` sea coherente con ese
puerto. Un *bind* TCP por sí solo no distingue "mi propio servidor ya
corriendo" de "otro proceso ocupa el puerto" (WSL2 reenvía ambos al mismo
loopback de Windows), así que `Test-OwnServerRunning` pregunta a `docker
compose -p aos-crm-local ps` si el servicio `server` de ESTE proyecto es el
que está arriba. `Start` ya no reporta `NOT ready` por su propio listener;
`Restart` valida seguridad, detiene **solo** su propio proyecto (nunca otro
producto, porque `down` ya estaba acotado por `-p aos-crm-local`), y
**vuelve a comprobar el puerto después del `down` y antes del `up`** — si
sigue ocupado (por un tercero que lo tomó mientras tanto), bloquea sin
levantar nada. Un listener verdaderamente ajeno bloquea Start/Restart desde
el principio, sin tocar `docker compose down`.

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
CRM-002-fix1.md.

**Precisión sobre qué prueba cada test (R1, corrección CRM-002-fix1):** la
prueba anterior (`merge-guard-script-direct:*`) invoca el script del hook
directamente vía `process.execPath` y stdin sintético — prueba la lógica
del script, pero **no** prueba el *wiring* de `.claude/settings.json`.
`verify-local-config.mjs` añade `merge-guard-wiring:*`: lee la entrada
`PreToolUse` real de `settings.json`, sustituye `${CLAUDE_PROJECT_DIR}`
igual que la forma exec de Claude Code
(https://code.claude.com/docs/en/hooks#exec-form-and-shell-form) y lanza
exactamente `command`/`args` tal cual están en el archivo —
`command: "node"` resuelto por `PATH`, nunca el intérprete de este propio
proceso — con igualdad estricta de código de salida (`0` exacto para
inocuo, `2` exacto para bloqueo; un `null`/ENOENT nunca se confunde con
ninguno de los dos). Un tercer check (`broken-path-visible-not-misread`)
corrompe la ruta del hook a propósito y confirma que el fallo (Node sale
con `1`, "Cannot find module") es visible y distinto de ambos códigos
esperados — `onFailure: "block"` en `settings.json` es lo que hace que
*Claude Code* trate ese fallo de arranque como bloqueo; esta prueba no
puede observar esa reacción del arnés, solo que el fallo es visible desde
fuera. **Evidencia adicional de carga real por ESTE CLI nativo:** cada
invocación Bash/PowerShell de este mismo worker durante CRM-002/CRM-002-fix1
pasó por este hook como `PreToolUse` real (está wireado en
`.claude/settings.json`, que aplica a todo el checkout) y ninguna fue
bloqueada — evidencia en vivo de que el hook carga y permite comandos
inocuos bajo el dispatcher nativo, no solo bajo subprocess de prueba.
**Límite declarado:** no se lanzó ningún `gh pr merge`/`git push origin
main` real para observar el bloqueo bajo el dispatcher nativo (prohibido
por el dispatch); no hay, por tanto, evidencia end-to-end del lado
"bloquea" dentro de Claude Code mismo — solo de los dos scripts
(`merge-guard-script-direct`/`merge-guard-wiring`) y del lado "permite" en
vivo.

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

## Seguridad de `scripts/aos/local.ps1` en Windows (R5/R6)

Dos defectos confirmados en el propio script orquestador, corregidos en
CRM-002-fix1:

- **Borrado recursivo sin contención resuelta.** El cleanup de `-SelfTest`
  hacía `Remove-Item -LiteralPath $tmpRoot -Recurse -Force` sin validar,
  justo antes de borrar, que `$tmpRoot` seguía siendo un directorio real,
  hijo directo del temporal esperado, con el prefijo esperado. Ahora
  `Remove-ContainedTempDir` re-resuelve la ruta inmediatamente antes de
  borrar y rechaza: una raíz de unidad, cualquier ruta fuera del padre
  esperado, un prefijo distinto, y **cualquier *reparse point*** (symlink o
  junction) en la propia ruta objetivo — su destino podría ser cualquier
  cosa, así que un *reparse point* se rechaza siempre, sin intentar
  resolver adónde apunta. Probado con una *junction* real apuntando fuera
  del temporal (creada sin necesitar consola de administrador) y
  confirmando que su contenido sobrevive.
- **`Test-HostReady` perdía el *quoting* por argumento.** `Start-Process
  -ArgumentList` con un array de strings, en Windows, concatena los
  elementos con un espacio sin citarlos — una ruta de repo o un nombre de
  distro con espacio/Unicode se partía en argumentos equivocados. Fix:
  `ProcessStartInfo.ArgumentList` (vía `[System.Diagnostics.Process]::Start`
  directamente, no el cmdlet `Start-Process`), que sí cita cada argumento
  por separado. `UseShellExecute=$false` + `CreateNoWindow=$true` es el
  equivalente de `-WindowStyle Hidden` para un helper en segundo plano cuyo
  stdout/stderr se redirige (`WindowStyle` solo aplica con
  `UseShellExecute=$true`, incompatible con la redirección). Sin
  `-ExecutionPolicy Bypass`. Probado con una ruta de script y un argumento
  de distro sintéticos, ambos con espacios y caracteres acentuados, sin
  duplicar el bus/checkout real.

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

Excluye `.aos`, `.codegraph-aos`, `.claude`, `.dispatch-bodies`, `.mcp.json`
(configuración de agentes existente en la raíz) y, a **cualquier
profundidad**, todo dotenv real: `**/.env` y `**/.env.*` (cubre
`.env.local`, `.env.production`, los fixtures de test
`packages/twenty-server/.env.test`/`.env.e2e-testing-server`, etc.), con
`!**/.env.example` re-incluyendo explícitamente solo los `*.env.example`
versionados y libres de secretos (los cinco que existen en el repo). Docker
no aplica un patrón simple de forma recursiva
(https://docs.docker.com/build/concepts/context/), de ahí el `**/` en ambas
líneas — la corrección R1 original solo cubría `.env` en la raíz y en dos
rutas fijas, dejando fuera cualquier `.env.*` anidado.
`deploy/local/privacy.env` sigue excluido del contexto Docker (no lo
necesita el build), pero ya no se describe como secreto: ver "Contrato de
privacidad" más abajo.

Verificado contra Docker/BuildKit real, no contra una reimplementación de
las reglas de dockerignore: `scripts/aos/verify-local-config.mjs` construye
una imagen `FROM scratch` descartable sobre un contexto sintético aislado
(fixtures dotenv en varias profundidades, nunca el repo real ni la imagen
CRM) y exporta el contexto resultante con `docker build -o <dir>` para
comprobar qué quedó realmente dentro. `.gitignore` NO lista
`deploy/local/privacy.env` (ver abajo); `deploy/local/.env` sigue cubierto
por el patrón existente `**/**/.env`, comprobado con `git check-ignore`.

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
- **`postgres:16` y `redis:7` son referencias de preparación móviles**
  (etiqueta mayor sin digest): antes de cualquier `pull`/`start` real
  (CRM-004), ese track debe resolver versión/digest concretos y registrar
  licencias de esos componentes — este track no simula ni inventa un pin;
  `compose.yaml` sigue con la etiqueta móvil a propósito porque CRM-002
  nunca hace `pull`/`up`.
- Lección del incidente `git fetch --depth` (CRM-001-HOST/CRM-002,
  recuperado por el coordinador): nunca usar `--depth` en este checkout
  para explorar ramas — rompe el contrato non-shallow del pin. Medición de
  cierre de CRM-002-fix1: `git rev-parse --is-shallow-repository` → `false`,
  `git rev-list --count 15e4826d3b5fc5867baeabeeb42b253892b2d4da` → `17313`
  (igual que la base original), ascendencia e historial completos
  conservados sin repetir el `fetch`.
