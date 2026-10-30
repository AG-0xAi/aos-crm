# CRM-014 — Runbook del operador para la beta

Fecha: 30 de octubre de 2026. Implementa el contrato `.aos/pack/aos-crm/specs/beta-espacios/spec.md`.

Cada amigo de la beta usa **su propio espacio** del mismo despliegue, con su propia URL, sus propios
datos y su propio conector para ChatGPT o Claude. Los espacios los abre **solo el operador**. Este
documento es el procedimiento exacto del operador y está escrito contra el código de Twenty pinneado
en este checkout (`twenty/v2.51.0`, `15e4826d3b`): cada paso cita el fichero que lo implementa, para
que nadie tenga que adivinar qué hace el botón.

No contiene credenciales ni datos de negocio: el fork `AG-0xAi/aos-crm` es público. Las URLs que
aparecen son las del **stack local**; la columna de AWS dice cómo se traduce cada una cuando el
despliegue de CRM-013 esté arriba.

Lo que aquí se afirma está medido contra el stack local de este checkout con
`scripts/aos/test/crm-isolation-e2e.test.mjs`; las cifras de cada corrida están en
`.aos/reports/CRM-014.md`.

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

| Para qué | Local | AWS (beta, CRM-013) |
| --- | --- | --- |
| Acceso / selector de espacios | `http://app.localhost:43000` | `https://app.<dominio>` |
| Espacio del operador | `http://aos-crm.localhost:43000` | `https://<subdominio>.<dominio>` |
| Espacio de un amigo | `http://<subdominio>.localhost:43000` | `https://<subdominio>.<dominio>` |
| Conector MCP de ese amigo | `http://<subdominio>.localhost:43000/mcp` | `https://<subdominio>.<dominio>/mcp` |
| Pantalla de autorización | `http://<subdominio>.localhost:43000/authorize` | `https://<subdominio>.<dominio>/authorize` |

En local el host base es `localhost` y no `127.0.0.1` a propósito: los navegadores resuelven
`*.localhost` a loopback sin DNS ni fichero `hosts` (RFC 6761), y una IP literal no tiene
subdominios, así que con `127.0.0.1` el stack arranca sano y **nadie puede entrar**.
`scripts/aos/local.ps1` bloquea el arranque si `SERVER_URL` no es `http://localhost:<puerto>`.

**Techo que hay que saber antes de prometer espacios:** sin clave Enterprise el servidor rechaza
crear el **sexto** espacio (`MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = 5` en
`auth/constants/max-workspaces-without-organization-key.constant.ts`, aplicado en
`assertWorkspaceCountWithinLimit`). Contando el espacio del operador, la beta admite **el operador y
cuatro amigos**. Un quinto amigo exige una decisión del founder (clave Enterprise, que esta beta
excluye, o un segundo despliegue).

## 1. Abrir el espacio de un amigo

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

## 2. Entregarlo: el amigo como administrador de su espacio, sin correo

Este despliegue **no tiene salida de correo**: `EMAIL_DRIVER` se queda en el valor por defecto
`LOGGER` (`config-variables.ts:531`), de modo que el "correo" de invitación se escribe en un log y no
sale de la máquina (`email/drivers/logger.driver.ts`). Eso es lo que convierte el enlace de
invitación en un enlace que el operador copia a mano.

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

### Aviso que hay que leer antes de invitar a nadie

**Una invitación pendiente es una credencial a nombre de una dirección de correo, y en este perfil
nada prueba que quien dice tener esa dirección la tenga.** Medido el 30/10 contra el stack local
(`crm-isolation-e2e.test.mjs`, línea `[LIMIT]`): mientras la invitación está pendiente, cualquiera
que **conozca la dirección invitada** puede registrarse con ella (el registro de una dirección con
invitación pendiente está permitido a propósito,
`sign-in-up.service.ts assertSignUpWithoutWorkspaceAllowed`), la respuesta del registro **le entrega
el token personal de la invitación**, y canjearlo **le mete en el espacio con el rol invitado**. No
hace falta tocar el correo de nadie: basta saber la dirección.

En local da igual (el puerto solo escucha en loopback). En AWS, con el dominio público, **no** da
igual. Mitigación mientras no haya una decisión mejor:

1. Invita y haz que la persona **acepte en el momento**, contigo delante si se puede. La ventana de
   riesgo es exactamente el tiempo que la invitación pasa pendiente.
2. **Borra toda invitación pendiente que no se haya consumido** (Settings → Members, o la mutación
   `deleteWorkspaceInvitation`). No dejes invitaciones abiertas "para luego".
3. Comprueba que no hay ninguna pendiente antes de exponer el despliegue:
   `select context->>'email' from core."appToken" where type = 'INVITATION_TOKEN' and "deletedAt" is null;`
   El 30/10 había **una** pendiente en el espacio del founder, a una dirección real: acéptala o
   bórrala antes de abrir la beta.
4. `IS_EMAIL_VERIFICATION_REQUIRED=true` es el control que trae Twenty para esto, pero **no está
   medido aquí y no es gratis**: el enlace de verificación también acabaría en el log del worker (el
   operador tendría que llevarlo a mano), y no cierra la entrega del token —que ocurre en la
   respuesta del registro, antes de cualquier verificación—, solo (probablemente) el acceso
   posterior. Queda como decisión del founder y trabajo de otro track.

Alternativa sin rol preasignado: Settings → Members ofrece también un **enlace genérico** del espacio
(el `inviteHash`); sirve para que entre cualquiera que lo tenga, y después el operador le cambia el
rol a Admin en la misma pantalla. Se usa solo si el paso 1 no es posible, porque un enlace genérico
no caduca por persona.

## 3. Salir el operador

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

## 4. Restablecer una contraseña sin correo

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

## 5. Borrar un espacio a petición

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

## 6. El conector de cada usuario (ChatGPT / Claude)

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

Si en cambio pegara el host base (`SERVER_URL`), el servidor detecta que ese host no sirve ninguna
interfaz de espacio (`isApiHost`) y manda la autorización a `app.<dominio>/authorize?iss=…`. Funciona,
pero hace al usuario pasar por el selector, así que el procedimiento es dar su propia URL.

Medido en `crm-isolation-e2e.test.mjs` (R3): el token OAuth que obtiene un usuario de su espacio
**solo ve su espacio** por `/mcp` — los ids del otro espacio no se leen, no aparecen al buscar por
nombre y no se pueden modificar ni borrar — y lo mismo por REST. El detalle de qué herramientas
ofrece el conector, qué se le quitó y con qué rol conviene conectar está en
[MCP_CONNECTOR.md](MCP_CONNECTOR.md).

Límite heredado de CRM-007 y que sigue en pie: un token de acceso OAuth ya emitido es un JWT
autocontenido y sobrevive a la revocación de su autorización hasta que caduca (hasta 1800 s). Para
cortar el acceso de inmediato hay que cambiar la contraseña del usuario o quitarlo del espacio.

## 7. Lo que este runbook no cubre

- **El panel de administración del servidor** (`/settings/admin-panel`) da al operador búsqueda de
  usuarios, impersonación y variables de configuración. No forma parte de este procedimiento y no se
  ha ejercitado en CRM-014.
- **SSO, facturación y permisos por fila** son Enterprise y esta beta no los usa.
- **Correo saliente**: no hay. Invitaciones y restablecimientos pasan por el log del servidor y por la
  mano del operador, que es la decisión registrada en el plan de AWS (CRM-013 R3).
- **Copias de seguridad** del volumen de PostgreSQL: fuera de este track. Antes de que los amigos
  metan datos de verdad, es la siguiente pregunta que hay que resolver.
