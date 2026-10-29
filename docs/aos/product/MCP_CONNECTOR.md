# CRM-007 — Conector MCP para ChatGPT y Claude

Fecha: 29 de octubre de 2026. Implementa el contrato `.aos/pack/aos-crm/specs/mcp-connector/spec.md`.

Cada usuario opera el CRM desde su propio ChatGPT o Claude a través del servidor MCP que Twenty ya
trae. Este documento es técnico: cómo se conecta un cliente, con qué credencial, con qué rol, qué se
quitó del conector para que no salgan datos del despliegue, y qué límites se midieron. No contiene
credenciales ni datos de negocio: el fork `AG-0xAi/aos-crm` es público.

Todo lo que se afirma aquí está medido contra el stack local de este checkout con los scripts de
`scripts/aos/mcp/` y la suite `scripts/aos/test/crm-mcp-e2e.test.mjs`. Las cifras concretas de cada
corrida están en `.aos/reports/CRM-007.md`.

## 1. Qué expone el conector

El endpoint es `POST /mcp` sobre el mismo servidor del CRM. `initialize` responde como
`Twenty MCP Server` con versión de protocolo `2025-06-18`.

`tools/list` ofrece seis herramientas de entrada:

| Herramienta | Para qué |
| --- | --- |
| `execute_tool` | ejecuta cualquier herramienta del catálogo por nombre (es el despachador) |
| `learn_tools` | devuelve los esquemas de entrada de las herramientas que le nombres |
| `get_tool_catalog` | descubrimiento por categoría, cuando no sabes qué herramienta existe |
| `list_object_metadata_names` | los objetos de este workspace |
| `list_skills` / `load_skills` | instrucciones paso a paso para tareas complejas |

El CRUD de negocio (`find_many_companies`, `create_one_person`, `update_one_opportunity`,
`delete_one_company`, …) no aparece en `tools/list`: se alcanza por `execute_tool`, que es el modo
por defecto del servidor. Los nombres se construyen con la gramática que el propio servidor publica
en sus instrucciones (`find_many_{objetos}`, `create_one_{objeto}`, …), sin descubrimiento previo.

Dos detalles que cuestan una corrida si no se saben, ambos están en el esquema que devuelve
`learn_tools`:

- los campos de filtro van como argumentos de primer nivel, **no** envueltos en un objeto `filter`;
- `select` es obligatorio y es un **array de nombres de campo** (`["id","name"]`), o `["*"]`.

## 2. Lo que se quitó: herramientas que mandaban contenido a terceros (R3)

`search_help_center` enviaba el texto de la consulta a `https://docs.twenty.com/mcp`
(`search-help-center-tool.ts`). Se midió en vivo el 29/10 antes del cambio: devolvía cinco
resultados reales de esa URL, es decir, la consulta salió del despliegue.

Ya no se ofrece. El conjunto `MCP_EXCLUDED_TOOL_NAMES` cubría `code_interpreter`, `http_request` y
las de navegación de salida, pero `search_help_center` llegaba a `tools/list` por la lista de
precarga compartida con las otras superficies de IA, que nunca pasaba por ese conjunto. Ahora MCP
resta sus propias exclusiones de esa lista (`get-mcp-preload-tool-names.util.ts`). Resultado: ausente
de `tools/list`, del catálogo, de las instrucciones del servidor, y `execute_tool` la rechaza con
`Tool "search_help_center" not found`.

**Auditoría de las once herramientas de acción**, clasificadas por destino en
`mcp-excluded-tool-names.constant.spec.ts`:

| Destino | Herramientas | Qué se hizo |
| --- | --- | --- |
| Tercero que el llamante no elige | `search_help_center`, `http_request`, `code_interpreter` | excluidas del conector |
| Cuenta conectada del propio workspace, destinatario que el llamante nombra | `send_email`, `draft_email`, `create_calendar_event` | siguen disponibles, pero detrás de su permiso; el rol de equipo de la sección 5 no lo concede |
| No sale del despliegue | `find_connected_accounts`, `save_campaign`, `create_file_upload`, `complete_file_upload`, `share_record` | sin cambios |

