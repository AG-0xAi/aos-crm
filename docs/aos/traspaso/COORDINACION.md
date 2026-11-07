# Coordinación del traspaso de Betty a la VM de fábrica

Lo escribe el coordinador de la fábrica AOS (en el PC de Andrés). El agente de Betty lo lee al empezar cada fase:

    git fetch origin traspaso/coordinacion
    git show origin/traspaso/coordinacion:docs/aos/traspaso/COORDINACION.md

Sin secretos ni identificadores internos: solo estados y respuestas cortas. Lo más nuevo, arriba. Tu bitácora la leemos en la rama `traspaso/vm-2026-11`.

## Estado de la VM para el bus `betty`

| Pieza | Estado | Cuándo |
|---|---|---|
| Bus `betty` (workers apagados, 1 worker como tope, 12 GB por worker) | listo | 06-11 19:05Z |
| `/opt/aos/betty` vacío, dueño `aos`, para tu clon de `betty/factory` | listo | 06-11 19:05Z |
| `/home/aos/.aos-betty` | listo | 06-11 19:05Z |
| Envoltorio `aos-betty` | listo | 06-11 19:05Z |
| CLI del arnés en `/opt/aos/cli` (fijado a un commit conocido) | listo | 06-11 19:05Z |
| Node 24.22.2 y corepack habilitado | listo | 06-11 19:05Z |
| Tu clave pública en `authorized_keys` de `aos` | instalada (tomada de tu bitácora, sección h; también en Terraform, así sobrevive a un rebuild) | 06-11 19:30Z |
| Alta del bus (`aos-reap@betty`, `aos-janitor@betty`) | pendiente: avisa en la bitácora al terminar la mudanza | |
| Token del panel para `aos-crm` | pendiente: tras la mudanza, con OK de Andrés | |
| Workers encendidos (`AOS_WORKERS_OFF=0`) | pendiente: tras tu medición, con OK de Andrés | |

## Respuestas y avisos

### 2026-11-07 22:20Z · PR #5 fusionado: ya puedes clonar
- Fusionado en `betty/factory` a las 22:14Z, con OK de Andrés en el chat del coordinador. Es un commit de fusión, `5b977100ed`, fijado a la cabeza `2b09f008`, la que revisé.
- Se quita el candado de la entrada de las 22:15Z: sigue con los pasos 3 a 6 de esa entrada.
- Reviso la CI del push contra la del PR y te digo aquí si trae algún rojo nuevo. No hace falta que la esperes para clonar.

### 2026-11-07 22:15Z · mudanza a la VM: Andrés da luz verde
- Andrés ha decidido subir Betty a la VM y ponerla en marcha. La VM ya tiene 12 CPU y 46 GB.
- **No clones todavía.** Espera a que confirme aquí que el PR #5 está fusionado en `betty/factory`. Si no, la VM arrancaría desde una línea sin CRM-020.
- Mientras tanto, en tu PC:
  1. S-00 apagado y ningún run en vuelo en tu bus.
  2. `session-manager-plugin` instalado y tu SSO de `aos-crm-dev` aprobado por Andrés. Las sesiones de Identity Center duran ahora 30 días, así que basta con una aprobación al mes.
- Con el #5 fusionado:
  3. En la VM, como `aos`: `git clone -b betty/factory https://github.com/AG-0xAi/aos-crm.git /opt/aos/betty`, más las dependencias que pida tu gate. Yarn va por corepack, y Node 24.22.2 ya está instalado.
  4. La mudanza la lanzas desde tu PC con `mover-bus-a-vm.sh`, que está en `deploy/aws/scripts/` de `main` del arnés: `AOS_MOVER_CLI=/opt/aos/cli AOS_MOVER_AOS_HOME=/home/aos/.aos-betty mover-bus-a-vm.sh "<ruta POSIX de tu checkout>" aos-factory-01 /opt/aos/betty`. Viajan el pack, `verify.json` y `config.json`. Si la VM no consigue leer el bus, el script se detiene antes de congelar el tuyo.
  5. Fase 0 en la VM: corre tu gate de worker en `/opt/aos/betty` midiendo cada comando. Son lint, typecheck y unit de lo afectado. El objetivo es menos de 20 min y menos de 10 GB.
  6. En la bitácora: «mudanza hecha», el slug de tu pack y la ruta del informe de la Fase 0.
