# Perfil local seguro (CRM-002)

Fecha: 27 de octubre de 2026, actualizado en CRM-002-fix1 y CRM-002-fix2 (misma fecha).
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
`.aos/reports/CRM-002-fix2.md` (y `.aos/reports/CRM-002-fix1.md`/
`.aos/reports/CRM-002.md` para las entregas previas) para comandos y
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
el JSON ya resuelto.

**Corrección CRM-002-fix2 (fail-closed por defecto):** antes de esta
corrección, si WSL/Docker no estaba alcanzable, `main()` omitía en
silencio los checks de `compose.yaml` y de `.dockerignore` contra Docker
real, y seguía reportando `PASS` sobre el resto de checks estáticos — una
ausencia total de medición Docker no fallaba el gate. Ahora el
**comportamiento por defecto (sin flags; el que usan este gate y
`local.ps1` Start/Restart) falla cerrado**: si `docker compose config`/el
build de contexto sintético no se pudieron medir, el gate termina en `FAIL`
en vez de omitir esos controles. Un modo reducido y explícito,
`node scripts/aos/verify-local-config.mjs --static`, sigue existiendo para
cuando de verdad solo se necesita el subconjunto estático (reporta
`[INFO] ... not measured`, sin contarlo como fallo) — pero **ni este
comando del gate (`.aos/verify.json`) ni `local.ps1` Start/Restart pasan
nunca `--static`**, así que un Docker/WSL caído bloquea esos dos caminos en
vez de dejarlos pasar con menos controles de los que creen tener.

### Puerto propio vs. ajeno (R4, corrección CRM-002-fix2)

`local.ps1` ya no fija `43000` a ciegas: lee `AOS_CRM_WEB_PORT` de
`deploy/local/.env` (con `43000` solo como *fallback* si el archivo o la
clave no existen) y valida que `AOS_CRM_SERVER_URL` sea coherente con ese
puerto. Un *bind* TCP por sí solo no distingue "mi propio servidor ya
corriendo" de "otro proceso ocupa el puerto" (WSL2 reenvía ambos al mismo
loopback de Windows), así que `Test-OwnServerRunning` pregunta a `docker
compose -p aos-crm-local ps` si el servicio `server` de ESTE proyecto es el
que está arriba. **Corrección fix2:** comprobar solo `Service == 'server'`
no demuestra que ese servidor posea el puerto configurado — si
`AOS_CRM_WEB_PORT` cambia (ej. de `43000` a `43001`) mientras el contenedor
`server` viejo sigue arriba en `43000`, el chequeo anterior lo clasificaba
como `OwnedBySelf` y dejaba que `Start`/`Restart` siguieran de largo sin ver
que el `43001` real lo ocupa un proceso ajeno. `Test-ServerOwnsPublishedPort`
(función pura, con fixtures de JSON) ahora lee el array `Publishers` de la
entrada `server` en `docker compose ps --format json` y exige que
`URL == 127.0.0.1` **y** `PublishedPort == <puerto configurado>` — no solo
el nombre del servicio. Un puerto `AOS_CRM_WEB_PORT` explícito pero
inválido (no numérico o fuera de 1-65535) también deja de caer en silencio
al *fallback* `43000`: `Get-ConfiguredWebPort` ahora devuelve
`{Port, Valid}` y el gate bloquea con `Valid=false` en vez de arrancar
sobre el puerto equivocado sin avisar.