El criterio es el destino, no el verbo: enviar un correo a quien el usuario indica, por la cuenta que
el workspace conectó a propósito, es la función declarada de esa cuenta; mandar la consulta a la
documentación del proveedor no lo es. Las tres del grupo del medio además necesitan una cuenta
conectada, y en este despliegue no hay ninguna.

El test de clasificación obliga a decidir: si alguien añade una herramienta de acción nueva y no la
clasifica, el spec falla. Lo corre `node scripts/aos/mcp/verify-mcp-specs.mjs`, que está en el gate.

## 3. Autenticación

`POST /mcp` sin credencial responde **401** con
`WWW-Authenticate: Bearer resource_metadata="<SERVER_URL>/.well-known/oauth-protected-resource/mcp", scope="api profile"`.
Un cliente MCP sigue ese puntero y llega al descubrimiento OAuth.

Hay dos credenciales posibles, y las dos van en `Authorization: Bearer <token>`:

### API key (lo más simple para uso interno)

Se crea en el panel (Ajustes → API & Webhooks) o por API, **siempre ligada a un rol**. Es lo que
usan hoy los clientes de este checkout. Se valida contra el registro en base de datos en cada uso:
caducada o revocada da 401 inmediatamente, aunque el JWT siga con firma válida.

### OAuth 2.1 con registro dinámico y PKCE (lo que piden ChatGPT y claude.ai)

El descubrimiento está publicado y es coherente con el `SERVER_URL` efectivo:

- `/.well-known/oauth-protected-resource/mcp` → `resource`, `authorization_servers`, `scopes_supported`
- `/.well-known/oauth-authorization-server` → `issuer`, `/authorize`, `/oauth/token`,
  `/oauth/register`, `/oauth/revoke`, `/oauth/introspect`, `code_challenge_methods_supported: ["S256"]`

El flujo completo se ejercitó **sin navegador y sin ninguna cuenta externa** con
`node scripts/aos/mcp/oauth-pkce-probe.mjs`: registro dinámico de un cliente con `redirect_uri` a un
listener de loopback propio, código de autorización + PKCE S256 como el administrador local,
intercambio del código por un token y `tools/list` con ese token. El paso de autorización, que en un
navegador es la página `/authorize`, se reproduce con las mismas llamadas que hace ese frontend: la
mutación GraphQL `authorizeApp(clientId, codeChallenge, redirectUrl, state, scope)` sobre
`/metadata`, autenticada con la sesión del usuario (`auth.resolver.ts`).

Medido el 29/10 contra la imagen reconstruida, 13 de 13 pasos:

- el verificador PKCE que no corresponde al reto → `400 invalid_grant`
- el código de autorización no se puede reusar → `400 invalid_grant`
- token emitido: `Bearer`, `expires_in` 1800 s, `scope "api profile"`, con refresh token
- un token manipulado → 401

**Dos notas de alcance en `/metadata` en lugar de `/graphql`:** `auth.resolver.ts`, el resolver de
roles y el de API keys son `@MetadataResolver`. Mandar `authorizeApp` a `/graphql` responde
`Cannot query field "authorizeApp" on type "Mutation"`, que se lee como una función que no existe y
en realidad es el esquema equivocado.

## 4. Conectar un cliente

### Claude Code (CLI)

La cabecera se toma de una variable de entorno, para que la credencial no quede en el fichero de
configuración ni en el historial del shell:

```bash
export AOS_CRM_MCP_API_KEY="<la api key>"      # no la escribas en un fichero del repo
claude mcp add --transport http aos-crm "https://<host>/mcp" \
  --header "Authorization: Bearer ${AOS_CRM_MCP_API_KEY}"
```

