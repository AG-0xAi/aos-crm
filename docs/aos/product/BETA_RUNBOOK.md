# Runbook del operador para la beta

Fecha: 31 de octubre de 2026. Implementa los contratos `.aos/pack/aos-crm/specs/beta-espacios/spec.md`
(CRM-014) y `.aos/pack/aos-crm/specs/alta-invitacion/spec.md` (CRM-016).

Cada amigo de la beta usa **su propio espacio** del mismo despliegue, con su propia URL, sus propios
datos y su propio conector para ChatGPT o Claude. Desde CRM-016 el operador **solo añade un correo** y
la persona se da de alta y abre su espacio sola (§1); abrirlo a mano (§2 y §3) sigue documentado para
cuando eso no sirva. Este
documento es el procedimiento exacto del operador y está escrito contra el código de Twenty pinneado
en este checkout (`twenty/v2.51.0`, `15e4826d3b`): cada paso cita el fichero que lo implementa, para
que nadie tenga que adivinar qué hace el botón.

No contiene credenciales ni datos de negocio: el fork `AG-0xAi/aos-crm` es público. Las URLs que
aparecen son las del **stack local**; la columna de AWS dice cómo se traduce cada una cuando el
despliegue de CRM-013 esté arriba.

Lo que aquí se afirma está medido contra el stack local de este checkout con
`scripts/aos/test/crm-isolation-e2e.test.mjs` y `scripts/aos/test/crm-signup-invitation-e2e.test.mjs`;
las cifras de cada corrida están en `.aos/reports/CRM-014.md` y `.aos/reports/CRM-016.md`.

## 0. El perfil: qué hace que esto funcione así

Dos variables de configuración de Twenty, puestas en `deploy/local/compose.yaml` (y en las task
definitions de AWS, CRM-013):

| Variable | Valor | Qué hace | Dónde está en el código |
| --- | --- | --- | --- |
| `IS_MULTIWORKSPACE_ENABLED` | `true` | permite más de un espacio y hace que **cada petición resuelva su espacio por el subdominio** en vez de "el único que hay" | `config-variables.ts:2184`; `domain/workspace-domains/services/workspace-domains.service.ts` (`resolveWorkspaceAndPublicDomain`) |
| `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS` | `true` | solo un administrador del servidor puede crear espacios, y un registro sin invitación se rechaza | `config-variables.ts:588`; `auth/services/sign-in-up.service.ts` (`assertWorkspaceCreationAllowed`, `assertSignUpWithoutWorkspaceAllowed`) |
| `DEFAULT_SUBDOMAIN` | `app` | el subdominio de la pantalla de acceso, que **no** es el espacio de nadie | `config-variables.ts:1225`; `domain/domain-server-config/utils/get-subdomain-and-custom-domain-from-hostname.util.ts` |

**Quién es administrador del servidor.** La columna `canAccessFullAdminPanel` de `core."user"`
(`core-modules/user/user.entity.ts:77`). No se asigna por configuración: la recibe **el primer
usuario que se registra en el servidor** y nadie más (`sign-in-up.service.ts:842-850`, que solo la
concede cuando `hasServerAdmin()` es falso). En este despliegue ese primer usuario es el operador;
todos los amigos que entran después la tienen en `false`, y por eso no pueden abrir espacios. Para
dar o quitar esa marca a otra persona existe `updateServerAdminAccess` en el panel de administración
(`core-modules/admin-panel/admin-panel.resolver.ts`), que solo usa otro administrador del servidor.

**URLs.** Con multi-espacio activo el espacio se deduce del *host* de la petición, no de la
configuración:

| Para qué | Local | AWS (beta, CRM-013 + CRM-018) |
| --- | --- | --- |
| Acceso / selector de espacios | `http://app.localhost:43000` | `https://app.<dominio>` |
| Espacio del operador | `http://aos-crm.localhost:43000` | `https://<subdominio>.<dominio>` |
| Espacio de un amigo | `http://<subdominio>.localhost:43000` | `https://<subdominio>.<dominio>` |
| Conector MCP de ese amigo | `http://<subdominio>.localhost:43000/mcp` | `https://<subdominio>.<dominio>/mcp` |
| Pantalla de autorización | `http://<subdominio>.localhost:43000/authorize` | `https://<subdominio>.<dominio>/authorize` |
| API (`SERVER_URL`): ficheros, OAuth, webhooks | `http://localhost:43000` | `https://api.<dominio>` |
| La raíz `<dominio>` | no se usa | **no es del CRM** (ver §8) |