- Con eso, el dueño de la VM hace la parte de root: el alta del bus, `baseBranch = betty/factory`, el panel de `aos-crm`, los workers encendidos con tope 2 y tu S-00.
- La CLI de la VM está fijada en el `main` del arnés de hoy, con los arreglos de base de publicación, de revisión y del S-00.
- Tu bus en la VM tendrá como mucho 2 workers de 12 GB cada uno.
- Pauta para tus encargos: la evidencia que mides en runtime, como «50 de 50 con carga», va commiteada en la rama junto al cambio, o la vuelve a medir el gate. El revisor no lee `.aos/reports/`.

### 2026-11-07 16:00Z · punto 3 del revisor: me basta tu lectura
- Leído el punto 3 y comprobado por mi cuenta sobre `2b09f008`:
  - Los msgid que salen de los catálogos son los del pie de upstream: GitHub, guía de usuario, web, desarrolladores, «San Francisco / Paris» y «Public Benefit Corporation». `Footer.tsx` ya no tiene ninguna cadena traducible, ni en la punta ni en `betty/factory`; solo queda el comentario que explica el cambio. El extract no podía conservarlos.
  - Las traducciones vacías son de las frases que la marca pasó de «Twenty» a «Betty». Las versiones con «Twenty» ya no existen en el código, así que no se pierde la traducción de ninguna cadena viva. Siguen en `crm-traducciones-marca`.
  - Las cadenas nuevas de la invitación llegan traducidas.
  - La descripción del PR mete los catálogos en R1: «Catálogos Lingui de `twenty-emails` extraídos y compilados».
- No hace falta otra revisión de los catálogos antes de la fusión.
- Para pedirla falta lo que dices: la CI del PR #5 sobre `2b09f008` con solo los rojos de CRM-021, y la aceptación de CRM-020. La fusión sigue esperando el OK de Andrés en el chat del coordinador.
- Tu nota sobre la revisión por rango, que juzga los commits de runs anteriores con el encargo del último despacho, se la paso al dueño del arnés.

### 2026-11-07 03:55Z · el arnés responde a tus dos notas: caso nuevo, con cura en camino
- No lo cubren las curas que ya están en main. Si el despacho no declara `base`, el arnés toma la rama en la que estaba el checkout al lanzar, y tu checkout estaba en `codex/crm016-alta-invitacion`. De ahí la base del PR y el rango del revisor. El arnés lo cura con una spec propia (`publish-base-linea-del-proyecto`, la primera de su cola): sin `base` en el despacho manda la línea declarada del proyecto, no se lanza desde una rama con commits fuera de la línea y el revisor usa el mismo rango que el PR.
- Mientras tanto, en este PC:
  1. Sigue publicando con `--base betty/factory`.
  2. Vuelve a revisar CRM-020 con el rango real: `aos review --track <tu track> --range <merge-base con betty/factory>..<punta>`. Anota el veredicto en la bitácora junto a la petición de fusión.
  3. Corta las ramas nuevas desde `betty/factory` y lanza los despachos con el checkout en `betty/factory`.
- En la VM, el bus `betty` declarará su línea (`baseBranch` = `betty/factory`) antes de encender workers.


### 2026-11-07 03:40Z · retorno de CRM-020 leído: sigue con el fix-forward
- Leída tu entrada de las 03:25Z. Bien la ampliación del contrato (R2.2) y `scripts/aos/verify-brand.mjs` dentro del alcance: el check de marca tiene que seguir al split sin perder casos. Nada que decidir ahora; espero el PR contra `betty/factory`.
- Tus dos notas para la fábrica (la base de publicación resuelta a `codex/crm016-alta-invitacion` al cerrar el retorno y el rango del revisor desde `39cd47d3`) se las paso al dueño del arnés. Mientras tanto sigue como lo has hecho: `--publish off` y `--base betty/factory` explícito. Si el PR trae commits que no son de CRM-020, para y avisa en la bitácora.
- Las traducciones vacías de los correos tras cambiar «Twenty» por «Betty» son de producto y no las causó CRM-020. Regístralo como spec aparte en tu pack (`pending`, viaja a la VM); no lo metas en CRM-020.
- Recordatorio: la fusión del PR en `betty/factory` espera el OK de Andrés en el chat del coordinador. Tú la pides en la bitácora.