`claude mcp add` guarda la cabecera resuelta en la configuración local de Claude Code (fuera del
repo). Si prefieres que el fichero no contenga nunca el valor, escribe un `.mcp.json` propio con el
literal `${AOS_CRM_MCP_API_KEY}` en la cabecera y pásalo con `--mcp-config`: Claude Code expande esa
variable al arrancar. Así lo hace `scripts/aos/mcp/claude-client-probe.mjs`, que además restringe el
cliente a este servidor con `--strict-mcp-config` y `--allowedTools mcp__aos-crm`.

Contra el stack local la URL es `http://127.0.0.1:43000/mcp`; `localhost` no sirve si el puerto está
publicado sólo en `127.0.0.1`.

### Claude Desktop

Se añade como conector personalizado desde los ajustes de la aplicación, dando la URL HTTPS pública
del servidor MCP (`https://<host>/mcp`). El cliente hace el descubrimiento OAuth y el registro
dinámico por su cuenta: abre `/authorize` en el navegador, el usuario se autentica en el CRM y el
conector queda ligado a **ese** usuario y a su rol, no a una API key compartida. Esa es la vía
pensada para un miembro del equipo.

No se ha probado: requiere la URL pública de la sección siguiente. Lo que sí está medido es el lado
del servidor que ese cliente necesita (descubrimiento, registro dinámico, código + PKCE, token
válido en `/mcp`), con `oauth-pkce-probe.mjs`.

### ChatGPT

Necesita igualmente una **URL pública HTTPS** y OAuth; una IP de loopback o una cabecera estática no
sirven. Tampoco se ha probado, por el mismo motivo.

Esto es el único requisito que el stack local no puede cumplir, y no se va a cumplir exponiendo el
stack local. Dos opciones, las dos decisión del founder:

| Opción | Qué implica | Riesgos |
| --- | --- | --- |
| **Staging en AWS (CRM-011)** | el Terraform ya está escrito y validado; da un dominio con certificado ACM y HTTPS real | cuesta dinero desde el momento del `apply`; es infraestructura LIVE y necesita orden explícita |
| **Túnel temporal** (Cloudflare Tunnel, ngrok) | minutos de trabajo, sirve para una demo | el CRM queda alcanzable desde Internet mientras el túnel vive, con la superficie completa (no sólo `/mcp`); el proveedor del túnel termina la TLS y ve el tráfico; el `SERVER_URL` tiene que cambiar al dominio del túnel o el descubrimiento OAuth publica una URL que el cliente no puede usar; cada reinicio cambia el dominio y hay que volver a autorizar |

Recomendación: para la prueba del equipo, Claude Code o Claude Desktop contra el stack local o
contra el staging. Para ChatGPT, el staging de CRM-011 cuando el founder autorice el gasto. Un túnel
sólo para una demo puntual, con la ventana acotada y sabiendo que se está publicando el CRM entero.

## 5. Rol de mínimo privilegio para conexiones de asistente (R4)

`node scripts/aos/mcp/team-role.mjs` crea (o devuelve a su estado) el rol
**«Assistant connection (team)»** por API y mide qué puede y qué no. Todo es AGPL core: un rol con
los interruptores de objeto y de ajustes; no se usan permisos por fila ni ninguna otra función
Enterprise.

| Interruptor | Valor | Por qué |
| --- | --- | --- |
| `canReadAllObjectRecords` | `true` | leer registros de negocio |
| `canUpdateAllObjectRecords` | `true` | crear y actualizar |
| `canSoftDeleteAllObjectRecords` | `true` | borrar como lo hace la interfaz |
| `canDestroyAllObjectRecords` | `false` | el purgado permanente queda en administración |
| `canUpdateAllSettings` | `false` | esto es lo que cierra API keys, roles y miembros |
| `canAccessAllTools` | `false` | no le entrega las herramientas de acción (correo, calendario, …) |
| `canAccessAllAgentChatChannels` | `false` | no lee los canales de chat de otros |
| `canBeAssignedToApiKeys` | `true` | para poder ligarle una API key |
| `canBeAssignedToUsers` | `true` | para que una persona del equipo pueda llevar este rol |
| `canBeAssignedToAgents` | `true` | para que un agente del workspace pueda llevarlo |

