# Línea base de build (CRM-004, fix1 a fix5)

> **CRM-004-fix1, 28 de octubre de 2026 — el bloqueo está resuelto.** El coordinador amplió
> el Scope (spec canónico y registro) a **una** variable del Dockerfile oficial y se aplicó:
> `THREADS_WORKER_INIT_TIMEOUT=180000` en el bloque `ENV` que ya existía en `node-base`,
> junto al opt-out de telemetría. Con eso, `lingui:extract`/`compile` de `twenty-server` y
> `twenty-emails`, `nx run twenty-server:build`, el frontend y la imagen final `twenty` se
> construyen de verdad. Las medidas nuevas están al final, en
> [§ CRM-004-fix1](#crm-004-fix1-el-build-completo-medido). Todo lo que sigue hasta esa
> sección es el registro **anterior** y se conserva tal cual, incluida la línea base del
> fallo, porque es la prueba de que no lo provocó ningún cambio de AOS.


27 de octubre de 2026. Todo lo que sigue se ejecutó de verdad en la distro dedicada
`AOS-CRM-Ubuntu-24.04` sobre este mismo checkout. Los registros completos están en
`.aos/onboarding/bootstrap-2026-10-27/` (no versionado).

## Entorno medido

| Dato | Valor observado |
| --- | --- |
| Docker Engine | 29.9.2 |
| CPUs visibles en la distro | 4 |
| Memoria total de la distro | 11,4 GiB |
| Espacio libre en `/var/lib/docker` | 954 GB |
| Node del host (resolución de yarn.lock) | v24.16.0 |
| Node dentro de la imagen | v24.22.1 (pin del Dockerfile) |

El checkout vive en `/mnt/c`, así que el contexto de build cruza drvfs: **197,67 MB
transferidos en 506 s**. Las exclusiones de `.dockerignore` son las que lo hacen viable:
`.codegraph-aos` solo (2,1 GB) y `.git` (444 MB) superan al contexto real enviado.

Memoria durante los builds, muestreada cada 15 s desde dentro de la distro: pico de
**4.066 MB usados / 7.583 MB disponibles** con BuildKit paralelizando etapas, y **1.420 MB
usados** con las etapas encadenadas de una en una. En ningún momento hubo presión de
memoria.

## Lo que sí se construyó

| Etapa | Resultado | Tiempo |
| --- | --- | --- |
| `server-deps` con el lockfile pinneado (línea base) | exit 0, imagen de 450 MB | 312 s (yarn install: 4 m 56 s) |
| `server-deps` con el lockfile parcheado (body-parser) | exit 0 | 6 m 44 s |
| `twenty-shared` / `twenty-client-sdk` / `twenty-emails` build | exit 0 | — |
| `twenty-server-build` | **exit 1**, ver abajo | 6 m 10 s hasta el fallo |

`enableScripts: false` se respetó de verdad: la instalación reportó 10 paquetes que
declaran build scripts (`bcrypt`, `cpu-features`, `esbuild`, `msgpackr-extract`, `msw`,
`nx`, `protobufjs`, `ssh2`, `unrs-resolver`) y **ninguno se ejecutó**. No se habilitó
ningún script binario: no hizo falta ninguno para llegar hasta donde se llegó.

Las imágenes de infraestructura se fijaron a digest inmutable antes de descargarlas y se
comprobó la versión real **dentro del contenedor**, no en la etiqueta:

| Imagen | Digest del índice | Versión real observada |
| --- | --- | --- |
| `postgres:16.15` | `sha256:9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97` | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) |
| `redis:7.4.12` | `sha256:bd28fff4b665fdf1b73e8b5b73ec05d2f858f4fa3c8ea0d7c9bc09f7f6bf7039` | Redis 7.4.12 |

Ambos digests se resolvieron de nuevo en esta sesión y coinciden con los que registró
`.aos/reports/runtime-image-metadata.md`; `postgres:16` y `postgres:16.15` apuntan al
mismo índice, igual que `redis:7` y `redis:7.4.12`.

## El build se detiene en `twenty-server-build`, y es un fallo preexistente

```
RUN npx nx run twenty-server:lingui:extract && ...
Error: Timeout: Did not receive an init message from worker after 10000ms.
    at /app/node_modules/threads/dist/master/spawn.js:35
```