`Start` ya no reporta `NOT ready` por su propio listener; `Restart` valida
seguridad, detiene **solo** su propio proyecto (nunca otro producto, porque
`down` ya estaba acotado por `-p aos-crm-local`), y **vuelve a comprobar el
puerto después del `down` y antes del `up`** — si sigue ocupado (por un
tercero que lo tomó mientras tanto), bloquea sin levantar nada. Un listener
verdaderamente ajeno bloquea Start/Restart desde el principio, sin tocar
`docker compose down`. **Corrección fix2:** `Invoke-RestartAction` no
observaba el código de salida real de `down` — con `down` fallando (ej.
exit 7) y el puerto ya libre por otra razón, el flujo anterior igual
llegaba a `up` y devolvía éxito (`exit 0`), ocultando el fallo real
(reproducido de forma independiente por el coordinador en
`restart-down-failure-observation.json`: `down` exit 7 + puerto libre →
`upCalls=1`, `finalExitCode=0`). Ahora `Invoke-RestartAction` lee el código
real de `down` antes de probar el puerto: si no es `0`, bloquea con
`Stage=blocked-down-failed` y **preserva ese código de salida original**
sin llegar nunca a `up`.

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
fuera. **Evidencia de carga real por ESTE CLI nativo, lado "permite" (CRM-002/fix1)
y lado "bloquea" (CRM-002-fix2):** cada invocación Bash/PowerShell de este
worker durante CRM-002/CRM-002-fix1 pasó por este hook como `PreToolUse`
real (wireado en `.claude/settings.json`, que aplica a todo el checkout) y
ninguna fue bloqueada. **Corrección fix2 sobre esa afirmación:** el éxito de
herramientas inocuas, por sí solo, NO demuestra que el dispatcher real
invocara el hook — una llamada que nunca pasa por `PreToolUse` también
"tendría éxito" sin bloquear nada, así que esa evidencia anterior probaba
como máximo que el hook no bloqueaba de más, no que estuviera cargado. La
prueba real que faltaba (lado "bloquea", bajo el dispatcher nativo, sin
ejecutar ningún `gh`/`git` real) se hizo en CRM-002-fix2: una llamada Bash
de este worker con el comando `echo "gh pr merge 999
literal-test-only-not-executed"` y una llamada PowerShell con
`Write-Output "git push origin main literal-test-only-not-executed"` — en
ambos casos el ÚNICO efecto posible, si el hook no cargara, sería imprimir
ese texto literal (nunca invocar `gh`/`git` de verdad). El dispatcher nativo
devolvió, para ambas, un error de hook antes de ejecutar nada:
`PreToolUse:Bash hook error: […aos-merge-guard.cjs]: [AOS-MERGE-GUARD]
BLOQUEADO: …` y el equivalente para `PreToolUse:PowerShell` — ningún texto
llegó a imprimirse. Esto es evidencia end-to-end real, bajo el dispatcher de
Claude Code (no un subprocess de prueba), de que `PreToolUse` carga el hook
y bloquea antes de ejecutar, para ambas shells que cubre el `matcher`.
**Límite que sigue en pie:** esta prueba usó una cadena que calza el patrón
del guard (`gh pr merge`, `git push … main`) dentro de un `echo`/
`Write-Output` inocuo — no se lanzó ningún `gh pr merge`/`git push origin
main` real (seguiría prohibido por el dispatch), y el guard sigue sin
cubrir una tercera vía de merge (otra shell, `curl` directo a la API de
GitHub, un comando construido para evadir el patrón).

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

### Borrados recursivos contenidos, cierre de huecos restantes (CRM-002-fix2)

El fix de `Remove-ContainedTempDir` de arriba cerró el borrado final de
`-SelfTest`, pero dejó sin contención el cleanup de SUS PROPIAS pruebas:
`$outside` y `$junctionTargetOutside` (los directorios creados fuera de
`$tmpRoot` a propósito, para probar que la función los rechaza) se borraban
con `Remove-Item -Recurse -Force` crudo en el `finally`/`catch` de esas
mismas pruebas. Ahora usan el mismo `Remove-ContainedTempDir`, con
`-ExpectedParent $tmpParent` y el prefijo real de cada directorio — sin
excepción para código de test.

Del lado Node, `scripts/aos/verify-local-config.mjs` tenía el mismo patrón
sin contención: `rmSync(winCtx, { recursive: true, force: true })` en
`checkDockerignoreViaRealDocker`, y `rmSync(dir, …)` sobre los repos git
temporales de `checkGitIgnoresRealEnvNotPrivacyProfile` en el self-test.
Además, la salida exportada del build `FROM scratch` (`outDir`) vivía en
una ruta puramente Linux (`${linuxCtx}-out`) y se borraba con
`wsl.exe … rm -rf outDir` — un borrado que cruza de Windows a Linux para
borrar, fuera del alcance de cualquier guarda de Node. Fix: un nuevo
`assertContainedTempDirSafeToRemove`/`removeContainedTempDir` (mismo
contrato que `Remove-ContainedTempDir` de `local.ps1`: re-resuelve la ruta
inmediatamente antes de borrar, exige directorio real, hijo directo del
padre esperado, con el prefijo esperado, y rechaza un symlink en la propia
ruta objetivo) — inspirado en, pero no copiado de, el
`assertSafeToRemove` de `verify-provenance.mjs` (ese es solo un guard de
contención por ancestro, sin exigir hijo-directo/prefijo/symlink; no se
tocó ese archivo). El contexto de build (`ctx`) y su salida exportada
(`out`) pasan a vivir como hijos del MISMO directorio temporal propio de
Node (`mkdtempSync`), así que un solo `removeContainedTempDir` al final
limpia ambos — incluida cualquier salida parcial de un build fallido,
porque sigue dentro del mismo temporal — sin ningún `rm -rf` de WSL
cruzando de vuelta a Windows.

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

