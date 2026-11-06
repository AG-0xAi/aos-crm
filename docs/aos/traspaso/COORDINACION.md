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

### 2026-11-06 21:45Z · DECISIÓN DE ANDRÉS: cambian el final de la Fase 2, el orden de las fases y la regla de pushes
Andrés lo aprobó en el chat del coordinador. En estos cuatro puntos sustituye a lo que dice el encargo.

1. **La Fase 2 termina con la CI medida, no toda verde.**
   - Rojos de infraestructura (runner, servicios, versiones, permisos, acciones): arréglalos en `ci/fork`; son trabajo de la Fase 2. Storybook: si no queda verde con un par de ajustes (shards, tamaño del runner), pasa a la línea base; no te quedes iterando.
   - Rojos de código o pruebas (los de la marca de Betty: formato y textos sin traducir en `twenty-emails`, el Markdown generado de iconos en `twenty-ui`, lint y tests del front, y los que salgan en servidor): no los arregles ahora. Anótalos en la bitácora como **línea base**: check, test y fichero de cada uno, sobre el commit de `betty/factory` en que corrió.
   - Después: pide a Andrés que fusione el PR #4 (o que dé OK al coordinador para hacerlo) y haz la PARADA 2: `betty/factory` con PR obligatorio, sin pushes directos y, como checks obligatorios, **solo los que pasan en la línea base** (lístalos). Los demás se añaden a medida que se pongan verdes.
2. **Esos rojos de código son las primeras specs del bus en la VM.** Regístralas en tu pack con el CLI `aos` antes de la mudanza, para que viajen con él: una spec por grupo coherente (correos, iconos, lint del front, tests del front, servidor), tamaño S como mínimo (XS se lo asigna a un modelo pequeño), cada una con un contrato corto: qué falla, qué check lo demuestra y criterio de hecho = ese check verde en su PR. Estado `pending`. No las despaches en este PC.
3. **Orden nuevo: la Fase 4 va antes que la Fase 3.** Tras la PARADA 2 haces la mudanza (Fase 4) con el comando corregido de abajo (21:25Z). La Fase 3 (despliegue desde Actions) va después, desde este PC; hasta entonces, si hace falta desplegar, se hace como hoy y solo con OK de Andrés. La Fase 5 (relevo) cierra.
4. **El override de la guarda `pre-push` NO es «siempre»: vale solo mientras dura el traspaso.** Andrés lo aclara: es para terminar de montar esto, no una regla permanente. Mientras tanto: cada push con su razón escrita (`AOS_PUSH_OVERRIDE_REASON="traspaso Betty: <qué subes>"`) y nunca un push directo a `betty/factory` (solo fusiones en GitHub). Se acaba al cerrar la Fase 5, o antes si Andrés lo retira; anota en el relevo cuándo dejaste de usarlo. Después, todo cambio de Betty llega por PR desde los workers de la VM, con su gate y la CI de Actions.

### 2026-11-06 21:25Z · CORRECCIÓN para la mudanza (Fase 4): tu pack no viajaba
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

### 2026-11-06 21:05Z · tu Fase 2, leída (poda y primeras ejecuciones)
- Bien la poda (10 workflows) y el cambio de base a `betty/factory`; los rojos de `pull_request_target` que vienen de la versión vieja de la línea desaparecen al fusionar #4, como dices.
- Sugerencia, no orden: `ci-utils` (Danger) es el bot de PR de Twenty y corre con `pull_request_target`, que en un repo público ejecuta con permisos de escritura sobre PR de terceros. No lo necesitamos; valora quitarlo también. Si lo dejas, que ningún job suyo declare `environment: beta` cuando existan los secretos de la Fase 3.
- `ci-front-storybook-test` suele ser el job más largo de Twenty: anota su duración aparte; si pasa de los 30 min, propón dejarlo solo en `push` a `betty/factory`, no en cada PR.
- Con la regla de Andrés («override siempre»), la protección de `betty/factory` de la PARADA 2 pasa a ser la única guarda de la línea: pídela en cuanto la CI esté verde, antes de seguir a la Fase 3.

### 2026-11-06 20:50Z · PR #2 y #3 fusionados en `betty/factory`
- Andrés dio el OK y el coordinador los fusionó con merge commit: `betty/factory` está en `6c6fd84d9`. `AGENTS.md` ya es fichero normal en la línea y `deploy/aws` lleva `favicon-redirects.tf` y `source-code.tf`.
- Antes de la Fase 2: `git fetch origin` y arranca `ci/fork` desde ese `betty/factory`. El `deploy/aws` de la línea es ahora el aplicado; el `terraform plan` de la Fase 3 debe salir sin cambios salvo el digest.
- Sigue pendiente de Andrés la regla general de pushes (20:20Z).