**Causa.** `@lingui/cli@5.9.5` depende de `threads@1.7.0`. `threads` da a cada worker del
pool 10 s para enviar su mensaje de init. `lingui extract` crea el pool y a continuación
recorre el árbol de fuentes de `twenty-server` encolando **10.952 tareas**, una por
fichero, bloqueando el hilo principal unos 30 s. Con 4 CPUs, parte de los workers
inicializan a tiempo y al menos uno no: su promesa rechazada sube como
`unhandledRejection` y tumba el proceso. No es memoria (pico de 1,4 GB con 10 GB libres)
ni concurrencia de BuildKit.

**Es de la línea base, no de este track.** Se midió en vez de suponerlo:

| Árbol construido | Resultado |
| --- | --- |
| Working tree, build de compose en paralelo | exit 1, mismo error |
| Working tree, etapas encadenadas | exit 1, mismo error |
| Working tree, reintento | exit 1, mismo error |
| **`git archive` del commit pinneado `15e4826d3b` (sin cambio alguno de AOS, body-parser 2.3.0)** | **exit 1, mismo error** |

El árbol pinneado puro falla igual, así que ni el ajuste de lockfile de body-parser ni
nada de CRM-001..004 lo provocan. Respecto a upstream, `packages/` solo difiere en tres
ficheros: el bloque `ENV` de telemetría del Dockerfile (CRM-002) y los dos specs de
privacidad (CRM-003); ninguno toca lingui.

**Hipótesis comprobada, no solo enunciada.** `threads@1.7.0` lee
`THREADS_WORKER_INIT_TIMEOUT`. En un contenedor desechable (sin tocar el checkout) se
subió ese valor a 180000 y se relanzó el comando exacto que falla:

```
EXTRACT_WITH_RAISED_TIMEOUT_EXIT=0 after 94s
catálogos producidos: 35
```

El arreglo es una línea `ENV THREADS_WORKER_INIT_TIMEOUT=...` en la etapa `node-base` de
`packages/twenty-docker/twenty/Dockerfile`, justo donde ya vive el bloque de opt-out de
telemetría. **Ese fichero está fuera del Scope de CRM-004, así que queda escalado al
coordinador y no se ha modificado.** Sin esa decisión no hay imagen de aplicación y, por
tanto, no hay arranque, migraciones, primer administrador ni camino E2E.

## Lo que quedó sin medir

- Arranque real de servidor/worker, migraciones, persistencia y reinicio: bloqueado por lo
  anterior.
- `typecheck` completo de `twenty-server`: el árbol de `server-deps` está enfocado al
  runtime de producción (`yarn workspaces focus twenty-monorepo twenty-server
  twenty-emails twenty-shared twenty-client-sdk`), así que `tsgo` falla por dependencias
  ausentes de ese enfoque (`@types/semver`, `twenty-sdk`, `twenty-oxlint-rules`,
  `graphql-sse`), no por errores de tipos del código. Medir typecheck de verdad exige una
  instalación completa del monorepo.
- Frontend (`twenty-front-build`) y la imagen final `twenty`: no se alcanzaron.

## Lo que sí quedó cubierto sin la imagen

Los dos specs de privacidad que CRM-003 dejó preparados y nunca pudo ejecutar **ya se
ejecutaron de verdad** contra las clases reales, usando el árbol de dependencias de
`server-deps`:

```
Test Suites: 2 passed, 2 total
Tests:       4 passed, 4 total
```

Son `telemetry.service.spec.ts` (spy HTTP sobre la clase real) y
`twenty-config.service.spec.ts` (precedencia ENV-vs-BD). Esto cierra la cobertura que
`.aos/verify.json` declaraba pendiente desde CRM-003.

## CRM-004-fix1: el build completo, medido

28 de octubre de 2026, misma distro `AOS-CRM-Ubuntu-24.04` y mismo checkout. El cambio
autorizado es exactamente este, en la etapa `node-base` del Dockerfile oficial:

```
ENV YARN_ENABLE_TELEMETRY=0 \
    NX_NO_CLOUD=true \
    NX_DAEMON=false \
    THREADS_WORKER_INIT_TIMEOUT=180000
```

Ensancha el presupuesto de init que `threads@1.7.0` da a cada worker de su pool. **No omite
ninguna etapa de traducción**: los cuatro `lingui` siguen ejecutándose y el build de
`twenty-server` también. Al ir en `node-base` invalida la caché de las etapas de
dependencias, así que `server-deps` se reinstaló por completo.