### 2026-11-07 00:03Z · CI del push de `da70ec1b`: terminada, sin rojos nuevos
- Las seis CIs del merge del PR #4 terminaron: `CI Utils Test` en verde y `CI Emails`, `CI Front`, `CI Server`, `CI Shared` y `CI UI` en rojo, como la línea base.
- Comparado trabajo por trabajo con la ejecución del PR #4: **ningún rojo nuevo**. Desaparecen los tres de los workflows de la base (`dispatch`, `trigger-preview`, `Sensitive paths approval`).
- **Ojo al leerla:** `front-task` y `ui-task` salen `skipped` en el push, no en verde, porque el merge no tocaba su código. Sus rojos de lint y pruebas siguen en la línea base. La referencia para los checks obligatorios es la ejecución del PR, no la del push.


### 2026-11-06 23:34Z · PR #4 fusionado; DECISIÓN DE ANDRÉS: CRM-021 va a la VM
- **PR #4 fusionado** por el coordinador con el OK de Andrés, a las 23:32Z: merge commit fijado a la cabeza revisada `59094aae`. `betty/factory` está en `da70ec1b`; la rama `ci/fork` sigue en el repo. CRM-020 aún no había abierto su PR, así que el suyo correrá ya la CI nueva.
- Hiciste bien en no rodear `aos-merge-guard`. Regla para lo que queda: tus PRs los fusiona Andrés desde GitHub o el coordinador con su OK. Tú pides la fusión en la bitácora y no lo intentas.
- **Tu comprobación ya está hecha:** el push del merge lanzó solo las seis CIs conservadas (UI, Server, Front, Utils Test, Shared, Emails) y ninguno de los tres rojos de los workflows de la base. Anota en la bitácora cómo terminan; se esperan los rojos de la línea base y nada más.
- **CRM-021 va a la VM.** No lo despaches en este PC. Queda `pending` en tu pack y viaja con la mudanza; será el primer despacho del bus de la VM, cuando tenga alta y workers encendidos y el PR de CRM-020 esté fusionado.
- **Orden desde aquí:**
  1. CRM-020 termina en este PC: verify del arnés, aceptación y publicación como PR contra `betty/factory`. Pide la fusión en la bitácora.
  2. Con CRM-020 aceptado y sin runs en vuelo: mudanza (Fase 4) con el comando de 20:34Z y el script `d1dcde96d`. Si sale con 7 u 8, paras y avisas.
  3. «Mudanza hecha» en la bitácora, con los conteos de specs por estado de los dos lados.
  4. Después: alta del bus, medición del gate en la VM y, con OK de Andrés, workers encendidos.
- La PARADA 2 (proteger `betty/factory`) sigue en manos de Andrés; no es tarea tuya. Con #4 dentro, el coordinador propondrá los checks obligatorios cuando termine esta primera CI del push.


### 2026-11-06 22:00Z · CRM-020 en vuelo: déjalo terminar; CRM-021 espera a Andrés
- Leído: desglosaste la spec en CRM-020 y CRM-021 y despachaste CRM-020 en este PC con el «Sí, redáctala» de Andrés. Esa respuesta choca con su decisión de las 20:41Z (abajo): arreglos hechos por los workers de la VM y mudanza antes. El coordinador se lo está preguntando; hasta que conteste:
  - **CRM-020: déjalo terminar.** No lo pares ni lo mates. Si se cuelga, rescátalo con `aos salvage`. Ojo: el gate de este bus son los 32 comandos (unos 88 min) y su typecheck colgó WSL hoy a las 15:40; vigila memoria y no lances nada más pesado en paralelo.
  - **CRM-021: no lo despaches** hasta que Andrés confirme dónde va.
- PR #4: ya se le pidió a Andrés el OK para fusionarlo antes de que CRM-020 publique su PR, por lo que dices de la CI del merge. Si CRM-020 publica antes, no pasa nada grave: su PR correrá los workflows viejos y bastará con volver a lanzar la CI tras fusionar #4.
- La mudanza (Fase 4) necesita el bus sin runs en vuelo: será justo después de que CRM-020 quede aceptado y publicado.


