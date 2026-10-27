# Lecciones de la inspección

## L-01: incorporación de upstream en un repositorio preparado

Síntoma: existen orientación, hooks y bus antes de incorporar un monorepo con ficheros homónimos.

Causa: un checkout upstream puede sobrescribir ficheros ignorados y el AGENTS original es un enlace.

Fix: respaldo previo, incorporación sobre el Git existente, restitución de orientación AOS y conciliación de settings/ignore.

Regla: comprobar colisiones y tipos de fichero antes del checkout; conservar instrucciones y metadatos upstream por separado. No crear un segundo bus ni un commit raíz de scaffold.

## L-02: lectura durante checkout incompleto

Síntoma: primeras lecturas encontraron manifiestos todavía ausentes aunque estaban en el árbol del tag.

Causa: el checkout de 39.805 archivos seguía escribiendo en Windows.

Fix: contrastar con `git ls-tree`/`git show` de la referencia fija y esperar fin del proceso antes de concluir sobre el disco.

Regla: ausencia transitoria no significa ausencia del repositorio; no escribir conclusiones negativas hasta comprobar el checkout terminado.

## L-03: rutas y patrones de búsqueda

Síntoma: búsquedas por rutas supuestas y un glob pasado como ruta literal a rg fallaron; `segment` capturó abundantes falsos positivos.

Causa: asumir nombres de módulos y semántica de globs del shell en lugar de descubrir los archivos.

Fix: `rg --files` para localizar, luego leer rutas exactas y buscar proveedores con patrones específicos.

Regla: descubrir antes de leer y no inferir ausencia por un path o patrón incorrecto.

## L-04: estado de cron sin elevación

Síntoma: `aos crons status` devuelve `NO-VERIFICABLE`, acceso denegado.

Causa: tarea creada como SYSTEM/Admin, invisible a la consulta actual.

Fix: comprobar latido del reaper/watchdog y crecimiento de `~/.aos/health-events` sin modificar la tarea.

Regla: `NO-VERIFICABLE` no equivale a `NO-INSTALADA`; escalar elevación solo si la comprobación alternativa falla.

## L-05: límite del indexado grande

Síntoma: `aos graph build` termina con `exit null` tras diez minutos y deja un índice consultable; status incluso dice up-to-date y avisa metadata de versión incompleta.

Causa: `buildGraph()` del módulo AOS tiene timeout predeterminado de 600.000 ms; la pasada inicial no había terminado.

Fix: usar el mismo módulo exportado con un plazo mayor, sin editar el arnés ni crear otro índice. Registrar código de salida y volver a consultar símbolos/rutas.

Regla: un SQLite presente o una consulta válida no acreditan una construcción completa. Conservar el fallo y el resultado de recuperación; no inventar un PASS.

## L-06: falsos positivos de secretos

Síntoma: aparecen patrones de ID AWS en bundles vendorizados y claves privadas en fixtures/aserciones de tests.

Causa: un patrón textual no valida que exista una credencial operativa ni distingue datos embebidos de configuración.

Fix: guardar únicamente ubicaciones/categorías, clasificar el contexto sin imprimir los valores y mantener límites de cobertura explícitos.

Regla: no publicar secretos para explicar un hallazgo y no declarar P0 confirmado ni ausencia total de secretos por una coincidencia/no coincidencia de regex.

## L-07: arrays de hooks al conciliar JSON

Síntoma: una primera conciliación con pipeline PowerShell convirtió el array de un solo hook en un objeto.

Causa: el pipeline desempaqueta colecciones unitarias al asignarlas.

Fix: reconstrucción con listas explícitas y validación de que cada valor de `hooks` sigue siendo un array; se preservaron SessionStart y PreToolUse.

Regla: al fusionar configuración estructurada, comprobar tipos y contenido final, no solo que el JSON parsea. No ejecutar workers con un schema de hooks sin verificar.

## L-08: guard local ignorado al preparar la entrega

Síntoma: Git advierte que `.claude` está ignorado al añadir las rutas de configuración.

Causa: las exclusiones locales previas y las reglas upstream protegen ese directorio; el guard preparado aún no estaba versionado.

Fix: añadir con `-f` únicamente el fichero existente del guard, cuya identidad se contrastó con el respaldo, y contar las veinte rutas previstas en el índice.

Regla: no desactivar exclusiones ni usar `git add -A`; preservar el guard por path explícito y comprobar el índice completo antes de commitear.
