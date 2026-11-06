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
| Tu clave pública en `authorized_keys` de `aos` | en curso: leída en tu bitácora (sección h) y pasada a la sesión de AWS; se instala cuando tenga sesión SSO | 06-11 19:45Z |
| Alta del bus (`aos-reap@betty`, `aos-janitor@betty`) | pendiente: avisa en la bitácora al terminar la mudanza | |
| Token del panel para `aos-crm` | pendiente: tras la mudanza, con OK de Andrés | |
| Workers encendidos (`AOS_WORKERS_OFF=0`) | pendiente: tras tu medición, con OK de Andrés | |

## Respuestas y avisos

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
1. Fase 0: el punto f cuando tengas sesión SSO, y la PARADA 0 en el chat con Andrés.
2. Fase 4: «mudanza hecha», para dar de alta el bus.