La sonda pide al servidor **los diez interruptores que el rol declara** y falla si alguno no vuelve:
un campo ausente no se compara, y no comparar es indistinguible de estar bien.

Medido con una API key ligada a ese rol:

- crea una empresa por MCP: **sí**
- lee registros por MCP: **sí**
- acuñar una API key: **rechazado** (`Entity performing the request does not have permission`)
- crear un rol con acceso total a ajustes: **rechazado**
- leer la lista de roles del workspace: **rechazado**

Cada rechazo se mide **dos veces**, con la misma consulta y los mismos argumentos: con la key de
equipo tiene que ser rechazado *por permiso* (`FORBIDDEN` / `PERMISSION_DENIED`), y con una
credencial Admin la misma llamada tiene que **pasar**. Sin esa segunda mitad un rechazo puede ser la
petición mal formada y no el permiso — es lo que pasaba con un `roleId` inexistente, que el servidor
rechaza con `NOT_FOUND` incluso para el administrador. Lo que crea la mitad Admin se deshace (la key
se revoca, el rol se borra).

Dos matices medidos:

- **ninguna** API key acuña API keys, tampoco una Admin: `createApiKey` lleva su propio guardia de
  tipo de llamante (`This endpoint is not available to this caller`), así que ahí lo que rechaza es
  el tipo de credencial y no el rol. La mitad permitida de esa comprobación corre con la sesión del
  administrador;
- la **administración de miembros** (`updateWorkspaceMemberRole`) queda fuera del alcance de
  cualquier API key por ese mismo guardia, y su mitad permitida reescribiría el rol del único
  miembro de este workspace, así que no se sondea. Lo que se mide es la lista de roles.

Además, el conector **no ofrece ninguna herramienta de borrado permanente**: por MCP sólo existe
`delete_one_*` (borrado suave, deja `deletedAt`). Un asistente no puede purgar datos.

### Atribución de lo que hace el agente

Lo que **queda atribuido**:

- cada escritura lleva el `createdBy` que construye el servidor con `source: AGENT`
  (`mcp-protocol.service.ts`, `buildActorContext`). Medido con psql sobre las filas que escribieron
  las sondas: con una **API key**, `createdByName` es el nombre de la key y
  `createdByWorkspaceMemberId` queda nulo; con un **token de usuario**, `createdByName` es el nombre
  del miembro del workspace y su id queda escrito. En los dos casos `createdBySource` es `AGENT`, así
  que una escritura del asistente se distingue de una hecha a mano en la interfaz;
- el borrado suave deja la fila con su `deletedAt`, así que la acción es reconstruible;
- la API key usada queda identificada: el `jwtid` del token es el id de la key, y las keys se
  nombran y se revocan de una en una.

Lo que **no queda atribuido**:

- **qué prompt** llevó al agente a hacerlo, y qué conversación. Eso vive en la cuenta de ChatGPT o
  Claude del usuario, no en el CRM;
- el **modelo** y el cliente concreto: `initialize` recibe un `clientInfo` que el cliente declara y
  nadie verifica, y no se guarda en el registro;
- **qué leyó** el agente. Las lecturas no dejan rastro por registro; sólo existen los logs del
  servidor, que son volátiles y no son una auditoría;
- si varias personas comparten una misma API key, **quién** de ellas actuó. Por eso una key por
  persona, nunca una compartida.

Consecuencia práctica: una API key por persona y por cliente, nombrada con la persona y el cliente, o
mejor OAuth, donde el actor es el miembro del workspace y no hace falta repartir secretos.

## 6. Revocación y rotación

