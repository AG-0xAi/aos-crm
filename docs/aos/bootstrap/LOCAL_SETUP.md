# Entorno local: estado real y preparación propuesta

Fecha: 27 de octubre de 2026. **No es todavía un procedimiento de instalación validado. El CRM no está arrancado.**

**Actualización CRM-001-HOST (misma fecha):** los dos scripts reales
(`scripts/aos/preflight-host.ps1`, `scripts/aos/install-host-wsl.ps1`) y su estado medido —
no propuesto— están en [HOST_RUNTIME.md](HOST_RUNTIME.md). Esta sección queda como la radiografía
original; no se reescribe aquí.

**Actualización fix2 (27 de octubre de 2026):** el founder autorizó instalar Linux; tras el
reinicio de Windows y la instalación de Docker por el coordinador, `scripts/aos/preflight-host.ps1`
mide `"status": "ready"` (exit 0) contra `AOS-CRM-Ubuntu-24.04` ahora mismo. El runtime de host
(WSL2 + Docker Engine) ya no es el prerrequisito pendiente; detalle en
[HOST_RUNTIME.md § CRM-001-HOST-fix2](HOST_RUNTIME.md#crm-001-host-fix2-cierre-con-linux-real-tras-reinicio).
El CRM en sí (build, migraciones, servidor/worker) sigue sin arrancar.

## Comprobaciones realizadas

| Elemento | Resultado |
| --- | --- |
| Sistema | Windows; checkout en `C:\Users\Andrés\Documents\AOS-CRM` |
| Memoria física | Aproximadamente 23,4 GiB |
| Disco C | Aproximadamente 588 GiB libres al inicio de inspección |
| Git | Disponible; repositorio con historia de Twenty, rama `codex/bootstrap-inspection` |
| Node host | 24.16.0; no se ejecutó código del CRM con él |
| Yarn | No encontrado en PATH; el repositorio trae Yarn 4.18.1, todavía no ejecutado |
| Docker | No encontrado en PATH; falta runtime de contenedores comprobado |
| WSL | `wsl --list --verbose` informa que el subsistema no está instalado |
| Build / tests / servicios | No ejecutados; tampoco hay migraciones o administrador creados |

La guía oficial soporta Linux/macOS y Windows mediante WSL. Esta máquina todavía no reúne ese prerrequisito. La instalación del subsistema puede requerir consola elevada y reinicio, que no se realizaron durante la inspección. [Guía de Twenty](https://docs.twenty.com/developers/contribute/capabilities/local-setup).

## Estrategia propuesta, pendiente de contrato AOS

Preparar WSL2 y un motor de contenedores compatible con los permisos del equipo. Conservar el checkout y el único bus existente; no crear otro proyecto/bus para instalar. Verificar acceso al mismo árbol desde Linux antes de despachar workers. Si el rendimiento en el volumen Windows fuera un bloqueo, escalar cualquier cambio de topología al founder.

Construir una imagen propia desde `packages/twenty-docker/twenty/Dockerfile` y esta referencia fija. Mantener servidor y worker como procesos separados, PostgreSQL/Redis en red exclusiva y volúmenes persistentes. No hace falta arrancar website, Companion, Storybook, ClickHouse o apps comerciales para el CRUD inicial; cualquier dependencia adicional se debe justificar con un fallo observado.

Antes de construir: excluir `.aos/`, agentes, grafo y secretos del contexto Docker; completar triage de dependencias y controlar scripts de instalación. Antes de arrancar: fijar privacidad, ambos drivers de código a `DISABLED`, secretos aleatorios y entorno real ignorado. No copiar ejemplos/demos como credenciales operativas.

Elegir puertos libres con preflight. Candidatos para revisar: 127.0.0.1:43000 para servidor y frontend compilado; DB/Redis solo red de contenedores, o 127.0.0.1:45432 y 127.0.0.1:46379 cuando haga falta acceso host. **No se han reservado ni comprobado estos puertos; no son direcciones de una aplicación activa.**

Crear el primer usuario en una instancia vacía y bajo acceso local controlado, con password seguro. Mantener `IS_MULTIWORKSPACE_ENABLED=false` y comprobar que no se pueden abrir workspaces nuevos tras el alta; verificar también invitaciones y cualquier registro de usuarios sin workspace. No usar las cuentas demo del seeder como administrador final.

## Verificación que falta

El gate deberá contener comandos reales ejecutados sobre Linux: construcción de shared/server/front, typechecks directos sin caché engañosa, tests enfocados de privacidad/configuración y smoke HTTP. Después: migraciones sobre DB exclusiva, arranque de worker, navegador, login, CRUD, relaciones y persistencia tras reinicio. Captura de tráfico desde el primer arranque en servidor/worker/browser.

`.aos/verify.json` ya no está vacío: trae los dos comandos de procedencia de CRM-001 más el preflight
de host de CRM-001-HOST y los `-SelfTest` aislados de sus dos scripts (detalle en
[HOST_RUNTIME.md](HOST_RUNTIME.md)). Ninguno de estos comandos es el gate de aplicación completo — no
construye, no arranca servidor/worker/DB/Redis, no corre typecheck/tests de la app. Los comandos de
arranque/parada/reinicio y las credenciales solo se documentarán como operativos después de
ejecutarlos y verificar sus efectos.