Desde CRM-018 (orden del founder, 30 de octubre de 2026) **la raíz del dominio no sirve el CRM en
AWS**: queda libre para la landing. La API se mudó a `api.<dominio>` y los espacios, el acceso y la
pantalla de autorización siguen exactamente donde estaban. El stack local no cambia.

En local el host base es `localhost` y no `127.0.0.1` a propósito: los navegadores resuelven
`*.localhost` a loopback sin DNS ni fichero `hosts` (RFC 6761), y una IP literal no tiene
subdominios, así que con `127.0.0.1` el stack arranca sano y **nadie puede entrar**.
`scripts/aos/local.ps1` bloquea el arranque si `SERVER_URL` no es `http://localhost:<puerto>`.

**Techo de espacios:** desde CRM-015 (orden del founder, 30 de octubre de 2026) este perfil no tiene
techo. La variable `MAX_WORKSPACES` (`config-variables.ts:609`, vacío o `0` significa sin límite)
está fijada a `"0"` en `deploy/local/compose.yaml`, igual que en la Terraform de AWS (CRM-017). La
decisión vive en `assertWorkspaceCountWithinLimit` (`auth/services/sign-in-up.service.ts`), que
delega en el helper puro `isWorkspaceCountWithinLimit`
(`auth/utils/is-workspace-count-within-limit.util.ts`). **Nota de licencia:** si en algún despliegue
se fija un `MAX_WORKSPACES` positivo, una clave Enterprise válida sigue levantando ese límite
igual que antes, sin importar cuántos espacios haya.

## 1. Dar de alta a alguien: la persona crea su cuenta y su espacio sola

Esto es lo normal desde CRM-016 y es lo que hay que usar. El operador solo añade un correo; lo demás
lo hace la persona. El procedimiento a mano de §2 y §3 sigue existiendo para cuando no sirva este.

1. El operador entra en su CRM, va a **Settings → Admin Panel → General** y busca la sección
   **«Sign-up invitations»** (justo debajo de la lista de administradores).
2. Escribe el correo de la persona y pulsa **Invite**. Aparece una fila **Pending** con su fecha de
   caducidad: **siete días**.
3. A la persona le llega un correo **«Te han invitado a Betty»** con un enlace único. El correo sale
   en el idioma en el que el operador tenía la interfaz (hay español e inglés).
4. La persona abre el enlace y ve la pantalla de alta con **su correo ya puesto y bloqueado**: ese
   enlace no sirve para ninguna otra dirección. Elige contraseña, y después el nombre y el
   subdominio de su espacio. El subdominio es su URL, así que conviene que sea su nombre
   (1-30 caracteres, minúsculas, números y guiones).
5. Al confirmar, la persona queda **administradora de su propio espacio** y la fila del panel pasa a
   **Used**. El operador **no** es miembro de ese espacio: no hay nada que abandonar después.

Lo que el operador puede hacer con una fila:

| Acción | Para qué | Qué pasa |
| --- | --- | --- |
| **Resend** | el correo se perdió, o la invitación caducó | se manda otro correo **con un enlace nuevo**; el anterior deja de funcionar |
| **Revoke** | la invitación ya no debe usarse | el enlace deja de funcionar al instante |

Reglas que el servidor aplica solo, sin que el operador tenga que acordarse:

- **Un solo uso.** El enlace abre **un** espacio. Repetirlo no abre un segundo.
- **Una sola dirección.** El enlace solo vale para el correo al que se mandó.
- **Siete días.** Pasado eso caduca y hay que reenviarlo (`SIGN_UP_INVITATION_TOKEN_EXPIRES_IN`).
- **El token no se guarda.** En la base de datos solo queda su huella (sha256), así que ni el
  operador ni nadie con acceso a la base puede recuperar el enlace: si se pierde, se reenvía.
- **Sin invitación, nadie abre espacios.** Quien no sea administrador del servidor y no traiga un
  enlace válido sigue recibiendo `Workspace creation is restricted to admins`.
- **El tope de espacios sigue mandando.** Una invitación no sube el techo de cinco espacios del §0:
  si el despliegue está lleno, el alta se rechaza aunque la invitación sea válida.

### Mientras no haya correo de verdad (hoy)

`EMAIL_DRIVER` está en `LOGGER`, así que ese correo **no sale de la máquina**: se escribe en el log
del **worker**. Para leer el enlace y pasarlo a mano:

```sh
docker compose -f deploy/local/compose.yaml -p aos-crm-local logs --no-log-prefix   --tail 4000 worker | grep -o "http[^\"<> ]*signUpInvitationToken=[^\"<> ]*" | tail -1
```

Es el log del `worker` y no del `server`, y se lee con `--tail` y **no** con `--since` (ver §3 para el
porqué de las dos cosas). El enlace **es una credencial**: se manda por un canal privado, no se pega
en un chat de grupo. Encender el correo de verdad es §9.

