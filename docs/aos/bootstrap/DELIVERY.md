# CRM-041 — Delivery mapping: final bootstrap documentation and independent review

Fecha: 13 de noviembre de 2026. Track: CRM-041 (`crm-bootstrap-delivery`, CRM-006 en `EXECUTION_PLAN.md`).
Contrato fuente: `.aos-spec/bootstrap-delivery/spec.md` (solo lectura, fuera de Git en este worktree).
Dependencia `crm-functional-acceptance` (CRM-005): hecha — ver `FUNCTIONAL_EVIDENCE.md`.

Este documento no certifica nada por sí mismo. Mapea cada requisito del contrato a lo que ya
existe (archivo o PR) y a lo que sigue pendiente, con comandos reales donde los hay. Lo que un
reviewer o el founder necesite verificar está marcado explícitamente como pendiente, no asumido.

## R1 — Runbook y cumplimiento

| Sub-requisito | Satisfecho por | Estado |
| --- | --- | --- |
| Setup reproducible | `LOCAL_SETUP.md`, `deploy/local/compose.yaml`, `scripts/aos/local.ps1` | Hecho (local, medido en CRM-004/CRM-005) |
| Start/stop/restart/recuperación | `docs/aos/product/BETA_RUNBOOK.md` §2, §4, §6, §12 (despliegue/rollback AWS); `deploy/local/compose.yaml` (local) | Hecho para local y para la beta AWS desplegada. Backup/restauración de PostgreSQL contra datos reales sigue sin probarse — ver "Pendiente" |
| Arquitectura | `ARCHITECTURE.md` (27/10/2026) | Hecho como inspección estática inicial; sigue siendo la referencia estructural (monorepo Nx, server NestJS/worker separado, Postgres/Redis). No describe las capacidades añadidas después (multi-espacio, MCP, AWS) — eso vive en `BETA_RUNBOOK.md` y `AWS_DEPLOYMENT_PLAN.md`, enlazados desde aquí para no duplicar |
| Seguridad | `SECURITY_AUDIT.md`, `LOCAL_SECURITY.md` | Hecho como inspección inicial + perfil local (CRM-002). Las superficies añadidas después (invitaciones, OAuth DCR, MCP, webhook de altas) tienen su propia medición en `BETA_RUNBOOK.md` y `docs/aos/product/MCP_CONNECTOR.md` §2-§6, no repetida aquí |
| Telemetría | `TELEMETRY_AUDIT.md`; gate real `scripts/aos/verify-privacy.mjs` | Hecho. Ver comandos re-ejecutados abajo |
| Licencias/cumplimiento de componentes | `LICENSE_COMPLIANCE.md` | Hecho como registro técnico; SBOM final y revisión jurídica siguen marcados pendientes ahí mismo — no se resuelven en este track |
| Prerrequisitos API/MCP/integraciones | `docs/aos/product/MCP_CONNECTOR.md`, `INTEGRATIONS.md` | Hecho |
| Estrategia upstream | `UPSTREAM_STRATEGY.md` | Hecho |
| Estado propio en AGENTS.md/CLAUDE.md refleja el estado final medido y enlaza el runbook autoritativo | Introducción propia (fuera del bloque `AOS:BEGIN`) de `AGENTS.md`/`CLAUDE.md`, actualizada en este track | Hecho en este commit — ver abajo |
| Bloques gestionados de AOS sin tocar | `git diff` de `AGENTS.md`/`CLAUDE.md` contra el commit anterior | Hecho — solo se tocaron las líneas 1-9 (antes de `<!-- AOS:BEGIN -->`); verificado con `git diff` antes de commitear |

### Pendiente de R1

- **Backups/restauración de PostgreSQL y de ficheros** contra datos de prueba: `BETA_RUNBOOK.md` §13 lo deja explícito como fuera de este runbook y como "la siguiente pregunta" antes de que haya datos reales. No se mide en este track.
- **SBOM final y revisión jurídica de licencias**: `LICENSE_COMPLIANCE.md` lo deja pendiente desde el 27/10; sigue pendiente.
- **Auditoría de dependencias (`DEPENDENCY_AUDIT.md`)** no se ha vuelto a ejecutar desde el 27/10. Este track no corrió una nueva consulta a OSV: no estaba en los checks que pide el dispatch de CRM-041, y afirmar que sigue vigente sin volver a correrla sería una afirmación sin medir. Queda como pendiente explícito, no como hallazgo nuevo.

## R2 — AWS y límites

**Alcance de este requisito en CRM-041:** que *este* trabajo de documentación no cree recursos,
coste ni credenciales AWS. Eso es lo que se verifica abajo. No es una afirmación de que el
producto en su conjunto nunca desplegó AWS: sí lo hizo, con autorización LIVE explícita del
founder, en tracks anteriores (CRM-011, CRM-013, CRM-017, CRM-018, CRM-024, CRM-027, CRM-036),
documentados con sus comandos y códigos de salida en `AWS_DEPLOYMENT_PLAN.md` y en
`docs/aos/product/BETA_RUNBOOK.md`. Este track no reabre, repite ni re-verifica esas autorizaciones.