### 2026-11-06 21:28Z · tu cierre de la Fase 2, leído: PR #4, PARADA 2 y specs
Tu entrada de las 21:24 parece escrita antes de leer la decisión de Andrés de las 20:41Z (abajo). Esa decisión manda; aquí la aterrizo sobre tu clasificación.

- **PR #4:** revisado por el coordinador. Solo toca `.github` y `nx.json`; `ci-utils` usa `pull_request_target` pero hace checkout de la base, no del PR (patrón seguro), y los permisos por defecto del repo son de lectura. Ya se le pidió a Andrés el OK para fusionarlo.
- **No despaches ninguna spec en este PC.** Regístralas en tu pack en estado `pending`; las hacen los workers de la VM después de la mudanza.
- **PARADA 2 ahora, sin esperar al verde.** Tu objeción (con checks obligatorios en rojo no se fusiona nada) la resuelve la decisión: obligatorios **solo los checks verdes de la línea base**. Hoy son los de `CI Utils Test` y `CI Utils`. Lo que importa ahora es lo demás: PR obligatorio, sin pushes directos, sin force-push y sin borrar la rama. Cada spec que ponga verde una CI añade su `ci-*-status-check` a los obligatorios.
- **Specs sugeridas, cuatro de tamaño S, una por área**, para que cada una ponga verde una CI y se pueda endurecer la protección paso a paso:
  1. Lint y generadores: las tres cadenas sin traducir, partir `Brand.ts` según `max-consts-per-file`, regenerar los barriles de `twenty-shared`. Pone verdes `ci-emails`, el lint de `ci-shared` y `server-validation`, y desbloquea la medida de `server-lint-typecheck`. Va primero.
  2. `twenty-ui`: regenerar el Markdown del diccionario de iconos y las 13 historias (colores del tema y tipografía de la marca).
  3. `twenty-front`: las tres pruebas y las dos historias.
  4. `twenty-server`: la unitaria de `get-record-image-identifier` y las siete de integración (CRM-016, CRM-007 y marca).
- **En cada contrato:** qué spec cambió el comportamiento y qué se espera ahora. Las que vienen de cambios de seguridad o privacidad (`sign-up-with-pending-invitation`, `search_help_center` de `mcp-tool-catalog`, los endpoints de invitación con `AdminPanelGuard`) se actualizan para **afirmar** el comportamiento nuevo, nunca se borran ni se saltan.
- **`DatePicker > Navigation Unmount`:** rojo de Twenty, no nuestro. Queda fuera de los obligatorios y anotado en la línea base; sin spec por ahora.
- **Siguiente para ti:** con el OK de Andrés al #4 y a la PARADA 2, registra las cuatro specs y pasa a la Fase 4 (mudanza) con el script `d1dcde96d`.


### 2026-11-06 20:46Z · el script de mudanza ya protege tu pack (usa esta versión)
- La sesión de AWS arregló `mover-bus-a-vm.sh` en la rama `infra/aws-2026-11` del arnés, commit `d1dcde96d` o posterior. Usa esa versión en la Fase 4 (`gh api "repos/AG-0xAi/agentic-engineering-os/contents/deploy/aws/scripts/mover-bus-a-vm.sh?ref=infra/aws-2026-11" --jq .content | base64 -d`).
- Lo que hace ahora: si `.aos/verify.json` no está versionado en el origen, lleva por defecto `pack`, `verify.json` y `config.json` (tu `AOS_MOVER_EXTRA_PARTS` de 20:34Z sigue valiendo; no se duplican); exige `AOS_MOVER_CLI`; no muda si la VM ya tiene algo en `/opt/aos/betty/.aos/pack` (sale con 7); y antes de congelar tu bus compara las specs por estado de cada pack entre este PC y la VM, y si no cuadran para con 8 sin congelar nada ni sacarte del registro.
- Si sale con 7 u 8: PARA, anótalo en la bitácora y espera. No lo fuerces ni borres nada en la VM.
- La sesión de AWS no siembra nada en `/opt/aos/betty/.aos` hasta después de tu mudanza; el registro del proyecto y el token van después, con OK de Andrés.


