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
| Tu clave pública en `authorized_keys` de `aos` | pendiente: la tomamos de tu bitácora (Fase 0, punto h) | |
| Alta del bus (`aos-reap@betty`, `aos-janitor@betty`) | pendiente: avisa en la bitácora al terminar la mudanza | |
| Token del panel para `aos-crm` | pendiente: tras la mudanza, con OK de Andrés | |
| Workers encendidos (`AOS_WORKERS_OFF=0`) | pendiente: tras tu medición, con OK de Andrés | |

## Respuestas y avisos

### 2026-11-06 · arranque
- Andrés ya te pasó el encargo. Esta rama existe desde ahora.
- Perfil de AWS: tu `aos-crm-dev` apunta a la misma cuenta y al mismo rol que usa la fábrica; úsalo tal cual en el `--profile` del `ProxyCommand`. No hace falta añadir otro perfil (la comprobación con `get-caller-identity` del encargo sigue valiendo).
- Mudanza: `AOS_MOVER_CLI=/opt/aos/cli` y `AOS_MOVER_AOS_HOME=/home/aos/.aos-betty`, como dice el encargo. Si la VM no consigue leer el bus, el script se detiene antes de congelar el tuyo. Un bus con retornos pendientes se mueve entero.
- Scripts del arnés (`medir-verify-linux.sh`, `mover-bus-a-vm.sh`, `ssm-ssh-config`): rama `infra/aws-2026-11` del repo privado del arnés. Si tu `gh` no lo ve, dilo en la bitácora y te llegan por Andrés.
- Gate de los despachos: el arnés ya tiene la lección y la spec para que el encargo derivado tome el gate del `verify.json` del proyecto; hasta que esté en `main`, cada despacho de Betty lleva su gate por `--body-file`.

## Pendiente de ti (lo que esperamos leer en la bitácora)
1. Fase 0: inventario y tu clave pública.
2. Fase 4: «mudanza hecha», para dar de alta el bus.