Excluye, a **cualquier profundidad** (`**/`), `.aos`, `.codegraph-aos`,
`.claude`, `.dispatch-bodies`, `.git` y `.mcp.json` (bus/configuración de
agentes/Git/grafo) y todo dotenv real: `**/.env` y `**/.env.*` (cubre
`.env.local`, `.env.production`, los fixtures de test
`packages/twenty-server/.env.test`/`.env.e2e-testing-server`, etc.), con
`!**/.env.example` re-incluyendo explícitamente solo los `*.env.example`
versionados y libres de secretos (los cinco que existen en el repo). Docker
no aplica un patrón simple de forma recursiva
(https://docs.docker.com/build/concepts/context/), de ahí el `**/` en cada
línea.

**Corrección CRM-002-fix2:** hasta esta corrección, `.git`, `.aos`,
`.codegraph-aos`, `.claude`, `.dispatch-bodies` y `.mcp.json` estaban
escritos SIN `**/` (solo raíz). El review independiente final de fix1
confirmó el hueco real: `packages/twenty-agent-skills/.mcp.json` (existente
en el repo) no quedaba excluido porque el patrón raíz-only `.mcp.json` no
cubre esa ruta anidada. Las seis líneas pasan ahora a `**/`, y
`checkDockerignoreExcludesAosState` en `verify-local-config.mjs` exige esa
forma `**/` literal (un patrón raíz-only vuelve a fallar el check, con un
negativo exacto para ese caso). El build de contexto sintético
(`checkDockerignoreViaRealDocker`) añade fixtures anidadas reales —
`packages/twenty-agent-skills/.mcp.json`, `nested/sub/.claude/…`,
`nested/sub/.aos/…`, `nested/sub/.codegraph-aos/…`,
`vendor/thirdparty/.git/HEAD` — y preserva fixtures de ejemplo/licencia/
assets (`LICENSE`, `packages/twenty-agent-skills/skill.json`,
`nested/deeper/dir/asset.txt`) para confirmar que las nuevas exclusiones
`**/` no se llevan contenido legítimo por delante. Medido en vivo contra
Docker/BuildKit real sobre `AOS-CRM-Ubuntu-24.04`: 14 fixtures excluidas
(incluida la anidada `packages/twenty-agent-skills/.mcp.json`), 6
ejemplos/licencia/assets conservados, `wronglyKept=[]`/`wronglyExcluded=[]`.
`deploy/local/privacy.env` sigue excluido del contexto Docker (no lo
necesita el build), pero ya no se describe como secreto: ver "Contrato de
privacidad" más abajo.

Verificado contra Docker/BuildKit real, no contra una reimplementación de
las reglas de dockerignore: `scripts/aos/verify-local-config.mjs` construye
una imagen `FROM scratch` descartable sobre un contexto sintético aislado
(fixtures dotenv/agente/bus/Git/grafo en varias profundidades, nunca el
repo real ni la imagen CRM) y exporta el contexto resultante con
`docker build -o <dir>` para comprobar qué quedó realmente dentro —
contexto y salida exportada viven bajo un único directorio temporal propio
de Node (`mkdtempSync`), limpiado por Node tras validar destino/padre/
prefijo (ver "Borrados recursivos contenidos" más abajo), nunca con un `rm
-rf` de WSL cruzando de vuelta a borrar algo en el lado Windows. `.gitignore`
NO lista `deploy/local/privacy.env` (ver abajo); `deploy/local/.env` sigue
cubierto por el patrón existente `**/**/.env`, comprobado con
`git check-ignore`.

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