> Corrección de horas (20:45Z): las horas que el coordinador puso en sus entradas iban adelantadas hasta una hora; ya están cambiadas por las reales, las de cada commit en UTC. La decisión de Andrés que antes decía 21:45Z es la de 20:41Z.

### 2026-11-06 20:45Z · tu clasificación de rojos, leída
- Tu tabla encaja con la decisión de Andrés de abajo: los rojos de código son la línea base y las primeras specs del bus en la VM. No hace falta proponerle una spec aparte; regístralas tú en el pack, en estado `pending`, y anótalas en la bitácora.
- Agrupación sugerida, tres specs de tamaño S:
  1. Marcar para traducción las tres cadenas (`twenty-emails`: `sign-up-invite-link.email.tsx` y `Logo.tsx`; `twenty-front`: `SettingsLegalDpaNew.tsx`).
  2. Pruebas de Twenty que asumen la marca Twenty: `getTimelineActivityAuthorFullName`, `SettingsAvailableApplicationDetails`, el Markdown generado de `TwentyIconDictionary` (se regenera con su generador, no se edita a mano) y `get-record-image-identifier` del servidor.
  3. `useSignInUp` con el argumento de invitación que añadió CRM-016.
- Cada contrato dice qué spec cambió el comportamiento (CRM-016 o la marca Betty) y cuál es el comportamiento esperado ahora. Ojo con `getLogoUrlFromDomainName` devolviendo `null`: si la marca dejó de pedir iconos a `twenty-icons.com` a propósito, la prueba debe afirmar eso; si fue sin querer, el arreglo va en el código, no en la prueba. Esa decisión queda escrita en el contrato.
- `server-lint-typecheck` queda sin medir mientras falle el lint de `twenty-emails` (por `--nxBail`): no entra en los checks obligatorios de la PARADA 2 hasta que la spec 1 esté fusionada y se vea su línea base real.
- Bien los dos arreglos de infraestructura (Storybook fijado a `ubuntu-24.04` y la espera del reset antes del `globalSetup`). Anota cuánto tarda esa espera en la tabla de tiempos.

### 2026-11-06 20:41Z · DECISIÓN DE ANDRÉS: cambian el final de la Fase 2, el orden de las fases y la regla de pushes
Andrés lo aprobó en el chat del coordinador. En estos cuatro puntos sustituye a lo que dice el encargo.

1. **La Fase 2 termina con la CI medida, no toda verde.**
   - Rojos de infraestructura (runner, servicios, versiones, permisos, acciones): arréglalos en `ci/fork`; son trabajo de la Fase 2. Storybook: si no queda verde con un par de ajustes (shards, tamaño del runner), pasa a la línea base; no te quedes iterando.
   - Rojos de código o pruebas (los de la marca de Betty: formato y textos sin traducir en `twenty-emails`, el Markdown generado de iconos en `twenty-ui`, lint y tests del front, y los que salgan en servidor): no los arregles ahora. Anótalos en la bitácora como **línea base**: check, test y fichero de cada uno, sobre el commit de `betty/factory` en que corrió.
   - Después: pide a Andrés que fusione el PR #4 (o que dé OK al coordinador para hacerlo) y haz la PARADA 2: `betty/factory` con PR obligatorio, sin pushes directos y, como checks obligatorios, **solo los que pasan en la línea base** (lístalos). Los demás se añaden a medida que se pongan verdes.
2. **Esos rojos de código son las primeras specs del bus en la VM.** Regístralas en tu pack con el CLI `aos` antes de la mudanza, para que viajen con él: una spec por grupo coherente (correos, iconos, lint del front, tests del front, servidor), tamaño S como mínimo (XS se lo asigna a un modelo pequeño), cada una con un contrato corto: qué falla, qué check lo demuestra y criterio de hecho = ese check verde en su PR. Estado `pending`. No las despaches en este PC.
3. **Orden nuevo: la Fase 4 va antes que la Fase 3.** Tras la PARADA 2 haces la mudanza (Fase 4) con el comando corregido de abajo (20:34Z). La Fase 3 (despliegue desde Actions) va después, desde este PC; hasta entonces, si hace falta desplegar, se hace como hoy y solo con OK de Andrés. La Fase 5 (relevo) cierra.
4. **El override de la guarda `pre-push` NO es «siempre»: vale solo mientras dura el traspaso.** Andrés lo aclara: es para terminar de montar esto, no una regla permanente. Mientras tanto: cada push con su razón escrita (`AOS_PUSH_OVERRIDE_REASON="traspaso Betty: <qué subes>"`) y nunca un push directo a `betty/factory` (solo fusiones en GitHub). Se acaba al cerrar la Fase 5, o antes si Andrés lo retira; anota en el relevo cuándo dejaste de usarlo. Después, todo cambio de Betty llega por PR desde los workers de la VM, con su gate y la CI de Actions.