### Comprobar qué hay pendiente antes de exponer el despliegue

```sh
docker compose -f deploy/local/compose.yaml -p aos-crm-local exec -T db   psql -U aos_crm -d aos_crm_local -c "select context->>'email', \"expiresAt\", \"revokedAt\" from core.\"appToken\" where type = 'SIGN_UP_INVITATION_TOKEN' and context->>'consumedAt' is null and \"revokedAt\" is null;"
```

Lo que salga ahí son enlaces vivos. Lo que no se vaya a usar, **Revoke**.

## 2. Abrir el espacio de un amigo

El operador no "crea un usuario": crea un espacio y después lo entrega.

1. Entra en la pantalla de acceso (`http://app.localhost:43000`) con su propia cuenta. El selector
   lista sus espacios y ofrece **"Create a workspace"**
   (`twenty-front/src/modules/auth/sign-in-up/components/SignInUpGlobalScopeForm.tsx`, que lleva al
   paso `WorkspaceCreation`).
2. Rellena el nombre del espacio y su subdominio. El subdominio es la URL del amigo, así que conviene
   que sea su nombre: 1-30 caracteres, minúsculas, números y guiones, sin empezar por `api-`
   (`twenty-shared/src/constants/SubdomainPattern.ts`), y no puede ser `app` ni otro reservado
   (`subdomain-manager/utils/is-subdomain-valid.util.ts`).
3. Al confirmar, el frontend llama `signUpInNewWorkspace`
   (`auth/auth.resolver.ts:698`). El espacio nace en `PENDING_CREATION` y la propia interfaz lo
   **activa** (`activateWorkspace`), que es el paso que crea su esquema de datos y sus objetos
   estándar. Hasta que se activa, el espacio no tiene API de registros.

Medido: un amigo que **no** es administrador del servidor ve el botón igual (es una pantalla pública)
y el servidor le responde `Workspace creation is restricted to admins`; no se crea ninguna fila.
`crm-isolation-e2e.test.mjs` lo comprueba con un usuario sintético real.

## 3. Entregarlo: el amigo como administrador de su espacio, sin correo

Este despliegue **no tiene salida de correo**: `EMAIL_DRIVER` se queda en el valor por defecto
`LOGGER` (`config-variables.ts:531`), de modo que el "correo" de invitación se escribe en un log y no
sale de la máquina (`email/drivers/logger.driver.ts`). Eso es lo que convierte el enlace de
invitación en un enlace que el operador copia a mano. Es la etapa 1 de §9, y mientras siga ahí este
procedimiento es el único que funciona.

**En el log del `worker`, no del `server`.** `EmailService.send` no envía: encola un `EmailSenderJob`
(`email/email.service.ts`), y quien lo ejecuta —y por tanto quien imprime el correo entero— es el
**worker** (`email/email-sender.job.ts`). Medido el 30/10: el log del `server` no contiene ni una
línea `Sent email to`, y el del `worker` las contiene todas. Y se lee con `--tail`, **no con
`--since`**: en este host `docker compose logs --since <duración>` devolvió vacío incluso para
líneas de hace segundos.

1. Dentro del espacio nuevo, el operador va a **Settings → Members**, invita la dirección del amigo
   y le asigna el rol **Admin** en la misma invitación. La mutación es `sendInvitations(emails,
   roleId)` (`workspace-invitation/workspace-invitation.resolver.ts:153`), que exige el permiso
   `WORKSPACE_MEMBERS` y, para fijar el rol, también `ROLES`.
2. El operador lee el enlace en el log del servidor:

   ```sh
   docker compose -f deploy/local/compose.yaml -p aos-crm-local logs --no-log-prefix \
     --tail 4000 worker | grep -o "http[^\"<> ]*/invite/[^\"<> ]*" | tail -1
   ```

   El enlace tiene la forma `http://<subdominio>.localhost:43000/invite/<inviteHash>?inviteToken=<token>&email=<correo>`
   (`workspace-invitation.service.ts:349-358`). **Es una credencial**: quien lo tenga entra en ese
   espacio con el rol invitado, así que se envía por un canal privado y no se pega en un chat de
   grupo. Caduca según `INVITATION_TOKEN_EXPIRES_IN`.
3. El amigo abre el enlace, elige contraseña y queda dentro con el rol Admin del espacio
   (`signUpInWorkspace`, `auth.resolver.ts:580`, que valida que el token corresponde a su dirección).
   El token de invitación **no** se puede recuperar por la API: `loadWorkspaceInvitations` lo excluye
   explícitamente (`select: { value: false }`), así que si se pierde hay que reenviar la invitación
   (`resendWorkspaceInvitation`) y leer el log otra vez.

