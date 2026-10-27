# Inventario inicial de integraciones

Fecha: 27 de octubre de 2026. Inspección de código, sin conectar cuentas ni probar proveedores. "Presente" significa implementado en el árbol inspeccionado, no validado en AOS.

| Integración | Soporte y archivos | Configuración / permisos | Estado y límites |
| --- | --- | --- | --- |
| Gmail | Nativo: `src/modules/messaging`, auth Google APIs | `AUTH_GOOGLE_CLIENT_ID/SECRET`, callbacks, flags de proveedor. Scopes declarados: Gmail readonly/send/compose, email/profile y profile.emails.read | Requiere proyecto OAuth, consentimiento y revisión de permisos del proveedor; desactivado en AOS |
| Google Calendar | Nativo: `src/modules/calendar`, auth compartida Google | `CALENDAR_PROVIDER_GOOGLE_ENABLED`, OAuth y scope `calendar.events` | Requiere configuración; no se ha sincronizado ningún calendario |
| Microsoft 365 | Nativo: messaging/calendar y estrategias `microsoft-apis-*` | `AUTH_MICROSOFT_CLIENT_ID/SECRET`, callbacks y flags. Scopes: openid/email/profile, offline_access, Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, User.Read | Requiere app/consentimiento del tenant; no se ha conectado |
| REST/GraphQL | Nativo: `src/engine/api/rest`, `graphql` | API keys con rol, sesiones y tokens de aplicación/OAuth según contexto | Disponible en código; falta comprobar autenticación, CRUD y permisos en la instalación |
| MCP servidor | Nativo: `engine/api/mcp`; JSON-RPC sobre HTTP, SSE opcional | Guard JWT, API key/OAuth/principal de aplicación admitido según contrato. No usar tokens de sesión como API bearer | Falta prueba 401, permisos y limitación a localhost; no se ha expuesto |
| Clientes MCP externos | `src/engine/metadata-modules/ai` y SDK MCP en dependencias | Credenciales y endpoint por integración; revisar OAuth/redirecciones y avisos de SDK | Requiere configuración y revisión; Orkestia/ChatGPT no se han conectado |
| Agentes IA | Nativo: `engine/metadata-modules/ai`, SDK de varios proveedores | `AI_PROVIDERS`, claves específicas o identidad de proveedor; permisos de herramientas y consumo | Requiere proveedor y autorización de gasto/datos. No se implementó agente comercial propio |
| AWS Bedrock | Nativo: `ai-models/services/sdk-provider-factory.service.ts`, `buildBedrockProvider` | Configuración de proveedor/region y cadena de credenciales AWS de Node; IAM y acceso a modelos | Presente; sin credenciales, recursos ni llamadas AWS. Consumo de modelos sujeto a tarifas y autorización posterior |
| Workflows | Nativo: `src/modules/workflow`; acciones y colas | Workers, permisos, destinos HTTP y credenciales según acción | Requiere validación local. Acciones de código quedan desactivadas sin sandbox |
| Grabación / transcripción | Apps `call-recorder`, `fathom`, `fireflies`, `granola`; modelos de transcripción en proveedor IA | Calendario, proveedor de grabación, permisos y credenciales de cada app; algunas usan servicios/billing de Twenty | Requiere configuración, revisión de self-hosting y coste. No instalar ni prometer grabación local autónoma por encontrar la app |
| WhatsApp | No se identificó app pública WhatsApp en el inventario de apps de esta versión | API/proveedor y autorización pendientes de diseño | Requiere confirmar soporte o desarrollo separado; fuera del bootstrap |

Fuentes de permisos exactos: `auth/utils/get-google-apis-oauth-scopes.ts` y `get-microsoft-apis-oauth-scopes.ts`. Son permisos amplios; no concederlos automáticamente por tener soporte nativo.

El README de Call Recorder declara consumo medido de créditos y costes para resúmenes. No se adopta su precio como presupuesto ni se asume que el servicio esté incluido en self-hosting: falta verificar sus dependencias de servidor, proveedor y licencia en una iteración autorizada.

Las herramientas de desarrollo de `.mcp.json` no son el endpoint MCP del CRM. No se activaron sus procesos `npx`. SSO, dominios personalizados y otras capacidades pueden cruzar archivos Enterprise: revisar `LICENSE_COMPLIANCE.md` y los gates concretos antes de ofrecerlas.

Siguiente verificación: API/MCP autenticados y CRUD local sin cuentas externas. Después se documentará cada conexión habilitada con destino, scopes, responsable, coste y revocación. Ninguna cuenta real es necesaria para aceptar el CRM básico.