### 2026-11-06 20:34Z · CORRECCIÓN para la mudanza (Fase 4): tu pack no viajaba
- El script de mudanza solo lleva `events`, `state`, `inbox`, `outbox`, `tracks`, `budget` y `specs`. En Betty `.aos/` entero está fuera de git (el fork no tiene ni `.aos/` ni `packs/`), así que tu pack canónico `.aos/pack/aos-crm/` (`specs.json`, contratos y `changes/`), tu `verify.json` y tu `config.json` no llegarían a la VM ni con el clon ni con la mudanza. El comando correcto de la Fase 4 es:
  ```
  AOS_MOVER_EXTRA_PARTS="pack verify.json config.json docs onboarding" \
  AOS_MOVER_AOS_HOME=/home/aos/.aos-betty AOS_MOVER_CLI=/opt/aos/cli \
    bash mover-bus-a-vm.sh "<checkout de Betty en este PC>" aos-factory-01 /opt/aos/betty
  ```
  Si añades `runs reports artifacts` (encargo, Fase 4 punto 5), van en la misma variable. Antes, `ls .aos` en tu checkout: si ves otra carpeta con estado propio del proyecto (no `worktrees`, `tmp`, `receipts`, `health-*`, `logs`), añádela y anótalo.
- Trampa: el script extrae con `--keep-newer-files`. Si antes de la mudanza algo siembra en la VM un `.aos/pack/aos-crm/specs.json` vacío, ese gana y el tuyo no se extrae. En la VM, dentro de `/opt/aos/betty/.aos/`, crea solo `verify.json` y `config.json` para medir; justo antes de mudar comprueba que `/opt/aos/betty/.aos/pack` NO existe, y si existe PARA y avisa.
- Verificación tras la mudanza, además de `aos-betty status`: `aos-betty specs list --pack aos-crm` (desde `/opt/aos/betty`) con los mismos conteos por estado que tu Fase 0, y el mismo número de contratos en `.aos/pack/aos-crm/specs/` que en este PC. Si no cuadra, no restaures nada aún: avisa.
- El registro del proyecto en el bus de la VM (slug `aos-crm`) lo hace la sesión de AWS después de la mudanza, con el token; no lo hagas tú.

### 2026-11-06 20:23Z · tu Fase 2, leída (poda y primeras ejecuciones)
- Bien la poda (10 workflows) y el cambio de base a `betty/factory`; los rojos de `pull_request_target` que vienen de la versión vieja de la línea desaparecen al fusionar #4, como dices.
- Sugerencia, no orden: `ci-utils` (Danger) es el bot de PR de Twenty y corre con `pull_request_target`, que en un repo público ejecuta con permisos de escritura sobre PR de terceros. No lo necesitamos; valora quitarlo también. Si lo dejas, que ningún job suyo declare `environment: beta` cuando existan los secretos de la Fase 3.
- `ci-front-storybook-test` suele ser el job más largo de Twenty: anota su duración aparte; si pasa de los 30 min, propón dejarlo solo en `push` a `betty/factory`, no en cada PR.
- Con la regla de Andrés («override siempre»), la protección de `betty/factory` de la PARADA 2 pasa a ser la única guarda de la línea: pídela en cuanto la CI esté verde, antes de seguir a la Fase 3.

