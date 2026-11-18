# CRM-058 — Plantilla Finanzas: entrada desde el saludo de Betty

Fecha: 18 de noviembre de 2026. Implementa el requisito R7 del contrato
`finanzas-asistente`. Este documento es técnico e interno; el fork es público, así que no hay
credenciales, URLs de despliegue ni código de la app.

## 1. Qué es y qué no está aquí

Betty Finanzas (cuentas, movimientos, presupuesto y previsión de caja) es una **aplicación
propietaria**. Su código vive en un repositorio privado y **nunca** se sube a este fork. Aquí solo
hay lo genérico: el catálogo de plantillas, dos herramientas MCP para ofrecer e instalar una
plantilla registrada, el texto del saludo y su comando de actualización.

La plantilla **no viene preinstalada**. Cada espacio la instala bajo demanda, y solo si el servidor
la tiene registrada.

## 2. Cómo se registra una plantilla en un servidor

Una plantilla es una aplicación registrada en el servidor con origen `tarball`:

1. Se construye el tarball de la app a partir de su repositorio privado (el manifiesto lleva el
   identificador universal de la app).
2. Una persona con el permiso de aplicaciones de marketplace del espacio propietario sube el tarball
   con el flujo de subida de archivos (`createFileUpload` con la carpeta de tarballs de apps y
   `completeAppTarballUpload`). El servidor lee el identificador universal del manifiesto y crea o
   actualiza el registro de la aplicación.
3. Desde ese momento `list_templates` la muestra en ese servidor. En un servidor donde no se ha
   registrado, no aparece y `install_template` responde que no está disponible.

El catálogo de plantillas es una constante del código
(`packages/twenty-server/src/engine/api/mcp/constants/betty-template-catalog.constant.ts`). Cada
entrada lleva: `id`, identificador universal de la app, título, descripciones en español e inglés,
los dos puntos de entrada y la configuración mínima. Hoy hay una: `finanzas`. Registrar la app en el
servidor sin esa entrada no la hace visible por MCP, y tener la entrada sin registrar la app tampoco.

## 3. Herramientas MCP

### `list_templates` (solo lectura)

Devuelve las entradas del catálogo cuya aplicación está registrada en el servidor, cada una con
`installed: true|false` para el espacio de quien llama. No lista nunca una plantilla no registrada.
Una aplicación cuenta como instalada cuando existe en el espacio **con versión**: el servicio de
instalación fija la versión al terminar, así que una instalación a medias no se da por hecha.

### `install_template` (`{ templateId }`)

- **Espacio:** sale del contexto de autenticación de la petición, nunca de la entrada. El esquema de
  entrada solo tiene `templateId`, y un `workspaceId` enviado de más se descarta. Con el token del
  espacio B no se instala nada en el espacio A.
- **Permiso:** exige el permiso de ajustes `APPLICATIONS`, el mismo que usan las mutaciones de
  instalación de aplicaciones de Ajustes. Se comprueba con `PermissionsService` y el contexto de la
  petición (usuario, clave de API, aplicación o agente). Sin permiso responde `forbidden` con
  «Pídele a quien administra el espacio que la active», en español e inglés para que el asistente lo
  diga en el idioma de la persona.
- **Idempotente:** si ya está instalada responde `already_installed` con los puntos de entrada, sin
  llamar al servicio de instalación.
- **Errores:** plantilla desconocida o no registrada → `unknown_template`. Fallo al instalar →
  `failed`, con un mensaje que impide al asistente decir que está activa; el detalle va al log del
  servidor, no a la persona.
- **Éxito:** `installed` con `entryPoints` y `minimumSetup` (moneda principal y una cuenta con su
  saldo inicial y su fecha de corte). La instalación reutiliza `ApplicationInstallService`; no hay
  lógica de instalación nueva.

Límite conocido: la comprobación de «ya instalada» y la instalación no son una sola operación, así
que dos llamadas simultáneas del mismo espacio pueden llegar ambas al servicio de instalación. Este
toma un bloqueo por espacio y aplicación, pero no se ha medido qué hace la segunda llamada; el
asistente llama de una en una, tras el consentimiento de la persona.

## 4. El saludo

- `betty-guia` («Conóceme») llama a `list_templates` en el saludo. Si `finanzas` aparece, ofrece
  «Organizar mis cuentas y finanzas personales», y también ante frases como «quiero llevar mis
  gastos», «registra esta compra» o «ayúdame a organizar mis finanzas». Con consentimiento explícito
  llama a `install_template` y después ofrece los dos puntos de entrada. Si no aparece, nunca la
  ofrece.
- Las instrucciones del servidor nombran las dos herramientas y piden consentimiento explícito antes
  de instalar.
- `search_use_cases` incluye tres casos de la categoría «Finanzas» (foto de un ticket, presupuesto
  mensual, previsión de caja), buscables en español e inglés.
- Los espacios que ya existen reciben el nuevo contenido de la habilidad con el comando de
  actualización `upgrade:2-51:offer-finanzas-in-betty-guia-skill`, que es idempotente: compara el
  contenido con el catálogo y no hace nada si ya coincide (ni en espacios sin la habilidad ni en
  `--dry-run`).

## 5. Verificación

Pruebas unitarias en `packages/twenty-server`:
`src/engine/api/mcp/tools/__tests__/templates.tool.spec.ts`, el caso añadido en
`build-mcp-server-instructions.util.spec.ts`, `search-betty-use-cases.util.spec.ts`,
`create-standard-flat-skill-metadata.util.spec.ts` y el spec del comando de actualización.
No hay prueba contra un servidor real: el escenario completo de R7.1 por `/mcp` con una app
registrada queda para la prueba de aceptación en el espacio de pruebas, con el OK del fundador.
