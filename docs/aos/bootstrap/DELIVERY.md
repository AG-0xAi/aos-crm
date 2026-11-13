# CRM-041 — Delivery mapping: final bootstrap documentation and independent review

Fecha: 13 de noviembre de 2026. Track: CRM-041 (`crm-bootstrap-delivery`, CRM-006 en `EXECUTION_PLAN.md`).
Contrato fuente: `.aos/pack/aos-crm/specs/bootstrap-delivery/spec.md` (solo lectura, fuera de Git).
Dependencia `crm-functional-acceptance` (CRM-005): hecha — ver `FUNCTIONAL_EVIDENCE.md`.

Este documento no certifica nada por sí mismo. Mapea cada requisito del contrato a lo que ya
existe (archivo o PR) y a lo que sigue pendiente, con comandos reales donde los hay. Lo que un
reviewer o el founder necesite verificar está marcado explícitamente como pendiente, no asumido.

## Estado actual (13-11-2026)

### Beta en AWS

Compute: ECS Fargate para server y worker (`deploy/aws/ecs.tf`: `aws_ecs_task_definition.server`/`.worker`,
`aws_ecs_service.server`/`.worker`, `launch_type = "FARGATE"`). Storage: RDS PostgreSQL
(`deploy/aws/rds.tf`, `engine = "postgres"`) y ElastiCache en modo réplica (`deploy/aws/redis.tf`,
`aws_elasticache_replication_group`, motor `valkey`). Correo: SES, cuenta todavía en sandbox
(`deploy/aws/ses.tf`; `docs/aos/product/BETA_RUNBOOK.md`, sección del sandbox de SES). Funciones de
lógica: driver Lambda (`deploy/aws/logic-function.tf`, CRM-035, PR #26). Despliegue: workflow
`.github/workflows/deploy-beta.yaml`, autenticado por GitHub OIDC (`permissions: id-token: write`,
`aws-actions/configure-aws-credentials`, `role-to-assume: vars.AWS_DEPLOY_ROLE_ARN`). El estado real
de estos recursos (si siguen corriendo, coste acumulado, si SES ya salió del sandbox) **no se puede
medir desde esta VM/worktree**: esta sesión no tiene credenciales AWS. Detalle completo en
`docs/aos/product/BETA_RUNBOOK.md` y `docs/aos/bootstrap/AWS_DEPLOYMENT_PLAN.md`.

### Fábrica

Un único bus AOS por proyecto, en `.aos/` de este checkout; no se parte. Línea de integración
`betty/factory`, protegida en GitHub como rama de integración (no verificable desde esta sesión sin
credenciales de la API de GitHub). El gate real del proyecto vive en `.aos/verify.json` (fuera de
Git): instala dependencias con yarn en modo `hardlinks-global`, corre los chequeos estáticos de
marca y privacidad de este repo, lint y typecheck de lo afectado con `nx`, y unit de lo cambiado con
`jest`/`vitest` contra `origin/betty/factory`; no construye imagen, no levanta stack y no corre e2e —
eso vive en GitHub Actions. CI en GitHub Actions del fork (ficheros en `.github/workflows/`):
`changed-files.yaml`, `ci-cross-version-upgrade.yaml`, `ci-emails.yaml`, `ci-front-storybook-test.yaml`,
`ci-front.yaml`, `ci-server.yaml`, `ci-shared.yaml`, `ci-ui.yaml`, `ci-utils-test.yaml`, `ci-utils.yaml`,
`deploy-beta.yaml`.

### Producto

Marca Betty: sin referencias visibles a Twenty (`scripts/aos/verify-brand.mjs`, salida re-ejecutada
abajo). Invitaciones de equipo: PR #15 (`crm028/invitar-equipo-2`), PR #21 (`crm031/menu-invitar`).
Animación de bienvenida: PR #17 (`crm022/bienvenida-betty-4`). Conector MCP: PR #23
(`crm033/menu-conector`), documentado en `docs/aos/product/MCP_CONNECTOR.md`. Correo con marca: PR
#18 (`crm029/correo-marca`), PR #19 (`crm030/correo-acabado`). Webhook de altas: PR #25
(`crm034/webhook-altas`), PR #31 (`crm036/webhook-secreto`). Números de PR citados tal como los
nombra el commit de merge correspondiente (`git log --oneline --merges`), no inferidos.

## R1 — Runbook y cumplimiento

| Sub-requisito | Satisfecho por | Estado |
| --- | --- | --- |
| Setup reproducible | `LOCAL_SETUP.md`, `deploy/local/compose.yaml`, `scripts/aos/local.ps1` | Documentado, no re-medido en este track (medido en CRM-004/CRM-005) |
| Start/stop/restart/recuperación | `docs/aos/product/BETA_RUNBOOK.md` §2, §4, §6, §12 (despliegue/rollback AWS); `deploy/local/compose.yaml` (local) | Documentado, no re-medido en este track. Backup/restauración de PostgreSQL contra datos reales sigue sin probarse — ver "Pendiente de R1" |
| Arquitectura | `ARCHITECTURE.md` (27/10/2026) | Documentado, no re-medido en este track; sigue siendo la referencia estructural (monorepo Nx, server NestJS/worker separado, Postgres/Redis). No describe las capacidades añadidas después (multi-espacio, MCP, AWS) — eso vive en `BETA_RUNBOOK.md` y `AWS_DEPLOYMENT_PLAN.md`, enlazados desde aquí para no duplicar |
| Seguridad | `SECURITY_AUDIT.md`, `LOCAL_SECURITY.md` | Documentado, no re-medido en este track (inspección inicial + perfil local, CRM-002). Las superficies añadidas después (invitaciones, OAuth DCR, MCP, webhook de altas) tienen su propia medición en `BETA_RUNBOOK.md` y `docs/aos/product/MCP_CONNECTOR.md` §2-§6, no repetida aquí |
| Telemetría | `TELEMETRY_AUDIT.md`; gate real `scripts/aos/verify-privacy.mjs` | Re-medido en este track — salida pegada en "Verificación re-ejecutada" abajo |
| Licencias/cumplimiento de componentes | `LICENSE_COMPLIANCE.md` | Documentado, no re-medido en este track; SBOM final y revisión jurídica siguen pendientes ahí mismo |
| Prerrequisitos API/MCP/integraciones | `docs/aos/product/MCP_CONNECTOR.md`, `INTEGRATIONS.md` | Documentado, no re-medido en este track |
| Estrategia upstream | `UPSTREAM_STRATEGY.md` | Documentado, no re-medido en este track |
| R1.1 — ambiente limpio compatible, seguir el runbook, build y test sin secretos no documentados | — | No medido: este track no provisionó un ambiente limpio ni corrió build/test contra él |
| Estado propio en AGENTS.md/CLAUDE.md refleja el estado final medido y enlaza el runbook autoritativo | Introducción propia (fuera del bloque `AOS:BEGIN`) de `AGENTS.md`/`CLAUDE.md`, actualizada en el commit `cdd1ec9b` de este track | Hecho — `git diff --stat` pegado abajo |
| Bloques gestionados de AOS sin tocar | `git diff` de `AGENTS.md`/`CLAUDE.md` contra el commit anterior | Hecho (mismo AGENTS.md/CLAUDE.md) — solo se tocaron las líneas 1-9 (antes de `<!-- AOS:BEGIN -->`); `git diff` pegado abajo |

### Pendiente de R1

- **R1.1 — ambiente limpio.** No medido en este track: no se provisionó un ambiente limpio compatible para seguir el runbook ni se corrió build/test contra él.
- **Backups/restauración de PostgreSQL y de ficheros** contra datos de prueba: `BETA_RUNBOOK.md` §13 lo deja explícito como fuera de este runbook y como "la siguiente pregunta" antes de que haya datos reales. No se mide en este track.
- **SBOM final y revisión jurídica de licencias**: `LICENSE_COMPLIANCE.md` lo deja pendiente desde el 27/10; sigue pendiente.
- **Auditoría de dependencias (`DEPENDENCY_AUDIT.md`)** no se ha vuelto a ejecutar desde el 27/10. Este track no corrió una nueva consulta a OSV: no estaba en los checks que pide el dispatch de CRM-041, y afirmar que sigue vigente sin volver a correrla sería una afirmación sin medir. Queda como pendiente explícito, no como hallazgo nuevo.

## R2 — AWS y límites

**Alcance de este requisito en CRM-041:** que *este* trabajo de documentación no cree recursos,
coste ni credenciales AWS. Eso es lo que se verifica abajo. No es una afirmación de que el
producto en su conjunto nunca desplegó AWS: sí lo hizo, con autorización LIVE explícita del
founder, en tracks anteriores, documentados con sus comandos y códigos de salida en
`AWS_DEPLOYMENT_PLAN.md` y en `docs/aos/product/BETA_RUNBOOK.md` (no se repite aquí la lista de
tracks de esos despliegues: este track no la re-verificó). Este track no reabre, repite ni
re-verifica esas autorizaciones.

| Sub-requisito | Satisfecho por | Estado |
| --- | --- | --- |
| Compute/storage/secrets/backups/isolation/auth/HTTPS cubiertos | `AWS_DEPLOYMENT_PLAN.md` (secciones CRM-011 R1-R3, CRM-013 R1-R4, CRM-017, CRM-018) | Hecho — documentado con Terraform en `deploy/aws/**` y comandos reales (`terraform fmt/init/validate`, escaneo de secretos) |
| CI/CD | `.github/workflows/deploy-beta.yaml` (OIDC vía `aws-actions/configure-aws-credentials`, `permissions: id-token: write`), `deploy/aws-bootstrap/github-deploy-role/` | Hecho — confirmado con `grep` sobre el workflow en este checkout, salida pegada en "Verificación re-ejecutada" abajo |
| Supuestos de coste | `AWS_DEPLOYMENT_PLAN.md`, sección "Coste estimado (staging mínimo)" | Hecho parcialmente: tarifas verificadas para Fargate/ALB/NAT/Secrets Manager/CloudWatch/ECR; RDS/ElastiCache/S3/Budgets marcados explícitamente "no verificado" en el propio documento, no inventados |
| Ningún recurso/coste/crédito AWS creado **por este track** | Sin cambios a `deploy/aws/**`, `deploy/aws-bootstrap/**` ni a ningún `.tf`/`.tfvars` en este commit; sin `terraform plan`/`apply`; sin credenciales AWS usadas en esta sesión | Hecho — `git status --short` limpio antes de cada commit, salida pegada en "Verificación re-ejecutada" abajo |
| Fuera de alcance: agentes comerciales a medida, billing, tenancy prematuro | Sin `stripe`/billing comercial en el repo (solo `aws_budgets_budget`, que es una alarma de gasto, no facturación de clientes); sin SSO/row-level Enterprise activado (`ENTERPRISE_KEY=""` en `deploy/local/privacy.env` y `deploy/aws/ecs.tf`) | Confirmado por grep en este track, no implementado |

### Pendiente de R2

- **Estado real de los recursos AWS en este momento** (si la beta sigue corriendo, su coste acumulado, si SES ya salió del sandbox) no se puede medir desde esta VM/worktree: esta sesión no tiene credenciales AWS ni acceso a la cuenta. `BETA_RUNBOOK.md` §9 registra que la solicitud de salida del sandbox de SES fue denegada una vez y sigue abierta; no se ha vuelto a comprobar aquí.

## R3 — Revisión y reporte

**Este worker no puede cerrar R3 por su cuenta.** El contrato exige que "the AOS independent
reviewer" evalúe frontera de arquitectura, contrato, efectos colaterales, calidad de tests, el
registro de deuda y el siguiente paso, y que el coordinador vuelva a correr los gates reales del
proyecto y emita un After-Commit Report A-M con hashes/ficheros/evidencia. Eso es un paso posterior
a este commit, no algo que este reporte pueda autodeclarar.

Lo que **sí** se hizo en este track y queda como insumo para esa revisión:

| Qué pide R3 | Dónde está el insumo |
| --- | --- |
| Frontera de arquitectura | Alcance de este track: solo `docs/aos/bootstrap/**`, `AGENTS.md`/`CLAUDE.md` (fuera del bloque gestionado). Sin cambios a `packages/`, `deploy/`, ni a ningún script. Verificable con `git diff --stat` del rango de este track |
| Contrato | Tabla de R1/R2 arriba, con archivo o PR por cada sub-requisito |
| Efectos colaterales | Ninguno: sin instalación de dependencias, sin build, sin recursos AWS, sin escritura a bases de datos. Los dos checks que corrieron (`verify-privacy.mjs`, `verify-brand.mjs`) son de solo lectura sobre el árbol de fuentes |
| Calidad de los tests | Este track no añade tests: es documentación. La calidad de los tests del producto está en los `.aos/reports/CRM-*.md` de cada track citado arriba (fuera de Git, en el bus) |
| Registro de deuda | `DEFERRED_LEDGER.md` es una fotografía del 27/10/2026, previa a la aprobación del mapa; no se ha reescrito para reflejar CRM-007 a CRM-037. Este track no lo actualiza retroactivamente (no es su alcance) pero lo marca aquí como desactualizado, para que el reviewer no lo lea como la cola de pendientes actual. Los pendientes reales a fecha de hoy son los listados en este documento (R1/R2) más los que cite cada `.aos/reports/CRM-*.md` |
| Alcance y siguiente paso | Siguiente paso: el coordinador corre `aos review --track CRM-041` (o `--range` sobre el rango de commits de este worktree) y re-ejecuta `.aos/verify.json` sobre este checkout; solo después de eso cabe considerar el bootstrap "aceptado" |

### Pendiente de R3 (no marcar como resuelto hasta que ocurra)

- `aos review --track CRM-041` (o el `--range` equivalente) — no corrido por este worker.
- Re-ejecución completa de `.aos/verify.json` (12 comandos, incluida `yarn install`) sobre este
  checkout — no corrida en este track; ver más abajo cuáles de esos 12 comandos sí se re-ejecutaron
  y cuáles no.
- El After-Commit Report A-M final, con hashes y evidencia — lo emite el coordinador, no este
  worker.

## Verificación re-ejecutada en este track (no leída, corrida)

Todo lo siguiente se ejecutó en este worktree
(`.aos/worktrees/2026-11-13T09-36-04-348Z-CRM-041-53d4f490`), rama `crm041/bootstrap-delivery-2`,
el 13 de noviembre de 2026, después de fusionar `cdd1ec9ba429be46ec3a2e2566636167daa11dfd`
(rama `crm041/bootstrap-delivery`, run anterior).

```
$ node scripts/aos/verify-privacy.mjs
[... 15 checks PASS, detalle de cada uno omitido aquí por brevedad ...]
PASS: all 15 privacy checks passed.
exit 0
```

```
$ node scripts/aos/verify-brand.mjs
[PASS] no user-visible reference to Twenty, and no reference to a Twenty-branded asset file, in 20270 shipped source files (35 allowlisted exceptions, each with a reason).
[PASS] every brand asset path this repo names exists on disk, every <Row> in the e-mail package wraps its children in <Column>, and index.html names an absolute https image for both social preview cards.
exit 0
```

Comprobación de enlaces Markdown de este fichero (el comando del dispatch; alcance: solo
`docs/aos/bootstrap/DELIVERY.md`):

```
$ node -e 'const fs=require("fs"),p=require("path");const f="docs/aos/bootstrap/DELIVERY.md";const s=fs.readFileSync(f,"utf8");let bad=0;for(const m of s.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)){const t=m[1];if(/^https?:/.test(t))continue;if(!fs.existsSync(p.resolve(p.dirname(f),t))){console.log("BROKEN",t);bad++}}process.exit(bad?1:0)'
exit 0
```

Sobre el commit base `cdd1ec9ba429be46ec3a2e2566636167daa11dfd` (antes de este run) el mismo
comando imprimía `BROKEN AOS_CRM_Bootstrap.md` y salía con `exit 1`: el "Cambios hechos en este
track" de ese commit describía el enlace roto que se corrigió escribiendo la sintaxis de enlace
Markdown real y completa, que el propio chequeo interpretaba como un enlace vivo. Se reescribió esa
frase sin reproducir esa sintaxis (ver "Cambios hechos en este track" abajo); el chequeo vuelve a
dar `exit 0`.

Grep de OIDC en el workflow de despliegue (soporta la fila CI/CD de R2):

```
$ git grep -n -E 'id-token|configure-aws-credentials|role-to-assume' -- .github/workflows/deploy-beta.yaml
.github/workflows/deploy-beta.yaml:18:  id-token: write
.github/workflows/deploy-beta.yaml:71:        uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
.github/workflows/deploy-beta.yaml:73:          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
exit 0
```

Greps del dispatch para R2 (sin SSO/Enterprise ni billing comercial):

```
$ git grep -n ENTERPRISE_KEY -- deploy/ ':!*.md'
deploy/aws/ecs.tf:28:    ENTERPRISE_KEY                        = ""
deploy/local/privacy.env:70:ENTERPRISE_KEY=
[... 4 líneas de comentario con el mismo nombre de variable, omitidas aquí ...]
exit 0
```

```
$ git grep -niE 'stripe|billing' -- deploy/ ':!*.md'
deploy/aws/budgets.tf:4:# allocation tag in the Billing console first (a manual step outside
exit 0
```

La única coincidencia es un comentario que nombra la consola de facturación de AWS como paso
manual previo a aplicar Terraform, no una integración de billing de clientes; no hay `stripe` en
el árbol de `deploy/`.

```
$ git status --short
 M docs/aos/bootstrap/DELIVERY.md
```

(salida tomada mientras este fichero seguía en edición, antes del commit de este track; después
del commit, `git status --short` queda limpio — confirmado con `git show --stat` tras commitear,
ver más abajo).

`git diff --stat` de `AGENTS.md`/`CLAUDE.md` entre el commit base de este track (`d42bc7888c`) y el
commit del run anterior (`cdd1ec9ba429be46ec3a2e2566636167daa11dfd`), que es el que introdujo esos
cambios y se conserva en este run:

```
$ git diff --stat d42bc7888c cdd1ec9ba429be46ec3a2e2566636167daa11dfd -- AGENTS.md CLAUDE.md
 AGENTS.md | 6 +++---
 CLAUDE.md | 6 +++---
 2 files changed, 6 insertions(+), 6 deletions(-)
```

`git diff` completo de esas dos líneas confirma que solo se tocaron las líneas 1-9 de cada fichero
(antes de `<!-- AOS:BEGIN -->`): el bloque gestionado no cambia en ese diff.

### Lo que NO se re-ejecutó en este track, y por qué

El dispatch de CRM-041 solo pide `verify-privacy.mjs` y `verify-brand.mjs` como checks explícitos,
y dice expresamente "no dependency install needed unless a check in the contract requires it". El
gate completo de `.aos/verify.json` tiene 12 comandos, empezando por `yarn install` (necesario para
que `nx`/`jest`/`vitest` existan) y siguiendo con lint/typecheck/unit afectado. Este track no instaló
dependencias ni corrió esos 10 comandos restantes, porque:

1. Este track no tocó código de `packages/` (solo Markdown de `docs/aos/bootstrap/` y las dos líneas
   de introducción de `AGENTS.md`/`CLAUDE.md`), así que `nx affected` no encontraría nada que analizar
   sobre ese `base`.
2. El dispatch no lo pidió.

Esto se deja explícito, no en silencio: **el gate completo no se re-ejecutó en este track.** Si el
coordinador quiere una confirmación de que `.aos/verify.json` sigue en verde sobre `betty/factory`
después de fusionar este cambio puramente documental, esa es la re-ejecución pendiente de R3 citada
arriba, no algo que este reporte pueda dar por hecho.

## Cambios hechos en este track

Este run (`crm041/bootstrap-delivery-2`) parte de fusionar el commit `cdd1ec9b` del run anterior
(`crm041/bootstrap-delivery`) y edita solo `docs/aos/bootstrap/DELIVERY.md`:

- Añadida la sección "Estado actual (13-11-2026)" (beta AWS, fábrica, producto), con enlaces en
  vez de duplicar contenido.
- Corregida la ruta al contrato fuente a `.aos/pack/aos-crm/specs/bootstrap-delivery/spec.md`: la
  ruta anterior era local a un worktree concreto, no una ruta del repo.
- Ninguna fila de la tabla de R1 queda en `Hecho` salvo que este run la haya medido y pegado la
  salida, o que se trate de la fila de `AGENTS.md`/`CLAUDE.md` con su `git diff --stat` pegado.
  Las demás pasan a `Documentado, no re-medido en este track`. Se añade la fila R1.1 como
  `No medido`.
- Añadidos los comandos reales (con salida) que antes solo se mencionaban como "ver sección de
  comandos" o "ver comando abajo": grep de OIDC del workflow de despliegue, los dos greps de R2
  (`ENTERPRISE_KEY`, `stripe|billing`), y el chequeo de enlaces re-ejecutado con su resultado antes
  y después del fix.

Lo que ya hizo el run anterior y este run conserva sin cambios:

- `docs/aos/bootstrap/README.md`: entrada al índice y nota de que el estado actual vive en
  `DELIVERY.md`, sin reescribir el resto del documento (sigue siendo la fotografía del 27/10/2026).
- `AGENTS.md` / `CLAUDE.md`, introducción propia (antes de `<!-- AOS:BEGIN -->`): actualizada para
  reflejar el estado medido (dependencias instaladas, servicios arrancados en local y en la beta AWS,
  gate real con lint/typecheck/unit) y enlazar `DELIVERY.md` como runbook autoritativo.
- Sin cambios a `packages/`, `deploy/`, `scripts/` ni a ningún `.tf`/`.tfvars`, en ninguno de los
  dos runs.

## Invariantes comprobados

- Sin secretos añadidos: este track no escribió ningún valor de credencial, solo Markdown y dos
  párrafos de introducción.
- Sin recursos/costes AWS creados por este track (ver R2).
- Sin merge ni push propios: cambios commiteados localmente en `crm041/bootstrap-delivery-2`;
  publicar el PR y fusionarlo es del coordinador/founder.
- Prefijo de tracks `CRM-` respetado; ningún track nuevo registrado por este documento.