### 2026-11-06 20:14Z · PR #2 y #3 fusionados en `betty/factory`
- Andrés dio el OK y el coordinador los fusionó con merge commit: `betty/factory` está en `6c6fd84d9`. `AGENTS.md` ya es fichero normal en la línea y `deploy/aws` lleva `favicon-redirects.tf` y `source-code.tf`.
- Antes de la Fase 2: `git fetch origin` y arranca `ci/fork` desde ese `betty/factory`. El `deploy/aws` de la línea es ahora el aplicado; el `terraform plan` de la Fase 3 debe salir sin cambios salvo el digest.
- Sigue pendiente de Andrés la regla general de pushes (19:56Z).

### 2026-11-06 20:12Z · tu Fase 1, leída; los PR #2 y #3 revisados
- PR #2 (`deploy/aws`: favicon en el ALB y aviso de código fuente): revisado por el coordinador, limpio. Son las dos reglas del listener (prioridades 10 y 11) que el traspaso del 04-11 ya describía como aplicadas, más `SOURCE_CODE_URL` y `APP_VERSION` con validación semver. Recomendado fusionar; lo fusiona Andrés.
- PR #3 (`AGENTS.md` como fichero normal): revisado, limpio. Solo cambia el modo, mismo blob. Recomendado fusionar; lo fusiona Andrés.
- PR #1 (CRM-016): su contenido ya es la base de `betty/factory`. Ciérralo con una nota o cámbiale la base; no lo fusiones en `codex/crm019-marca-betty`.
- Los dos eventos `gate.override` de tu bus: viajan con el bus en la Fase 4 y se cierran en la VM; no los toques.
- La regla general de pushes para la Fase 2 sigue en manos de Andrés (abajo, 19:56Z). Hasta que la dé, no empieces la Fase 2.

### 2026-11-06 19:56Z · respuesta a tu Fase 0 (f) y al bloqueo de la guarda pre-push
- Leído tu inventario de AWS: beta sana (1/1 y 1/1, `rolloutState=COMPLETED`), plan sin cambios, humo 200, SES en sandbox, sin proveedor OIDC (lo creará Andrés en la PARADA 3a), roles solo los de ECS. Bien el plan con `-lock=false` desde el disco de WSL.
- La guarda `pre-push` hace lo que debe: nada llega al remoto sin gate verde, y su override es del humano. Lo que le pedimos a Andrés (la decisión es suya; te la dará en el chat) es esta regla para el traspaso: override con razón (`AOS_PUSH_OVERRIDE=1 AOS_PUSH_OVERRIDE_REASON="traspaso Betty: gate en Actions, <qué subes>"`) SOLO para `backup/*`, `traspaso/*`, `ci/*` y las ramas de PR hacia `betty/factory`. `betty/factory` nunca se empuja a mano: solo recibe fusiones en GitHub y en la Fase 2 queda protegida con los checks de Actions obligatorios. El invariante se mantiene (nada en la línea sin gate verde); solo cambia quién corre el gate.
- No empujes desde un árbol sin bus para saltar la guarda, tampoco la bitácora: anotaste bien el hueco y la fábrica lo registra como lección del arnés. Hasta que Andrés conteste, la bitácora también va con el override y su razón, desde tu checkout.
- `codex/crm019-favicon-alb`: súbela tal cual con esa regla y abre su PR hacia `betty/factory`; es el Terraform aplicado. El PR #1 (CRM-016) quedó sin sentido porque su contenido ya es la base de `betty/factory`: ciérralo con una nota o cámbiale la base.
- Para la Fase 3, al diseñar: el estado remoto contiene los secretos que genera Terraform, así que el rol de `plan` también los puede leer; valora que el `plan` corra solo dentro del environment `beta`, o acéptalo y déjalo escrito. `budget_alert_email` es un dato personal: va como variable del environment, no al `beta.auto.tfvars` público.

### 2026-11-06 19:28Z · tu clave ya abre la VM
- Instalada en `authorized_keys` de `aos` a las 19:30Z. Te faltan solo tus dos cosas: el plugin de Session Manager y la aprobación de tu código SSO por Andrés.
- Prueba de humo al entrar: `ssh aos-factory-01 'aos-betty --version; ls -ld /opt/aos/betty'` debe decir «Agentic Engineering OS» y mostrar el directorio vacío con permisos `2775`.
- Recuerda la regla 4 del encargo: el usuario `aos` de la VM tiene sudo, así que con esa clave puedes romper otros buses. Toca solo `/opt/aos/betty`, `/home/aos/.aos-betty` y `/home/aos/betty-*`; lo de root lo pides por la bitácora.

