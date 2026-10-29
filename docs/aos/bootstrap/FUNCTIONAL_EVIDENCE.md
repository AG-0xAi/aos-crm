# Evidencia funcional (CRM-005)

Fecha: 29 de octubre de 2026. Commit medido: la rama `codex/crm005-functional-acceptance` sobre el pin `twenty/v2.51.0` (`15e4826d3b5fc5867baeabeeb42b253892b2d4da`). Stack local `aos-crm-local` en la distro `AOS-CRM-Ubuntu-24.04`, publicado solo en `127.0.0.1:43000`.

Este documento registra **lo observado**, con el comando que lo observó y su código de salida, y separa explícitamente lo que **no** se midió. No declara nada que no se haya ejecutado. Las dos piezas que lo acompañan son `docs/aos/bootstrap/TELEMETRY_AUDIT.md` (inventario de destinos) y `docs/aos/bootstrap/SECURITY_AUDIT.md` (fronteras de API e invitaciones).

## Qué se añadió al gate

| Comando del gate | Qué mide | Cota declarada |
| --- | --- | --- |
| `node scripts/aos/verify-front-icons.mjs` (+ `--self-test`) | los tres consumidores del flag de iconos **renderizados de verdad** con dominios/enlaces sintéticos no vacíos, el estado inicial fail-closed, y `tsgo` sobre el programa que forman los ficheros cambiados y sus tests, con un canario que el compilador debe rechazar | 2 400 000 ms |
| `node --test scripts/aos/test/crm-api-authz-e2e.test.mjs` | REST y los dos esquemas GraphQL rechazando al anónimo y a una credencial malformada; CRUD real con la key del rol de mínimo privilegio verificado en PostgreSQL; cada operación de administración rechazada y contrastada con una credencial Admin; el token de una invitación real que no llega a ningún llamante no autorizado; el límite de un solo workspace | 900 000 ms |
| `node --test scripts/aos/test/crm-browser-e2e.test.mjs` | Chromium real con su sandbox activo contra el stack: login por formulario, alta de empresa/persona/oportunidad **por la UI**, relaciones puestas **por la UI**, lectura de las filas y sus claves ajenas con psql, la actividad de timeline que escribe el **worker**, reinicio de servidor y worker, y los mismos registros leídos otra vez **en el navegador** | 1 800 000 ms |
| `node scripts/aos/capture-traffic.mjs --self-test` | que la captura de red no puede escribir cuerpos: falla si alguien le añade `-w`, `-A`/`-X` o un snaplen de paquete completo, o si para la captura por nombre de proceso en vez de por su pid | (por defecto) |

`deploy/local/privacy.env` fija además `ALLOW_REQUESTS_TO_TWENTY_ICONS=false`, y `scripts/aos/verify-privacy.mjs` lo exige como clave requerida (con negativos propios: `=true` y la clave ausente se rechazan), de modo que quitar la línea deja de ser silencioso.

## R1. Navegador, persistencia y worker

El navegador es la imagen **oficial** de Playwright fijada por digest (`mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad9…b948`), con el paquete `playwright@1.60.0` —la misma versión que resuelve el lockfile del repo— instalado encima en `scripts/aos/browser-acceptance.Dockerfile`. Corre headless dentro de la distro, contra el puerto de loopback publicado.

**El sandbox de Chromium queda encendido, y eso se mide, no se supone.** Tres hechos medidos el 29/10/2026:

1. El valor por defecto de `chromium.launch()` en Playwright es sandbox **apagado**: la primera corrida devolvió un árbol de procesos con `--no-sandbox` sin que nadie lo pidiera. Ahora se pasa `chromiumSandbox: true` explícito.
2. Con el perfil seccomp por defecto de Docker, ese lanzamiento falla con *Chromium sandboxing failed!*. Se resolvió con el perfil seccomp **oficial** de Playwright (`utils/docker/seccomp_profile.json` del tag `v1.60.0`, sha256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`), versionado en `scripts/aos/playwright-seccomp-profile.json` y pasado con `--security-opt seccomp=…`. Sin capacidades añadidas, sin contenedor privilegiado y sin `--no-sandbox`.
3. El contenedor corre como el usuario sin privilegios de la propia imagen (`pwuser`, uid 1001), porque Chromium rechaza su sandbox si es root. El script lee `/proc` dentro del contenedor y reporta los procesos de Chromium y sus *switches*; el test del host falla si aparece `--no-sandbox` o si el uid es 0.

**Lo que hace la sesión del navegador** (fase `create`): abre el CRM, inicia sesión como administrador rellenando el formulario (correo y contraseña leídos del `deploy/local/.env` ignorado, entregados al contenedor con `docker --env-file` para que no pasen por la línea de comandos de nadie, y nunca impresos), crea por la UI una empresa, una persona y una oportunidad sintéticas, y pone por la UI tres relaciones: persona→empresa, oportunidad→empresa y oportunidad→persona (*Point of Contact*). Cada relación se comprueba **recargando la página** del registro, no leyendo el DOM que acaba de mutar.

Dos cosas que la UI enseñó por el camino y que están codificadas en el script porque volverían a morder:

- Escribir el nombre tras una espera fija pierde los primeros caracteres: "Marta probe4" se guardó como "a probe4" porque el editor de la celda aún no estaba montado. Ahora se espera a que el documento tenga **algo enfocado que acepte texto**, se escribe tecla a tecla y se **lee el valor de vuelta** antes de confirmar con Enter. El test del host compara además el nombre de la fila en PostgreSQL con el que el navegador quiso escribir.
- El selector de relación devuelve una lista **acotada**: buscar "Ensayos Sinteticos" cuando cuatro empresas compartían ese prefijo dejaba fuera la que la corrida acababa de crear. Se busca por el marcador único de la corrida.

**Lo que el test del host comprueba sobre datos** (no sobre capturas; no se toma ni una): las tres filas existen en el PostgreSQL de este proyecto con **el nombre que el navegador escribió**; `person."companyId"`, `opportunity."companyId"` y `opportunity."pointOfContactId"` apuntan a los ids correctos; existe al menos una fila en `"timelineActivity"` para cada uno de los tres registros, consultada en bucle con cota de 120 s (esa fila la escribe el job `upsert-timeline-activity-from-internal-event` en el **worker**, no la petición que creó el registro: es la tarea esencial del worker procesada de verdad); se reinician `server` y `worker` con `docker compose restart` (acotado a propósito: la base de datos y Redis no bajan, para no tirar el stack que el founder puede estar usando) y, tras volver a estar sano, **otra sesión de navegador** vuelve a abrir los tres registros, ve sus relaciones y ve la entrada de timeline que escribió el worker.

Limpieza: el test destruye permanentemente sus tres registros al terminar (`destroyCompany`/`destroyPerson`/`destroyOpportunity` con la sesión del administrador), porque el rol de mínimo privilegio deliberadamente no puede purgar y un borrado suave dejaría basura en el workspace. Los registros demo existentes (Marta Ensayo, Ensayos Sinteticos SL) no se tocan.

## R3. Iconos: el flag oficial, medido por render

El orden fue el que exige el arnés: **primero la prueba que falla**. Sobre el código sin arreglar, las cuatro suites del nuevo comando dieron `3 failed, 1 passed` (18 tests: `6 failed, 12 passed`), y el fallo nombra exactamente el defecto:

```
LinkIconWithLinkOverlay favicon requests › renders no provider favicon when the official flag is off
  - Expected  - []
  + Received  + ["https://twenty-icons.com/enlace-apagado.invalid"]
LinkIconWithLinkOverlay favicon requests › is fail-closed before client configuration has loaded
  Expected: false   Received: true
```

Es decir: con el flag oficial en `false`, el componente seguía metiendo la URL del proveedor en el DOM; y el estado inicial del frontend valía `true`, así que la primera petición salía antes de que `/client-config` respondiera. La cuarta suite (`getImageIdentifierFieldValue.test.ts`, el camino que **sí** respetaba el flag) pasó en esa misma corrida: la diferencia entre las tres que fallan y la que pasa es el defecto, no el entorno.

El arreglo es exactamente el registrado en el Scope y nada más: leer el flag con `useAtomStateValue(allowRequestsToTwentyIconsState)` en los tres consumidores y pasar el estado inicial a `false`. Los fallbacks locales se conservan (iniciales del avatar, icono por defecto del enlace), y los tests lo comprueban renderizando la fila/el icono y encontrando el nombre de la empresa y el icono por defecto.

El caso positivo controlado está en las tres suites: con el flag puesto a `true` a mano, la petición **sí** se produce y se observa, pero **no sale del proceso**: `window.Image` —lo que el primitivo de avatar usa para probar una URL— se sustituye por un grabador, y `global.fetch` se sustituye por un espía que debe quedarse a cero. Así el "true" prueba que la guarda es lo único que suprime la petición, sin contactar al proveedor.

## R3. Tráfico

Ver el inventario y sus límites en `docs/aos/bootstrap/TELEMETRY_AUDIT.md` (sección CRM-005). Las ventanas capturadas y sus resultados se listan en la tabla de comandos de abajo.

## R2. API y aislamiento

Ver `docs/aos/bootstrap/SECURITY_AUDIT.md` (sección CRM-005) para los siete resultados, los códigos medidos, el hallazgo del borrado por REST, el estado real de SEC-09 (invitaciones) y el límite de aislamiento entre workspaces.

## Límites explícitos de esta aceptación

1. **No se afirma cero telemetría global.** Lo que hay es: el navegador del arnés no pidió nada al proveedor de iconos con el flag apagado, y las capturas de red cubren ventanas concretas. Fuera de esas ventanas no se mide nada.
2. **El navegador del founder (en Windows) no está capturado.** Sus peticiones no cruzan el espacio de red de la distro. El navegador del arnés sí, y es el que da la evidencia.
3. **TLS no se descifra.** Un destino se clasifica por nombre y puerto.
4. **Aislamiento entre workspaces sin medir:** con multiworkspace apagado no existe un segundo workspace contra el que probarlo.
5. **`twentyhq.github.io`** sigue recibiendo una petición por carga (logo por defecto del workspace, constante upstream fuera del Scope de CRM-005). Reportado, no parcheado.
6. **El typecheck del frontend es del programa cambiado, no de todo `twenty-front`.** Medido: `tsgo -p tsconfig.json` sobre el proyecto completo reporta TS7016 en seis ficheros upstream intactos porque los `@types` de `lodash.*`/`pluralize` los declara solo `twenty-server` (dependencia fantasma que un `yarn install` completo tapa al hoistearlos). La imagen del gate restaura exactamente esos `@types` leyendo las versiones del `package.json` de `twenty-server`, y el programa que se compila son los cuatro ficheros cambiados, sus tests y todo lo que importan.
7. **El gate no mide el primer arranque del stack real**, que ya pasó. Lo que se mide del primer arranque es lo que diga la sección correspondiente de la tabla de abajo.

## Comandos, códigos de salida y artefactos

Todos ejecutados sobre este checkout el 29 de octubre de 2026.

| Comando | Resultado |
| --- | --- |
| `node scripts/aos/verify-privacy.mjs` | exit 0 — 14/14 chequeos, incluido el nuevo `ALLOW_REQUESTS_TO_TWENTY_ICONS=false` |
| `node scripts/aos/verify-privacy.mjs --self-test` | exit 0 — incluidos los dos negativos nuevos del flag de iconos |
| `node scripts/aos/verify-front-icons.mjs` (antes del arreglo) | exit 1 — `3 failed, 1 passed` suites: la evidencia must-fail-first |
| `node scripts/aos/verify-front-icons.mjs` (después del arreglo) | ver abajo |
| `node scripts/aos/verify-front-icons.mjs --self-test` | exit 0 |
| `node --test scripts/aos/test/crm-api-authz-e2e.test.mjs` | exit 0 — 7/7 |
| `node scripts/aos/capture-traffic.mjs --self-test` | exit 0 — 7/7 |
| `node --test scripts/aos/test/crm-browser-e2e.test.mjs` | ver abajo |
