# Evidencia funcional (CRM-005)

Fecha: 29 de octubre de 2026. Commit medido: la rama `codex/crm005-functional-acceptance` sobre el pin `twenty/v2.51.0` (`15e4826d3b5fc5867baeabeeb42b253892b2d4da`). Stack local `aos-crm-local` en la distro `AOS-CRM-Ubuntu-24.04`, publicado solo en `127.0.0.1:43000`.

**Cierre del 30 de octubre de 2026 (rama `codex/crm005-cierre`, sobre la cabeza de CRM-014).** Aquella sesión se detuvo por el directo y dejó dos cosas sin terminar: el verificador de iconos en rojo y las ventanas de captura de R3 sin medir. Las dos se cierran aquí. Lo que cambió del entorno entretanto: el stack corre el **perfil beta** de CRM-014 (multiespacio, altas limitadas al administrador del servidor), su host base es `http://localhost:43000` y el espacio del founder vive en `http://aos-crm.localhost:43000`; el puerto sigue publicado solo en `127.0.0.1`. Todas las corridas de esta sección están fechadas el 30/10 y llevan su código de salida.

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

## R3. Tráfico: las tres ventanas capturadas (30 de octubre de 2026)

R3 pide cubrir servidor, worker y navegador **desde el primer arranque y el alta inicial, pasando por CRUD, reinicio y errores controlados**. Eso son tres ventanas, cada una con el flujo que la rellena dentro. `scripts/aos/capture-traffic.mjs` levanta `tcpdump` en la distro que ejecuta el stack —donde viven servidor, worker y el contenedor del navegador— con snaplen 128 y **sin fichero pcap**: lo que queda son marcas de tiempo, direcciones, puertos, flags y nombres de consulta DNS, nunca cuerpos, cabeceras ni cookies.

| Ventana | Qué corrió dentro | Qué parte de R3 cubre | Resultado del flujo | Destinos externos observados |
| --- | --- | --- | --- | --- |
| `firstboot-and-registration` | `node scripts/aos/firstboot-capture.mjs` (stack desechable propio: proyecto, red, volúmenes y puerto 43010 distintos, destruido con `down -v`) | primer arranque: migraciones, registro de cron jobs y **alta del primer administrador** con creación de su espacio | exit 0, 270 s — migraciones `true`, cron jobs `true`, `/client-config` 200, espacio creado en `http://aos-crm.localhost:43010/` | NTP del sistema; SSDP de la pasarela de Windows; **y `twenty-icons.com` → `172.67.158.99:443` (60 paquetes), pedido por el propio servidor al crear el espacio** (ver el hallazgo de abajo) |
| `api-crud-and-controlled-errors` | `node --test scripts/aos/test/crm-api-authz-e2e.test.mjs` (exit 0, 7/7, 119 s) | CRUD por API con la key de mínimo privilegio **y los errores controlados**: anónimo (401), credencial malformada (403), `PERMISSION_DENIED` de cada operación de administración | exit 0 | `checkpoint-api.hashicorp.com` → `99.84.9.99:443` (72 paquetes), **de un contenedor Terraform de otro track**, no del CRM; NTP del sistema; DNS del resolver de WSL |
| `browser-crud-restart` | `node --test scripts/aos/test/crm-browser-e2e.test.mjs` (exit 0, **6/6**, 444 s) | navegador real: login por formulario, alta y relaciones **por la UI**, la fila de timeline que escribe el **worker**, `restart` de servidor y worker y los registros releídos en el navegador | exit 0 | `twentyhq.github.io` → `185.199.111.153`/`185.199.110.153:443` (68 paquetes, 2 consultas DNS A): el logo por defecto del espacio; NTP; SSDP multicast de la pasarela de Windows; DNS |

**Del navegador, `twenty-icons.com` no recibió nada**, que es exactamente lo que cerró el arreglo de iconos: en las ventanas de API y de navegador no aparece ni una petición, y en la del navegador no es solo que no esté en la captura — la propia suite falla si el navegador pide un icono al proveedor o alcanza un host fuera de su inventario (`crm-browser-e2e`, prueba «asked the icon provider for nothing»).