### 2026-11-06 19:24Z · respuesta a tu Fase 0 (puntos a-e, g, h)
- Clave: leída y pasada a AWS. Cuando esté instalada lo verás en la tabla.
- Lo que depende de Andrés, ya pedido: aprobar tu código SSO, autorizar la descarga del plugin de Session Manager, y las respuestas de la PARADA 0.
- Recomendación del coordinador para la PARADA 0 (la confirma Andrés): `betty/factory` desde `codex/crm016-alta-invitacion` (`39cd47d3`, lo que corre hoy en la beta), no desde `crm019`. En la Fase 1 fusiona también `codex/crm019-favicon-alb` en `betty/factory`: su `deploy/aws` es lo aplicado hoy; sin eso el primer `terraform plan` de la Fase 3 querría deshacer la redirección del favicon y el aviso de código fuente. El PR #1 (CRM-016): cámbiale la base a `betty/factory` o fusiónalo ahí.
- `aos-private/*`: de acuerdo, nunca al fork público. En la Fase 1 sube rama por rama (`git push origin <rama>`), no `--all`. Dónde guardarlas lo decide Andrés (un repo privado); mientras, quedan en ese PC y lo anotas en el relevo.
- `.gitignore`: añade `*.tfplan` y `.env.local` en la Fase 1 (bajo riesgo, no espera OK).
- `.aos/config.json` no existe: lo creas en la Fase 4 con `worktreeLinks` y `maxHeavyProcesses`.
- Gate: los 32 comandos de hoy (88 min, PowerShell y WSL, imagen y e2e) no son el gate de un worker en la VM. En la Fase 4 el gate queda en lint, typecheck y unit de lo afectado; los e2e (browser, isolation, brand, signup) van a Actions como workflow aparte, igual que la integración. Anota los tiempos de cada uno cuando los montes.
- Slug: la fábrica usa `aos-crm` para el token del panel; coincide con tu `CLAUDE.md`. Andrés lo confirma en la PARADA 0.
- Docker Engine en WSL en vez de Docker Desktop: anotado; no cambia nada del encargo.

### 2026-11-06 · arranque
- Andrés ya te pasó el encargo. Esta rama existe desde ahora.
- Perfil de AWS: tu `aos-crm-dev` apunta a la misma cuenta y al mismo rol que usa la fábrica; úsalo tal cual en el `--profile` del `ProxyCommand`. No hace falta añadir otro perfil (la comprobación con `get-caller-identity` del encargo sigue valiendo).
- Mudanza: `AOS_MOVER_CLI=/opt/aos/cli` y `AOS_MOVER_AOS_HOME=/home/aos/.aos-betty`, como dice el encargo. Si la VM no consigue leer el bus, el script se detiene antes de congelar el tuyo. Un bus con retornos pendientes se mueve entero.
- Scripts del arnés (`medir-verify-linux.sh`, `mover-bus-a-vm.sh`, `ssm-ssh-config`): rama `infra/aws-2026-11` del repo privado del arnés. Si tu `gh` no lo ve, dilo en la bitácora y te llegan por Andrés.
- Gate de los despachos: el arnés ya tiene la lección y la spec para que el encargo derivado tome el gate del `verify.json` del proyecto; hasta que esté en `main`, cada despacho de Betty lleva su gate por `--body-file`.

## Pendiente de ti (lo que esperamos leer en la bitácora)
1. Fase 2: CI del push de `da70ec1b` leída por el coordinador (sin rojos nuevos). La PARADA 2 la deciden Andrés y el coordinador.
2. Specs de la línea base en tu pack: CRM-021 en `pending`, sin despachar en este PC.
3. CRM-020: fix-forward del check de marca, verify en verde, aceptación y PR contra `betty/factory` con `--base` explícito; la petición de fusión, en la bitácora.
4. Fase 4: «mudanza hecha», con el comando de 20:34Z y los conteos de specs cuadrados, para dar de alta el bus.
5. Después: Fase 3 (despliegue desde Actions) y Fase 5 (relevo, con la fecha en que dejaste el override).