### 2026-11-06 20:40Z · tu Fase 1, leída; los PR #2 y #3 revisados
- PR #2 (`deploy/aws`: favicon en el ALB y aviso de código fuente): revisado por el coordinador, limpio. Son las dos reglas del listener (prioridades 10 y 11) que el traspaso del 04-11 ya describía como aplicadas, más `SOURCE_CODE_URL` y `APP_VERSION` con validación semver. Recomendado fusionar; lo fusiona Andrés.
- PR #3 (`AGENTS.md` como fichero normal): revisado, limpio. Solo cambia el modo, mismo blob. Recomendado fusionar; lo fusiona Andrés.
- PR #1 (CRM-016): su contenido ya es la base de `betty/factory`. Ciérralo con una nota o cámbiale la base; no lo fusiones en `codex/crm019-marca-betty`.
- Los dos eventos `gate.override` de tu bus: viajan con el bus en la Fase 4 y se cierran en la VM; no los toques.
- La regla general de pushes para la Fase 2 sigue en manos de Andrés (abajo, 20:20Z). Hasta que la dé, no empieces la Fase 2.

### 2026-11-06 20:20Z · respuesta a tu Fase 0 (f) y al bloqueo de la guarda pre-push
- Leído tu inventario de AWS: beta sana (1/1 y 1/1, `rolloutState=COMPLETED`), plan sin cambios, humo 200, SES en sandbox, sin proveedor OIDC (lo creará Andrés en la PARADA 3a), roles solo los de ECS. Bien el plan con `-lock=false` desde el disco de WSL.
- La guarda `pre-push` hace lo que debe: nada llega al remoto sin gate verde, y su override es del humano. Lo que le pedimos a Andrés (la decisión es suya; te la dará en el chat) es esta regla para el traspaso: override con razón (`AOS_PUSH_OVERRIDE=1 AOS_PUSH_OVERRIDE_REASON="traspaso Betty: gate en Actions, <qué subes>"`) SOLO para `backup/*`, `traspaso/*`, `ci/*` y las ramas de PR hacia `betty/factory`. `betty/factory` nunca se empuja a mano: solo recibe fusiones en GitHub y en la Fase 2 queda protegida con los checks de Actions obligatorios. El invariante se mantiene (nada en la línea sin gate verde); solo cambia quién corre el gate.
- No empujes desde un árbol sin bus para saltar la guarda, tampoco la bitácora: anotaste bien el hueco y la fábrica lo registra como lección del arnés. Hasta que Andrés conteste, la bitácora también va con el override y su razón, desde tu checkout.
- `codex/crm019-favicon-alb`: súbela tal cual con esa regla y abre su PR hacia `betty/factory`; es el Terraform aplicado. El PR #1 (CRM-016) quedó sin sentido porque su contenido ya es la base de `betty/factory`: ciérralo con una nota o cámbiale la base.
- Para la Fase 3, al diseñar: el estado remoto contiene los secretos que genera Terraform, así que el rol de `plan` también los puede leer; valora que el `plan` corra solo dentro del environment `beta`, o acéptalo y déjalo escrito. `budget_alert_email` es un dato personal: va como variable del environment, no al `beta.auto.tfvars` público.

### 2026-11-06 19:55Z · tu clave ya abre la VM
- Instalada en `authorized_keys` de `aos` a las 19:30Z. Te faltan solo tus dos cosas: el plugin de Session Manager y la aprobación de tu código SSO por Andrés.
- Prueba de humo al entrar: `ssh aos-factory-01 'aos-betty --version; ls -ld /opt/aos/betty'` debe decir «Agentic Engineering OS» y mostrar el directorio vacío con permisos `2775`.
- Recuerda la regla 4 del encargo: el usuario `aos` de la VM tiene sudo, así que con esa clave puedes romper otros buses. Toca solo `/opt/aos/betty`, `/home/aos/.aos-betty` y `/home/aos/betty-*`; lo de root lo pides por la bitácora.

### 2026-11-06 19:45Z · respuesta a tu Fase 0 (puntos a-e, g, h)
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
1. Fase 2: rojos clasificados, línea base y tabla de tiempos en la bitácora; PR #4 fusionado; PARADA 2 con los checks de la línea base.
2. Las specs de la línea base registradas en tu pack (estado `pending`).
3. Fase 4: «mudanza hecha», con el comando de 21:25Z y los conteos de specs cuadrados, para dar de alta el bus.
4. Después: Fase 3 (despliegue desde Actions) y Fase 5 (relevo, con la fecha en que dejaste el override).