### Aviso que hay que leer antes de invitar a nadie (actualizado en CRM-016)

Hasta CRM-016, una invitación pendiente era una credencial que se entregaba a quien **supiera la
dirección**: la respuesta del registro le daba el token personal de la invitación y canjearlo le
metía en el espacio. **Eso está cerrado.** Ahora el token personal solo viaja a una identidad que ha
**probado la dirección** (tiene el enlace, o tiene el correo verificado); quien solo la conoce
recibe la respuesta sin token. Medido en `crm-signup-invitation-e2e.test.mjs`.

Lo que **sigue siendo cierto** y conviene no olvidar:

1. **El enlace de la invitación es la credencial.** Quien lo tenga entra en ese espacio con el rol
   invitado. Se manda por un canal privado y no se pega en un chat de grupo.
2. Alguien que **conozca una dirección invitada** todavía puede crear una cuenta con ella y, al
   hacerlo, ver que esa dirección está invitada a un espacio (nombre y URL). **No entra** y **no lee
   ningún dato**: sin el enlace no hay token que canjear. Es una filtración de "a quién invitaste",
   no de acceso.
3. **Borra toda invitación pendiente que no se vaya a usar** (Settings → Members, o
   `deleteWorkspaceInvitation`). No dejes invitaciones abiertas "para luego".
4. Comprueba qué hay pendiente antes de exponer el despliegue:
   `select context->>'email' from core."appToken" where type = 'INVITATION_TOKEN' and "deletedAt" is null;`
5. `IS_EMAIL_VERIFICATION_REQUIRED=true` sigue sin estar medido aquí y sigue sin ser gratis: hoy el
   enlace de verificación también acabaría en el log del worker y el operador tendría que llevarlo a
   mano. Con el agujero del token cerrado, ya no es urgente: queda como decisión del founder.

Alternativa sin rol preasignado: Settings → Members ofrece también un **enlace genérico** del espacio
(el `inviteHash`); sirve para que entre cualquiera que lo tenga, y después el operador le cambia el
rol a Admin en la misma pantalla. Se usa solo si el paso 1 no es posible, porque un enlace genérico
no caduca por persona.

## 4. Salir el operador

Cuando el amigo ya es Admin de su espacio, el operador deja de tener razón para estar dentro.

1. En **Settings → Members** del espacio del amigo, el operador borra **su propio** miembro. La
   mutación es `deleteUserFromWorkspace(workspaceMemberIdToDelete)`
   (`core-modules/user/user.resolver.ts:428`): quita la pertenencia a ese espacio y deja la cuenta
   del operador intacta en los demás.
2. Comprobación: el espacio desaparece del selector del operador, y su propia sesión en ese
   subdominio deja de resolver.

Importante y sin adornos: salir del espacio **no** quita el poder del operador sobre el servidor.
Sigue siendo administrador del servidor, así que puede impersonar (`canImpersonate`), leer el panel
de administración y borrar el espacio. El aislamiento que esta beta demuestra es **entre espacios**
(ningún usuario de un espacio alcanza otro); no es aislamiento frente al administrador del servidor,
que es quien opera la máquina. Si el founder quiere que ni el operador pueda entrar, eso es otra
decisión de producto (quitarse `canImpersonate` a sí mismo y dejar constancia).

## 5. Restablecer una contraseña sin correo

1. El amigo pulsa "Forgot password" en su propia pantalla de acceso, o el operador dispara el enlace
   con la mutación pública `emailPasswordResetLink(email, workspaceId)` (`auth.resolver.ts:1270`).
2. El operador lee el enlace del log del **worker**, igual que la invitación (y por la misma razón:
   el correo lo imprime quien ejecuta el trabajo encolado):

   ```sh
   docker compose -f deploy/local/compose.yaml -p aos-crm-local logs --no-log-prefix \
     --tail 4000 worker | grep -o "http[^\"<> ]*/reset-password/[0-9a-f]\{64\}" | tail -1
   ```

   `tail -1` no es cosmética: el log conserva los enlaces de restablecimientos anteriores, ya
   revocados, y el que sirve es el último.

   El enlace apunta a la URL del espacio del amigo con el token en la ruta
   (`auth/services/reset-password.service.ts:206-213`) y caduca según
   `PASSWORD_RESET_TOKEN_EXPIRES_IN`. Cada nuevo enlace **revoca el anterior**
   (`rotatePasswordResetToken`), y el servidor limita a 3 peticiones por dirección y ventana
   (`PASSWORD_RESET_EMAIL_RATE_LIMIT_MAX`).
