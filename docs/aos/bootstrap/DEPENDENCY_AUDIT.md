# Dependencias: consulta estática inicial

Fecha: 27 de octubre de 2026. Referencia: `twenty/v2.51.0`, `15e4826d3b5fc5867baeabeeb42b253892b2d4da`.

Se extrajeron 4.880 resoluciones npm únicas por nombre/versión de `yarn.lock` y se consultaron en 13 lotes a OSV. No se instalaron dependencias ni ejecutaron sus scripts. Todos los lotes y las 63 consultas de detalle terminaron sin error. Se señalaron 47 combinaciones de paquete/versión, con 63 avisos distintos.

Estas coincidencias identifican versiones afectadas según la base consultada. No demuestran que la función vulnerable se use ni que el paquete termine en la imagen del CRM. Las entradas workspace, git y patch no se validan íntegramente con este extractor; faltan análisis de imagen, paquetes descargados, SBOM y comprobación de alcance.

## Clasificación inicial

Avisos únicos por severidad de la fuente: CRITICAL: 4, HIGH: 23, LOW: 11, MODERATE: 25.

| Grupo | Evidencia | Decisión previa a ejecución |
| --- | --- | --- |
| Next.js 16.3.8 | Dos avisos críticos y uno alto. Está en website/react-email UI; el frontend CRM es Vite | No arrancar el website ni el servidor auxiliar de email; comprobar que no entra en runtime CRM y actualizar si se requiere ese tooling |
| Storybook 10.4.6 | Aviso crítico de validación de origen y otro alto | No arrancar el dev server hasta resolverlo; localhost por sí solo no elimina ataques desde un navegador |
| DOMPurify 3.4.16 | Un crítico, un alto y un bajo | Revisión ampliada: tres llamadas en dos utilidades (archivo SVG, HTML de correo y asunto). El asunto sí usa `RETURN_DOM_FRAGMENT`, con tags/atributos vacíos y lectura de `textContent`; ninguna activa `SAFE_FOR_TEMPLATES`, `IN_PLACE` ni parser XHTML. No se confirma explotación; completar consumidores transitivos y triage de cada aviso antes del runtime |
| MCP SDK 1.30.0 | Avisos de sesiones/tareas, memoria, OAuth y transporte | El controlador MCP de Twenty usa protocolo propio; revisar también clientes MCP e integraciones antes de atribuir todos los avisos al endpoint servidor |
| GraphQL Tools | Versiones 9.2.1, 10.3.4, 11.1.0 y 12.0.0 | Revisar reachability de `mergeDeep`/`mergeIncrementalResult`, esquemas y dependencias transitivas |
| body-parser, compression, multer | Avisos altos de disponibilidad | Revisar middleware real, límites de cuerpo, configuración de uploads y versiones corregidas antes de aceptar el backend |
| MSAL, follow-redirects, undici, nodemailer | Credenciales, redirecciones, parsing y disponibilidad | Priorizar antes de habilitar proveedores de correo/OAuth; no hay cuentas conectadas |
| Vite/Vitest/Happy DOM | Herramientas de desarrollo/test y ejecución de código | No exponer servidores de desarrollo ni lanzar suites con entradas no confiables; resolver el contexto relevante antes de arrancar |
| Electron | Companion, fuera del primer CRM local | No arrancar/empacar Companion en este bootstrap |

No se detectó un exploit crítico confirmado en el camino de instalación revisado. Se mantiene `enableScripts: false`. El gate de seguridad debe bloquear cualquier componente cuya ruta crítica quede confirmada antes de ejecutarlo; no se acepta un cambio masivo de versiones sin baseline y pruebas.

## Coincidencias del lockfile

