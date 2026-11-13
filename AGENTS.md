# AOS-CRM — bootstrap: documentación final y revisión en curso (CRM-041)

Este es el proyecto **AOS-CRM**, slug `aos-crm`, con tracks `CRM-`.
La orden vigente es `AOS_CRM_Bootstrap.md` (`.aos/onboarding/AOS_CRM_Bootstrap.md`, fuera de Git — no hay un fichero con ese nombre en la raíz del repo). El founder autorizó comenzar el 27 de octubre de 2026 y aprobó el mapa con «go». **El estado medido de hoy frente a cada requisito del contrato de cierre — qué está satisfecho, con qué archivo o PR, y qué sigue pendiente — está en [docs/aos/bootstrap/DELIVERY.md](docs/aos/bootstrap/DELIVERY.md); léelo antes de asumir que algo ya terminó.** La radiografía original sigue en [docs/aos/bootstrap/README.md](docs/aos/bootstrap/README.md). Las specs y sus contratos están registrados en el pack canónico.

El registro en el panel, la membresía admin del founder y la instalación de AOS Factory ya están resueltos. Usa el bus local `.aos/` y el pack canónico `.aos/pack/aos-crm/`; no repitas el alta ni crees un segundo bus. Las evidencias y una copia del encargo están en `.aos/onboarding/`.

Twenty está incorporado en esta carpeta sobre `twenty/v2.51.0`, SHA `15e4826d3b5fc5867baeabeeb42b253892b2d4da`, con historial no superficial y remoto `upstream`. El fork `AG-0xAi/aos-crm` y `origin` están verificados. Dependencias instaladas y servicios arrancados: hay un stack local (`deploy/local/compose.yaml`) y, con orden LIVE del founder, una beta multi-espacio en AWS — ver [BETA_RUNBOOK.md](docs/aos/product/BETA_RUNBOOK.md) y [AWS_DEPLOYMENT_PLAN.md](docs/aos/bootstrap/AWS_DEPLOYMENT_PLAN.md). El gate real vive en `.aos/verify.json` (privacidad, marca, lint, typecheck y unit tests de lo afectado); integración, Storybook y E2E corren en GitHub Actions del fork, no en ese gate. Configura o amplía el gate solo después de comprobar sus comandos. Conserva las convenciones upstream guardadas en `docs/aos/upstream/CLAUDE.md` al modificar su código.

<!-- AOS:BEGIN v3 — bloque gestionado por `aos init` / `aos docs sync`. NO editar a mano:
     lo que escribas aquí se pierde en el próximo refresco. Tu texto propio va FUERA del bloque. -->

# Estás operando dentro de AOS

Este proyecto corre sobre **AOS** (Agentic Engineering OS). Todo lo que sigue aplica **antes** de
que hagas nada. No es contexto de fondo: es el contrato de operación.

Producto: **AOS-CRM** · slug del panel: `aos-crm` · prefijo de tracks: `CRM-`.

## 0. Primer contacto con un código que no conoces (antes de nada)

Si el proyecto aún no tiene historia en AOS —sin specs propias en `packs/aos-crm/`, sin índice
de grafo (`.codegraph-aos/`)— tu PRIMERA tarea **NO** es crear specs ni despachar. Es la
**radiografía**, igual que al entrar a cualquier código ajeno. Crear specs antes de entender el
código es exactamente cómo salen specs que no calzan.

1. **Indexa el grafo:** `aos graph build --project .`. Sin esto, `aos graph query` te devuelve
   símbolos de OTRO proyecto. Compruébalo: `aos graph query <sustantivo-del-dominio> --project .`
   debe responder rutas de ESTE repo. Si devuelve rutas que no existen aquí, el índice no es tuyo
   —el proyecto necesita `graphProject` propio: **escala al founder**, no sigas a ciegas.
2. **Mapea:** qué es, cómo arranca, módulos y fronteras, y dónde vive el riesgo.
3. **Barrido de seguridad** (reportas, no "arreglas" en silencio): secretos versionados
   (`git grep` de claves/tokens/`.env`), authz/authn (quién puede qué), inyección (SQL/comando/
   ruta), validación de entrada, dependencias con CVE conocidos, y superficie expuesta sin gate.
   Un secreto versionado es hallazgo **P0**: se reporta, no se rota solo (es del dueño).
4. **REPORTA al founder** el diagnóstico + el plan propuesto (qué specs saldrían y en qué orden).

