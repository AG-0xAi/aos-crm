# Línea base de build (CRM-004)

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