| Paquete | Versión | Avisos (enlaces a la fuente) |
| --- | --- | --- |
| `@ai-sdk/provider-utils` | 4.0.5 | [GHSA-866g-f22w-33x8](https://osv.dev/vulnerability/GHSA-866g-f22w-33x8) |
| `@azure/msal-node` | 5.2.4 | [GHSA-xcx6-jx8p-x3h5](https://osv.dev/vulnerability/GHSA-xcx6-jx8p-x3h5) |
| `@cyntler/react-doc-viewer` | 1.17.1 | [GHSA-fvhg-p4hf-79x3](https://osv.dev/vulnerability/GHSA-fvhg-p4hf-79x3) |
| `@graphql-tools/executor-legacy-ws` | 1.1.28 | [GHSA-6fw5-9hq8-w87g](https://osv.dev/vulnerability/GHSA-6fw5-9hq8-w87g) |
| `@graphql-tools/utils` | 10.3.4 | [GHSA-7mx3-vvmw-hjmv](https://osv.dev/vulnerability/GHSA-7mx3-vvmw-hjmv) |
| `@graphql-tools/utils` | 11.1.0 | [GHSA-7mx3-vvmw-hjmv](https://osv.dev/vulnerability/GHSA-7mx3-vvmw-hjmv), [GHSA-c4qx-w738-7hr3](https://osv.dev/vulnerability/GHSA-c4qx-w738-7hr3) |
| `@graphql-tools/utils` | 12.0.0 | [GHSA-7mx3-vvmw-hjmv](https://osv.dev/vulnerability/GHSA-7mx3-vvmw-hjmv), [GHSA-c4qx-w738-7hr3](https://osv.dev/vulnerability/GHSA-c4qx-w738-7hr3) |
| `@graphql-tools/utils` | 9.2.1 | [GHSA-7mx3-vvmw-hjmv](https://osv.dev/vulnerability/GHSA-7mx3-vvmw-hjmv) |
| `@modelcontextprotocol/sdk` | 1.30.0 | [GHSA-22jm-h49p-29qw](https://osv.dev/vulnerability/GHSA-22jm-h49p-29qw), [GHSA-46jr-4wx8-v453](https://osv.dev/vulnerability/GHSA-46jr-4wx8-v453), [GHSA-6prh-2h8m-c8cw](https://osv.dev/vulnerability/GHSA-6prh-2h8m-c8cw), [GHSA-6qxp-vccf-f47h](https://osv.dev/vulnerability/GHSA-6qxp-vccf-f47h), [GHSA-rvq5-wwqv-78pq](https://osv.dev/vulnerability/GHSA-rvq5-wwqv-78pq) |
| `@storybook/addon-vitest` | 10.4.6 | [GHSA-f2ph-cmg5-wxc8](https://osv.dev/vulnerability/GHSA-f2ph-cmg5-wxc8), [GHSA-px85-f4q5-jh77](https://osv.dev/vulnerability/GHSA-px85-f4q5-jh77) |
| `@vitest/mocker` | 4.1.11 | [GHSA-qxg6-89mg-rqv8](https://osv.dev/vulnerability/GHSA-qxg6-89mg-rqv8), [GHSA-xp26-3454-mjgp](https://osv.dev/vulnerability/GHSA-xp26-3454-mjgp) |
| `@vue/server-renderer` | 3.5.38 | [GHSA-g2v6-rqmx-r4w6](https://osv.dev/vulnerability/GHSA-g2v6-rqmx-r4w6) |
| `body-parser` | 1.20.8 | [GHSA-27r3-jxmh-p828](https://osv.dev/vulnerability/GHSA-27r3-jxmh-p828) |
| `body-parser` | 2.3.0 | [GHSA-27r3-jxmh-p828](https://osv.dev/vulnerability/GHSA-27r3-jxmh-p828) |
| `compression` | 1.8.1 | [GHSA-vc2v-76pw-4v95](https://osv.dev/vulnerability/GHSA-vc2v-76pw-4v95) |
| `dompurify` | 3.4.16 | [GHSA-c6gr-qvv4-5v3f](https://osv.dev/vulnerability/GHSA-c6gr-qvv4-5v3f), [GHSA-cg2g-xh64-v4q7](https://osv.dev/vulnerability/GHSA-cg2g-xh64-v4q7), [GHSA-mrv2-3pqr-j5jr](https://osv.dev/vulnerability/GHSA-mrv2-3pqr-j5jr) |
| `electron` | 44.1.0 | [GHSA-2p8c-gr87-2676](https://osv.dev/vulnerability/GHSA-2p8c-gr87-2676), [GHSA-3qxv-5xgr-q7w9](https://osv.dev/vulnerability/GHSA-3qxv-5xgr-q7w9), [GHSA-98mx-cjp9-gchm](https://osv.dev/vulnerability/GHSA-98mx-cjp9-gchm), [GHSA-997q-gvvc-jwmx](https://osv.dev/vulnerability/GHSA-997q-gvvc-jwmx), [GHSA-fw47-9c62-h3vw](https://osv.dev/vulnerability/GHSA-fw47-9c62-h3vw), [GHSA-h3v5-h239-pg29](https://osv.dev/vulnerability/GHSA-h3v5-h239-pg29), [GHSA-jr5w-w6x2-84p9](https://osv.dev/vulnerability/GHSA-jr5w-w6x2-84p9), [GHSA-x562-297c-g43g](https://osv.dev/vulnerability/GHSA-x562-297c-g43g) |
| `fast-uri` | 3.1.7 | [GHSA-333x-w4r6-6crp](https://osv.dev/vulnerability/GHSA-333x-w4r6-6crp), [GHSA-hrr3-gc8f-f4qj](https://osv.dev/vulnerability/GHSA-hrr3-gc8f-f4qj), [GHSA-w74x-v6f9-j3xg](https://osv.dev/vulnerability/GHSA-w74x-v6f9-j3xg), [GHSA-wjr9-j795-jxcr](https://osv.dev/vulnerability/GHSA-wjr9-j795-jxcr), [GHSA-xhq7-xmqj-769h](https://osv.dev/vulnerability/GHSA-xhq7-xmqj-769h) |
| `fflate` | 0.8.2 | [GHSA-px8p-9vwx-vf98](https://osv.dev/vulnerability/GHSA-px8p-9vwx-vf98) |
| `follow-redirects` | 1.16.0 | [GHSA-8r9p-f939-6h3c](https://osv.dev/vulnerability/GHSA-8r9p-f939-6h3c), [GHSA-q3jh-wrc6-jgq8](https://osv.dev/vulnerability/GHSA-q3jh-wrc6-jgq8) |
| `happy-dom` | 20.10.3 | [GHSA-834v-8h66-3h79](https://osv.dev/vulnerability/GHSA-834v-8h66-3h79) |
| `happy-dom` | 20.8.9 | [GHSA-834v-8h66-3h79](https://osv.dev/vulnerability/GHSA-834v-8h66-3h79) |
| `http-cache-semantics` | 4.1.1 | [GHSA-ch52-4w7c-c8xp](https://osv.dev/vulnerability/GHSA-ch52-4w7c-c8xp) |
| `http-cache-semantics` | 4.2.0 | [GHSA-ch52-4w7c-c8xp](https://osv.dev/vulnerability/GHSA-ch52-4w7c-c8xp) |
| `ip-address` | 10.7.2 | [GHSA-rxp7-6hxx-x8q5](https://osv.dev/vulnerability/GHSA-rxp7-6hxx-x8q5) |
| `katex` | 0.16.25 | [GHSA-238p-pmpm-9mq7](https://osv.dev/vulnerability/GHSA-238p-pmpm-9mq7) |
| `markdown-it` | 14.3.2 | [GHSA-gfr2-rv44-r23c](https://osv.dev/vulnerability/GHSA-gfr2-rv44-r23c), [GHSA-vfgh-jcmw-g37q](https://osv.dev/vulnerability/GHSA-vfgh-jcmw-g37q) |
| `multer` | 2.4.0 | [GHSA-q7qp-rjg7-q26m](https://osv.dev/vulnerability/GHSA-q7qp-rjg7-q26m) |
| `next` | 16.3.8 | [GHSA-2464-fhr4-w9xw](https://osv.dev/vulnerability/GHSA-2464-fhr4-w9xw), [GHSA-673q-mjm6-r5xr](https://osv.dev/vulnerability/GHSA-673q-mjm6-r5xr), [GHSA-p3m5-59mp-jv5r](https://osv.dev/vulnerability/GHSA-p3m5-59mp-jv5r) |
| `nodemailer` | 10.0.12 | [GHSA-85x2-q946-cp5h](https://osv.dev/vulnerability/GHSA-85x2-q946-cp5h), [GHSA-8c8m-p3m8-cjg8](https://osv.dev/vulnerability/GHSA-8c8m-p3m8-cjg8), [GHSA-m943-m63m-w62w](https://osv.dev/vulnerability/GHSA-m943-m63m-w62w) |
| `postcss-selector-parser` | 6.1.4 | [GHSA-rj75-hqrm-r3gf](https://osv.dev/vulnerability/GHSA-rj75-hqrm-r3gf) |
| `sanitize-html` | 2.17.7 | [GHSA-374f-7chj-9948](https://osv.dev/vulnerability/GHSA-374f-7chj-9948), [GHSA-cv27-6wvh-8x7j](https://osv.dev/vulnerability/GHSA-cv27-6wvh-8x7j), [GHSA-x3q4-9hxx-gx8m](https://osv.dev/vulnerability/GHSA-x3q4-9hxx-gx8m) |
| `storybook` | 10.4.6 | [GHSA-f2ph-cmg5-wxc8](https://osv.dev/vulnerability/GHSA-f2ph-cmg5-wxc8), [GHSA-px85-f4q5-jh77](https://osv.dev/vulnerability/GHSA-px85-f4q5-jh77) |
| `undici` | 6.29.0 | [GHSA-4qv8-2p9j-2685](https://osv.dev/vulnerability/GHSA-4qv8-2p9j-2685), [GHSA-xjj6-f33q-929c](https://osv.dev/vulnerability/GHSA-xjj6-f33q-929c) |
| `undici` | 7.29.1 | [GHSA-4qv8-2p9j-2685](https://osv.dev/vulnerability/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://osv.dev/vulnerability/GHSA-f72v-6w45-q472), [GHSA-xjj6-f33q-929c](https://osv.dev/vulnerability/GHSA-xjj6-f33q-929c) |
| `undici` | 7.30.0 | [GHSA-4qv8-2p9j-2685](https://osv.dev/vulnerability/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://osv.dev/vulnerability/GHSA-f72v-6w45-q472), [GHSA-xjj6-f33q-929c](https://osv.dev/vulnerability/GHSA-xjj6-f33q-929c) |
| `undici` | 8.10.2 | [GHSA-4qv8-2p9j-2685](https://osv.dev/vulnerability/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://osv.dev/vulnerability/GHSA-f72v-6w45-q472), [GHSA-xjj6-f33q-929c](https://osv.dev/vulnerability/GHSA-xjj6-f33q-929c) |
| `undici` | 8.11.2 | [GHSA-4qv8-2p9j-2685](https://osv.dev/vulnerability/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://osv.dev/vulnerability/GHSA-f72v-6w45-q472), [GHSA-xjj6-f33q-929c](https://osv.dev/vulnerability/GHSA-xjj6-f33q-929c) |
| `vite` | 7.3.6 | [GHSA-587h-7wmj-h5pm](https://osv.dev/vulnerability/GHSA-587h-7wmj-h5pm), [GHSA-698v-4r3x-3vcv](https://osv.dev/vulnerability/GHSA-698v-4r3x-3vcv), [GHSA-9jrq-w75r-8gcw](https://osv.dev/vulnerability/GHSA-9jrq-w75r-8gcw), [GHSA-r825-w8mm-5pxw](https://osv.dev/vulnerability/GHSA-r825-w8mm-5pxw), [GHSA-rq7h-c2jc-7f22](https://osv.dev/vulnerability/GHSA-rq7h-c2jc-7f22) |
| `vite` | 8.0.16 | [GHSA-587h-7wmj-h5pm](https://osv.dev/vulnerability/GHSA-587h-7wmj-h5pm), [GHSA-698v-4r3x-3vcv](https://osv.dev/vulnerability/GHSA-698v-4r3x-3vcv), [GHSA-9jrq-w75r-8gcw](https://osv.dev/vulnerability/GHSA-9jrq-w75r-8gcw), [GHSA-r825-w8mm-5pxw](https://osv.dev/vulnerability/GHSA-r825-w8mm-5pxw), [GHSA-rq7h-c2jc-7f22](https://osv.dev/vulnerability/GHSA-rq7h-c2jc-7f22) |
| `zod` | 3.24.0 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |
| `zod` | 4.1.11 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |
| `zod` | 4.3.6 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |
| `zod` | 4.4.3 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |
| `zod` | 4.5.4 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |
| `zod` | 4.6.2 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |
| `zod` | 4.6.5 | [GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) |

## Evidencia y reproducción

Los scripts `static-inventory.py` y `osv-details.py`, sus respuestas JSON y las fechas están en `.aos/onboarding/bootstrap-2026-10-27/`. Las consultas solo enviaron identificadores públicos de paquetes y versiones. La revisión se realizó sin `yarn install`, `npm install` ni `npx`.

Los avisos del producto Twenty se evalúan por separado en `SECURITY_AUDIT.md`. Una resolución upstream que mencione un CVE como corregido no se acepta como prueba de ausencia de otros avisos.

## Corrección de cobertura posterior a la inspección inicial

La revisión ampliada del coordinador encontró la tercera llamada `sanitizeOutboundEmailSubject` en `packages/twenty-server/src/engine/core-modules/email/utils/sanitize-outbound-email-html.util.ts`; el informe inicial había omitido su retorno DOM. No basta ese modo para confirmar el aviso de shadow roots: requiere además `SAFE_FOR_TEMPLATES`, entrada con shadow root y evaluación posterior como plantilla. La [metadata actual del mantenedor](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7), consultada el 27/10/2026, indica severidad Low y versión parcheada 3.4.17, mientras el cuerpo histórico aún dice sin fix. Los conteos OSV de arriba conservan la fotografía y clasificación de aquella consulta; no sustituyen el triage actual ni acreditan un parche instalado. No se ejecutaron PoCs ni dependencias en esta comprobación.

## CRM-004: del lockfile al árbol instalado

Todo lo anterior es inferencia sobre `yarn.lock`. CRM-004 instaló de verdad las
dependencias con la configuración Yarn revisada (`enableScripts: false`,
`enableHardenedMode: true`, `enableTelemetry: false`, `npmMinimalAgeGate: 3d`) dentro de la
etapa `server-deps` del Dockerfile oficial, y midió el árbol resultante. Los 10 paquetes
que declaran build scripts (`bcrypt`, `cpu-features`, `esbuild`, `msgpackr-extract`,
`msw`, `nx`, `protobufjs`, `ssh2`, `unrs-resolver`) quedaron sin ejecutar; no se habilitó
ninguno.

### body-parser: confirmado en el árbol, corregido y reverificado

[GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)
(High 7.5, caída por cuerpo comprimido con bytes posteriores, sin autenticación). El
árbol instalado confirmó la ruta, no solo el lockfile:

```
/app/node_modules/express/node_modules/body-parser  2.3.0   <- express 5.2.1 <- @nestjs/platform-express 11.2.6
/app/node_modules/body-parser                       1.20.8
```

`packages/twenty-server/src/main.ts` registra los parsers `json`/`urlencoded`/`text` sin
`inflate: false`, así que la ruta de middleware precede a la autenticación.

Se aplicó la **resolución mínima compatible**: 2.4.0 y 1.20.9 son las versiones corregidas
y ambas caen dentro de los rangos que ya pedían los dependientes (`^2.2.1`, `~1.20.3`,
`~1.20.5`), de modo que **no hizo falta ningún override en `package.json`**. Solo se
re-resolvieron esos descriptores en `yarn.lock` (27 inserciones, 10 borrados: body-parser
y tres transitivos obligados, `content-type` 2.1.0, `iconv-lite` ^0.7.3 y `qs` 6.16.1).
No hubo refresco masivo del lockfile.

Reverificado reinstalando y volviendo a leer el árbol:

```
/app/node_modules/express/node_modules/body-parser  2.4.0
/app/node_modules/body-parser                       1.20.9
```

Límite honesto: **no se ejecutó la prueba negativa** (petición comprimida inválida contra
el backend) porque la imagen de aplicación no llegó a construirse; ver
`BUILD_BASELINE.md`. Esa prueba sigue siendo requisito antes de aceptar el backend.

### Qué avisos alcanzan de verdad al runtime

Se reprodujo el pruning de producción del Dockerfile (`yarn workspaces focus --production
twenty-emails twenty-shared twenty-client-sdk twenty-server`), se enumeraron los **1.087
paquetes** realmente presentes y se cruzaron con los 47 pares paquete/versión señalados
arriba. Esto mide presencia; no es inferencia por búsqueda sin coincidencias.

Presentes en el árbol de runtime con la versión exacta señalada (14): `@azure/msal-node`
5.2.4, `@graphql-tools/utils` 9.2.1/10.3.4/12.0.0, `dompurify` 3.4.16, `follow-redirects`
1.16.0, `ip-address` 10.7.2, `multer` 2.4.0, `nodemailer` 10.0.12, `sanitize-html`
2.17.7, `undici` 7.30.0/8.10.2/8.11.2, `zod` 4.1.11.

**Ausentes del árbol de runtime** (21), entre ellos los que concentraban los avisos
críticos del inventario inicial: `next` 16.3.8, `storybook` 10.4.6, `@storybook/addon-vitest`
10.4.6, `@vitest/mocker` 4.1.11, `electron` 44.1.0, `vite` 7.3.6/8.0.16, `happy-dom`,
`@modelcontextprotocol/sdk` 1.30.0, `compression` 1.8.1, `@cyntler/react-doc-viewer`,
`@vue/server-renderer`, `katex`, `markdown-it`, `fflate`, `fast-uri`,
`http-cache-semantics`, `postcss-selector-parser`, `@graphql-tools/executor-legacy-ws`.
Siguen estando en el repositorio y en el tooling de desarrollo: ausencia del artefacto de
runtime no es ausencia del proyecto.

`body-parser` aparece ahora solo como 2.4.0 en el árbol de producción: las dos versiones
vulnerables desaparecieron y la línea 1.20.x no entra en el enfoque de producción.

No se encontró ningún crítico confirmado en la ruta necesaria del runtime medido.
Presencia no es explotabilidad, y este cruce no sustituye un SBOM ni un escaneo de la
imagen final (que no existe todavía). El JSON del cruce está en
`.aos/onboarding/bootstrap-2026-10-27/runtime-advisory-crosscheck.json`.

## Inventario sobre la imagen final (CRM-004-fix1, 28 de octubre de 2026)

El cruce anterior se hizo **reproduciendo** el pruning de producción del Dockerfile. Ahora
existe la imagen de aplicación, así que se inventariaron los paquetes **realmente presentes
dentro de ella**, leyendo cada `package.json` del árbol instalado desde un contenedor con
`--network none` (`fix1/walk-installed.js`, `fix1/inventory-final-image.sh`):

| Dato | Valor |
| --- | --- |
| Imagen inspeccionada | `aos-crm-local/twenty:v2.51.0-15e4826d3b` (la que construye Compose) |
| Paquetes presentes | **1.084** (890 nombres distintos) |
| Pares señalados por este documento | 47 |
| Presentes con la versión exacta señalada | **14** |
| Mismo paquete en otra versión | 12 |
| Ausentes de la imagen | 21 |

Los 14 presentes son: `@azure/msal-node@5.2.4`, `@graphql-tools/utils` en 9.2.1/10.3.4/12.0.0,
`dompurify@3.4.16`, `follow-redirects@1.16.0`, `ip-address@10.7.2`, `multer@2.4.0`,
`nodemailer@10.0.12`, `sanitize-html@2.17.7`, `undici` en 7.30.0/8.10.2/8.11.2 y
`zod@4.1.11`. **El conjunto es idéntico al que predijo la reproducción del pruning**
(1.087 paquetes entonces, 1.084 ahora), así que aquella medida era correcta y esta la
confirma sobre el artefacto real.

De esos 14, el único con un aviso crítico en el inventario inicial es `dompurify@3.4.16`, y
su triage de alcance (tres llamadas, ninguna con `SAFE_FOR_TEMPLATES`, `IN_PLACE` ni parser
XHTML) está más arriba en este documento: sigue siendo un triage de alcance, no una
exoneración. Los críticos que concentraban el inventario (`next`, `storybook`, `electron`,
`vite`, `@modelcontextprotocol/sdk`, `compression`) **no están en la imagen**.

`body-parser` aparece solo como 2.4.0. Esto sigue sin ser un SBOM ni un escaneo de
vulnerabilidades de la imagen: es un inventario de presencia cruzado con una lista de avisos
conocida. El JSON está en `fix1/final-image-advisory-crosscheck.json`.