3. El amigo abre el enlace y elige contraseña nueva (`updatePasswordViaResetToken`).

El operador nunca ve ni fija la contraseña: solo transporta un enlace de un solo uso.

## 6. Borrar un espacio a petición

El borrado es en dos pasos porque el producto borra en dos pasos, y decirlo importa: el primer paso
**no** borra los datos.

1. **El dueño del espacio** (o el operador, si sigue dentro) usa Settings → General → Delete
   workspace, que llama `deleteCurrentWorkspace`
   (`core-modules/workspace/workspace.resolver.ts:254`). Eso **suspende** el espacio y lo marca como
   borrado (`deleteWorkspace(id, softDelete = true)`): la fila, el esquema de datos y todos los
   registros siguen en la base de datos, y los miembros pierden el acceso.
2. **El operador** borra de verdad, desde la máquina:

   ```sh
   docker compose -f deploy/local/compose.yaml -p aos-crm-local exec -T server \
     yarn command:prod workspace:clean --workspace-id <id> --only-operation destroy \
     --ignore-destroy-grace-period
   ```

   Ese comando (`workspace-cleaner/commands/clean-suspended-workspaces.command.ts`) **encola** el
   trabajo; quien lo ejecuta es el **worker** (`destroy-soft-deleted-workspace.job.ts`), que llama
   `deleteWorkspace` sin `softDelete` y tira el esquema del espacio. Sin `--ignore-destroy-grace-period`
   el borrado espera el periodo de gracia configurado.
3. Comprobación, que no es opcional: el esquema y la fila ya no están.

   ```sh
   docker compose -f deploy/local/compose.yaml -p aos-crm-local exec -T db \
     psql -U aos_crm -d aos_crm_local -t -A \
     -c "select count(*) from core.workspace where id = '<id>'"
   ```

   `crm-isolation-e2e.test.mjs` hace exactamente estos tres pasos con sus dos espacios sintéticos y
   espera el efecto en la base de datos en vez de fiarse del código de salida del comando.

## 7. El conector de cada usuario (ChatGPT / Claude)

**La URL que pega cada usuario es la de su propio espacio más `/mcp`:**

```
http://<subdominio>.localhost:43000/mcp        (local)
https://<subdominio>.<dominio>/mcp             (AWS)
```

No la del host base. El descubrimiento OAuth se construye con el **host que pidió el cliente**
(`mcp-auth.guard.ts:26` y `application-oauth/controllers/oauth-discovery.controller.ts`, ambos sobre
`request.get('host')`), así que al pegar su propia URL:

- el `401` inicial apunta a `http://<subdominio>…/.well-known/oauth-protected-resource/mcp`,
- el emisor y el registro dinámico son ese mismo host,
- y la **pantalla de autorización es `http://<subdominio>…/authorize`**: la de su propio espacio,
  donde ya está identificado. Ahí ve qué pide el cliente y lo aprueba (`authorizeApp`,
  `auth.resolver.ts:1139`), y el código vuelve al cliente con PKCE S256.

**Corrección (CRM-018, 30 de octubre de 2026).** Hasta ahora este runbook decía que pegar el host de
la API «funciona, pero hace al usuario pasar por el selector». Al leer el código con detalle, **no
funciona**, y conviene saber por qué para no perder una tarde: el servidor ve que ese host no sirve
ninguna interfaz de espacio (`isApiHost` en `oauth-discovery.controller.ts:91-95`) y manda la
autorización a `app.<dominio>/authorize?iss=…`; pero en `app.<dominio>` el front carga el enrutador
sin espacio (`DomainShell.tsx:39` → `useCreateRootAppRouter.tsx`), que **no tiene ruta
`/authorize`** — solo acceso, invitación, verificación de correo y restablecimiento. El usuario
acaba en una página «no encontrada». Y aunque la tuviera, la mutación que concede el permiso exige
un espacio en la sesión (`authorizeApp` con `@AuthWorkspace()`, `auth.resolver.ts:1149` y
`auth-workspace.decorator.ts`), y `app.<dominio>` es justamente el host que el servidor traduce a
«ningún espacio» (`get-subdomain-and-custom-domain-from-hostname.util.ts:30`).

**Por eso hay una sola URL de conector y es la del espacio.** Es además la que la propia aplicación
enseña en **Ajustes > IA**: esa pantalla la construye con el origen de la ventana del navegador, no
con una URL configurada (`SettingsMcpSetup.tsx:49` sobre `buildMcpServerUrl`, que lee
`REACT_APP_SERVER_BASE_URL`; cuando el servidor sirve el front inyecta `window._env_ = {}`, ver
`render-frontend-html.util.ts:19`, así que el valor acaba siendo `window.location.origin`). Si el
usuario está dentro de su espacio, lo que copia de Ajustes > IA y lo que dice este runbook son la
misma URL. No hay dos respuestas.