### Hallazgo del 30/10: el que pide el icono en el alta es el SERVIDOR, y el flag oficial no lo para

La ventana del primer arranque **sí** vio `twenty-icons.com`, y no venía del navegador (en esa ventana no hay navegador). Atribución medida en la captura cruda: la conexión salió de `172.19.0.4` por el bridge de la red **del stack desechable**, un segundo después de que `signUpInNewWorkspace` creara el espacio, con `ALLOW_REQUESTS_TO_TWENTY_ICONS=false` en vigor para ese stack.

El camino, leído en el código pinneado: `auth/services/sign-in-up.service.ts:683` calcula `isWorkEmail(email)` y, si el correo del creador no es de un proveedor gratuito, la línea 772 llama a `uploadInferredWorkspaceLogo`, que construye `https://twenty-icons.com/<dominio del correo>` (línea 590) y lo **descarga** con `fileCorePictureService.uploadWorkspaceLogoFromUrl` para guardarlo como logo del espacio. Ese camino **no consulta** `ALLOW_REQUESTS_TO_TWENTY_ICONS`: el flag lo leen `client-config.service.ts:298`, `search.service.ts:718` y `navigation-menu-item-record-identifier.service.ts:130`, que son los caminos del **cliente**.

Qué significa, sin adornos: **cada vez que se abre un espacio, el servidor envía a un tercero el dominio de correo de quien lo abre.** En esta medición el dominio era sintético (`aos-crm.invalid`). En la beta, el que abre los espacios es el operador, así que el dominio que viaja es el suyo, una vez por espacio.

Qué **no** se hace aquí y por qué: `sign-in-up.service.ts` es núcleo de Twenty y está **fuera del Scope registrado de CRM-005** (cuatro ficheros de frontend, el perfil local, los scripts y la documentación). Se reporta, no se parchea en silencio. Opciones para su dueño: bloquear la salida a ese host en el despliegue, parchear el núcleo para que ese camino respete el flag (otro track, con su propia spec), o aceptarlo sabiendo exactamente qué viaja y cuándo. El flag oficial, por sí solo, no cierra esto.

La atribución de cada destino —con qué interfaz y desde qué dirección se originó, y qué contenedor era— está en `docs/aos/bootstrap/TELEMETRY_AUDIT.md`, junto con el límite que esto hace evidente: la captura ve **todo** el espacio de red de la distro, incluidos los contenedores de otros tracks que corran en este host.

## R2. API y aislamiento

Ver `docs/aos/bootstrap/SECURITY_AUDIT.md` (sección CRM-005) para los siete resultados, los códigos medidos, el hallazgo del borrado por REST y el estado real de SEC-09 (invitaciones).

El **aislamiento entre espacios**, que el 29/10 era un límite declarado («con multiworkspace apagado no existe un segundo workspace contra el que probarlo»), es desde el perfil beta un resultado medido: `scripts/aos/test/crm-isolation-e2e.test.mjs` (CRM-014) abre dos espacios sintéticos, les acuña API keys de rol Admin y ejecuta la misma llamada contra el espacio ajeno en REST, los dos esquemas GraphQL, metadatos, ficheros, MCP y OAuth/PKCE. Corrida del 30/10 en este checkout: **exit 0, 13/13, 650 s**. La misma suite imprime el límite `[LIMIT]` de las invitaciones pendientes, que está descrito en `SECURITY_AUDIT.md` y es un P1 para el despliegue público, no para local.

El rechazo de MCP sin credencial y el conector por espacio los mide `scripts/aos/test/crm-mcp-e2e.test.mjs`, que el gate corre entero; no hay ningún despliegue MCP público ni anónimo en este perfil (su primera prueba es exactamente esa negativa).

## Límites explícitos de esta aceptación

