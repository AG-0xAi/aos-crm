# Registro inicial de licencias

Evaluación técnica sobre `15e4826d3b5fc5867baeabeeb42b253892b2d4da`, 27 de octubre de 2026. Las decisiones de redistribución comercial y el encaje concreto de AOS requieren revisión jurídica antes de producción.

| Componente | Evidencia | Tratamiento |
| --- | --- | --- |
| Core, servidor y resto sin excepción | `LICENSE` raíz y manifiestos AGPL-3.0 | Conservar licencia, avisos, modificaciones e instrucciones de construcción; preparar entrega del código fuente correspondiente |
| Toolkit y bibliotecas MIT | `twenty-cli`, `twenty-sdk`, `twenty-client-sdk`, `create-twenty-app`, `twenty-shared`, `twenty-ui`; manifiestos y LICENSE propios | Conservar aviso y permiso MIT también al distribuir binarios/bundles |
| Frontend y otros manifiestos sin `license` | Por ejemplo `twenty-front/package.json` | No interpretar campo ausente como permiso libre: aplica licencia raíz salvo encabezados/excepciones |
| Archivos Enterprise | Encabezado `@license Enterprise`; 552 archivos detectados bajo front/server | Licencia comercial separada. No desbloquear, eliminar gates ni asumir derecho a comercializarlos por estar en Git |
| Apps independientes | Excepción expresa de aplicaciones en `LICENSE`; revisar además licencia efectiva de cada paquete de `twenty-apps` | Mantenerlas fuera de modificaciones del core y verificar que cumplen la definición de Application |
| Terceros | `yarn.lock`, parches y paquetes incorporados | Falta SBOM y agregado de avisos/licencias de la instalación efectiva; el lockfile no acredita el inventario del binario final |
| Marcas | `.github/TRADEMARK.md` y límite expreso en LICENSE | No asumir derecho a marca Twenty por la licencia del código |

La AGPL permite modificar y redistribuir el core cumpliendo sus condiciones. Su sección 13 exige ofrecer el código fuente correspondiente de la versión modificada a usuarios que interactúan por red. Para AOS, esto implica diseñar desde el inicio un enlace de acceso al código de la versión desplegada, con scripts e instrucciones necesarios, y conservar los avisos al distribuir. El detalle de qué integra el código correspondiente debe revisarse con asesoría antes de ofrecer el SaaS.

La excepción Twenty Application, bajo sección 7, permite licenciar por separado una aplicación que use las interfaces publicadas y no incorpore ni modifique el código de Twenty. Contempla API REST/GraphQL, webhooks, manifiestos, funciones, componentes y SDK. No exime modificaciones del propio core ni concede derechos sobre marcas. Recomendación técnica: mantener las futuras capacidades propias de AOS en aplicaciones y servicios separados que usen estas interfaces, con cambios mínimos y públicos al core cuando sean necesarios.

Entre los archivos Enterprise se observan SSO, dominios personalizados, reglas de validación y permisos por fila, además de otros componentes. Esa lista no define por sí sola un entitlement completo: se debe cruzar cada función deseada con sus guards, plan y condiciones comerciales vigentes. La licencia distingue desarrollo/pruebas de uso y distribución comercial; no se ha contratado ni activado una suscripción.

No se modificó LICENSE, no se retiraron avisos ni se activó funcionalidad comercial. La creación futura del fork completo debe conservar el material legal de upstream y revisar cómo se distribuyen los componentes comerciales.

Fuentes: [LICENSE de la versión inspeccionada](https://github.com/twentyhq/twenty/blob/15e4826d3b5fc5867baeabeeb42b253892b2d4da/LICENSE), licencias y manifiestos locales. Evidencias: `static-inventory.json` y `enterprise-files.txt` bajo `.aos/onboarding/bootstrap-2026-10-27/`.
