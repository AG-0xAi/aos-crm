# CRM-001-HOST — runtime Linux/contenedores sobre este mismo checkout

Fecha: 27 de octubre de 2026. Implementa el contrato `.aos/pack/aos-crm/specs/host-runtime/spec.md`.
Continúa [LOCAL_SETUP.md](LOCAL_SETUP.md) con los dos scripts reales y su estado medido ahora mismo,
no uno propuesto.

**Corrección CRM-001-HOST-fix1 (misma fecha, rama `codex/crm001-host-runtime-fix1`):** revisión del
coordinador sobre el commit anterior (`.aos/reports/CRM-001-HOST-coordinator-review.md`) confirmó
defectos de código reales, distintos del bloqueo externo de WSL/admin. Corregidos en este run:
decodificación UTF-16/UTF-8, selección de distro, limpieza/permisos del instalador, diagnóstico de
Docker existente y el estado final informado. Detalle en la sección
["Qué se corrigió en fix1"](#qué-se-corrigió-en-fix1-defectos-de-código-no-el-bloqueo-externo) más
abajo. El bloqueo externo (WSL/elevación) sigue sin resolverse y el gate sigue fallando a propósito
por esa razón, no por los defectos ahora corregidos.

## Alcance

- `scripts/aos/preflight-host.ps1` — mide el host en modo solo lectura: nunca activa una
  característica de Windows, nunca arranca/detiene un servicio, nunca crea otro checkout/bus.
- `scripts/aos/install-host-wsl.ps1` — preparación idempotente y revisable de WSL2 + una
  distribución Linux + Docker Engine (no Docker Desktop). Nunca se autoeleva ni reinicia el equipo.
- Ninguno de los dos instala dependencias del CRM ni construye su imagen; eso es CRM-004.

## Estado medido ahora (re-ejecutado, no de memoria)

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/aos/preflight-host.ps1` sobre esta
sesión (no administrador):

| Medición | Resultado real |
| --- | --- |
| Windows | 11 Pro, build 26200 |
| Elevación de esta sesión | No administrador |
| Virtualización firmware (`Win32_Processor`) | `VirtualizationFirmwareEnabled=true`, `SecondLevelAddressTranslationExtensions=true` |
| DEP (`Win32_OperatingSystem`) | `DataExecutionPrevention_Available=true` |
| `VirtualMachinePlatform` (WMI `Win32_OptionalFeature`) | `InstallState=2` → **Disabled** (no "no reportada"; el enum 1=Enabled/2=Disabled/3=Absent/4=Unknown no se confunde con "listo") |
| `Microsoft-Windows-Subsystem-Linux` (WMI) | `InstallState=2` → **Disabled** |
| `wsl.exe --status` | exit **50**, mensaje real decodificado: *"El Subsistema de Windows para Linux no está instalado. Para instalar, ejecute "wsl.exe --install"."* |
| `wsl.exe --help` | exit 1; únicamente reconoce `--install`/`--update`/`--status`/`--help` → stub de arranque, no la CLI completa (no se asumen `--distribution`/`--no-launch`/`--list` todavía) |
| Distribuciones registradas | ninguna |
| Acceso a este checkout desde Linux | no intentado (no hay distro) |
| Runtime de contenedores | no intentado (no hay distro) |
| Smoke aislado (`docker run --rm hello-world`, sin puertos) | no intentado |
| Memoria / disco | ~23,4 GiB RAM; ~585 GiB libres en `C:` |
| `docker`/`docker.exe` en PATH de Windows | ausente (confirmado, no descartado de memoria) |

Veredicto: **`not-ready`, exit 1**, sin fabricar ninguna versión de Linux/Docker. Evidencia completa
(JSON íntegro) en `.aos/reports/host-preflight-evidence.json` (no versionado; bus local).

### Re-medido tras fix1, sin `-ExecutionPolicy Bypass`

`powershell -NoProfile -File scripts/aos/preflight-host.ps1` (sin flag de política; ver sección de
gate) sigue devolviendo **`not-ready`, exit 1** sobre este mismo checkout, sin elevación. El estado
del host **cambió por sí solo** entre la medición original y esta (nadie en esta sesión instaló,
elevó ni tocó WSL): `wsl.exe --status` ahora sale **exit 0** en vez de 50, con el mensaje real
*"WSL2 no se puede iniciar porque la virtualización no está habilitada en esta máquina... Habilita
'Plataforma de máquina virtual' ejecutando: wsl.exe --install --no-distribution"*, y
`VirtualMachinePlatform` (WMI) pasó a **Enabled**; `Microsoft-Windows-Subsystem-Linux` (WMI) sigue
**Disabled**, y `wsl --list --verbose` sigue sin ninguna distribución (exit -1). Se reporta el hecho
sin investigarlo más: no es trabajo de este run diagnosticar quién/qué cambió el host, solo medirlo
honestamente. Evidencia completa en `.aos/reports/host-preflight-fix1-evidence.json` (no versionado;
bus local).

## Por qué queda incompleto: elevación + reinicio + interacción, en ese orden

1. **Elevación** (bloqueante en esta sesión, que no es administrador). El comando exacto, preparado
   y revisado pero no ejecutado, es:
   ```
   wsl.exe --install
   ```
   corrido desde una PowerShell elevada (clic derecho → "Ejecutar como administrador", o
   Win+X → "Terminal (Admin)"). `scripts/aos/install-host-wsl.ps1` detecta esta falta de elevación y
   devuelve exactamente este comando en `phase1.exactCommand`/`phase1.instructions`; no intenta
   `Start-Process -Verb RunAs` ni ningún otro rodeo de la elevación.
2. **Reinicio**, requerido por Windows tras habilitar `VirtualMachinePlatform`/WSL. Ninguno de los
   dos scripts reinicia el equipo; si `install-host-wsl.ps1` llega a emitir `wsl --install` desde una
   sesión ya elevada, se detiene ahí e instruye el reinicio manual.
3. **Interacción del founder**: el primer lanzamiento de la distribución (p. ej. "Ubuntu" desde el
   menú Inicio) pide crear usuario/contraseña de Linux de forma interactiva. Es un paso esperado del
   founder, no algo que esta sesión deba o pueda completar.

Una vez resueltos los tres puntos, la fase 2 (Docker Engine) **no necesita elevación de Windows ni
contraseña de Linux**: corre como `wsl -u root`, que WSL concede directamente a la sesión Windows
que controla esa VM sin pasar por autenticación de Linux. Por eso `install-host-wsl.ps1` puede
completar esa fase de forma no interactiva en cuanto exista una distribución registrada.

## `install-host-wsl.ps1`: qué hace cada fase (actualizado en fix1)

- **Fase 1** (Windows, necesita elevación): si `wsl --status` ya sale 0, no hace nada
  ("already-satisfied", idempotente). Si no, y la sesión no está elevada, imprime el comando exacto
  y los pasos siguientes sin ejecutarlos. Si la sesión sí está elevada, corre `wsl.exe --install` una
  vez (comando oficial único de Microsoft) y se detiene para el reinicio manual.
- **Fase 2** (Linux, no necesita elevación de Windows): si `wsl --help` todavía es el stub de
  arranque, se bloquea con `blocked-phase1-incomplete`. **Exige `-DistroName` explícito** — nunca
  elige la primera distro registrada ni asume la default — y la valida antes de tocar nada: debe
  existir y ser WSL2 (si no, `blocked-distro-invalid`). Si `docker` ya existe en esa distro, ya no
  basta con que el binario esté en el PATH: comprueba además que el daemon responde
  (`docker info`), que el servicio está activo (`systemctl is-active`) y que el plugin Compose
  funciona (`docker compose version`); si alguno falla, bloquea con `blocked-existing-docker-unhealthy`
  y **no intenta repararlo** (eso necesita un encargo propio). Si `docker` no existe, antes de tocar
  apt lee `/etc/os-release` y exige una release de Ubuntu soportada (`blocked-unsupported-os` si no lo
  es) y comprueba paquetes en conflicto (`docker.io`, `podman-docker`, `containerd`, `runc`, etc.) —
  si hay alguno, **bloquea con la lista, no los desinstala** (`blocked-conflicting-packages`). Solo
  entonces instala Docker Engine paso a paso como root dentro de esa distribución, replicando
  exactamente la [guía oficial de Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
  (repositorio apt + clave GPG + paquetes `docker-ce`/`docker-ce-cli`/`containerd.io`/
  `docker-buildx-plugin`/`docker-compose-plugin`) y habilita el servicio con
  [`systemctl enable --now`](https://docs.docker.com/engine/install/linux-postinstall/). Cada paso
  registra su propio comando y código de salida; el primer fallo detiene los siguientes (no hay
  "seguir de largo" silencioso). **Ya no añade usuarios al grupo `docker`**: cada paso ya corre como
  `wsl -u root`, así que no hace falta ningún privilegio nuevo para ningún usuario. Nunca cambia la
  distro por defecto, nunca `--unregister`/`--shutdown`, nunca toca otra distribución que la
  seleccionada explícitamente.
- `-WhatIf` (nativo de PowerShell, `SupportsShouldProcess`) imprime qué comando correría en cada paso
  mutante sin ejecutarlo — la vía de revisión pedida por el contrato, sin reinventar una bandera
  propia.
- **Estado final** (`status`) ya no puede leer `done` tras un comando fallido, un dry-run o una
  instalación a medio reiniciar: se clasifica en `done` / `planned` (dry-run o paso saltado) /
  `reboot-required` (`wsl --install` emitido, falta reinicio) / `blocked` (prerrequisito/distro/OS
  inválido) / `error` (comando real que falló), con código de salida 0/1/1/1/2 respectivamente.

## `preflight-host.ps1`: qué mide y cómo decide `ready`

Lee únicamente; no es un instalador. Mide, en este orden: identidad del checkout (ruta +
`HEAD` + presencia de `.aos`), build/elevación de Windows, virtualización de firmware/SLAT/DEP
(propiedades CIM, independientes de idioma — no se parsea `systeminfo` localizado), estado real de
`VirtualMachinePlatform`/`Microsoft-Windows-Subsystem-Linux` vía WMI, comportamiento real de
`wsl.exe` (nunca confía en que el binario exista: corre `--status`/`--help`/`-l -v` y decodifica su
propia salida como UTF-16LE preservando acentos — texto de wsl.exe, no de un proceso Linux),
distribuciones registradas y su versión WSL, memoria/disco. Si se pide `-DistroName` y no está
registrada, o solo hay WSL1, falla cerrado (`missingPrerequisites`) en vez de probar otra distro
distinta a la pedida; sin `-DistroName`, solo elige entre las distros que ya son WSL2 (fix1).

Si hay una distribución usable, además: traduce esta misma ruta de checkout con `wslpath`, compara el
`HEAD` de Git visto desde Linux contra el de Windows, confirma que `.aos/` es alcanzable desde esa
misma ruta (nunca otro checkout), comprueba que `docker` responde dentro de esa distribución y — solo
si todo lo anterior pasa — corre el smoke aislado oficial `docker run --rm hello-world` (imagen
oficial de Docker, sin puertos publicados, sin datos de otro producto, contenedor autoeliminado por
`--rm`). Estas cinco comprobaciones ejecutan un proceso **dentro** de la distro (`wsl.exe -d <distro>
-- ...`), cuyo stdout es el de ese proceso Linux (UTF-8), no el texto propio de wsl.exe (UTF-16LE) —
decodificarlo como UTF-16 corrompía acentos y el SHA de `git rev-parse HEAD` (confirmado con un
proceso `node` como sustituto de Linux antes de corregirlo; fix1). `ready` (exit 0) exige las cinco
cosas a la vez; cualquier ausencia queda en `missingPrerequisites` con el paso concreto que la
resuelve, nunca con una versión inventada.

## Gate del proyecto

`.aos/verify.json` ahora incluye, junto a los dos comandos de procedencia de CRM-001:
`powershell -NoProfile -File scripts/aos/preflight-host.ps1` (sin `-ExecutionPolicy Bypass`: nunca
hubo bloqueo de política en esta sesión, confirmado de nuevo en fix1, y nada autorizó bajar ese
control) y dos comandos `-SelfTest` (uno por script) deterministas, sin WSL/Linux/elevación, que
prueban en aislado la decodificación UTF-16/UTF-8, la selección de distro y, en el instalador, el
parseo de `/etc/os-release` y el clasificador final. El instalador real (`-WhatIf` o mutando) **no**
está en el gate permanente: fase 2 exige `-DistroName` explícito, y fijar un nombre de distro en
`verify.json` asumiría una topología que nadie eligió. Con el host en el estado medido arriba, el
comando de medición real falla el gate **a propósito** (exit 1): es el comportamiento pedido por el
contrato ("el gate debe fallar si falta WSL/Linux/runtime"), no un defecto del script. Ninguno de
estos comandos construye, arranca servidor/worker/DB/Redis, corre typecheck/tests de la aplicación o
instala una dependencia del CRM — ese gate completo sigue en CRM-004/CRM-005.

## Fuentes oficiales usadas

- [Install WSL — Microsoft Learn](https://learn.microsoft.com/en-us/windows/wsl/install)
- [Basic commands for WSL — Microsoft Learn](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
  (confirma `--no-distribution`, `--no-launch`, `--distribution` como opciones documentadas de
  `wsl --install`, deliberadamente no usadas en la fase 1 hasta confirmar que el stub actual las
  soporta, por pedido explícito del contrato)
- [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Engine post-installation steps on Linux](https://docs.docker.com/engine/install/linux-postinstall/)

## Qué se corrigió en fix1 (defectos de código, no el bloqueo externo)

Revisión completa en `.aos/reports/claude-worker-report.md` (run CRM-001-HOST-fix1). Resumen:

1. **Decodificación**: `Invoke-NativeUnicode` forzaba UTF-16LE para *todo*, incluyendo stdout de
   procesos Linux reales (`wslpath`/`git`/`test`/`docker`/`bash`), que es UTF-8. Reproducido con
   `node` como sustituto de Linux: exit 0, texto corrupto, `matches=false`. Dividido en
   `Invoke-WslSelf` (texto propio de wsl.exe: `--status`/`--help`/`-l -v`/`--install`, UTF-16LE) e
   `Invoke-WslLinux` (cualquier comando ejecutado dentro de una distro, UTF-8).
2. **Selección de distro**: si se pedía `-DistroName` y no existía, caía en silencio a otra distro
   (o, en el instalador, a la primera registrada si no se pedía ninguna). Ahora
   `Resolve-TargetDistro` (preflight, solo lectura) y `Resolve-MutationDistro` (instalador, exige
   `-DistroName` explícito para cualquier mutación) fallan cerrado en vez de sustituir.
3. **Limpieza/permisos del instalador**: se quitó el `apt-get remove` automático de paquetes en
   conflicto (ahora bloquea reportando la lista) y el alta masiva de usuarios de `/home` al grupo
   `docker` (innecesaria: todo corre como `wsl -u root`). Docker existente ya no se da por bueno con
   `command -v docker`: se comprueba daemon + servicio + Compose, y si no está sano se bloquea sin
   intentar reparar.
4. **Estado final**: ya no puede leer `done` tras un comando fallido, un `-WhatIf` o una instalación
   a medio reiniciar; `Get-OverallInstallStatus` clasifica en
   `done`/`planned`/`reboot-required`/`blocked`/`error` a partir de los tokens reales de cada fase.
5. **Documentación/gate**: quitado `-ExecutionPolicy Bypass` (nunca hizo falta); el instalador ahora
   valida `/etc/os-release` contra una lista de versiones Ubuntu soportadas antes de tocar apt.

Verificado con `-SelfTest` (aislado, sin WSL/Linux) en ambos scripts y con `-WhatIf` real contra este
host (sin distro, sin elevación): cero mutación, estado final honesto (`blocked`/`done` según el
caso, nunca `done` por una fase bloqueada). El propio proceso de corregir y probar esto encontró dos
bugs adicionales no listados por el coordinador — una colección vacía que colapsa a `$null` al
capturarla (y que al recorrerla con `Where-Object` sigue invocando el bloque una vez sobre ese
`$null`, lo que revienta bajo `Set-StrictMode`) y una clave `result` que no existía en el reporte
hasta que esa fase corría — ambos confirmados en vivo contra este host con `-Phase1Only`/`-Phase2Only`
y corregidos igual que los cinco de arriba.

**No corregido aquí, fuera de alcance de este run**: `powershell.exe` clásico (no `pwsh`) recorta las
comillas dobles incrustadas en argumentos nativos pasados por arreglo — confirmado con `node`,
afecta en teoría a la plantilla `--format "{{.Server.Version}}"` del chequeo de Docker existente
(inocuo para ese literal concreto porque bash no expande `{{...}}` sin coma, pero sí sería un riesgo
real para cualquier argumento futuro que necesite comillas literales bajo `powershell.exe`). Pendiente
de que el coordinador decida si amerita su propio encargo.

## Siguiente paso (fuera del alcance de esta sesión)

1. El founder (o quien tenga consola de administrador) corre `wsl.exe --install` elevado y reinicia.
2. Lanza la distribución instalada una vez para crear su usuario/contraseña de Linux.
3. Re-corre `scripts/aos/preflight-host.ps1`; si sigue `not-ready`, re-corre
   `scripts/aos/install-host-wsl.ps1 -DistroName <nombre-exacto>` (fase 2, Docker Engine; el nombre
   ya no se adivina) y vuelve a comprobar.
4. Solo cuando `preflight-host.ps1` salga `ready` (exit 0) y por tanto `aos verify` pase todos sus
   comandos, este track puede aceptarse como terminado. Hasta entonces queda **BLOCKED/INCOMPLETE**
   en el punto exacto descrito arriba, sin fingir aceptación. El procedimiento del instalador
   (fix1) queda además pendiente de revisión independiente y de una ejecución real sobre un host con
   WSL/elevación disponibles — ningún claim de "instalado"/"listo" sale de este run.