| Credencial | Cómo se revoca | Cuándo deja de servir |
| --- | --- | --- |
| API key | `revokeApiKey` (panel o API) | **inmediato**: se valida el registro en cada uso (medido: 200 antes, 401 después) |
| API key | adelantar `expiresAt` con `updateApiKey` | **inmediato**, por la misma razón (medido) |
| Autorización OAuth | `POST /oauth/revoke` con el **refresh token** | **inmediato** para emitir nuevos tokens: el refresh grant pasa a `400 invalid_grant` (medido) |
| Token de acceso OAuth ya emitido | — | **hasta su propia caducidad, 1800 s** |

El último es un límite real, no un descuido: el token de acceso es un JWT autocontenido y `/mcp` no
consulta ninguna lista de revocación. Lo dice el propio código (`oauth.service.ts`, `revokeToken`:
«RFC 7009 §2.1: only the issuing client may revoke; access tokens stay valid until expiry»), y se
midió: después de revocar, el token ya emitido seguía respondiendo 200. **Para cortar a alguien
ahora mismo hay que usar una API key y revocarla, o esperar hasta 30 minutos.** Si eso no es
aceptable para un caso concreto, la vía correcta es acortar la vida del token de acceso en el
servidor, no inventar un rodeo en el cliente.

`POST /oauth/revoke` responde 200 para un token válido y para uno inválido (RFC 7009 §2.2), así que
ese 200 no prueba nada: la comprobación es intentar usar la credencial después.

**Rotación.** Las API keys llevan `expiresAt` obligatorio, así que rotar es: crear la nueva con la
misma ligadura de rol, cambiarla en el cliente, revocar la vieja. Nunca al revés, y nunca
reutilizando el nombre: el nombre es lo que queda escrito en `createdBy` de los registros que esa
key escribió.

## 7. Límites medidos

- **ChatGPT y claude.ai no se han probado**: requieren URL pública HTTPS y este track no expone el
  stack local. Queda para la prueba live con el staging de CRM-011 o un túnel autorizado.
- **El token de acceso OAuth sobrevive a su revocación** hasta 1800 s (sección 6).
- **La autorización OAuth se probó como el administrador local.** Un miembro del equipo con el rol de
  la sección 5 pasa por el mismo `/authorize`, pero eso no se ha medido con un segundo usuario real.
- **La prueba con cliente real** usa Claude Code (`claude -p`) como cliente MCP, restringido a este
  servidor. Corrió una vez el 29/10: listó los 29 objetos del workspace, creó una empresa y la volvió
  a leer por su id; la sonda confirmó la fila por su cuenta y la borró. No está en el gate: una
  corrida dirigida por un modelo no es determinista. Lo determinista es
  `scripts/aos/test/crm-mcp-e2e.test.mjs`.
- **Sin cuentas conectadas.** `send_email`, `draft_email` y `create_calendar_event` no se pudieron
  ejercitar porque no hay ninguna cuenta Google/Microsoft conectada en este despliegue. Siguen
  disponibles en el conector y el rol de equipo no les concede el permiso.
- El gate de este track mide el conector contra el stack local por HTTP y psql. **No** mide el
  conector detrás de HTTPS, ni con un proxy delante, ni la conducta de clientes de terceros.

## 8. Comandos

```bash
# el gate: specs unitarios del conector, y la suite de extremo a extremo
node scripts/aos/mcp/verify-mcp-specs.mjs
node scripts/aos/mcp/verify-mcp-specs.mjs --self-test
node --test scripts/aos/test/crm-mcp-e2e.test.mjs

# sondas (no están en el gate; escriben en el workspace local y limpian lo suyo)
node scripts/aos/mcp/oauth-pkce-probe.mjs
node scripts/aos/mcp/team-role.mjs
node scripts/aos/mcp/claude-client-probe.mjs
```

Las tres sondas leen las credenciales del administrador local de `deploy/local/.env`, que está
ignorado por git, y la API key de pruebas de `%USERPROFILE%\.aos-crm\local-mcp-api-key` o de
`AOS_CRM_MCP_API_KEY`. Ninguna imprime una credencial: a lo sumo su longitud.