1. **No se afirma cero telemetría global.** Lo que hay es: el navegador del arnés no pidió nada al proveedor de iconos con el flag apagado, y las capturas de red cubren ventanas concretas. Fuera de esas ventanas no se mide nada.
2. **El navegador del founder (en Windows) no está capturado.** Sus peticiones no cruzan el espacio de red de la distro. El navegador del arnés sí, y es el que da la evidencia.
3. **TLS no se descifra.** Un destino se clasifica por nombre y puerto.
4. **Aislamiento entre espacios: medido desde el 30/10** (era un límite cuando multiworkspace estaba apagado). Lo que sigue sin medir es el aislamiento frente al **administrador del servidor**, que por diseño impersona, abre y borra espacios, y el aislamiento **por navegador** (dos sesiones a la vez en dos subdominios).
5. **`twentyhq.github.io`** sigue recibiendo una petición por carga (logo por defecto del workspace, constante upstream fuera del Scope de CRM-005). Reportado, no parcheado, y visto otra vez en la ventana del navegador del 30/10.
6. **El typecheck del frontend es del programa cambiado, no de todo `twenty-front`.** Medido: `tsgo -p tsconfig.json` sobre el proyecto completo reporta TS7016 en seis ficheros upstream intactos porque los `@types` de `lodash.*`/`pluralize` los declara solo `twenty-server` (dependencia fantasma que un `yarn install` completo tapa al hoistearlos). La imagen del gate restaura exactamente esos `@types` leyendo las versiones del `package.json` de `twenty-server`, y el programa que se compila son los cuatro ficheros cambiados, sus tests, **las declaraciones ambientales y el fichero de arranque de jest que lleva el propio `tsconfig.json` de `twenty-front`** (`src/**/*.d.ts` y `setupTests.ts`, añadidos el 30/10: sin ellos el compilador rechazaba código upstream intacto) y todo lo que todo eso importa.
7. **El gate no mide el primer arranque del stack real**, que ya pasó semanas atrás y no puede repetirse sin destruir sus datos. El primer arranque y el alta inicial se miden sobre un stack **desechable** con su propio proyecto, red, volúmenes y puerto, creado y destruido por `scripts/aos/firstboot-capture.mjs` en un solo comando. Por eso **no** es un comando del gate: arrancar un stack entero por cada corrida no cabe en su presupuesto. Es un instrumento de evidencia que se corre a demanda, y su ventana está en la sección de R3.
8. **El perfil del stack desechable es el beta, no el de octubre.** Desde el 30/10 lleva las mismas dos variables de espacio y la misma forma de URL (`http://localhost:43010`) que el perfil real, porque una ventana de primer arranque de un perfil que ya no desplegamos mediría otra cosa. Lo que no comparte, a propósito: sus datos, su puerto y `restart: "no"`.
9. **Las corridas de navegador dependen de la carga del host.** Medido el 30/10: con otra sesión ocupando la distro de 4 CPU (carga 6-7, `wsl.exe` devolviendo `WSAETIMEDOUT`), el navegador no alcanza la aplicación y la suite falla aunque el servidor conteste `/` en 0,2 s. Las esperas de la suite se dimensionaron a lo medido en este host (navegación 90 s, vuelta de un reinicio 900 s) y, con el host libre, pasa 6/6. No es una suite que pueda correr a la vez que otro gate.

## Comandos, códigos de salida y artefactos

Todos ejecutados sobre este checkout el 29 de octubre de 2026.

| Comando | Resultado |
| --- | --- |
| `node scripts/aos/verify-privacy.mjs` | exit 0 — 14/14 chequeos, incluido el nuevo `ALLOW_REQUESTS_TO_TWENTY_ICONS=false` |
| `node scripts/aos/verify-privacy.mjs --self-test` | exit 0 — incluidos los dos negativos nuevos del flag de iconos |
| `node scripts/aos/verify-front-icons.mjs` (antes del arreglo) | exit 1 — `3 failed, 1 passed` suites: la evidencia must-fail-first |
| `node scripts/aos/verify-front-icons.mjs --self-test` | exit 0 |
| `node --test scripts/aos/test/crm-api-authz-e2e.test.mjs` | exit 0 — 7/7 |
| `node scripts/aos/capture-traffic.mjs --self-test` | exit 0 — 7/7 |

