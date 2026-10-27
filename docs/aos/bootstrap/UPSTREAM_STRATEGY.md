# Procedencia y gestión de upstream

Fecha: 27 de octubre de 2026 (fork creado y verificado el mismo día, track CRM-001).

| Elemento | Estado comprobado |
| --- | --- |
| Upstream | `https://github.com/twentyhq/twenty.git` |
| Release | `twenty/v2.51.0`, publicada el 25 de octubre de 2026; no prerelease |
| SHA de base | `15e4826d3b5fc5867baeabeeb42b253892b2d4da` |
| Rama local | `codex/crm001-provenance` (creada desde `codex/bootstrap-inspection`) |
| Historia importada | 17.313 commits alcanzables desde la release; `--is-shallow-repository=false` |
| Transferencia | Partial clone por blobs (`--filter=blob:none`), sin truncar historia; Git puede recuperar blobs históricos bajo demanda |
| Fork remoto | `AG-0xAi/aos-crm`, creado con `gh repo fork twentyhq/twenty --fork-name aos-crm --clone=false` (sin `--default-branch-only`). GitHub confirma `fork=true`, `parent=twentyhq/twenty`, 2336 ramas y 629 tags (upstream: 2337 ramas, 629 tags en el mismo instante) |
| `origin` | `https://github.com/AG-0xAi/aos-crm.git`, configurado explícitamente tras verificar el fork; no se tocó `upstream` |
| GitHub observado | `gh api user` confirma identidad efectiva `AG-0xAi` (el `gh auth status` mostraba otro nombre de keyring). `gh api repos/AG-0xAi/aos-crm` devolvía 404 antes de crear el fork |

Detalle completo, con conteos y evidencia, en `docs/aos/bootstrap/provenance.json`.

Se reutilizó el Git inicial y se incorporó el tag en esta carpeta mediante fetch y switch. No se creó un commit raíz de scaffold. Se preservaron bus, pack y hooks de AOS. `.gitignore` conserva reglas upstream y añade exclusiones de bus/grafo. La orientación original se respaldó en `.aos/onboarding/bootstrap-2026-10-27/pre-upstream/`; las instrucciones upstream se conservaron junto a la evidencia antes de restituir las de AOS.

El `AGENTS.md` upstream era un enlace a `CLAUDE.md`; en este checkout Windows se conserva como archivo regular de AOS para mantener el contrato del proyecto. Los cambios de orientación no modifican código de Twenty. `.claude/settings.json` conserva la configuración upstream y el guard local de merge.

Git no tenía identidad configurada. Para esta entrega se configuró únicamente este repo con el login autenticado `AG-0xAi` y su dirección GitHub noreply derivada del ID de la API; no se modificó configuración global.

## Estado del fork (CRM-001, resuelto)

El fork `AG-0xAi/aos-crm` existe, con relación de fork real a `twentyhq/twenty` (no un repositorio nuevo sin parentesco) y con ramas/tags completos, no solo la rama por defecto. `origin` quedó configurado únicamente con ese remoto verificado; `upstream` no se modificó. No se hizo push ni se modificó `main`/`master` de ningún repositorio. La publicación de la rama de trabajo (`codex/crm001-provenance`) sigue pendiente de que el arnés abra el PR tras un gate verde; este worker no publica ni hace merge.

Un comprobador determinista (`scripts/aos/verify-provenance.mjs`, gate en `.aos/verify.json`) revalida este estado — origen/base, no-shallow, ancestría, ausencia de runtime/secretos versionados y estado real en GitHub — en cada corrida; no se acepta una declaración de éxito sin volver a ejecutar las comprobaciones.

## Pendiente (fuera de CRM-001)

Para actualizar a una release nueva más adelante: fetch explícito de la nueva release, auditoría de notas/cambios de licencia/telemetría, rama `codex/...` y comparación contra la base fijada; ejecutar migraciones y regresiones en datos de prueba con backup/restauración medidos. Conservar la base upstream por tag/SHA y los cambios AOS pequeños. No reescribir historia compartida ni fusionar trabajo propio; PR con evidencia de build y commit, revisión independiente y merge humano.

Falta todavía la prueba práctica de una actualización de release y los permisos de publicación (push del fork, apertura de PR por el arnés). Conservar historia completa de la release no significa haber probado compatibilidad futura.

Fuente de selección: [release 2.51.0](https://github.com/twentyhq/twenty/releases/tag/twenty/v2.51.0).
