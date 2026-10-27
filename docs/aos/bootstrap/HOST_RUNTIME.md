# CRM-001-HOST — runtime Linux/contenedores sobre este mismo checkout

Fecha: 27 de octubre de 2026. Implementa el contrato `.aos/pack/aos-crm/specs/host-runtime/spec.md`.
Continúa [LOCAL_SETUP.md](LOCAL_SETUP.md) con los dos scripts reales y su estado medido ahora mismo,
no uno propuesto.

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

## `install-host-wsl.ps1`: qué hace cada fase

- **Fase 1** (Windows, necesita elevación): si `wsl --status` ya sale 0, no hace nada
  ("already-satisfied", idempotente). Si no, y la sesión no está elevada, imprime el comando exacto
  y los pasos siguientes sin ejecutarlos. Si la sesión sí está elevada, corre `wsl.exe --install` una
  vez (comando oficial único de Microsoft) y se detiene para el reinicio manual.
- **Fase 2** (Linux, no necesita elevación de Windows): si `wsl --help` todavía es el stub de
  arranque, se bloquea con `blocked-phase1-incomplete`. Si hay una distribución registrada, comprueba
  si `docker` ya existe (idempotente) y si no, instala Docker Engine paso a paso como root dentro de
  esa distribución, replicando exactamente la [guía oficial de Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
  (repositorio apt + clave GPG + paquetes `docker-ce`/`docker-ce-cli`/`containerd.io`/
  `docker-buildx-plugin`/`docker-compose-plugin`) y habilita el servicio con
  [`systemctl enable --now`](https://docs.docker.com/engine/install/linux-postinstall/). Cada paso
  registra su propio comando y código de salida; el primer fallo detiene los siguientes (no hay
  "seguir de largo" silencioso). Un paso best-effort añade al grupo `docker` a cualquier usuario ya
  presente en `/home` (para uso interactivo futuro sin `sudo`), sin bloquear el resto si no hay
  ninguno. Nunca cambia la distro por defecto, nunca `--unregister`/`--shutdown`, nunca toca otra
  distribución que la seleccionada.
- `-WhatIf` (nativo de PowerShell, `SupportsShouldProcess`) imprime qué comando correría en cada paso
  mutante sin ejecutarlo — la vía de revisión pedida por el contrato, sin reinventar una bandera
  propia.

## `preflight-host.ps1`: qué mide y cómo decide `ready`

Lee únicamente; no es un instalador. Mide, en este orden: identidad del checkout (ruta +
`HEAD` + presencia de `.aos`), build/elevación de Windows, virtualización de firmware/SLAT/DEP
(propiedades CIM, independientes de idioma — no se parsea `systeminfo` localizado), estado real de
`VirtualMachinePlatform`/`Microsoft-Windows-Subsystem-Linux` vía WMI, comportamiento real de
`wsl.exe` (nunca confía en que el binario exista: corre `--status`/`--help` y decodifica su salida
UTF-16 preservando acentos), distribuciones registradas y su versión WSL, memoria/disco.

Si hay una distribución usable, además: traduce esta misma ruta de checkout con `wslpath`, compara el
`HEAD` de Git visto desde Linux contra el de Windows, confirma que `.aos/` es alcanzable desde esa
misma ruta (nunca otro checkout), comprueba que `docker` responde dentro de esa distribución y — solo
si todo lo anterior pasa — corre el smoke aislado oficial `docker run --rm hello-world` (imagen
oficial de Docker, sin puertos publicados, sin datos de otro producto, contenedor autoeliminado por
`--rm`). `ready` (exit 0) exige las cinco cosas a la vez; cualquier ausencia queda en
`missingPrerequisites` con el paso concreto que la resuelve, nunca con una versión inventada.

## Gate del proyecto

`.aos/verify.json` ahora incluye
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/aos/preflight-host.ps1` junto a los dos
comandos de procedencia de CRM-001. Con el host en el estado medido arriba, este comando falla el
gate **a propósito** (exit 1): es el comportamiento pedido por el contrato ("el gate debe fallar si
falta WSL/Linux/runtime"), no un defecto del script. Ninguno de los tres comandos del gate construye,
arranca servidor/worker/DB/Redis, corre typecheck/tests de la aplicación o instala una dependencia del
CRM — ese gate completo sigue en CRM-004/CRM-005.

## Fuentes oficiales usadas

- [Install WSL — Microsoft Learn](https://learn.microsoft.com/en-us/windows/wsl/install)
- [Basic commands for WSL — Microsoft Learn](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
  (confirma `--no-distribution`, `--no-launch`, `--distribution` como opciones documentadas de
  `wsl --install`, deliberadamente no usadas en la fase 1 hasta confirmar que el stub actual las
  soporta, por pedido explícito del contrato)
- [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Engine post-installation steps on Linux](https://docs.docker.com/engine/install/linux-postinstall/)

## Siguiente paso (fuera del alcance de esta sesión)

1. El founder (o quien tenga consola de administrador) corre `wsl.exe --install` elevado y reinicia.
2. Lanza la distribución instalada una vez para crear su usuario/contraseña de Linux.
3. Re-corre `scripts/aos/preflight-host.ps1`; si sigue `not-ready`, re-corre
   `scripts/aos/install-host-wsl.ps1` (fase 2, Docker Engine) y vuelve a comprobar.
4. Solo cuando `preflight-host.ps1` salga `ready` (exit 0) y por tanto `aos verify` pase los tres
   comandos, este track puede aceptarse como terminado. Hasta entonces queda **BLOCKED/INCOMPLETE**
   en el punto exacto descrito arriba, sin fingir aceptación.