## Cierre del 30 de octubre de 2026: comandos y códigos de salida

Todos sobre este checkout, rama `codex/crm005-cierre`, con el stack en el perfil beta.

| Comando | Resultado |
| --- | --- |
| `node scripts/aos/verify-front-icons.mjs` (estado heredado) | **exit 1** — `[FAIL] frontend icon flag: tsgo rejected twenty-front (exit 2)`. Ocho diagnósticos, todos en código que este track no tocó: `src/config/index.ts(2,10): Property '_env_' does not exist on type 'Window & typeof globalThis'` y siete `toBeInTheDocument does not exist` en las tres suites de iconos |
| Reproducción acotada dentro de la propia imagen del gate (`tsgo -p` con el programa tal como lo generaba el verificador, y con las dos entradas ambientales añadidas) | **exit 2** con esos ocho diagnósticos / **exit 0** con el programa completo — la causa estaba en el programa acotado, no en el núcleo, y se midió antes de tocar el verificador |
| `node scripts/aos/verify-front-icons.mjs` (tras el arreglo) | **exit 0** — 4/4 suites, 18/18 tests, `tsgo` exit 0 y el canario rechazado con 2 |
| `node scripts/aos/verify-front-icons.mjs --self-test` | exit 0 — 24 casos, incluido el nuevo: quitar cualquiera de las dos entradas ambientales del programa hace fallar el self-test (comprobado quitando cada una) |
| `node scripts/aos/verify-privacy.mjs` (+ `--self-test`) | exit 0 — 15 chequeos / exit 0 |
| `node scripts/aos/verify-local-config.mjs` (+ `--self-test`) | exit 0 — 31 chequeos / exit 0 |
| `node scripts/aos/capture-traffic.mjs --self-test` | exit 0 |
| `node scripts/aos/verify-provenance.mjs --self-test` | exit 0 |
| `node --test scripts/aos/test/crm-isolation-e2e.test.mjs` | **exit 0 — 13/13**, 650 s. Al terminar: un espacio (el del founder) y un esquema de datos |
| `node scripts/aos/capture-traffic.mjs --label api-crud-and-controlled-errors -- node --test …/crm-api-authz-e2e.test.mjs` | **exit 0** — 7/7, 119 s; ventana de R3 (CRUD + errores controlados) |
| `node scripts/aos/capture-traffic.mjs --label browser-crud-restart -- node --test …/crm-browser-e2e.test.mjs` | **exit 0** — 6/6, 444 s; ventana de R3 (navegador, CRUD por UI, worker y reinicio) |
| `node scripts/aos/capture-traffic.mjs --label firstboot-and-registration -- node scripts/aos/firstboot-capture.mjs` (primer intento) | **exit 1** — `signUpInNewWorkspace failed: Cannot query field "activationStatus" on type "WorkspaceUrlsAndId"`: la consulta de ese paso, escrita el 29/10, nunca había llegado a ejecutarse. El stack desechable sí arrancó sano y se destruyó solo |
| `node scripts/aos/capture-traffic.mjs --label firstboot-and-registration -- node scripts/aos/firstboot-capture.mjs` (tras corregir la consulta) | **exit 0**, 270 s — primer arranque sano, migraciones `true`, cron jobs `true`, alta del primer administrador, espacio creado en `http://aos-crm.localhost:43010/`, `/client-config` 200, `down -v` sin dejar volumen ni contenedor y los tres volúmenes del stack real intactos |
| Gate completo (`aos verify --project .`) | lo corre el arnés y deja su propio recibo; aquí no se declara |

Estado de los datos del founder al terminar el cierre, medido en PostgreSQL: **un** espacio, **un** esquema de datos, 9 empresas / 13 personas / 8 oportunidades vivas (el `count(*)` total es mayor porque incluye las filas borradas en blando por corridas anteriores).
