# Fase 0 de Betty en la VM aos-factory-01 (07-08/11/2026)

Medido por el agente de Betty antes de mudar el bus. Sin identificadores de cuenta ni de instancia.

## Máquina

- 12 CPU y 46 GB (37 GB libres al medir), disco raíz de 193 GB. Carga media entre 3 y 14 durante las medidas: otros buses trabajan en la misma VM.
- Node v24.22.2, corepack activo. Usuario `aos` en el grupo `docker`.

## Checkout y dependencias

- `git clone --branch betty/factory` en `/opt/aos/betty`: 188 s, `.git` de 2,3 GB, cabeza `5b977100ed` (fusión del PR #5).
- `corepack yarn install --immutable` con `NODE_OPTIONS=--max-old-space-size=4096`: 158 s, pico de 9,5 GB de RSS, `node_modules` de 4,9 GB.

## Hallazgo: `worktreeLinks` no sirve en este monorepo

Con `node_modules` del principal enlazado al worktree, los paquetes del workspace (`twenty-shared`, `twenty-oxlint-rules` y los demás) son enlaces relativos `../packages/<x>` dentro de ese `node_modules`, así que resuelven al checkout principal y no al worktree. Resultado medido: 3 de 10 comandos en rojo sin que el cambio tuviera culpa (`twenty-shared/dist` inexistente en el principal; lint, typecheck y jest no encuentran `twenty-shared/*`). Además, un cambio en `twenty-shared` no lo verían sus dependientes.

Solución medida: cada worktree instala sus dependencias como primer comando del gate, con `YARN_NM_MODE=hardlinks-global` (enlaces duros al almacén global de yarn): 126 s y 4,0 GB por worktree. `.aos/config.json` queda sin `worktreeLinks`, con `"maxHeavyProcesses": 8`.

## Gate de los workers (`.aos/verify.json`, 12 comandos)

Medido con `deploy/aws/scripts/medir-verify-linux.sh` del arnés en un worktree de prueba con el cambio de CRM-015 (servidor: `twenty-server` afectado). 12/12 en verde, 389 s en total, pico de 8,5 GB.

| # | Comando | s |
|---|---|---|
| 1 | `YARN_NM_MODE=hardlinks-global ... corepack yarn install --immutable` | 126 |
| 2-3 | `node scripts/aos/verify-privacy.mjs` y `--self-test` | 1 |
| 4-5 | `node scripts/aos/verify-brand.mjs` y `--self-test` | 5 |
| 6 | `corepack yarn nx build twenty-shared` | 3 |
| 7 | `corepack yarn nx affected -t lint --base=origin/betty/factory --parallel=1` | 25 |
| 8 | `corepack yarn nx affected -t typecheck --base=origin/betty/factory --parallel=1` | 54 |
| 9 | jest de `twenty-server` con `--changedSince=origin/betty/factory --maxWorkers=2`, sin specs `.postgres` ni integración | 162 |
| 10-11 | jest de `twenty-front` y `twenty-shared` con `--changedSince` | 3 |
| 12 | vitest de `twenty-ui` con `--changed origin/betty/factory` | 10 |

Fuera del gate, como pide el encargo: imagen, stack local, integración, Storybook y los e2e de `scripts/aos/test/` (viven o vivirán en Actions). El gate de 32 comandos del PC queda guardado en `.aos/docs/verify-windows-2026-11-08.json` del bus.

Sin medir: el peor caso, un cambio en `twenty-shared` que afecte a todos los paquetes (typecheck y lint de front, servidor y UI). Cada comando tiene la cota de 20 min de la VM.

## Mudanza

- `mover-bus-a-vm.sh` del `main` del arnés (`d1dcde96d6`), con `AOS_MOVER_CLI=/opt/aos/cli`, `AOS_MOVER_AOS_HOME=/home/aos/.aos-betty` y `AOS_MOVER_EXTRA_PARTS="runs reports artifacts onboarding docs"`: paquete de 606 MB, 1626 entradas, 401 eventos en la VM.
- Specs de `aos-crm` cuadradas antes de congelar: PC y VM con `done=16 in-progress=2 pending=12`, 23 contratos en los dos lados.
- Bus del PC congelado (`.aos/CONGELADO.md`, 2026-11-08T00-15-57Z) y fuera del registro del PC.