**Specs y dispatch solo DESPUÉS de que el founder vea el mapa y apruebe por dónde empezar.** Con
un proyecto que ya tiene historia AOS, esto ya está hecho: pasa directo al punto 1 de abajo.

## 1. Lo primero de cada sesión (antes de proponer nada)

```
aos status --project .
```

Léelo entero y **atiende lo que aparezca**, en este orden:

1. **Cola de aceptación (`Needs S-00 = yes`).** Cada línea es trabajo entregado que nadie firmó.
   Mientras no se cierre, **el panel del founder no se mueve** aunque hayáis trabajado todo el día:
   la barra mide trabajo *aceptado*, no trabajo *hecho*. Decide cada uno: si está bien,
   `aos done --archive --track <T>` (eso marca la spec y mueve la barra); si no, redespacha. Un
   `aos done` **sin `--archive`** solo apaga la alarma y no marca nada — casi nunca es lo que quieres.
2. **Runs `RUNNING` con el proceso muerto** (latido viejo). Es un worker que murió sin devolver:
   `aos reap --project .`. No lo dejes: bloquea la lane y falsea el estado.
3. **Tracks en `INCOMPLETE` o `NEEDS_S00`.** Deuda que crece sola.

Si la cola tiene más de un par de días, esa es tu tarea, no lo que ibas a hacer.

## 2. Nada se publica sin verificar

- El gate del proyecto vive en `.aos/verify.json`. **Córrelo tú antes de abrir un PR o pedir un
  merge**, aunque el cambio parezca trivial y aunque lo haya hecho un worker. Un PR sin build es un
  PR roto que alguien va a tener que descubrir leyendo.
- **En el cuerpo del PR va la evidencia**: qué comandos corriste, con qué código de salida, sobre
  qué commit. Si el proyecto no tiene gate configurado, dilo explícitamente en el PR.
- Si el gate no está configurado (`commands: []`), configúralo o dilo — no lo dejes en silencio.

## 3. Lo que un agente NO puede hacer, nunca

- **Certificarse a sí mismo.** El veredicto de un trabajo lo emite el arnés desde su propia
  observación. Escribir a mano un `worker.return`, un recibo de gate o cualquier evento de éxito es
  falsificación, aunque el trabajo esté bien.
- **Fusionar su propio trabajo.** Abres el PR y paras. El merge es de un humano.
- **Empujar a `main`/`master`** ni reescribir historia ajena.
- **LIVE, deploys o migraciones contra datos reales** sin OK explícito del founder.
- **Secretos** al repo, a los logs o a los commits. Si encuentras uno versionado: es hallazgo P0,
  se reporta, no se "arregla" en silencio (rotarlo es decisión del dueño).

## 4. Cómo se verifica (esto es lo que más se salta)

- **`exit 0` no es trabajo hecho.** Verifica por `git diff`, por la salida real, por el archivo en
  disco. Un comando que devuelve 0 sin cambiar nada es el fallo más común del sistema.
- **La evidencia ajena se re-ejecuta, no se lee.** Si un informe dice "tests en verde", córrelos. Si
  dice "no se pudo verificar porque X", comprueba X: casi siempre X es falso o hay otra invocación.
- **Toda afirmación sobre lo que el repo NO tiene** se contrasta con `ls` o `git grep` antes de
  escribirla. Cuesta segundos y evita el ridículo.
- **Si una suite ya estaba roja, mide la línea base** en la rama base antes de atribuir nada a tu
  cambio. Sin baseline, "fallo preexistente" es una suposición.

## 5. Git en una máquina con varias sesiones

- Comprueba **en qué rama estás** antes de commitear. Puede haber otro agente trabajando en el mismo
  checkout.
- El pathspec va en el **`commit`**, no solo en el `add`: `git commit <rutas> -m "..."`. Un
  `git commit` sin rutas se lleva todo el índice, incluido el trabajo staged de otro.
- Después de cualquier commit, `git show --stat` y **cuenta los archivos** contra lo que esperabas.
- Nunca `git add -A` donde haya junctions o enlaces a packs de otros clientes.

## 6. Mantener el sistema vivo (nadie lo hace por ti)

El arnés tiene alarmas, pero **no se auto-instalan y algunas dependen de que algo esté corriendo**.
Compruébalo al empezar y avisa al founder si falta algo:

- `aos crons status` — la tarea de salud (`AOS-Health-Runner`) ejecuta reaper y watchdog. Si sale
  **NO-INSTALADA**, no hay nada cerrando runs zombis ni vigilando workers colgados. Instalarla
  requiere consola de **administrador**: si no la tienes, **escala al founder**, no lo dejes pasar.
- Las notificaciones push son best-effort: **sin suscripciones registradas no llega nada**. No
  asumas que una alerta avisó a alguien.
- El panel es la fuente de verdad del founder, pero **solo refleja lo aceptado y lo que emite el
  bus**. Trabajo que no pasa por el bus es trabajo invisible para él.

## 7. Cómo se trabaja aquí

- **Nada de código sin spec.** El alcance vive en `specs.json` (registro) y el contrato en
  `packs/aos-crm/specs/<capacidad>/spec.md` (Purpose + Requirements SHALL/MUST + Scenarios
  GIVEN/WHEN/THEN). Toda spec de tamaño S o mayor necesita contrato o notas sustanciosas; el
  dispatch lo exige.
- **Prefijo de tracks: `CRM-` y solo `CRM-`.** El control-plane es compartido entre
  productos: dos con el mismo prefijo colisionan.
- Delega por el bus (`aos dispatch` → `aos worker`), no con subagentes por fuera: lo que no pasa por
  el bus no queda auditado.
- **Cada error nuevo se registra** como lección (Síntoma → Causa → Fix → Regla) antes de cerrarlo.
  Si algo te sorprendió hoy, va a sorprender a otro dentro de un mes.

## 8. Al founder se le habla claro

Reportas en lenguaje de negocio, sin jerga y sin adornos. **"Lo verifiqué y funciona" solo si lo
verificaste**; si no, di qué falta. Escalas decisiones de producto, coste, credenciales y todo lo
que sea LIVE. No le uses de mensajero entre agentes: si necesitas algo de otra sesión, díselo con lo
que ya sabes resuelto y lo que falta.

## 9. Cómo está montada la fábrica (no la adivines)

Una capacidad que no encuentras no es una que no existe. Antes de construir un rodeo, pregúntale
al CLI (`aos <comando> --help`) y al manual sembrado (`.aos/docs/aos-mechanic-manual.md`); si
sigue sin estar, **escala** en vez de inventar la mecánica.

- **Un bus por proyecto:** el `.aos/` de este checkout. Dispatch, runs, retornos, aceptación y
  panel pasan por él. **Nunca se parte el bus:** ni otro `.aos`, ni el repo clonado en "slots",
  ni proyectos nuevos para ganar paralelismo. Partes la cola, S-00 y el panel dejan de verla
  entera, y el `.aos` nuevo nace sin gate: sus PASS son autodeclarados. Cambiar la topología es decisión del founder.
  **Si tu proyecto ya opera en slots** (varios checkouts, cada uno con su `.aos`), sigue operando así
  y escala la migración; no la hagas por tu cuenta. Mientras tanto, cada slot debe tener el mismo
  `.aos/verify.json` que el principal: un slot sin gate firma PASS vacíos.
- **Paralelo = un worktree por worker sobre ese mismo bus:** `aos worker --project . --agent
  claude --worktree` (o `AOS_WORKER_WORKTREE=1`). Cada run trabaja en `.aos/worktrees/<runId>`,
  su verify corre en ese árbol y su retorno cae al bus como cualquier otro. Alcances disjuntos
  (no dos workers sobre los mismos ficheros) y techo de 4-5 a la vez. En el brief, pide que el
  worker cree su rama (`git checkout -b <rama>`) antes de commitear. Sin `--worktree`, dos
  workers comparten árbol, índice y rama, y el arnés avisa al lanzar el segundo.
- **S-00** es `aos s00`: un despertar que acepta lo que pasa los gates, rescata, encola lo que ya
  tiene brief, escala lo ambiguo y termina. `aos s00 --diagnose` lee la cola sin tocarla.
- **Revisor:** `aos review --track <T>` re-revisa el commit del track; `--range <base>..<tip>`
  revisa una ventana. Si commiteaste en el checkout con un worker en vuelo, `--range
  <tu-commit>..<tip>` deja fuera lo tuyo.
- **Qué cambió y cuándo:** `.aos/docs/aos-cambios-de-la-fabrica.md` (síntoma, cambio, qué haces
  distinto y si ya está desplegado).

<!-- AOS:END v3 -->