### Etapa a etapa (log `fix1/A1-twenty-server-build-coordinator-launched.log`)

| Paso | Qué hace | Resultado |
| --- | --- | --- |
| `#16` | `yarn workspaces focus` de `server-deps` (reinstalación completa) | DONE 352,9 s |
| `#17`–`#20` | COPY de los cuatro workspaces del servidor | DONE 7,8 / 2,3 / 0,5 / 19,0 s |
| `#21` | **los cuatro `lingui` (extract+compile de server y emails)** | **DONE 458,0 s** |
| `#22` | `nx run twenty-server:build` | DONE 86,5 s |
| `#23` | limpieza de `.d.ts` y tests compilados | DONE 3,5 s |
| `#24` | `yarn workspaces focus --production` | DONE 77,4 s |
| `#25` | exportar imagen (incluye 150,4 s de unpacking) | DONE 350,6 s |

Cero líneas `ERROR` en el log y los 25 pasos en `DONE`. El paso `#21` es el que fallaba a
los ~10 s en cada intento anterior.

**La política de scripts se respetó de verdad**, otra vez medido y no supuesto: 12 avisos
`YN0004` sobre 11 paquetes distintos (`@sentry/node-cpu-profiler`, `@swc/core`, `bcrypt`,
`cpu-features`, `esbuild`, `msgpackr-extract`, `msw`, `nx`, `protobufjs`, `ssh2`,
`unrs-resolver`) con el texto literal "lists build scripts, but all build scripts have been
disabled". No se habilitó ningún script, ni global ni individual.

### La imagen de aplicación completa

Un solo comando, secuenciado y con su serie de memoria propia
(`fix1/A2-twenty.log`, `fix1/ram-A2-twenty.log`):

| Dato | Valor medido |
| --- | --- |
| Comando | `docker build --progress=plain --target twenty -f packages/twenty-docker/twenty/Dockerfile -t aos-crm-local/twenty:fix1-build .` |
| Código de salida | **0** |
| Duración | **2.220 s** (37 min) |
| Memoria, 103 muestras cada 20 s | pico **6.821 MB usados**, mínimo **4.829 MB disponibles** |
| `twenty-front:lingui:extract/compile` + `nx build twenty-front` | DONE 243,2 s |
| Exportar la imagen final (incluye 45,6 s de unpacking) | DONE 125,5 s |
| Tamaño de la imagen | 1,65 GB |

Nunca hubo presión de memoria: el mínimo disponible fue 4,8 GB de 11,4 GB.

El contexto de build es el coste dominante y no desaparece con la caché: el checkout vive
en `/mnt/c`, así que BuildKit vuelve a recorrer el árbol en cada invocación
(~100 MB y entre 9 y 11 minutos, incluso cuando el único cambio es una etiqueta). En fix1
eso se usó como razón para que **construir no fuera un comando del gate**: su resultado se
registraba aquí y `verify-image-provenance.mjs` comprobaba en cada corrida que el artefacto
correspondía a este commit.