Este punto no se ha ejercitado contra el despliegue de AWS: está leído del código y medido en local
por `crm-isolation-e2e.test.mjs`. La comprobación tras el despliegue es
`scripts/aos/verify-public-hosts.mjs` (ver §8).

Medido en `crm-isolation-e2e.test.mjs` (R3): el token OAuth que obtiene un usuario de su espacio
**solo ve su espacio** por `/mcp` — los ids del otro espacio no se leen, no aparecen al buscar por
nombre y no se pueden modificar ni borrar — y lo mismo por REST. El detalle de qué herramientas
ofrece el conector, qué se le quitó y con qué rol conviene conectar está en
[MCP_CONNECTOR.md](MCP_CONNECTOR.md).

Límite heredado de CRM-007 y que sigue en pie: un token de acceso OAuth ya emitido es un JWT
autocontenido y sobrevive a la revocación de su autorización hasta que caduca (hasta 1800 s). Para
cortar el acceso de inmediato hay que cambiar la contraseña del usuario o quitarlo del espacio.

## 8. Sacar el CRM de la raíz y poner ahí la landing

Orden del founder del 30 de octubre de 2026: la raíz del dominio es para la landing, el CRM vive en
sus subdominios. Son **dos pasos separados**, y el orden importa.

### Paso 1 — Mover la API (se puede hacer ya, sin la landing)

La API pasa de la raíz a `api.<dominio>`. No hace falta ningún DNS nuevo ni ningún certificado
nuevo: el comodín `*.<dominio>` y el certificado comodín ya cubren ese nombre, y `api` es un
subdominio que Twenty tiene reservado, así que ningún espacio puede llamarse así nunca
(`twenty-shared/src/constants/ReservedSubdomains.ts`).

1. Aplicar Terraform con el cambio de CRM-018 (`deploy/aws/ecs.tf`). Lo único que cambia es la
   definición de tarea de ECS: el servicio se despliega de nuevo con `SERVER_URL=https://api.<dominio>`.
2. Esperar a que el servicio quede estable y comprobarlo con la comprobación de abajo.

**Qué se nota y qué no.** No se nota: los espacios, el acceso, los enlaces de los correos y la
pantalla de autorización siguen igual, porque todos se construyen desde `app.<dominio>` o desde el
subdominio del espacio, nunca desde la raíz. Sí se nota, y hay que tenerlo en cuenta:

- **Los enlaces de ficheros firmados que ya se habían generado** apuntaban a la raíz
  (`file-url.service.ts`); los nuevos apuntan a `api.<dominio>`. Mientras la raíz siga en el ALB,
  los viejos siguen funcionando; cuando la raíz se vaya a la landing, dejan de funcionar. Son
  enlaces de corta vida (caducan con su token), así que basta con no hacer los dos pasos el mismo
  minuto.
- **Webhooks de Google y Microsoft** se registran con la URL de la API
  (`google-webhook-subscription.driver.ts`, `microsoft-webhook-subscription.driver.ts`). Esta beta
  no los usa; si algún día se usan, hay que volver a registrarlos tras el cambio.

### Paso 2 — Dar la raíz a la landing (cuando la landing esté lista)

En `terraform.tfvars`, rellenar las dos variables que CRM-018 añadió y aplicar:

```hcl
apex_a_records   = ["<la dirección A que publique el host de la landing>"]
www_cname_target = "<el destino CNAME que publique el host de la landing>"
```

Con esas dos líneas el plan toca **solo** dos registros DNS: la raíz deja de ser un alias al ALB y
pasa a ser un registro A al host externo, y `www` pasa a tener su propio CNAME (hoy no tiene
registro propio: lo resuelve el comodín). Sin esas dos líneas el plan no cambia nada, que es como
está hoy.

Lo que **no** se toca y conviene no tocar: los registros de correo de la raíz (MX y SPF de
`apex_mailbox_mx_records` / `apex_mailbox_spf_value`, CRM-017) son de otro tipo y conviven con el
registro A. Moverse la landing no afecta al correo.

### Volver atrás

Quitar esas dos líneas de `terraform.tfvars` y aplicar: la raíz vuelve a ser alias del ALB y el
registro de `www` desaparece. El TTL de los registros externos es de 300 segundos
(`var.external_record_ttl`), así que la vuelta tarda minutos, no horas. Volver atrás del paso 1 es
igual de simple: revertir `SERVER_URL` y desplegar, pero **solo tiene sentido si la raíz todavía
está en el ALB**.