| Sub-requisito | Satisfecho por | Estado |
| --- | --- | --- |
| Compute/storage/secrets/backups/isolation/auth/HTTPS cubiertos | `AWS_DEPLOYMENT_PLAN.md` (secciones CRM-011 R1-R3, CRM-013 R1-R4, CRM-017, CRM-018) | Hecho — documentado con Terraform en `deploy/aws/**` y comandos reales (`terraform fmt/init/validate`, escaneo de secretos) |
| CI/CD | `.github/workflows/deploy-beta.yaml` (OIDC vía `aws-actions/configure-aws-credentials`, `permissions: id-token: write`), `deploy/aws-bootstrap/github-deploy-role/` | Hecho — confirmado leyendo el workflow en este checkout (ver comando abajo) |
| Supuestos de coste | `AWS_DEPLOYMENT_PLAN.md`, sección "Coste estimado (staging mínimo)" | Hecho parcialmente: tarifas verificadas para Fargate/ALB/NAT/Secrets Manager/CloudWatch/ECR; RDS/ElastiCache/S3/Budgets marcados explícitamente "no verificado" en el propio documento, no inventados |
| Ningún recurso/coste/crédito AWS creado **por este track** | Sin cambios a `deploy/aws/**`, `deploy/aws-bootstrap/**` ni a ningún `.tf`/`.tfvars` en este commit; sin `terraform plan`/`apply`; sin credenciales AWS usadas en esta sesión | Hecho — verificado con `git status`/`git diff` antes de cada commit de este track (ver sección de comandos) |
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

Todo lo siguiente se ejecutó en este worktree (`.aos/worktrees/2026-11-13T09-25-36-052Z-CRM-041-17b200a6`),
commit base `d42bc7888c`, el 13 de noviembre de 2026:

```
$ node scripts/aos/verify-privacy.mjs
PASS: all 15 privacy checks passed.
exit 0
```

```
$ node scripts/aos/verify-brand.mjs
[PASS] no user-visible reference to Twenty ... (20270 archivos fuente, 35 excepciones listadas)
[PASS] every brand asset path this repo names exists on disk ...
exit 0
```

Comprobación de enlaces Markdown de `docs/aos/bootstrap/*.md`, `README.md`, `AGENTS.md`,
`CLAUDE.md`: todos los enlaces a `.md` dentro del repo resuelven a un fichero existente, con dos
excepciones corregidas en este commit (ver "Cambios hechos en este track" abajo) y un grupo de
enlaces en `BUILD_BASELINE.md`/`LOCAL_SETUP.md` que apuntan a `.aos/reports/CRM-004*.md`: esos
ficheros existen en el bus local (`.aos/reports/`, confirmado con `ls`) pero `.aos/` no está en
Git — son enlaces válidos para quien tiene el bus local, no para un clon limpio del repo. No se
reescriben: documentar evidencia fuera de Git en `.aos/reports/` es el patrón que usa todo el resto
de este bootstrap (ver por ejemplo las citas a `.aos/reports/CRM-007.md`, `CRM-014.md`, `CRM-016.md`
en `MCP_CONNECTOR.md` y `BETA_RUNBOOK.md`).

```
$ git status --short
(limpio antes de cada commit de este track; comprobado con git show --stat después)
```

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

- `docs/aos/bootstrap/DELIVERY.md` (este fichero): nuevo, mapeo R1/R2/R3 contra lo que existe hoy.
- `docs/aos/bootstrap/README.md`: añadida entrada al índice y nota de que el estado actual vive en
  `DELIVERY.md`, sin reescribir el resto del documento (sigue siendo la fotografía del 27/10/2026).
- `AGENTS.md` / `CLAUDE.md`, introducción propia (antes de `<!-- AOS:BEGIN -->`): actualizada para
  reflejar el estado medido (dependencias instaladas, servicios arrancados en local y en la beta AWS,
  gate real con lint/typecheck/unit) y enlazar `DELIVERY.md` como runbook autoritativo. Se corrigió
  además un enlace roto: `[AOS_CRM_Bootstrap.md](AOS_CRM_Bootstrap.md)` apuntaba a un fichero que
  nunca existió en la raíz del repo (el encargo vive en `.aos/onboarding/AOS_CRM_Bootstrap.md`, fuera
  de Git); se cambió a referencia en código, igual que el resto de rutas de `.aos/` en ese mismo
  párrafo, para no repetir un enlace que nadie sin el bus local puede seguir.
- Sin cambios a `packages/`, `deploy/`, `scripts/` ni a ningún `.tf`/`.tfvars`.

## Invariantes comprobados

- Sin secretos añadidos: este track no escribió ningún valor de credencial, solo Markdown y dos
  párrafos de introducción.
- Sin recursos/costes AWS creados por este track (ver R2).
- Sin merge ni push propios: cambios commiteados localmente en `crm041/bootstrap-delivery`; publicar
  el PR y fusionarlo es del coordinador/founder.
- Prefijo de tracks `CRM-` respetado; ningún track nuevo registrado por este documento.