> **Corregido en fix2.** Esa decisión ya no es la vigente: R3 exige un build real dentro
> del gate y una inspección de etiquetas no es un build. Hoy `.aos/verify.json` incluye
> `node scripts/aos/verify-image-build.mjs`, que construye el target oficial `twenty`.
> Ver [§ CRM-004-fix2 y fix3](#crm-004-fix2-y-fix3-lo-corregido-y-lo-medido-después).

La imagen que usa el perfil local la construye Compose por el camino real
(`local.ps1 -Action Start` → `docker compose up --build -d`), con las etiquetas de
procedencia de AOS. La referencia era `aos-crm-local/twenty:v2.51.0-15e4826d3b`, **que es
la que fix2 dejó de usar**: cada commit de AOS sobre el mismo pin produce bytes distintos y
esa etiqueta se sobrescribía. Hoy la referencia lleva también el commit de AOS
(`...-aos<12 hex>`); ver la sección de fix2/fix3.

### Typecheck real de `twenty-server`

Medir `tsgo` exige el entorno correcto, y aquí hubo dos pasos en falso que vale la pena
dejar escritos:

1. En el árbol de `server-deps` (enfocado al runtime y podado con `--production`), `tsgo`
   devolvía 14 errores de módulos ausentes. No es rojo ni verde: el entorno no era el que
   la medida supone.
2. En el **cierre de dependencias declarado de `twenty-server`** (devDependencies incluidas,
   sin poda) siguen apareciendo **13 errores**, 11 de ellos
   `TS7016: Could not find a declaration file for module 'semver'`, más
   `graphql-sse` y `twenty-sdk/front-component-renderer/build`. Tampoco es el entorno
   correcto: `@types/semver@^7.5.8` y `graphql-sse@^2.5.4` **están en el lockfile**,
   declarados por `twenty-cli`, `twenty-front` y `twenty-sdk`, y una instalación de todo el
   monorepo los eleva a `node_modules` de la raíz, que es donde `twenty-server` los
   resuelve. Son una propiedad del alcance de la instalación, no del código.

Por eso `scripts/aos/typecheck.Dockerfile` instala **el monorepo completo**
(`yarn install --immutable`, todos los manifiestos de workspace en el contexto), que es como
lo typechequea upstream, y `verify-server-typecheck.mjs` corre `tsgo -p tsconfig.json`
directo —nunca `nx typecheck`, que podría imprimir un verde desde la caché— y además exige
que un fichero canario deliberadamente mal tipado **aparezca** entre los errores de una
segunda pasada. Un `tsgo` que sale 0 sobre el código y sobre el canario no midió nada.

> **Corregido en fix2: ese typecheck no estaba limpio.** Lo de arriba omite que fix1 dejaba
> una concesión: permitía el `TS2307` de
> `scripts/build-seed-front-components.ts` sobre `twenty-sdk/front-component-renderer/build`
> porque el entorno no construía el SDK. No era un error intrínseco del código, era un
> artefacto de dependencia ausente —el propio target `twenty-server:typecheck` de upstream
> depende de `^build`— y llamar "limpia" a esa corrida fue incorrecto. Ver la sección
> siguiente.

## CRM-004-fix2 y fix3: lo corregido y lo medido después

28 de octubre de 2026, misma distro y mismo checkout. Esta sección **corrige** afirmaciones
de las anteriores; lo anterior se conserva como registro, no como estado vigente.

### Lo que estaba mal escrito arriba

| Afirmación anterior | Estado real |
| --- | --- |
| "construir no es un comando del gate" | Lo es desde fix2: `node scripts/aos/verify-image-build.mjs` construye el target oficial `twenty` con el mismo contexto, arg y etiquetas que Compose, y comprueba los artefactos **dentro** de la imagen resultante |
| La imagen se llama `aos-crm-local/twenty:v2.51.0-15e4826d3b` | Esa referencia base ya no se usa: la reescribía cada commit de AOS. Hoy incluye el commit (`-aos<12 hex>`) y `verify-image-provenance.mjs` rechaza la referencia base sola |
| El typecheck de fix1 era limpio | No lo era: llevaba una concesión por módulo ausente, retirada en fix2 |

### Typecheck sin concesión

fix2 suministró el artefacto en vez de permitir su ausencia:
`scripts/aos/typecheck-sources.Dockerfile` ejecuta la **mitad de declaraciones del target
oficial** de `twenty-sdk` (`tsgo --declaration --emitDeclarationOnly` + `tsc-alias`,
verbatim de su `project.json`), sin stubs ni `.d.ts` escritos a mano, y el self-test lo
comprueba contra el `project.json` real. No hay lista de módulos permitidos: `tsgo` tiene
que salir 0 sobre `tsconfig.json`. El parser además falla cerrado si el build de
dependencias no salió 0, si el contenedor no completó, o si el compilador salió distinto de
0 sin imprimir diagnósticos (el caso `exit 137` que fix1 certificaba como verde).

Tiempos registrados por el worker de fix2 en este host: build de fuentes/SDK en frío 562 s,
`tsgo -p tsconfig.json` 609 s, pasada del canario 273 s. **Límite honesto:** el coordinador
no volvió a ejecutar el typecheck real ni el build real sobre `6e0d50b6`, y fix3 tampoco los
re-midió porque no modificó esos dos comandos. Son medidas de una sola corrida, no
confirmadas por una segunda.

### Specs de privacidad: el camino de fuentes, medido antes y después

`verify-server-specs.mjs` copiaba las cuatro workspaces con `cp -r` desde montajes RO de
`/mnt/c` en cada corrida:

| Corrida | Resultado |
| --- | --- |
| Antes, coordinador (19:07 UTC) | **exit 124** al agotar la cota de 1200 s; el contenedor seguía en `cp -r` 21 min después, al 0,9 % de CPU |
| Antes, reproducido en fix3 | **>600 s sin terminar**; a los 10 min 13 s el proceso seguía siendo `cp -r` con 19 s de CPU acumulado (14.545 ficheros por corrida cruzando drvfs) |
| Después (fuentes en capa, árbol nuevo para la caché) | **192 s, exit 0**, 2/2 suites y 4/4 tests (deps 22 s, imagen de fuentes 134 s, jest 36 s) |
| Después (estado estable, dos corridas seguidas) | **67 s y 75 s, exit 0**, con todos los pasos pesados `CACHED` |

Lo que se mide no cambió: los mismos dos specs, el mismo árbol `server-deps` del Dockerfile
oficial, `--network none` y un build de dependencias cuyo exit 0 sigue siendo obligatorio.

Un detalle medido que vale para cualquier verificador con este patrón: BuildKit adjunta una
atestación de procedencia cuyo contenido incluye marcas de tiempo del build, así que un
rebuild **con todas las capas en caché** produce un image id distinto (medido:
`63d83413` → `5a2585be`). Con `FROM <imagen-de-deps>` eso invalida la capa de fuentes en
cada corrida. Con las atestaciones apagadas en esas imágenes internas del gate, el rebuild
cacheado es idéntico byte a byte y la capa de fuentes se reutiliza: construyendo las mismas
fuentes desde **dos commits distintos** se obtuvo el mismo digest de configuración en 0,1 s.
`verify-server-typecheck.mjs` comparte el patrón y **no** se tocó en fix3 (no estaba en
rojo); su imagen de fuentes sigue reconstruyéndose en cada commit por este mismo motivo.
Queda anotado para que el coordinador decida, no aplicado por cuenta propia.

### Arranque: la ventana de salud se dimensionó con el peor caso medido

`local.ps1 -Action Start` salió 1 con "container aos-crm-local-server-1 is unhealthy" y dejó
el worker en `Created`; dos minutos después el servidor estaba `healthy`. Medido: el
entrypoint oficial arranca Nest **cuatro veces** (init/migraciones, upgrade, flush,
cron:register) a ~2 min cada una, y el servidor escucha **516 s (8,6 min)** después de
arrancar el contenedor, con `upgrade 1/1 ok`, 0 fallos y sin reinicio. La ventana efectiva
era `start_period` 300 s + 20 x 5 s ≈ 400 s.

fix3 fija `start_period: 900s` en `deploy/local/compose.yaml`: los 516 s medidos con un
margen de 1,74x, deliberadamente mayor que la variabilidad del host porque esa corrida
tenía la base de datos ya migrada y un volumen frío ejecuta todas las migraciones por
primera vez. `interval`/`timeout`/`retries`, el test del healthcheck y el entrypoint oficial
**no se tocaron**, así que un servidor que muere después de escuchar sigue siendo
`unhealthy` en 100 s. Además, `Start`/`Restart` ya no toman el exit code de Compose como
veredicto completo: leen `docker compose ps --format json --all` y distinguen "aún
arrancando" (running + health starting) de "caído" (created/exited/restarting/unhealthy),
con el estado y el `RestartCount` de cada servicio en el informe.

### Límites que se conservan

- **La primera captura de tráfico mezcló build y arranque.** La compatibilidad de las IPs
  con la infraestructura de Docker no atribuye cada conexión a un proceso de la aplicación;
  la ventana limpia posterior no prueba retroactivamente que en aquella no hubiera egress de
  la app. La atribución inicial está registrada como trabajo de **CRM-005**, sobre recursos
  sintéticos dedicados y sin build en la ventana.
- **El gate interrumpido de `aea47607` no es un fallo de código.** Su `verify-server-specs`
  salió 1 sin stdout inmediatamente después de que el coordinador terminara de forma
  controlada la distro para recuperar el canal de exec de WSL; ver
  [.aos/reports/CRM-004-WSL-EXEC-RECOVERY.md](../../../.aos/reports/CRM-004-WSL-EXEC-RECOVERY.md).
  Hay que re-ejecutarlo, no atribuirle una causa establecida.
- El inventario de dependencias sigue siendo presencia cruzada con avisos conocidos: no es
  un SBOM ni un escáner de la imagen.

## CRM-004-fix4: la referencia del gate y la prueba por capas

29 de octubre de 2026, mismo host. El gate del arnés sobre `ed1425a4` quedó 18/19 con
`verify-image-provenance.mjs` en **exit 1**, y la causa no era la imagen: era el propio gate
pisándose.

### Lo medido

| Qué | Valor |
| --- | --- |
| Imagen que corrían server y worker | `sha256:6361980c…` (construida por Compose en el `Restart` de fix3) |
| Imagen que resolvía la referencia de despliegue después del gate | `sha256:f6f2c342…` (la construyó el comando 15 bajo la MISMA referencia) |
| Etiquetas de las dos | mismo `ai.aos.crm.source.commit` `ed1425a420…`, mismo árbol, `dirty=false` |
| Capas (RootFS diff IDs) | **26 y 26, idénticas una por una** |
| Estado del registro viejo | `docker image inspect sha256:6361980c…` → *No such image*: el store containerd descartó el registro al quedar sin referencia, con los contenedores aún corriéndolo |

Dos builds BuildKit del mismo contexto **no** comparten ImageID: la atestación de procedencia
que BuildKit adjunta por defecto lleva marcas de tiempo propias, así que incluso con todas
las capas en caché el resultado es otra identidad (lo mismo que fix3 midió en las imágenes
internas del gate, `63d83413` → `5a2585be`). La comparación por ImageID de un build contra
otro no mide bytes: mide identidades.

### El arreglo

- `verify-image-build.mjs` construye en una referencia **propia**,
  `aos-crm-local/twenty-gate:<versión>-<pin>-aos<12 hex>`, y pasa `--provenance=false`. La
  referencia de despliegue se lee y nunca se escribe. Contexto, Dockerfile, target, arg y
  etiquetas siguen siendo los de Compose, así que la caché de capas se comparte: no es un
  segundo build. Los artefactos y `APP_VERSION` se miden dentro de **esa** imagen.
- `verify-image-provenance.mjs` mantiene todo lo anterior (referencia no móvil que nombra pin
  y commit, etiquetas = este HEAD, árbol limpio, frontend dentro de la imagen, server **y**
  worker corriendo ese ImageID) y añade la mitad que las etiquetas no pueden dar: compara las
  **capas** de la imagen de despliegue con las de la imagen del gate. Las etiquetas son una
  afirmación de quien construyó; las capas son los bytes. Capa distinta → fallo nombrando el
  índice y los dos diff IDs. Configuración distinta sobre las mismas capas → no es fallo.
- El chequeo de árbol sucio de `verify-server-specs.mjs` cubre ahora **todo** lo que entra al
  contexto desde el árbol de trabajo en vez de por `git archive HEAD`, incluida
  `scripts/aos/server-specs-sources.Dockerfile`, que se empaqueta del árbol y quedaba fuera.
  El self-test exige que la lista del chequeo **sea** la lista del contexto, no una copia.

### Orden del gate (comandos 15 a 18)

Con referencias separadas, ninguno escribe lo del otro: 15 crea un registro de imagen propio
(capas compartidas, sin capas nuevas) y no toca contenedores, volúmenes ni la etiqueta de
despliegue; 17 solo lee y lanza un contenedor `--rm` de prueba; 16 y 18 no usan Docker. La
única dependencia es deliberada y declarada: 17 **lee** el artefacto que produce 15, y en el
orden de `.aos/verify.json` 15 va antes. Correr 17 sin 15 no da un PASS: falla cerrado
nombrando `verify-image-build.mjs`.

### Límites honestos

- La comparación de capas es contra un build sobre la caché de capas de **este** daemon:
  prueba que los bytes que corren son los que construye esta fuente aquí, **no** que el build
  sea reproducible bit a bit desde frío. Una caché fría que produjera capas distintas para la
  misma fuente se informaría como fallo, no como PASS.
- Cada commit deja un registro de imagen más (`twenty-gate:...`), metadatos sobre capas ya
  presentes, no 1,65 GB por commit. No se borró ninguna imagen: preservar evidencias manda.
- Las medidas de la corrida final (tiempos, ImageID, capas) están en
  [.aos/reports/CRM-004-fix4.md](../../../.aos/reports/CRM-004-fix4.md); este fichero no las
  duplica.

## CRM-004-fix5: cada corrida con sus propios recursos temporales

### Lo que estaba mal

Los dos verificadores que construyen imágenes intermedias nombraban sus recursos temporales
con un nombre **fijo por distro**, no por corrida: el tar de fuentes
(`/tmp/aos-crm-typecheck-sources.tar`, `/tmp/aos-crm-server-specs-sources.tar`) y las dos
etiquetas de imagen de cada uno (`...:gate`). Dos gates a la vez -- un worker por worktree,
que es la forma soportada de paralelizar -- se pisan: el segundo sobrescribe el tar del
primero y mueve su etiqueta, así que un compilador puede leer las fuentes de **otro** árbol,
y el `rm` de limpieza de uno borra la entrada del otro. Choca de frente con R3, que exige que
la limpieza toque solo los recursos de prueba de la propia corrida.

Tres defectos menores del mismo review: `removeOwnContainer()` lanzaba `docker inspect`/`rm`
**sin plazo** (un daemon que deja de responder cuelga el gate); el comentario de presupuesto
citaba una cota que `.aos/verify.json` ya no declaraba; y `typecheck-sources.Dockerfile`
probaba artefactos de dos de los **cuatro** workspaces que construye.

### El arreglo

- Cada recurso temporal se deriva de un identificador de corrida (`pid` + uuid): tar,
  etiquetas intermedias y nombre de contenedor. El uuid está porque los pid se reutilizan. La
  caché de capas de BuildKit se indexa por **contenido** del contexto y por el digest de la
  imagen base, no por el nombre de la etiqueta de salida, así que cambia lo que se **nombra**,
  no lo que se reconstruye -- y por eso se sigue compartiendo con
  `scripts/aos/mcp/verify-mcp-specs.mjs`.
- La limpieza nombra **solo** lo que creó esa corrida (contenedor por su nombre, etiquetas que
  registró cada build, su propio tar), nunca por patrón, por imagen ni por antigüedad, y toda
  ella comparte **un** plazo acotado que cabe dentro de la cota del comando: un daemon mudo ya
  no puede colgar el gate, y un paso de limpieza que no se pudo completar se informa.
  Si la corrida **falló**, sus etiquetas de imagen se **conservan** y se imprimen (son la
  evidencia de ese fallo); el tar se borra siempre. Las imágenes de aplicación (`twenty`,
  `twenty-gate`) no se tocan nunca.
- El comentario de presupuesto ya no repite un número: apunta a `.aos/verify.json`, que es lo
  que el self-test compara contra la suma de los plazos internos.
- `typecheck-sources.Dockerfile` prueba ahora una declaración por workspace que construye
  (twenty-shared, twenty-client-sdk, twenty-emails y twenty-sdk), y cada ruta es la entrada
  `exports[...].types` de un especificador que `twenty-server` importa de verdad. El self-test
  lee ese bloque contra la línea `nx run-many` y contra el `package.json` de cada paquete, así
  que un workspace añadido al build no puede quedarse sin prueba.
- `crm-runtime-e2e.test.mjs`: `timeoutMs` vuelve a ser un plazo **total** de la petición. La
  opción `timeout` de `node:http` mide **inactividad** del socket, así que el cambio desde
  `AbortSignal.timeout` había dejado la suite sin cota: un servidor que responde y luego
  gotea bytes mantenía una aserción esperando sin presupuesto.
- `verify-image-build.mjs` decide si es el punto de entrada por **ruta real resuelta**, no por
  el nombre con que se le invoca, y una `argv[1]` que no se puede resolver **falla cerrado**.
  La guarda anterior salía 0 sin construir cuando se le llamaba por un enlace con otro nombre.

### Lo que no cambia

- Qué mide cada gate: los mismos specs, el mismo `tsgo -p tsconfig.json` con su canario, el
  mismo target oficial, el mismo camino E2E. Solo cambia cómo se nombran y se recogen los
  recursos temporales.
- `scripts/aos/mcp/verify-mcp-specs.mjs` (CRM-007) **sigue** usando las etiquetas fijas
  `server-deps:gate` / `server-specs:gate`: está fuera del alcance de este track y queda
  reportado para su dueño. Dos gates simultáneos seguirían pisándose **ahí**.
- Las medidas de esta corrida (comandos, exits, tiempos, ImageID) están en
  [.aos/reports/CRM-004-fix5.md](../../../.aos/reports/CRM-004-fix5.md).