### Comprobarlo (no fiarse de que el apply dijo «ok»)

```sh
node scripts/aos/verify-public-hosts.mjs --domain <dominio> --workspace-host <subdominio>.<dominio>
```

Comprueba, contra el despliegue de verdad: que `api.<dominio>/healthz` responde 200; que el
descubrimiento OAuth en `api.<dominio>` y en el espacio devuelve como emisor **el host que se
pidió**; que `/mcp` sin credenciales devuelve 401 con su puntero `resource_metadata` a ese mismo
host en los dos; y que `app.<dominio>` sirve la pantalla de acceso de verdad (busca el elemento que
el servidor inyecta, no solo un 200). Si algo falla en su subdominio pero la raíz sí lo contesta, lo
dice con esas palabras. Sale distinto de 0 si algo falla.

Después del paso 2, añadir `--require-apex-off`: así además exige que la raíz **ya no** sirva el
CRM. Antes del paso 2 eso es normal y el script lo dice como información, no como fallo.

### Reconectar ChatGPT y Claude

La URL del conector **no cambia con esta mudanza**: siempre fue y sigue siendo la del espacio,
`https://<subdominio>.<dominio>/mcp` (§7). Quien ya lo tenga conectado no tiene que hacer nada.

Quien lo tenga apuntando a la raíz (porque alguien se lo dio mal) tiene que rehacerlo: borrar el
conector en su cliente y añadirlo de nuevo con la URL de su espacio. La forma de llegar a ella sin
preguntar a nadie es **Ajustes > IA** dentro de su propio espacio, que muestra exactamente esa URL y
la deja copiar. Al añadirlo, el cliente pide autorización y el usuario la aprueba en la pantalla de
su espacio; no hay que tocar nada en el servidor.

### Un aviso de seguridad que hay que leer antes del paso 2

Mientras `FRONTEND_URL` siga siendo la raíz —y tiene que seguir siéndolo, es de donde el servidor
deduce el nombre de cada espacio—, el servidor sigue teniendo el **origen de la raíz en su lista de
orígenes de confianza** para peticiones con credenciales
(`resolve-allowed-credentialed-origins.util.ts:85`, que la deriva de `FRONTEND_URL` sin condición).
Hoy eso es inofensivo porque la raíz es el propio CRM. Cuando la raíz la sirva un tercero, cualquier
script que se ejecute en la landing queda tratado como origen de confianza por la API del CRM. No
hay interruptor de configuración que lo quite: la lista solo se puede ampliar
(`AUTH_COOKIE_ALLOWED_ORIGINS`), no recortar. **Es una decisión para el founder** antes del paso 2:
o se acepta (la landing es suya y controla qué scripts carga), o hace falta un cambio de código en
ese fichero, que está fuera de lo que CRM-018 tocó.

## 9. El correo: tres etapas, y el buzón del dominio

Mandar y recibir son dos cosas distintas, las hace cada una un proveedor distinto, y se encienden
por separado:

- **Mandar** (invitaciones, restablecimientos, avisos) lo hace Amazon SES, que CRM-017 ya montó en
  AWS: el dominio dado de alta, sus firmas DKIM, el remitente y un usuario con permiso para enviar y
  nada más. Está montado pero **apagado**, a propósito.
- **Recibir** (el buzón donde el founder lee lo que le escriben) lo hace un proveedor de correo
  externo contratado con el dominio. SES no recibe nada.

### Las tres etapas de mandar correo

Cada etapa es **una línea en `terraform.tfvars` y un apply**, nunca un cambio de código ni una
imagen nueva:

| Etapa | Qué se pone en `terraform.tfvars` | Qué cambia para la gente |
| --- | --- | --- |
| **1. Hoy** | nada: los valores por defecto | El correo **se escribe en el log del worker** y no sale a internet, que es de lo que vive el procedimiento a mano de §3 y §5. Para entrar no hace falta tener la dirección verificada. |
| **2. Correo de verdad** | `outbound_email_enabled = true` | Invitaciones y restablecimientos salen por SES desde el remitente del dominio, y el operador deja de copiar enlaces del log. Entrar sigue sin exigir verificación. |
| **3. Verificación obligatoria** | y además `email_verification_required = true` | Quien no tenga su dirección verificada no puede entrar. Es el control que cierra el agujero del aviso de §3 («una invitación pendiente es una credencial»). |

**La etapa 1 es la que está aplicada y la que describe el resto de este runbook.** Las etapas 2 y 3
son decisiones del founder, y cada una tiene una condición que no depende de nosotros.

