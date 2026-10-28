# Entorno local: estado real y preparación propuesta

Fecha: 27 de octubre de 2026. **No es todavía un procedimiento de instalación validado. El CRM no está arrancado.**

**Actualización CRM-001-HOST (misma fecha):** los dos scripts reales
(`scripts/aos/preflight-host.ps1`, `scripts/aos/install-host-wsl.ps1`) y su estado medido —
no propuesto— están en [HOST_RUNTIME.md](HOST_RUNTIME.md). Esta sección queda como la radiografía
original; no se reescribe aquí.

**Actualización fix2 (27 de octubre de 2026):** el founder autorizó instalar Linux; tras el
reinicio de Windows y la instalación de Docker por el coordinador, `scripts/aos/preflight-host.ps1`
mide `"status": "ready"` (exit 0) contra `AOS-CRM-Ubuntu-24.04` ahora mismo. El runtime de host
(WSL2 + Docker Engine) ya no es el prerrequisito pendiente; detalle en
[HOST_RUNTIME.md § CRM-001-HOST-fix2](HOST_RUNTIME.md#crm-001-host-fix2-cierre-con-linux-real-tras-reinicio).
El CRM en sí (build, migraciones, servidor/worker) sigue sin arrancar.

## Comprobaciones realizadas

| Elemento | Resultado |
| --- | --- |
| Sistema | Windows; checkout en `C:\Users\Andrés\Documents\AOS-CRM` |
| Memoria física | Aproximadamente 23,4 GiB |
| Disco C | Aproximadamente 588 GiB libres al inicio de inspección |
| Git | Disponible; repositorio con historia de Twenty, rama `codex/bootstrap-inspection` |
| Node host | 24.16.0; no se ejecutó código del CRM con él |
| Yarn | No encontrado en PATH; el repositorio trae Yarn 4.18.1, todavía no ejecutado |
| Docker | No encontrado en PATH; falta runtime de contenedores comprobado |
| WSL | `wsl --list --verbose` informa que el subsistema no está instalado |
| Build / tests / servicios | No ejecutados; tampoco hay migraciones o administrador creados |

La guía oficial soporta Linux/macOS y Windows mediante WSL. Esta máquina todavía no reúne ese prerrequisito. La instalación del subsistema puede requerir consola elevada y reinicio, que no se realizaron durante la inspección. [Guía de Twenty](https://docs.twenty.com/developers/contribute/capabilities/local-setup).

## Estrategia propuesta, pendiente de contrato AOS

Preparar WSL2 y un motor de contenedores compatible con los permisos del equipo. Conservar el checkout y el único bus existente; no crear otro proyecto/bus para instalar. Verificar acceso al mismo árbol desde Linux antes de despachar workers. Si el rendimiento en el volumen Windows fuera un bloqueo, escalar cualquier cambio de topología al founder.

Construir una imagen propia desde `packages/twenty-docker/twenty/Dockerfile` y esta referencia fija. Mantener servidor y worker como procesos separados, PostgreSQL/Redis en red exclusiva y volúmenes persistentes. No hace falta arrancar website, Companion, Storybook, ClickHouse o apps comerciales para el CRUD inicial; cualquier dependencia adicional se debe justificar con un fallo observado.

Antes de construir: excluir `.aos/`, agentes, grafo y secretos del contexto Docker; completar triage de dependencias y controlar scripts de instalación. Antes de arrancar: fijar privacidad, ambos drivers de código a `DISABLED`, secretos aleatorios y entorno real ignorado. No copiar ejemplos/demos como credenciales operativas.

Elegir puertos libres con preflight. Candidatos para revisar: 127.0.0.1:43000 para servidor y frontend compilado; DB/Redis solo red de contenedores, o 127.0.0.1:45432 y 127.0.0.1:46379 cuando haga falta acceso host. **No se han reservado ni comprobado estos puertos; no son direcciones de una aplicación activa.**

Crear el primer usuario en una instancia vacía y bajo acceso local controlado, con password seguro. Mantener `IS_MULTIWORKSPACE_ENABLED=false` y comprobar que no se pueden abrir workspaces nuevos tras el alta; verificar también invitaciones y cualquier registro de usuarios sin workspace. No usar las cuentas demo del seeder como administrador final.

## Verificación que falta

El gate deberá contener comandos reales ejecutados sobre Linux: construcción de shared/server/front, typechecks directos sin caché engañosa, tests enfocados de privacidad/configuración y smoke HTTP. Después: migraciones sobre DB exclusiva, arranque de worker, navegador, login, CRUD, relaciones y persistencia tras reinicio. Captura de tráfico desde el primer arranque en servidor/worker/browser.

`.aos/verify.json` ya no está vacío: trae los dos comandos de procedencia de CRM-001 más el preflight
de host de CRM-001-HOST y los `-SelfTest` aislados de sus dos scripts (detalle en
[HOST_RUNTIME.md](HOST_RUNTIME.md)). Ninguno de estos comandos es el gate de aplicación completo — no
construye, no arranca servidor/worker/DB/Redis, no corre typecheck/tests de la app. Los comandos de
arranque/parada/reinicio y las credenciales solo se documentarán como operativos después de
ejecutarlos y verificar sus efectos.

## Actualización CRM-004 (27 de octubre de 2026): lo medido y lo que sigue bloqueado

**El CRM sigue sin arrancar, y esta vez por una causa concreta y reproducida**, no por
falta de intento. El detalle completo, con tiempos, memoria y códigos de salida, está en
[BUILD_BASELINE.md](BUILD_BASELINE.md).

Lo que ya es real:

- Las dependencias se instalan de verdad con la configuración Yarn revisada, dentro de la
  etapa `server-deps` del Dockerfile oficial. Ningún build script se ejecutó.
- `postgres` y `redis` están fijados a **digest inmutable** en
  `deploy/local/compose.yaml`, descargados y con su versión comprobada dentro del
  contenedor (PostgreSQL 16.15, Redis 7.4.12). `verify-local-config.mjs` ahora **rechaza**
  cualquier servicio que se descargue por etiqueta sin digest, así que el pin no puede
  perderse en silencio.
- `deploy/local/.env` se genera con `local.ps1 -Action Prepare`, con secretos
  cripto-aleatorios, y está ignorado por Git (comprobado con `git check-ignore`). Sus
  valores no se leen ni se imprimen en ningún punto de este track.
- Los dos tests de privacidad que CRM-003 dejó preparados **ya se ejecutan**, contra las
  clases reales, y están en el gate (`scripts/aos/verify-server-specs.mjs`).

Lo que **no** está hecho y no debe darse por hecho:

- No hay imagen de aplicación: `twenty-server-build` falla en `lingui:extract` por un
  timeout de 10 s de `threads@1.7.0`. Se reprodujo también sobre el árbol pinneado puro,
  así que es un fallo de línea base. El arreglo verificado es una variable de entorno
  (`THREADS_WORKER_INIT_TIMEOUT`) en el Dockerfile, fichero fuera del Scope de CRM-004:
  **escalado, no modificado**.
- Sin imagen no hay arranque, migraciones, worker, primer administrador, datos sintéticos,
  prueba de stop/start/restart ni camino E2E. Nada de eso está medido y nada de eso se
  declara en el gate.
- La prueba negativa de body-parser (petición comprimida inválida que no debe derribar el
  backend) sigue pendiente por el mismo motivo.

### Puertos y URL efectiva

El perfil por defecto publica `127.0.0.1:43000` y escribe un `AOS_CRM_SERVER_URL` que
coincide. Antes, un puerto personalizado **sin** `AOS_CRM_SERVER_URL` pasaba el gate: la
comprobación trataba una URL vacía como "nada que contradecir", mientras Compose sustituye
un literal fijo. La aplicación habría construido sus enlaces sobre el puerto equivocado.
Ahora `local.ps1` lee el valor por defecto directamente de `compose.yaml` y compara la
**URL efectiva**; si ese valor por defecto no se puede leer, bloquea en vez de pasar.

## Actualización CRM-004-fix1 (28 de octubre de 2026): el CRM arranca

Lo de arriba (§ CRM-004) describe el estado **anterior** y se conserva como registro. Lo
que sigue lo sustituye: el coordinador amplió el Scope a una variable del Dockerfile
oficial, se aplicó, y la aplicación se construye y arranca. Tiempos, códigos de salida y
memoria están en [BUILD_BASELINE.md](BUILD_BASELINE.md); el informe del track es
[.aos/reports/CRM-004-fix1.md](../../../.aos/reports/CRM-004-fix1.md).

### Procedimiento (validado, no propuesto)

```
pwsh -NoProfile -File scripts/aos/local.ps1 -Action Prepare   # una vez: genera deploy/local/.env
pwsh -NoProfile -File scripts/aos/local.ps1 -Action Start     # gate + build + up -d
pwsh -NoProfile -File scripts/aos/local.ps1 -Action Status
pwsh -NoProfile -File scripts/aos/local.ps1 -Action Stop
pwsh -NoProfile -File scripts/aos/local.ps1 -Action Restart
```

`Start` y `Restart` siguen siendo fail-closed: host, configuración local, privacidad,
secretos y coherencia puerto/URL se miden **antes** de cualquier `build`/`up`. Lo nuevo:

- **La distro no se apaga debajo del stack.** WSL2 termina una distro cuando sale su último
  proceso, y los servicios systemd de dentro **no** la mantienen viva
  ([documentación de Microsoft](https://learn.microsoft.com/en-us/windows/wsl/systemd)). Por
  eso `docker compose up -d` devolviendo no equivale a un stack que sobreviva: en cuanto
  salen todas las llamadas `wsl.exe` y pasa la ventana de inactividad, se van la distro, el
  demonio y los contenedores. `Start`/`Restart` abren una **sesión oculta propia** (un
  `tail -f` sobre un marcador de este producto) antes del `up`; `Stop` la libera, y solo si
  el `compose down` salió 0 — soltarla con contenedores vivos sería apagarlos por la
  puerta de atrás. Se identifica por su propia línea de comandos: nunca toca otra distro,
  otro producto ni la configuración global de WSL. `Status` dice si está o no.
- **La imagen queda trazable a su fuente.** `Start`/`Restart` estampan el commit de AOS, su
  árbol y si el working tree estaba sucio en `deploy/local/.env`
  (`AOS_CRM_SOURCE_COMMIT`/`_TREE`/`_DIRTY`), y `compose.yaml` los convierte en etiquetas
  de la imagen. Si no se puede registrar la procedencia, **no se construye**.
  `scripts/aos/verify-image-provenance.mjs` rechaza una imagen cuyas etiquetas no
  correspondan a ESTE commit, una construida con cambios sin commitear, o una imagen de
  dependencias disfrazada con la etiqueta de la aplicación (comprueba dentro de la imagen
  que el frontend servido existe).

### Primer administrador

Se crea una sola vez, por el flujo real de autenticación (`signUp` →
`signUpInNewWorkspace` → `getAuthTokensFromLoginToken`), con una contraseña de 36 bytes
aleatorios criptográficos. Queda en `deploy/local/.env` (ignorado por Git), **nunca se
imprime** y ninguna herramienta la devuelve: los scripts solo informan de booleanos y
categorías. Con `IS_MULTIWORKSPACE_ENABLED=false` y el workspace ya creado, un segundo alta
pública queda **rechazada por el servidor**, y eso se comprueba ejecutando el alta, no
leyendo la variable de entorno (`getSignUpWithoutWorkspaceDecision` devuelve `refused`
cuando ya existe un workspace y el multiworkspace está apagado).

Por el mismo motivo, `EMAIL_DRIVER=LOGGER` escribe el correo completo (HTML y texto) en el
log del servidor: cualquier invitación o reset deja su enlace en los logs técnicos. No se
disparó ninguna invitación en este track y los logs no se copian a ningún artefacto.

### Puerto y URL efectiva, ahora medidos en ejecución

Además del chequeo estático, el camino E2E lee `GET /client-config` del servidor arrancado
y comprueba que el `serverUrl` **efectivo** que la aplicación entrega al frontend usa el
puerto publicado, y que `analyticsEnabled` es `false` y el DSN de Sentry está vacío en
ejecución, no solo en `privacy.env`.

### Captura de destinos, lista antes del primer arranque

`.aos/onboarding/bootstrap-2026-10-27/capture-crm-egress.py` registra solo **a dónde** van
los paquetes: `tcpdump -nn -tttt -q`, nunca `-A`, `-X` ni `-w`, sin payload, sin cabeceras
y sin fichero pcap. Filtra destinos no privados más DNS, espera el aviso explícito de
readiness con deadline y marca las horas en UTC. Se validó ejecutándolo con el CRM
apagado: 0 destinos remotos en 20 s, que es la línea base previa al arranque, no una
prueba de que el CRM no hable con nadie.
