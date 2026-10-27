# Procedencia y gestión de upstream

Fecha: 27 de octubre de 2026.

| Elemento | Estado comprobado |
| --- | --- |
| Upstream | `https://github.com/twentyhq/twenty.git` |
| Release | `twenty/v2.51.0`, publicada el 25 de octubre de 2026; no prerelease |
| SHA de base | `15e4826d3b5fc5867baeabeeb42b253892b2d4da` |
| Rama local | `codex/bootstrap-inspection` |
| Historia importada | 17.313 commits alcanzables desde la release; `--is-shallow-repository=false` |
| Transferencia | Partial clone por blobs (`--filter=blob:none`), sin truncar historia; Git puede recuperar blobs históricos bajo demanda |
| Fork remoto / origin | Pendientes; no se ha creado ni afirmado que exista un fork remoto |
| GitHub observado | API autenticada como `AG-0xAi`; su cuenta contiene el repositorio de AOS Factory y otros productos. No devolvió organizaciones. `gh auth status` mostró otro nombre asociado al keyring: confirmar identidad efectiva con API antes de crear remoto |

Se reutilizó el Git inicial y se incorporó el tag en esta carpeta mediante fetch y switch. No se creó un commit raíz de scaffold. Se preservaron bus, pack y hooks de AOS. `.gitignore` conserva reglas upstream y añade exclusiones de bus/grafo. La orientación original se respaldó en `.aos/onboarding/bootstrap-2026-10-27/pre-upstream/`; las instrucciones upstream se conservaron junto a la evidencia antes de restituir las de AOS.

El `AGENTS.md` upstream era un enlace a `CLAUDE.md`; en este checkout Windows se conserva como archivo regular de AOS para mantener el contrato del proyecto. Los cambios de orientación no modifican código de Twenty. `.claude/settings.json` conserva la configuración upstream y el guard local de merge.

Git no tenía identidad configurada. Para esta entrega se configuró únicamente este repo con el login autenticado `AG-0xAi` y su dirección GitHub noreply derivada del ID de la API; no se modificó configuración global.

## Siguiente paso propuesto

Usar `AG-0xAi/aos-crm` como candidato a fork, condicionado a confirmar que es el namespace deseado. Comprobar primero si ya existe y qué contiene. Crear el fork con historial y metadatos usando las capacidades de GitHub disponibles; configurar `origin` únicamente con el remoto realmente creado. No sustituirlo por un repositorio nuevo sin relación de fork ni publicar un directorio local bajo la etiqueta de fork.

La inspección precede al fork remoto según la orden. La creación y primera publicación siguen pendientes de aprobación del mapa y del flujo AOS. No se hizo push ni se modificó main/master.

Para actualizar: fetch explícito de una release nueva, auditoría de notas/cambios de licencia/telemetría, rama `codex/...` y comparación contra la base fijada; ejecutar migraciones y regresiones en datos de prueba con backup/restauración medidos. Conservar la base upstream por tag/SHA y los cambios AOS pequeños. No reescribir historia compartida ni fusionar trabajo propio; PR con evidencia de build y commit, revisión independiente y merge humano.

Faltan todavía fetch de otras ramas/tags, prueba práctica de una actualización y permisos de publicación. Conservar historia completa de la release no significa haber probado compatibilidad futura.

Fuente de selección: [release 2.51.0](https://github.com/twentyhq/twenty/releases/tag/twenty/v2.51.0).