### Qué hay que esperar para la etapa 2

AWS tiene la cuenta de SES en el **sandbox**: en ese modo SES solo entrega a direcciones que alguien
haya dado de alta y confirmado **una a una** en la consola de AWS. Invitar a un amigo desde el CRM
con SES en sandbox no da un error visible en la aplicación: el correo simplemente no llega. Por eso
la etapa 2 espera a que AWS saque la cuenta del sandbox (hay una solicitud abierta; la primera fue
denegada). Mientras eso no pase, encenderla empeora las cosas respecto a la etapa 1, donde al menos
el enlace está en el log y el operador lo puede pasar.

### Qué hay que hacer antes de la etapa 3, y por qué en este orden

En cada entrada, el servidor comprueba que la dirección del usuario esté marcada como verificada en
la base de datos (`checkIsEmailVerified`, `auth.service.ts:260-266`). **Todas las cuentas que existen
hoy se crearon a mano, sin correo, así que ninguna lo está.** Encender la etapa 3 antes de arreglar
eso echa fuera de su propio espacio a todo el mundo, el operador incluido. El orden es:

1. Etapa 2 encendida y probada: un correo de verdad que llega. Sin eso, el enlace de verificación no
   tiene a dónde ir, y de eso se ocupa Terraform, que **se niega a aplicar la etapa 3 sin la 2** y lo
   dice con ese motivo en el mensaje de error.
2. Mirar en la base de datos quién no está verificado y marcarlo (`select email, "isEmailVerified"
   from core."user";`). Cuando no quede ninguno en `false`, la etapa 3 es segura.

### Volver atrás

Quitar la línea de `terraform.tfvars` y aplicar. ECS vuelve a desplegar el servicio y el worker con
el valor anterior; no hay que reconstruir ninguna imagen ni tocar la base de datos. De la etapa 3 se
vuelve en minutos; de la etapa 2, los correos ya enviados ya están enviados.

### Conectar el buzón del dominio

El proveedor del buzón da tres cosas en su pantalla de configuración, y cada una tiene su variable:

| Lo que da el proveedor | Variable de `terraform.tfvars` |
| --- | --- |
| Los servidores de correo entrante (registros MX de la raíz) | `apex_mailbox_mx_records` |
| La línea SPF de la raíz | `apex_mailbox_spf_value` |
| Sus CNAME: las firmas DKIM del proveedor y, si los publica, `autodiscover` / `autoconfig` | `apex_mailbox_cname_records` |

El formato exacto, con valores de ejemplo, está en `deploy/aws/terraform.tfvars.example`. Los
nombres del mapa van **sin el dominio**: Terraform se lo añade.

Dos cosas que conviene saber antes de rellenarlo:

- **Un CNAME no convive con otro registro del mismo nombre: lo sustituye.** Por eso Terraform
  **rechaza** un CNAME en `mail` (el remitente de SES), en `_dmarc`, en un nombre con la forma de
  las firmas DKIM que crea SES, y en `api`, `app` y `www` (los hosts del propio CRM). Si se intenta,
  el apply se para y el mensaje dice qué registro se habría roto. Las firmas DKIM del proveedor del
  buzón sí entran: tienen nombre de palabra, no de clave generada.
- **El DMARC ya existe.** CRM-017 dejó `_dmarc` en modo de solo observar (`p=none`). Si el proveedor
  del buzón pide añadir el suyo, no se añade: ya hay uno, y dos se pisan.

Nada de esto afecta al envío ni al CRM: los MX y el SPF del buzón viven en la raíz, los de SES viven
en `mail.<dominio>`, y los CNAME del buzón son nombres propios suyos.

## 10. Lo que este runbook no cubre

- **El resto del panel de administración del servidor** (`/settings/admin-panel`): búsqueda de
  usuarios, impersonación y variables de configuración. De ese panel, CRM-016 solo ejercita la
  sección de invitaciones de alta (§1); lo demás no forma parte de este procedimiento.
- **SSO, facturación y permisos por fila** son Enterprise y esta beta no los usa.
- **Correo saliente**: montado en AWS y apagado. Hoy las invitaciones de alta, las de equipo y los
  restablecimientos siguen pasando por el log del worker y por la mano del operador; encenderlo es una
  decisión del founder en dos pasos, y está en §9 con sus condiciones. Mientras siga apagado, el alta
  autónoma de §1 lo es a medias: la persona hace todo el trámite sola, pero el enlace se lo pasa el
  operador.
- **Copias de seguridad** del volumen de PostgreSQL: fuera de este track. Antes de que los amigos
  metan datos de verdad, es la siguiente pregunta que hay que resolver.
