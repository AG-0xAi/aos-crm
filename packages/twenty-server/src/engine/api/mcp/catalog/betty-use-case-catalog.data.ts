export type BettyUseCase = {
  title: string;
  level: number;
  category: string;
  persona: string;
  goal: string;
  prerequisites: string[];
  steps: string[];
  prompts: string[];
  expectedResult: string;
  bettyFeatures: string[];
  connectors: string[];
  caveats: string[];
};

export type BettyTemplateExplained = {
  name: string;
  purpose: string;
  where: string;
  example: string;
};

export type BettyCampaignTrack = {
  name: string;
  description: string;
};

export type BettyLimit = string;

export const BETTY_USE_CASES: BettyUseCase[] = [
  {
    title:
      '¿Qué hay dentro de mi Betty? Recorrido por objetos, campos y «plantillas»',
    level: 1,
    category: 'Orden y datos',
    persona:
      'Persona que acaba de abrir Betty y ve muchas secciones en Ajustes que no entiende',
    goal: 'Entender en cinco minutos qué objetos y campos tiene tu espacio, qué son las 16 habilidades de Ajustes > IA > Skills y cuáles funcionan hoy desde el chat.',
    prerequisites: [
      'Conector de Betty añadido en ChatGPT o Claude (https://<tu-subdominio>.betty.management/mcp)',
    ],
    steps: [
      'Abre una conversación nueva con el conector de Betty activo y pega el primer prompt.',
      'Pega el segundo prompt para ver la lista de habilidades explicada en lenguaje sencillo.',
      'En Betty abre Ajustes > IA > Skills: son las mismas habilidades. No se aplican como plantillas; el asistente las carga cuando le pides algo.',
      'Abre Ajustes > Diseño > Resumen: es el inventario de páginas, vistas y comandos de Betty. Es informativo; para cambiar una ficha usa «Editar diseño de la página» desde la propia ficha.',
      'Apunta los campos que echas en falta para el siguiente ejercicio.',
    ],
    prompts: [
      'Usando Betty, dime qué objetos tengo en mi espacio y, para Personas, Empresas y Oportunidades, qué campos tiene cada uno y de qué tipo son. Preséntalo como tres tablas cortas y marca los campos que están vacíos en más de la mitad de los registros. Solo consulta, no cambies nada.',
      'Lista las habilidades de mi Betty en una tabla: nombre, para qué sirve en una frase, un ejemplo de lo que podría pedirte con ella y si funciona hoy en Betty. Ten en cuenta que el intérprete de código está desactivado (afecta a code-interpreter, xlsx, pdf, docx y pptx) y que enrich depende de un buscador que no está instalado. No crees ni modifiques nada.',
    ],
    expectedResult:
      'Un mapa claro de tu modelo de datos y las 16 habilidades agrupadas en «para trabajar con clientes», «para construir» y «no disponibles en Betty».',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'La lista de habilidades también muestra las habilidades de archivos y código que no funcionan en Betty. Si el asistente intenta usarlas, pídele que haga ese trabajo con sus propias herramientas.',
      'workspace-demo-seeding archiva tus objetos personalizados: úsala solo en un espacio de pruebas.',
    ],
  },
  {
    title: 'Radiografía de tu base de contactos en una pregunta',
    level: 1,
    category: 'Orden y datos',
    persona:
      'Gerente de una distribuidora que quiere saber qué tiene antes de ordenar',
    goal: 'Ver en números cuántos contactos hay, cuántos están incompletos y de dónde vienen, para decidir por dónde empezar.',
    prerequisites: ['Conector de Betty', 'Contactos ya cargados'],
    steps: [
      'Pega el prompt. El asistente cuenta con agrupaciones, que cubren toda la base.',
      'Lee las tres anomalías que señala al final.',
      'Si quieres compararlo dentro de un mes, pídele que guarde el resumen como nota.',
    ],
    prompts: [
      'Con Betty, dame una radiografía de mi base de contactos: total de personas y empresas; cuántas personas no tienen empresa, correo o teléfono; las diez empresas con más contactos; y personas creadas por mes en los últimos seis meses. Usa agrupaciones en lugar de leer registro a registro. Solo consulta, no modifiques nada. Termina con las tres cosas más raras que veas y qué harías primero.',
    ],
    expectedResult:
      'Un resumen numérico de la calidad de la base y una prioridad clara de limpieza.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los listados registro a registro vienen por páginas. Para totales pide siempre agrupaciones.',
    ],
  },
  {
    title: 'De la tarjeta de visita al contacto en diez segundos',
    level: 1,
    category: 'Orden y datos',
    persona: 'Comercial que vuelve de una feria con un puñado de tarjetas',
    goal: 'Convertir fotos de tarjetas de visita en contactos y empresas en Betty, sin teclear y sin duplicar a quien ya estaba.',
    prerequisites: ['Conector de Betty', 'Fotos legibles de las tarjetas'],
    steps: [
      'Haz una foto a cada tarjeta, o a varias juntas, y súbelas al chat.',
      'Pega el prompt. El asistente lee los datos y busca en Betty por correo y por dominio.',
      'Revisa la tabla (Nuevo, Ya existe, Dudoso) y escribe «adelante».',
      'El asistente crea las empresas que faltan, después las personas vinculadas y una nota con el contexto.',
    ],
    prompts: [
      'Te paso fotos de tarjetas de visita que recogí en la Feria Alimentaria de Valencia. Para cada tarjeta extrae nombre, apellidos, cargo, correo, teléfono (formato internacional, +34 si no indica país), empresa y web. Si un dato no se lee bien, no lo inventes: déjalo vacío. Antes de crear nada, busca en Betty si ya existe una persona con ese correo o una empresa con ese dominio. Muéstrame una tabla con el estado Nuevo, Ya existe o Dudoso. Cuando te diga «adelante», crea las empresas que falten, después las personas vinculadas a su empresa, y añade a cada persona la nota «Conocido en Feria Alimentaria Valencia, noviembre 2026».',
    ],
    expectedResult:
      'Contactos y empresas nuevos en Betty, vinculados entre sí y con una nota de dónde los conociste, sin duplicados.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Lectura de imágenes del chat'],
    caveats: [
      'La foto no se guarda en Betty: si quieres conservarla, adjúntala a mano desde la ficha.',
      'Revisa la tabla antes de confirmar: algunas tipografías se leen mal.',
    ],
  },
  {
    title: 'Pega una firma de correo y deja la ficha completa',
    level: 1,
    category: 'Orden y datos',
    persona: 'Consultora independiente que recibe correos de clientes nuevos',
    goal: 'Completar la ficha de un contacto y de su empresa a partir de la firma de un correo, sin copiar campo a campo y sin pisar lo que ya había.',
    prerequisites: ['Conector de Betty', 'Opcional: conector de Gmail'],
    steps: [
      'Copia la firma o pide al asistente que la lea del hilo con el conector de Gmail.',
      'El asistente busca la persona por correo: si existe, solo rellena campos vacíos; si no, la crea.',
      'Hace lo mismo con la empresa por dominio y te enseña el antes y el después.',
    ],
    prompts: [
      'Esta es la firma de un correo que acabo de recibir:\n\nMarta Ibáñez Roca\nDirectora de Compras | Hortícolas del Segura S.L.\nT. +34 968 000 111 · M. 600 000 222\nwww.horticolasdelsegura.es · Av. del Puerto 14, Murcia\n\nSu correo es marta.ibanez@horticolasdelsegura.es. Búscala en Betty por correo. Si ya existe, rellena solo los campos vacíos y dime qué cambiaste; no sobrescribas nada. Si no existe, créala. Haz lo mismo con la empresa usando el dominio y vincula la persona a la empresa.',
      'Con el conector de Gmail, abre el último correo de pablo.serrano@ejemplo-logistica.com, lee su firma y actualiza su ficha en Betty con el mismo criterio: solo campos vacíos, y enséñame el antes y el después.',
    ],
    expectedResult:
      'Persona y empresa completas (teléfonos, web, dirección, cargo) y un resumen de lo que se tocó.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail (opcional)'],
    caveats: ['Betty no lee tu Gmail: lo abre el conector de Gmail del chat.'],
  },
  {
    title: 'Perfil de LinkedIn pegado: ficha y nota de contexto',
    level: 1,
    category: 'Orden y datos',
    persona: 'Responsable de selección en una consultora de talento',
    goal: 'Guardar en Betty lo esencial de un perfil profesional (cargo, empresa, trayectoria) en un minuto.',
    prerequisites: [
      'Conector de Betty',
      'Texto del perfil copiado del navegador',
    ],
    steps: [
      'Copia el texto visible del perfil y pégalo en el chat con la URL.',
      'El asistente busca duplicados por URL de LinkedIn o nombre, crea o actualiza la persona y su empresa.',
      'Escribe una nota corta con la trayectoria y dos datos útiles para la primera llamada.',
    ],
    prompts: [
      'Te pego el perfil de LinkedIn de Álvaro Muñiz Vela (URL: https://www.linkedin.com/in/alvaro-muniz-ejemplo). Con ese texto: 1) busca en Betty si ya existe por la URL de LinkedIn o por nombre y apellidos; 2) si no existe, créalo con cargo, ciudad y URL; 3) vincúlalo a su empresa actual (créala si falta); 4) añade una nota de cuatro líneas con su trayectoria y los dos datos más útiles para una primera llamada. No inventes nada que no esté en el texto.\n\n[pega aquí el texto del perfil]',
    ],
    expectedResult:
      'Persona con LinkedIn, cargo y empresa correctos, y una nota lista para la primera conversación.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El asistente trabaja con el texto que pegas; no navega LinkedIn ni debe usarse para extraer perfiles en masa.',
      'Guarda solo lo necesario para la relación profesional.',
    ],
  },
  {
    title: 'Foto del embudo en una sola pregunta',
    level: 1,
    category: 'Embudo y ventas',
    persona:
      'Directora de una academia de idiomas que capta alumnos por web e Instagram',
    goal: 'Saber en menos de un minuto cuántos interesados hay en cada etapa, cuántos entraron esta semana, por dónde llegan y dónde se atascan.',
    prerequisites: [
      'Conector de Betty',
      'Un campo de etapa en Personas u Oportunidades',
    ],
    steps: [
      'Pega el primer prompt. El asistente revisa los campos y agrupa; no cambia nada.',
      'Si tu embudo vive en Oportunidades, el asistente lo detecta. Confírmale cuál usar.',
      'Pega el segundo prompt para comparar con el mes anterior.',
      'Guarda los dos prompts como favoritos: son tu termómetro de cada lunes.',
    ],
    prompts: [
      'En Betty, mira primero qué campos tiene Personas y dime cuántas personas hay en cada etapa del embudo, cuántas entraron en los últimos 7 días y de qué origen vienen. Preséntalo en una tabla (etapa, total, nuevas esta semana, porcentaje). Usa agrupaciones y solo consulta. Si falta el campo de origen, dímelo en vez de suponer.',
      'Compara este mes con el anterior en Betty: cuántas personas entraron en cada etapa y cuántas siguen ahí. Dime en una frase en qué etapa se queda más gente y sugiéreme una acción concreta para esta semana.',
    ],
    expectedResult:
      'Una tabla de leads por etapa y origen, la comparación mensual y una conclusión accionable.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Si no tienes campo de origen, el caso «Diseñar el embudo» explica cómo crearlo.',
    ],
  },
  {
    title: 'Captura en una feria con el flujo «Quick Lead»',
    level: 1,
    category: 'Embudo y ventas',
    persona: 'Comercial de una bodega en un salón del vino',
    goal: 'Registrar cada contacto del stand en diez segundos desde el móvil y, por la noche, etiquetarlos y crearles su tarea de seguimiento.',
    prerequisites: [
      'Espacio con los flujos de ejemplo (Quick Lead viene activo)',
      'Campo «Origen» en Personas con la opción Feria, o permiso para crearlo',
    ],
    steps: [
      'Antes de la feria comprueba en Flujos que «Quick Lead» está activo.',
      'En el stand abre Betty en el móvil, Ctrl/Cmd+K > «Quick Lead», y rellena el formulario.',
      'Por la noche usa el primer prompt: el asistente te enseña las personas creadas hoy para que marques cuáles son de la feria.',
      'Usa el segundo prompt para crear una tarea de seguimiento por contacto.',
    ],
    prompts: [
      'Betty: enséñame las personas creadas hoy, con nombre, empresa y hora de creación. Voy a decirte cuáles son de la feria. Para esas, pon Origen = Feria y añade la nota «Conocido en el Salón del Vino Norte 2026». Si el campo Origen o la opción Feria no existen, propónmelos y espera mi confirmación. No actualices nada hasta que te confirme la lista.',
      'Betty: para cada persona con la nota del Salón del Vino Norte 2026, crea una tarea «Enviar catálogo y tarifas» vinculada a ella, con vencimiento pasado mañana y asignada a mí. Muéstrame la lista antes de crearlas.',
    ],
    expectedResult:
      'Los contactos de la feria vinculados a su empresa, con Origen Feria, una nota y una tarea de seguimiento cada uno.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El formulario se rellena dentro de Betty; el asistente no puede lanzar flujos por ti.',
      'Si lo borraste, pide al asistente que lo recree con workflow-building.',
    ],
  },
  {
    title: 'Inventario de tus automatizaciones: qué hay y si está fallando',
    level: 1,
    category: 'Automatizaciones',
    persona:
      'Fundadora que heredó un espacio con flujos creados por otra persona',
    goal: 'Saber qué automatizaciones existen, qué dispara cada una, cuáles están activas y cuáles fallaron esta semana, sin abrir el editor.',
    prerequisites: ['Conector de Betty', 'Rol con permiso de flujos'],
    steps: [
      'Pega el primer prompt y revisa la tabla.',
      'Fíjate en los dos flujos de ejemplo: «Quick Lead» y «Create company when adding a new person».',
      'Pega el segundo prompt para entender un flujo con lógica.',
      'Si alguno falla, pasa al caso «Arreglar una automatización que falló».',
    ],
    prompts: [
      'Conéctate a Betty y haz un inventario de todas mis automatizaciones. Para cada una dame: nombre, qué la dispara (registro creado o actualizado, programación, webhook o manual), qué hace paso a paso en lenguaje sencillo, si está activa o en borrador, y cuántas ejecuciones tuvo en los últimos 7 días y cuántas fallaron. Preséntalo en una tabla y no cambies nada.',
      'En Betty, explícame el flujo «Create company when adding a new person» como si se lo contaras a alguien que nunca ha automatizado nada: qué comprueba cada paso de código, por qué hay un filtro y qué pasa en cada rama.',
      'De mis flujos en Betty, ¿cuáles envían correos? Dime desde qué buzón conectado salen y a quién van.',
    ],
    expectedResult:
      'Una tabla con cada automatización, su disparador, su lógica explicada y su salud reciente.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Betty borra el historial de ejecuciones de más de 14 días.',
      'Los flujos de ejemplo solo existen en espacios creados con datos de muestra.',
    ],
  },
  {
    title:
      'Importar el Excel o el CSV de otra herramienta sin duplicar a nadie',
    level: 2,
    category: 'Orden y datos',
    persona:
      'Dueña de una agencia que migra desde una hoja de cálculo, o responsable de marketing con la lista de visitantes de una feria',
    goal: 'Pasar a Betty una lista exportada con las columnas bien asignadas, el origen marcado y sin duplicados.',
    prerequisites: [
      'Conector de Betty',
      'Archivo CSV o Excel',
      'Permiso de importación si usas el importador',
    ],
    steps: [
      'Sube el archivo al chat. El asistente lo analiza: columnas, correos inválidos, duplicados internos.',
      'Revisa el mapeo propuesto y decide qué hacer con las columnas sin campo.',
      'Hasta unos cientos de filas, deja que cargue por lotes de 20: primero empresas (por dominio) y después personas (por correo).',
      'Para miles de filas, pide un CSV limpio y súbelo con el importador de Betty (Ctrl/Cmd+K > Importar, hasta 10.000 filas).',
      'Comprueba los totales con una agrupación al final.',
    ],
    prompts: [
      'Te adjunto contactos_exportados.csv. Antes de tocar Betty: léelo, dime qué columnas hay, cuántas filas tienen correo válido y cuántos duplicados hay dentro del archivo, y propón un mapeo columna del archivo a campo de Betty (Personas y Empresas). Dime qué columnas no tienen campo y si conviene crearlo o ignorarlas. Normaliza correos a minúsculas y teléfonos a formato internacional. Cruza los correos con Betty y dime cuántos serían nuevos y cuántos actualizaciones. El análisis hazlo tú; no uses el intérprete de código de Betty. No cargues nada hasta que te diga «adelante».',
      'Adelante. Si son menos de 300 filas, carga primero las empresas con upsert por dominio y luego las personas con upsert por correo, en lotes de 20, vinculando cada persona a su empresa, con Origen = Importación. Si son más, prepárame CSV limpios (empresas y personas) para el importador de Betty y dime en qué orden subirlos. Al terminar, cuenta con una agrupación cuántas personas y empresas hay y compáralo con lo esperado.',
    ],
    expectedResult:
      'La lista entera en Betty, cada persona con su empresa, sin duplicados y con un recuento final que cuadra.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Lectura de archivos del chat'],
    caveats: [
      'La receta de importación de la habilidad data-manipulation usa un intérprete desactivado; el chat procesa el archivo por su cuenta.',
      'Importa solo contactos con base legal para comunicarte con ellos.',
    ],
  },
  {
    title:
      'Asistentes de un evento desde Google Drive, etiquetados y sin duplicados',
    level: 2,
    category: 'Orden y datos',
    persona: 'Organizadora de jornadas en una asociación empresarial',
    goal: 'Cargar los inscritos de una hoja de Drive, añadir el evento a su ficha sin borrar los anteriores y crear una vista para el seguimiento.',
    prerequisites: ['Conector de Betty', 'Conector de Google Drive'],
    steps: [
      'Crea una sola vez el campo de selección múltiple «Eventos» en Personas.',
      'El asistente lee la hoja y cruza por correo.',
      'A los existentes les añade el evento conservando los anteriores; a los nuevos los crea.',
      'Crea la vista del evento.',
    ],
    prompts: [
      'Si no existe ya, añade a Personas en Betty un campo de selección múltiple «Eventos» y crea la opción «Jornada Industria 4.0 Zaragoza 2026».',
      'Con el conector de Google Drive abre la hoja «Inscritos Jornada Industria 4.0». Para cada fila busca la persona en Betty por correo; si existe, añade «Jornada Industria 4.0 Zaragoza 2026» a su campo Eventos sin borrar los que ya tuviera; si no existe, créala con nombre, correo, empresa y cargo, vinculada a su empresa. Antes de escribir dame el resumen: nuevos, existentes y filas con correo vacío o mal escrito. Al final crea la vista «Asistentes Industria 4.0».',
    ],
    expectedResult:
      'Asistentes con el evento en su ficha, el histórico conservado y una vista lista para el seguimiento.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Drive'],
    caveats: [
      'Una actualización en bloque sobre una selección múltiple sustituye su contenido: pide siempre conservar los valores anteriores, registro a registro.',
    ],
  },
  {
    title: 'Migrar una base de Notion a Betty',
    level: 2,
    category: 'Orden y datos',
    persona:
      'Responsable de una agencia de eventos con proveedores y partners en Notion',
    goal: 'Pasar a Betty una base de contactos de Notion, enlazando cada persona a su empresa y sin duplicar lo que ya existe.',
    prerequisites: ['Conector de Betty', 'Conector de Notion'],
    steps: [
      'El asistente lee la base de Notion y propone el mapeo.',
      'Si una columna no tiene sitio, propone un campo nuevo y espera tu OK.',
      'Prueba con 5 filas; con tu «sigue», importa el resto en lotes de 20.',
      'Al final revisa duplicados con crm-hygiene.',
    ],
    prompts: [
      'Lee en Notion la base «Proveedores y partners» y dime qué columnas tiene y cuántas filas. Carga la habilidad data-manipulation de Betty y propónme un mapeo a Personas y Empresas. Si conviene un campo nuevo (por ejemplo, la selección «Tipo de proveedor» en Empresas con las opciones de Notion), propónmelo sin crearlo. No importes nada todavía.',
      'Aprobado. Haz una prueba con 5 filas usando upsert (empresas por dominio, personas por correo) y enséñamelas. Si digo «sigue», importa el resto en lotes de 20 y dame el resumen: creados, actualizados, omitidos y por qué.',
      'Carga crm-hygiene en Betty y revisa lo importado hoy: posibles duplicados, personas sin empresa y correos vacíos. Solo infórmame.',
    ],
    expectedResult:
      'Los contactos de Notion en Betty, enlazados a sus empresas, con un informe de lo importado.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Notion'],
    caveats: [
      'Las personas sin correo no tienen clave para el upsert y pueden duplicarse.',
      'El agente no fusiona: los duplicados se fusionan en la interfaz (Ctrl/Cmd+K > Fusionar registros).',
    ],
  },
  {
    title: 'Vistas guardadas que responden a una pregunta',
    level: 2,
    category: 'Orden y datos',
    persona: 'Responsable de atención al cliente de una tienda online',
    goal: 'Tener a un clic las listas que se consultan cada semana en lugar de filtrar cada vez.',
    prerequisites: ['Conector de Betty', 'Permiso de vistas'],
    steps: [
      'Describe la pregunta que quieres responder, no los filtros.',
      'El asistente propone filtros, orden y columnas, y crea las vistas.',
      'Las fija en tus favoritos. Ábrelas y comprueba los registros.',
    ],
    prompts: [
      'En Betty, crea tres vistas de tabla sobre Personas y fíjalas en mis favoritos: 1) «Sin teléfono»: personas sin teléfono, más recientes primero, con nombre, correo, empresa y ciudad. 2) «Nuevos de los últimos 7 días». 3) «Clientes de Andalucía»: ciudad Sevilla, Málaga, Granada, Córdoba, Cádiz, Almería, Huelva o Jaén. Antes de crearlas enséñame los filtros.',
    ],
    expectedResult: 'Tres vistas con nombre claro en la barra lateral.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Las vistas compartidas con todo el espacio requieren permiso de diseño.',
      'Las agrupaciones de tabla se configuran desde la interfaz.',
    ],
  },
  {
    title: 'Tablero kanban de cuentas por estado de relación',
    level: 2,
    category: 'Orden y datos',
    persona: 'Gestor de cuentas en una empresa de servicios B2B',
    goal: 'Ver en qué punto está cada empresa cliente y moverla de columna arrastrando.',
    prerequisites: [
      'Conector de Betty',
      'Permisos de modelo de datos y vistas',
    ],
    steps: [
      'Crea el campo «Estado de cuenta» en Empresas.',
      'El asistente propone una regla para el estado inicial y te enseña cuántas caerían en cada columna.',
      'Al aprobar, actualiza cada grupo de una vez.',
      'Crea el kanban y fíjalo.',
    ],
    prompts: [
      'En Betty, añade a Empresas un campo de selección «Estado de cuenta» con Prospecto, Activo, En riesgo, Pausado y Perdido, cada una con un color. Propón cómo asignar el estado inicial (por ejemplo, con oportunidad ganada = Activo; sin oportunidades = Prospecto) y enséñame cuántas caerían en cada columna antes de actualizar. Cuando apruebe, actualiza cada grupo de una vez.',
      'Crea un kanban de Empresas agrupado por «Estado de cuenta», con el responsable y los ingresos anuales en cada tarjeta y el recuento por columna. Fíjalo en mis favoritos.',
    ],
    expectedResult: 'Un tablero de cuentas con cinco columnas y recuento.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Si cada empresa necesita un valor distinto, el asistente va de 20 en 20.',
    ],
  },
  {
    title: 'Diseñar el embudo: etapas, origen, puntuación y kanban',
    level: 2,
    category: 'Embudo y ventas',
    persona: 'Socia de una agencia de marketing',
    goal: 'Dejar el modelo del embudo bien definido desde el primer día y verlo como un tablero.',
    prerequisites: ['Permisos de modelo de datos y vistas'],
    steps: [
      'Decide si el embudo vive en Personas (leads) u Oportunidades (negocios con importe). Las etapas por defecto de Oportunidades son New, Screening, Meeting, Proposal y Customer, sin etapa de pérdida.',
      'Pega el primer prompt y revisa el plan de campos antes de crearlos.',
      'Pega el segundo prompt para crear el tablero.',
      'Arrastra un par de tarjetas para comprobarlo.',
    ],
    prompts: [
      'Betty: carga la skill metadata-building. Quiero en Personas: «Etapa del embudo» (selección: Nuevo, Contactado, Cualificado, Reunión agendada, Propuesta, Cliente, Perdido, En pausa), «Origen» (selección: Web, Referido, Feria, LinkedIn, Prospección, Llamada entrante), «Puntuación» (número 0-100) y «Fecha de entrada en etapa» (fecha). Comprueba qué existe ya para no duplicar. Enséñame el plan y espera mi confirmación.',
      'Betty: carga la skill view-building. Crea un kanban de Personas agrupado por «Etapa del embudo», llamado «Embudo comercial», con el recuento por columna y email, origen y puntuación en la tarjeta. Añádelo a mis favoritos.',
    ],
    expectedResult:
      'Campos del embudo creados y un tablero «Embudo comercial» en el menú lateral.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Betty no tiene campos obligatorios por regla (no disponible en la beta). Para forzar datos, usa botones con formulario (ver «Motivos de pérdida»).',
      'Cambiar nombres de opciones más tarde afecta a los registros que las usan.',
    ],
  },
  {
    title: 'Intereses y temperatura de cada lead a partir de sus notas',
    level: 2,
    category: 'Embudo y ventas',
    persona: 'Coordinadora comercial de una escuela de idiomas',
    goal: 'Segmentar los leads por interés y temperatura usando lo que ya está escrito en sus notas.',
    prerequisites: ['Conector de Betty', 'Permiso de modelo de datos'],
    steps: [
      'Crea los campos «Intereses» (selección múltiple) y «Temperatura» (valoración 1-5).',
      'El asistente lee las notas recientes y propone valores con una justificación.',
      'Apruebas en bloques de 25.',
      'Crea la vista «Calientes».',
    ],
    prompts: [
      'En Betty, crea en Personas «Intereses» (selección múltiple: Inglés, Alemán, Francés, Empresa, Examen oficial, Niños) y «Temperatura» (valoración de 1 a 5) en una sola llamada.',
      'Lee las notas de las personas creadas en los últimos 90 días y propón Intereses y Temperatura para cada una, con una frase que justifique la temperatura. Muéstramelo en tablas de 25 y no actualices hasta que apruebe cada tabla. Al final crea la vista «Calientes» con temperatura 4 o 5, más recientes primero.',
    ],
    expectedResult: 'Leads segmentados y una vista de contactos calientes.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'La temperatura es una opinión del asistente: revísala.',
      'Define qué significa cada valor y guárdalo en una habilidad propia.',
    ],
  },
  {
    title: 'Revisión del pipeline del viernes con deal-review y parte en Slack',
    level: 2,
    category: 'Embudo y ventas',
    persona: 'Gerente de ventas de una distribuidora con cuatro comerciales',
    goal: 'Detectar cada viernes los negocios en riesgo, dejar una próxima acción por negocio y compartir un parte breve con el equipo.',
    prerequisites: [
      'Oportunidades con importe, fecha de cierre y responsable',
      'Opcional: conector de Slack',
    ],
    steps: [
      'Pega el primer prompt: deal-review ordena por riesgo y propone una acción por negocio.',
      'Aprueba qué tareas crear.',
      'El asistente redacta un parte de 20 líneas y lo publica en Slack o te lo deja listo para pegar.',
    ],
    prompts: [
      'Carga la skill deal-review de Betty y revisa las oportunidades abiertas con cierre en los próximos 60 días. Ordénalas por riesgo y, para cada una, dime por qué (días sin movimiento, sin contacto reciente, un solo interlocutor, falta importe o fecha, tareas vencidas) y una única próxima acción. Añade el valor abierto por etapa, lo que cambió de etapa o se ganó esta semana y el importe en riesgo por comercial.',
      'Crea en Betty las tareas de las 8 oportunidades de mayor riesgo, asignadas a su responsable y con vencimiento el martes; enséñame la lista antes. Después redacta un parte para Slack de 20 líneas como máximo, con viñetas y el responsable de cada riesgo, y publícalo en #ventas si tu conector lo permite.',
    ],
    expectedResult:
      'Ranking de riesgo, tareas asignadas en Betty y un parte compartido con el equipo.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Slack (opcional)'],
    caveats: [
      'deal-review solo lee: las tareas se crean con tu aprobación.',
      'Algunos conectores de Slack solo leen; en ese caso el asistente te deja el texto.',
    ],
  },
  {
    title: 'Biblioteca de plantillas de correo dentro de Betty',
    level: 2,
    category: 'Comunicaciones y correo',
    persona:
      'Responsable comercial de una inmobiliaria que escribe los mismos correos una y otra vez',
    goal: 'Tener un objeto «Plantilla» con asunto, cuerpo y variables, lleno con los ocho textos que más usa el equipo.',
    prerequisites: ['Permisos de modelo de datos y vistas'],
    steps: [
      'El asistente diseña el objeto Plantilla con metadata-building; revisa antes de crear.',
      'Pide las ocho plantillas con variables entre llaves y di «guarda» cuando estén bien.',
      'Crea la vista «Plantillas activas».',
      'A partir de aquí cualquier prompt puede decir «usa la plantilla X de Betty».',
    ],
    prompts: [
      'Carga la skill metadata-building de Betty. Quiero un objeto «Plantilla» con: Nombre (texto), Uso (selección: Primer contacto, Seguimiento, Visita, Oferta, Postventa, Interno), Asunto (texto), Cuerpo (texto enriquecido), Variables (texto), Idioma (selección: Español, Inglés) y Activa (sí/no). Enséñame el diseño y espera mi confirmación.',
      'Redacta 8 plantillas para una inmobiliaria: primer contacto con un comprador, confirmación de visita, recordatorio la víspera, seguimiento tras la visita, envío de oferta, oferta aceptada, petición de reseña tras la firma y aviso interno de nueva oportunidad. Usa variables como {nombre}, {inmueble}, {fecha_visita} y {agente}. Tono cercano y profesional, 120 palabras como máximo. Guárdalas en el objeto Plantilla de Betty solo cuando diga «guarda».',
      'En Betty crea una vista de tabla del objeto Plantilla llamada «Plantillas activas», filtrada por Activa = sí y ordenada por Uso.',
    ],
    expectedResult:
      'Ocho plantillas reutilizables en Betty, base para envíos programados y secuencias.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Las variables no se sustituyen solas: las rellena el asistente al redactar o un paso de código en un flujo.',
      'El texto enriquecido se envía en formato markdown.',
    ],
  },
  {
    title: 'Una habilidad propia con la voz de tu marca',
    level: 2,
    category: 'Comunicaciones y correo',
    persona: 'Fundador de una escuela online que alterna ChatGPT y Claude',
    goal: 'Que cualquier chat conectado a Betty redacte con el mismo tono, la misma estructura y las mismas reglas de uso de plantillas.',
    prerequisites: ['Permiso de ajustes de IA', 'Opcional: conector de Gmail'],
    steps: [
      'El asistente redacta la skill a partir de tus mejores correos.',
      'Revísala y pégala en Ajustes > IA > Skills > New Skill, con una descripción que diga cuándo usarla.',
      'Comprueba  que aparece y pruébala.',
    ],
    prompts: [
      'Lee con mi conector de Gmail los 5 últimos correos que envié a alumnos con la etiqueta «Buenos». Escribe una skill en markdown llamada «tono-escuela» con: Voz (3 rasgos con ejemplos), Palabras que usamos y evitamos, Estructura de un correo, Reglas para usar las Plantillas de Betty (rellenar todas las variables, no inventar fechas ni precios) y una lista de verificación antes de enviar. Añade una descripción de una línea que diga cuándo cargarla. Dame el texto para pegarlo en Betty.',
      'Lista las skills de Betty y confirma que aparece «tono-escuela». Cárgala y redacta, con la plantilla «Bienvenida» del objeto Plantilla, un correo para la alumna Marta Ruiz, inscrita hoy en Excel avanzado.',
    ],
    expectedResult:
      'Correos coherentes en voz y formato, redacte quien los redacte.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail'],
    caveats: [
      'Las instrucciones del espacio de Ajustes > IA no llegan al chat por el conector; la skill propia sí.',
    ],
  },
  {
    title: 'Triaje de la bandeja priorizado por lo que vale cada contacto',
    level: 2,
    category: 'Comunicaciones y correo',
    persona: 'Comercial o asesor con 40 correos al día que pierde seguimientos',
    goal: 'Saber qué correos sin responder importan más según la etapa del remitente en Betty, registrar cada pendiente como tarea y dejar borradores listos en Gmail.',
    prerequisites: [
      'Conector de Betty',
      'Conector de Gmail con permiso para crear borradores',
      'Campo «Origen» en Personas con la opción Email',
    ],
    steps: [
      'Pega el primer prompt. El asistente lee Gmail, busca cada remitente en Betty y ordena por prioridad.',
      'Revisa el plan; no se escribe nada hasta tu «adelante».',
      'Con el segundo prompt crea o actualiza personas, notas y tareas, y deja los borradores en Gmail sin enviar.',
    ],
    prompts: [
      'Busca en mi Gmail los hilos de los últimos 3 días en los que el último mensaje es de una persona externa y no he respondido (ignora boletines y notificaciones). Para cada remitente consulta en Betty su ficha, su empresa y su oportunidad abierta con etapa e importe. Ordena: primero oportunidades en Proposal o Meeting, luego clientes, luego el resto, y al final quien no esté en Betty. Para cada hilo propón una nota de dos líneas y una tarea «Responder a {nombre}: {tema}» para mañana a las 10:00, y redacta una respuesta breve para los 5 primeros. No escribas nada en Betty ni en Gmail hasta que diga «adelante».',
      'Adelante. En Betty crea o actualiza las personas por correo (Origen = Email para las nuevas), añade la nota y crea las tareas. Después crea en Gmail los borradores de las respuestas, sin enviarlos, y dame una tabla con lo hecho y el enlace a cada persona.',
    ],
    expectedResult:
      'Cada conversación pendiente reflejada en Betty, priorizada por valor, y borradores listos para revisar.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail'],
    caveats: [
      'Betty no lee tu Gmail; lo hace el chat. Los borradores quedan en Gmail.',
      'Si tu conector no crea borradores, el asistente te deja el texto.',
    ],
  },
  {
    title: 'Tarea de seguimiento automática cuando un trato cambia de etapa',
    level: 2,
    category: 'Automatizaciones',
    persona:
      'Comercial de software B2B que olvida el seguimiento tras enviar propuestas',
    goal: 'Que cada vez que una oportunidad pase a Proposal, Betty cree una tarea para su responsable a 3 días hábiles. Es la primera automatización ideal.',
    prerequisites: ['Permiso de flujos'],
    steps: [
      'El asistente carga workflow-building y te enseña el diseño.',
      'Revisa disparador, filtro y cálculo de fecha; créalo como borrador.',
      'Actívalo con «activa» y pruébalo moviendo una oportunidad de prueba.',
    ],
    prompts: [
      'Carga la skill workflow-building de Betty. Cuando una Oportunidad se actualice y su Etapa cambie a Proposal, crea una Tarea «Seguimiento de propuesta: {nombre de la oportunidad}», asignada al responsable, vinculada a la oportunidad y con vencimiento a 3 días hábiles (calcula la fecha con un paso de código en TypeScript puro que salte sábados y domingos). En el cuerpo pon el importe y el contacto principal. Enséñame disparador, campos vigilados, filtro y pasos antes de crear. Déjalo en borrador hasta que escriba «activa».',
      'Activa el flujo de seguimiento de propuestas y dime cómo comprobar que funciona.',
    ],
    expectedResult:
      'Cada propuesta enviada genera una tarea con fecha correcta y contexto.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El conector no ejecuta flujos: se prueba cambiando de verdad una oportunidad.',
      'Vincular la tarea al registro requiere crear su vínculo (taskTarget); compruébalo.',
    ],
  },
  {
    title: 'Botón «Registrar llamada» con formulario en cada contacto',
    level: 2,
    category: 'Automatizaciones',
    persona: 'Agente de seguros que hace 25 llamadas al día',
    goal: 'Un botón en la ficha que abre un formulario corto y deja la nota y la siguiente tarea en un clic.',
    prerequisites: ['Permiso de flujos'],
    steps: [
      'Pide el flujo manual sobre una Persona con un paso de formulario.',
      'Revisa la lógica por resultado.',
      'Actívalo y fíjalo: aparece como acción en la ficha y en Ctrl/Cmd+K.',
    ],
    prompts: [
      'Carga la skill workflow-building de Betty y diseña un flujo MANUAL sobre un solo registro de Persona, fijado, llamado «Registrar llamada». Primer paso, un formulario con Resultado (Interesado, No interesado, No contesta, Pide información), Resumen (texto), Próxima acción (texto) y Fecha de próxima acción (fecha). Después crea una Nota con resultado y resumen; si es «No contesta», una Tarea «Volver a llamar a {nombre}» a 2 días; si es «No interesado», ninguna tarea; en el resto, la Tarea con la próxima acción y su fecha. Enséñame el diseño y no lo actives sin mi confirmación.',
    ],
    expectedResult:
      'Registrar una llamada pasa de dos minutos a quince segundos.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: ['Los formularios se rellenan en la app de Betty, no en el chat.'],
  },
  {
    title: 'Resumen diario de tus tareas en tu correo',
    level: 2,
    category: 'Automatizaciones',
    persona:
      'Directora de una agencia de eventos que empieza el día en el móvil',
    goal: 'Recibir cada mañana, desde tu propio buzón conectado, las tareas de hoy y las atrasadas con enlace.',
    prerequisites: [
      'Buzón conectado por IMAP/SMTP en Ajustes > Cuentas (en Gmail, con contraseña de aplicación)',
      'Permiso de flujos',
    ],
    steps: [
      'El asistente busca tu cuenta conectada y diseña el flujo.',
      'Revisa el ejemplo de HTML.',
      'Ten en cuenta que la hora programada es UTC: las 8:00 de Madrid son las 7:00 UTC en invierno y las 6:00 en verano.',
      'Actívalo.',
    ],
    prompts: [
      'Carga la skill workflow-building de Betty y busca mi cuenta de correo conectada. Diseña un flujo programado cada día a las 07:00 UTC (8:00 de Madrid en invierno) que: 1) busque mis Tareas no completadas con vencimiento hoy o antes; 2) si no hay ninguna, termine; 3) si hay, con un paso de código en TypeScript puro arme un correo HTML con dos secciones, «Atrasadas» y «Para hoy», con título, registro relacionado, fecha y enlace; 4) me lo envíe desde mi buzón conectado con el asunto «Tu día en Betty: {n} tareas». Enséñame el diseño y un ejemplo del HTML. No lo actives hasta que confirme.',
    ],
    expectedResult: 'Un correo diario de agenda sin abrir Betty.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los flujos programados no siguen el cambio de hora.',
      'El correo sale de tu buzón, así que el límite del correo del sistema no le afecta.',
    ],
  },
  {
    title: 'Investigar una cuenta antes del primer contacto',
    level: 2,
    category: 'Agente y conectores del chat',
    persona: 'SDR o consultora que prepara una primera llamada',
    goal: 'Completar la ficha de una empresa con datos verificados y fuentes, aprobar campo por campo y dejar una nota con ganchos de conversación.',
    prerequisites: ['Conector de Betty', 'Búsqueda web del chat'],
    steps: [
      'El asistente lee la ficha actual y busca en la web.',
      'Te muestra una tabla: campo, valor actual, propuesto y fuente.',
      'Apruebas filas; no sobrescribe lo que escribió una persona.',
      'Guarda una nota de investigación con fuentes y tres preguntas.',
    ],
    prompts: [
      'Busca en Betty la empresa «Transportes Ribera Alta» y su contacto principal. Sigue el método de la habilidad enrich de Betty, pero con tu propia búsqueda web (el buscador que menciona no está instalado): averigua sector, número aproximado de empleados, ciudad, web, LinkedIn y noticias de los últimos 6 meses. Dame una tabla con campo, valor actual en Betty, valor propuesto y enlace a la fuente. No propongas cambiar campos con valor salvo error claro. No escribas nada hasta que apruebe.',
      'Aplica las filas que apruebo: [indica cuáles]. Después crea en la empresa la nota «Investigación previa» con un resumen de 5 líneas, las novedades y tres preguntas para abrir la llamada, citando las fuentes.',
    ],
    expectedResult:
      'Ficha completada con datos verificados y una nota de investigación lista para la llamada.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Búsqueda web del chat'],
    caveats: ['Limítate a información profesional pública.'],
  },
  {
    title: 'Ficha de 60 segundos antes de una llamada',
    level: 2,
    category: 'Agente y conectores del chat',
    persona: 'Comercial B2B con cinco o seis llamadas al día',
    goal: 'Llegar a cada llamada sabiendo quién es, qué hay abierto, qué pasó la última vez y qué preguntar, y dejar la ficha en Betty para el equipo.',
    prerequisites: [
      'Conector de Betty',
      'Conectores de Google Calendar y Gmail',
    ],
    steps: [
      'El asistente busca la reunión en Calendar y saca los asistentes externos.',
      'Carga meeting-prep y cruza con Betty y con tus últimos hilos de Gmail.',
      'Revisas y la guardas como nota.',
    ],
    prompts: [
      'Tengo una reunión hoy a las 15:00 con Marta Gil de Logística Ébano. Búscala en mi Google Calendar y dime quién asiste. Carga la habilidad meeting-prep de Betty y prepárame una ficha que se lea en menos de un minuto: quién es cada asistente, qué oportunidades y tareas tenemos abiertas con la empresa en Betty, qué pasó en el último contacto, qué ha cambiado según mis últimos 3 hilos de Gmail con ella y tres preguntas que valga la pena hacer. Si algo no está en Betty ni en Gmail, dilo; no lo inventes.',
      'Guarda la ficha como nota en Logística Ébano con el título «Preparación reunión» y la fecha de hoy. Enséñame el texto antes de crearla.',
    ],
    expectedResult:
      'Una ficha breve y accionable, guardada en la empresa para el resto del equipo.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Calendar', 'Gmail'],
    caveats: [
      'Betty no lee tu Calendar ni tu Gmail; lo hacen los conectores del chat.',
      'Guarda un resumen, no hilos completos.',
    ],
  },
  {
    title: 'La agenda del día cruzada con Betty',
    level: 2,
    category: 'Agente y conectores del chat',
    persona: 'Fundador de una consultora que encadena reuniones',
    goal: 'Empezar el día con todas las reuniones contrastadas con Betty y dar de alta con un «sí» a los asistentes que faltan.',
    prerequisites: ['Conector de Betty', 'Conector de Google Calendar'],
    steps: [
      'El asistente lee los eventos de hoy y descarta los internos.',
      'Busca a cada asistente externo en Betty por correo y su empresa por dominio.',
      'Te propone el alta de los que faltan y los crea en un lote tras tu confirmación.',
    ],
    prompts: [
      'Lee mis eventos de hoy en Google Calendar e ignora los asistentes de mi dominio. Para cada asistente externo busca en Betty si existe como persona (por correo) y, si no, su empresa (por dominio). Dame una tabla con hora, reunión, asistente, si está en Betty, empresa, oportunidad abierta y una línea de contexto de sus notas. Después propónme el alta de los que faltan (nombre, correo, cargo si aparece, empresa) y espera mi confirmación. No crees empresas a partir de correos personales como gmail.com.',
    ],
    expectedResult: 'Una agenda comentada y ninguna reunión fuera del CRM.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Calendar'],
    caveats: [
      'Si tienes activo el flujo «Create company when adding a new person», Betty crea o enlaza la empresa sola: díselo al asistente para no duplicar.',
    ],
  },
  {
    title: 'De las notas de la reunión a Betty: resumen, tareas y etapa',
    level: 2,
    category: 'Agente y conectores del chat',
    persona:
      'Account manager que toma notas o recibe la transcripción en un Google Doc',
    goal: 'Que cada reunión deje en Betty una nota, las tareas con responsable y fecha, la etapa y la fecha de cierre al día, y un borrador de seguimiento.',
    prerequisites: ['Conector de Betty', 'Conectores de Google Drive y Gmail'],
    steps: [
      'Indica el documento o pega tus apuntes.',
      'El asistente propone nota, tareas, cambios de etapa o importe; corriges.',
      'Aplica los cambios y deja un borrador de seguimiento en Gmail.',
    ],
    prompts: [
      'Lee en Google Drive el documento «Reunión Grupo Hostelero Mar Azul 12-11». En Betty busca la oportunidad «Mar Azul – digitalización reservas» y propón: una nota de 6 a 8 líneas (decisiones, dudas, presupuesto mencionado), las tareas que salen con responsable (elige entre los miembros de mi espacio) y fecha, y si corresponde cambiar la etapa, la fecha de cierre o el importe. Lee antes las opciones reales del campo etapa. Enséñamelo todo antes de escribir.',
      'Aplica los cambios aprobados. Después redacta un correo de seguimiento breve y cálido para el contacto principal con los acuerdos y el siguiente paso, y déjalo como borrador en mi Gmail, sin enviarlo.',
    ],
    expectedResult:
      'La oportunidad al día y un borrador de seguimiento esperando revisión.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Drive', 'Gmail'],
    caveats: [
      'Si la transcripción tiene datos sensibles, resúmela sin copiarla.',
    ],
  },
  {
    title: 'Auditoría de privacidad de las notas',
    level: 2,
    category: 'Equipo y gobierno',
    persona:
      'Gerente de una clínica dental que usa Betty para pacientes potenciales',
    goal: 'Encontrar notas con datos que no deberían estar en un CRM y sustituirlas por versiones resumidas, con aprobación una a una.',
    prerequisites: ['Conector de Betty', 'Permiso para editar notas'],
    steps: [
      'El asistente revisa las notas de los últimos 90 días por páginas.',
      'Te enseña una tabla con el tipo de dato y un fragmento enmascarado.',
      'Apruebas las versiones redactadas que quieras.',
      'Pide una guía de buenas prácticas para el equipo.',
    ],
    prompts: [
      'Revisa en Betty las notas creadas en los últimos 90 días, paginando si hace falta. Busca números de documento de identidad, tarjetas o cuentas bancarias, contraseñas y detalles de salud más allá de «interesado en ortodoncia». Dame una tabla con la nota, el registro al que pertenece, el tipo de dato y un fragmento enmascarado (nunca el dato completo), y una versión redactada para cada una. No modifiques nada hasta que apruebe nota por nota.',
      'Con lo que encontraste, escríbeme 8 reglas breves de privacidad para el equipo sobre qué se guarda en Betty y cómo pedir a un asistente que resuma un correo sin copiar datos personales.',
    ],
    expectedResult:
      'Notas sensibles limpiadas con tu aprobación y una guía para que no vuelva a pasar.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Betty conserva el historial de actividad: limpiar una nota no sustituye a una política de retención ni a una solicitud formal de supresión.',
      'El asistente lee el contenido: revisa la política de tu proveedor de chat.',
    ],
  },
  {
    title: 'Auditoría de higiene y fusión segura de duplicados',
    level: 3,
    category: 'Orden y datos',
    persona: 'Director comercial que hereda una base desordenada',
    goal: 'Detectar duplicados, fichas incompletas y relaciones rotas, corregir en bloque lo seguro y fusionar duplicados desde la interfaz.',
    prerequisites: [
      'Conector de Betty',
      'Permisos de edición y borrado para fusionar',
    ],
    steps: [
      'Carga crm-hygiene y audita Empresas; después Personas. Primero solo recuentos.',
      'Aprueba las correcciones en bloque.',
      'Para fusionar, el asistente te da los grupos; selecciona de 2 a 9 registros y usa Ctrl/Cmd+K > Fusionar registros.',
      'Repite el recuento al final.',
    ],
    prompts: [
      'Carga la habilidad crm-hygiene de Betty y audita Empresas: duplicados según los criterios del objeto, empresas sin dominio, sin ninguna persona y sin actualizar en 12 meses. Dame primero solo los recuentos.',
      'Haz lo mismo con Personas: duplicados por correo, LinkedIn y nombre y apellidos; personas sin empresa cuyo dominio de correo coincide con una empresa existente. Propón las correcciones que puedes hacer en una sola tanda y espera mi aprobación. Para los duplicados, dame los grupos con enlace a cada registro y cuál conservarías como principal.',
    ],
    expectedResult:
      'Informe de calidad antes y después, correcciones aplicadas y duplicados fusionados.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'La habilidad nunca borra ni fusiona. La fusión es manual e irreversible.',
      'Los correos personales no sirven para deducir la empresa.',
    ],
  },
  {
    title: 'Normalización masiva: teléfonos, nombres y ciudades',
    level: 3,
    category: 'Orden y datos',
    persona:
      'Administrativa de una clínica veterinaria con fichas escritas por varias personas',
    goal: 'Unificar formatos para que filtros, búsquedas y envíos funcionen.',
    prerequisites: [
      'Conector de Betty',
      'Exportación CSV previa como copia de seguridad',
    ],
    steps: [
      'Exporta Personas a CSV.',
      'Pide un muestreo de variantes sin cambiar nada.',
      'Acuerda las reglas.',
      'Ciudades: una actualización por variante. Nombres y teléfonos: tandas de 20 con muestra de cada tanda.',
      'Comprueba con una agrupación por ciudad.',
    ],
    prompts: [
      'En Betty revisa Personas y dime: 1) las formas en que aparece escrita cada ciudad (agrupa por ciudad); 2) cuántos teléfonos no tienen prefijo internacional; 3) cuántos nombres o apellidos están todo en mayúsculas o en minúsculas. No cambies nada.',
      'Aplica estas reglas. Ciudades: para cada variante, actualiza de una vez todas las personas con esa variante a la forma correcta de la tabla que propusiste, diciéndome antes cuántas tocarás. Teléfonos españoles sin prefijo a +34 y nombres con mayúscula inicial respetando «de», «del» y «la»: en tandas de 20, con cinco ejemplos antes y después de cada tanda, esperando mi visto bueno. Deja en una lista aparte los casos dudosos.',
    ],
    expectedResult:
      'Una forma por ciudad, teléfonos con prefijo, nombres bien escritos y una lista corta de casos a mano.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: ['No hay deshacer masivo: exporta antes.'],
  },
  {
    title: 'Enriquecimiento en lote de las empresas nuevas',
    level: 3,
    category: 'Orden y datos',
    persona: 'Analista de desarrollo de negocio en un software para hostelería',
    goal: 'Completar sector, tamaño, web y LinkedIn de las empresas del mes con fuentes, sin pisar lo escrito por personas.',
    prerequisites: [
      'Conector de Betty',
      'Búsqueda web del chat',
      'Campos Sector y Tamaño en Empresas',
    ],
    steps: [
      'El asistente lee las empresas del mes con campos vacíos.',
      'Busca cada una y prepara una tabla con valor propuesto y fuente.',
      'Apruebas; solo se rellenan vacíos.',
    ],
    prompts: [
      'Sigue el método de la habilidad enrich de Betty, pero con tu propia búsqueda web. Toma las empresas creadas este mes con Sector, Tamaño, web o LinkedIn vacíos. Para cada una prepara una tabla con empresa, campo, valor actual, propuesto y enlace a la fuente. Rellena solo campos vacíos y no escribas nada hasta que apruebe. Si no hay fuente fiable, déjalo vacío.',
    ],
    expectedResult: 'Empresas completas, cada dato con su fuente.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Búsqueda web del chat'],
    caveats: ['Los tamaños de plantilla publicados son aproximados.'],
  },
  {
    title: 'Panel de salud de tu base de contactos',
    level: 3,
    category: 'Orden y datos',
    persona:
      'Fundador de una startup de formación que quiere ver crecer su base',
    goal: 'Un panel con los números que importan: total, altas por semana, origen, sector y fichas sin correo.',
    prerequisites: ['Permiso de diseño', 'Campos Origen y Sector'],
    steps: [
      'Carga dashboard-building y describe las preguntas del panel.',
      'Confirma la propuesta y se crea en una acción.',
      'Ábrelo en Paneles. Opcional: parte de «My First Dashboard».',
    ],
    prompts: [
      'Carga la habilidad dashboard-building de Betty y propón un panel «Salud de la base» con: indicador del total de personas; líneas de personas creadas por semana en los últimos 90 días; circular de personas por Origen; barras de empresas por Sector; e indicador de personas sin correo. Enséñame la propuesta y créalo cuando confirme.',
    ],
    expectedResult: 'Un panel de cinco widgets que se actualiza solo.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Si duplicas My First Dashboard, cambia el objeto de cada gráfico.',
    ],
  },
  {
    title: 'Segmento listo para campaña, marcado y exportado',
    level: 3,
    category: 'Orden y datos',
    persona:
      'Responsable de marketing de una bodega que prepara un envío a distribuidores',
    goal: 'Construir un segmento justificado paso a paso, marcarlo en Betty conservando campañas anteriores y exportarlo.',
    prerequisites: [
      'Campos Sector, Consentimiento comercial y Campañas (selección múltiple)',
      'Permiso de exportación',
    ],
    steps: [
      'Explica el público objetivo.',
      'El asistente cuenta cuántas personas cumplen cada criterio y el total.',
      'Confirma; marca el segmento persona a persona en tandas de 20.',
      'Crea la vista y expórtala a CSV desde Betty.',
    ],
    prompts: [
      'En Betty quiero preparar el envío «Presentación cosecha 2026». Público: personas de empresas con Sector Distribución o Restauración, con cargo de compras o dirección, en España o Portugal, con correo válido. Excluye a quien tenga Consentimiento comercial = No y a quien tenga una oportunidad ganada este año. Dime cuántas cumplen cada criterio, paso a paso, el total y una muestra de 10 nombres. No modifiques nada.',
      'De acuerdo. Añade la opción «Cosecha 2026» al campo Campañas si no existe. Para cada persona del segmento, lee sus campañas y escribe la lista con «Cosecha 2026» añadida, sin quitar ninguna, en tandas de 20. Después crea la vista «Envío Cosecha 2026» con nombre, correo, empresa, cargo y país.',
    ],
    expectedResult:
      'Un segmento justificado, marcado sin perder histórico y exportable en un clic.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Sin campo de consentimiento, créalo antes de enviar comunicaciones comerciales.',
      'Las campañas nativas no están activas en la beta: envía desde tu herramienta o con flujos desde un buzón conectado.',
    ],
  },
  {
    title: 'Quién te escribe y aún no está en tu CRM',
    level: 3,
    category: 'Orden y datos',
    persona: 'Socia de un despacho de abogados que recibe consultas por correo',
    goal: 'Dar de alta, con los datos de su firma, a las personas reales con las que te carteas y no están en Betty.',
    prerequisites: ['Conector de Betty', 'Conector de Gmail'],
    steps: [
      'El asistente revisa 30 días de correo y descarta boletines y direcciones genéricas.',
      'Cruza con Betty y lee la firma de los que faltan.',
      'Confirmas y crea las fichas con nota del último hilo.',
    ],
    prompts: [
      'Con el conector de Gmail revisa mis correos de los últimos 30 días y saca las personas reales con las que he intercambiado mensajes (ignora boletines, notificaciones, no-reply e info@ o facturacion@). Cruza cada dirección con Personas en Betty y quédate con las que no existen. Para cada una, lee la firma de su último correo y propón nombre, cargo, empresa y teléfono. Cuando apruebe la tabla, créalas con Origen = Correo, vinculadas a su empresa, con una nota del asunto y fecha del último hilo.',
    ],
    expectedResult: 'Las personas de tu correo dadas de alta con su contexto.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail'],
    caveats: [
      'Alternativa: conectar un buzón IMAP a Betty para que sincronice mensajes y cree contactos según la política elegida. Pruébalo antes con un buzón de pruebas.',
    ],
  },
  {
    title: 'Cualificación con botón y formulario (BANT)',
    level: 3,
    category: 'Embudo y ventas',
    persona: 'Inside sales de una instaladora de paneles solares',
    goal: 'Cualificar cada lead con las mismas preguntas y que Betty puntúe, cambie la etapa y cree la oportunidad cuando toca.',
    prerequisites: [
      'Campos de etapa y puntuación en Personas',
      'Permiso de flujos',
    ],
    steps: [
      'Pide el flujo y revisa el esquema.',
      'Valídalo y actívalo.',
      'En la ficha del lead, Ctrl/Cmd+K > «Cualificar lead» y responde el formulario.',
    ],
    prompts: [
      'Betty: carga la skill workflow-building. Crea un flujo manual «Cualificar lead» sobre una Persona con un formulario: Presupuesto (menos de 4.000 €, 4.000-8.000 €, más de 8.000 €), ¿Decide la compra? (Sí/No), Necesidad (texto), Plazo (Este mes, 1-3 meses, Más de 3 meses) y Tipo de vivienda (Unifamiliar, Adosado, Piso). Un paso de código en TypeScript puro, sin red, calcula una puntuación de 0 a 100 (presupuesto 40 %, decisor 25 %, plazo 25 %, unifamiliar 10 %). Actualiza la Puntuación; si es 60 o más, Etapa «Cualificado», crea una Oportunidad vinculada en Screening y una tarea «Visita técnica» a 3 días para mí; si no, Etapa «En pausa» y tarea «Recontactar» a 60 días. Enséñamelo paso a paso, valídalo y espera mi confirmación.',
    ],
    expectedResult:
      'Un botón que estandariza la cualificación y crea la oportunidad y la tarea correctas.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los pasos de IA no funcionan en la beta: la puntuación es por reglas.',
    ],
  },
  {
    title: 'Formulario web a Betty: validado, limpio y sin duplicados',
    level: 3,
    category: 'Embudo y ventas',
    persona:
      'Dueña de un estudio de interiorismo o de una academia que recibe solicitudes desde su web',
    goal: 'Que cada envío del formulario entre solo en Betty, normalizado, sin duplicar a quien ya escribió, sin resetear su etapa, con nota, tarea de llamada y acuse de recibo.',
    prerequisites: [
      'Formulario cuyo servidor o herramienta (Tally, Typeform, Jotform) envíe un POST en JSON',
      'Campos Etapa, Origen y Campaña en Personas',
      'Buzón conectado para el acuse',
    ],
    steps: [
      'Acuerda los campos del envío y un campo «secreto».',
      'Si usas una herramienta de formularios, consigue un ejemplo del JSON real (suelen anidar las respuestas) y pásaselo al asistente.',
      'Pide el flujo y la URL del webhook. Configura URL y secreto en el servidor o en la herramienta, nunca en el JavaScript visible.',
      'Prueba: envío nuevo, el mismo otra vez (debe actualizar) y uno con secreto incorrecto (debe pararse).',
    ],
    prompts: [
      'Betty: carga la skill workflow-building. Crea el flujo «Entrada formulario web» con disparador webhook POST. Cuerpo esperado: nombre, apellidos, email, telefono, mensaje, servicio, utm_source, utm_campaign y secreto (si te pego el JSON real de mi herramienta, declara ese y extrae los campos en el código). Pasos: 1) filtro que solo sigue si secreto es igual a «CL-2026-cambia-esto»; 2) código en TypeScript puro que pasa el correo a minúsculas, pone nombres con mayúscula inicial, convierte el teléfono a +34 si no trae prefijo y compone el origen con los UTM; 3) busca la persona por email; si no existe, créala con Etapa «Nuevo», Origen «Web» y la campaña; si existe, actualiza solo la campaña y la fecha de última solicitud, sin tocar su etapa; 4) nota con el servicio y el mensaje; 5) tarea «Llamar en 24 h» para mí; 6) acuse de recibo desde mi buzón conectado con la plantilla «Acuse web». Enséñame el flujo y la URL, valídalo y no lo actives hasta que te lo diga.',
      'Activa «Entrada formulario web». Cuando haga mi envío de prueba, revisa la última ejecución y dime qué hizo cada paso y si alguno falló.',
    ],
    expectedResult:
      'Cada solicitud se convierte en una persona única con origen, campaña, nota, tarea y acuse, sin intervención manual.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El webhook de flujos no tiene autenticación propia: quien tenga la URL puede lanzarlo. El filtro de secreto es imprescindible.',
      'Si el cuerpo declarado no coincide con el real, las variables llegan vacías: prueba con un envío real.',
      'El asistente no puede lanzar el webhook; la prueba se hace enviando el formulario.',
    ],
  },
  {
    title: 'Panel de previsión de ventas',
    level: 3,
    category: 'Embudo y ventas',
    persona: 'Gerente de una pyme de mobiliario de oficina',
    goal: 'Ver en una pantalla cuánto hay en juego por etapa, qué se espera cerrar cada mes y qué se ganó este trimestre.',
    prerequisites: [
      'Oportunidades con importe, etapa y fecha de cierre',
      'Permiso de diseño',
    ],
    steps: [
      'Si quieres, parte de «My First Dashboard».',
      'Pega el prompt; la skill te enseña el diseño.',
      'Confirma y fija el panel en el menú.',
    ],
    prompts: [
      'Betty: carga la skill dashboard-building. Crea el panel «Previsión comercial» con: indicador del importe abierto; indicador del importe ganado este trimestre; barras de importe por etapa; líneas de importe por mes de cierre para los próximos 6 meses; circular de importe abierto por responsable; y una tabla de oportunidades que cierran este mes ordenadas por importe. Enséñame el diseño antes de crearlo.',
    ],
    expectedResult:
      'Un panel de previsión siempre actualizado para todo el equipo.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Customer equivale a ganada; si añades «Perdida», exclúyela de los totales abiertos.',
      'Para importe ponderado ver «Previsión ponderada».',
    ],
  },
  {
    title: 'Motivos de pérdida que sí se registran',
    level: 3,
    category: 'Embudo y ventas',
    persona: 'Director comercial de una escuela de negocios online',
    goal: 'Saber por qué se pierden las ventas, con datos, y dejar fijada una fecha de recontacto.',
    prerequisites: ['Permisos de modelo de datos y flujos'],
    steps: [
      'Crea la etapa Perdida y los campos.',
      'Construye el botón «Marcar como perdida».',
      'Acuerda con el equipo cerrar las pérdidas con el botón, no arrastrando la tarjeta.',
      'A fin de mes, analiza.',
    ],
    prompts: [
      'Betty: carga la skill metadata-building. En Oportunidades añade la opción «Perdida» a Etapa sin tocar las existentes y crea «Motivo de pérdida» (Precio, Plazo, Eligió competidor, Sin respuesta, No era el momento, Otro), «Competidor» (texto) y «Fecha de recontacto» (fecha). Enséñame el plan.',
      'Betty: carga workflow-building y crea un flujo manual «Marcar como perdida» sobre una Oportunidad: formulario con Motivo, Competidor y Fecha de recontacto; actualiza la oportunidad con esos datos y etapa Perdida; crea una tarea «Recontactar» para el responsable en la fecha de recontacto y una nota con el resumen. Valídalo y espera mi OK.',
      'Betty: agrupa las oportunidades perdidas en los últimos 90 días por motivo y responsable, con número e importe. Dime tres patrones y qué cambiarías.',
    ],
    expectedResult:
      'Cada pérdida con motivo, competidor y fecha de recontacto, y un análisis mensual.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: ['Arrastrar la tarjeta a Perdida no abre el formulario.'],
  },
  {
    title: 'Cuentas clave: plan de cuenta y mapa de interlocutores',
    level: 3,
    category: 'Embudo y ventas',
    persona: 'Key account manager en una empresa de packaging',
    goal: 'Gestionar las cuentas que más facturan con un plan escrito y detectar las que dependen de una sola persona.',
    prerequisites: ['Permisos de modelo de datos y vistas'],
    steps: [
      'Crea los campos y la vista «Cuentas A».',
      'Marca nivel y rol de cada contacto (el asistente puede proponerlo).',
      'Genera el plan de cada cuenta A y guárdalo con sus tareas.',
    ],
    prompts: [
      'Betty: carga metadata-building y crea en Empresas «Nivel de cuenta» (A, B, C), «Potencial anual» (moneda) y «Próxima revisión» (fecha), y en Personas «Rol en la decisión» (Decisor, Influenciador, Usuario, Patrocinador, Bloqueador). Con view-building crea la vista «Cuentas A» (nivel A, ordenada por próxima revisión). Enséñame el plan primero.',
      'Betty: para «Conservas del Cantábrico Norte» prepara un plan de cuenta: oportunidades abiertas y ganadas en 12 meses con recuento e importe, contactos por rol en la decisión, roles que faltan, riesgos y tres acciones con fecha para el próximo trimestre. Cuando lo apruebe, guárdalo como nota «Plan de cuenta T1 2027» y crea las tres tareas para mí.',
    ],
    expectedResult:
      'Vista de cuentas A, mapa de interlocutores y plan guardado con tareas.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los permisos por fila (cada KAM solo ve sus cuentas) no están disponibles en la beta; usa vistas filtradas por responsable.',
    ],
  },
  {
    title: 'Análisis ABC de tu cartera de clientes',
    level: 3,
    category: 'Embudo y ventas',
    persona: 'Account manager con unas 60 cuentas',
    goal: 'Clasificar la cartera por valor y salud, dejarlo marcado en Betty y vigilar las cuentas importantes desatendidas.',
    prerequisites: [
      'Permisos de modelo de datos y vistas',
      'Oportunidades ganadas con importe y empresa',
    ],
    steps: [
      'El asistente suma lo ganado por empresa en 12 meses y mira la actividad reciente.',
      'Propone A, B y C con un semáforo de salud.',
      'Crea los campos, los rellena y construye la vista «Cuentas A desatendidas».',
      'Pide el informe como hoja de cálculo para dirección.',
    ],
    prompts: [
      'Haz un análisis ABC de mi cartera en Betty: suma con group_by el importe ganado por empresa en 12 meses y mira la fecha de la última nota, tareas vencidas y oportunidades abiertas. A = cuentas que suman el 80 % del valor, B = el siguiente 15 %, C = el resto, con un semáforo de salud. Dame la tabla y 5 conclusiones. No cambies nada.',
      'Carga metadata-building y propón en Empresas «Segmento» (A, B, C), «Última actividad» (fecha) e «Importe ganado 12m» (moneda). Cuando confirme, créalos y rellénalos: el segmento con una actualización por segmento filtrando por IDs (enséñame antes el recuento) y los valores distintos de 20 en 20. Después crea la vista «Cuentas A desatendidas»: Segmento A y Última actividad anterior a hace 30 días, ordenada por importe.',
      'Entrégame el análisis como hoja de cálculo con una pestaña por segmento y otra de conclusiones.',
    ],
    expectedResult:
      'Cartera segmentada en Betty, vista permanente y un informe para dirección.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Herramientas de archivos del chat'],
    caveats: [
      'No filtres por «última actualización»: rellenar el segmento la pone a hoy.',
      'Los campos son una foto: repite el análisis cada trimestre.',
    ],
  },
  {
    title:
      'Secuencia de nutrición de cuatro correos que se detiene si el lead avanza',
    level: 3,
    category: 'Comunicaciones y correo',
    persona: 'Responsable de marketing de un gimnasio boutique',
    goal: 'Enviar cuatro correos espaciados a los leads en Nutrición, comprobando antes de cada envío que siguen ahí y aceptan comunicaciones.',
    prerequisites: [
      'Buzón conectado',
      'Cuatro plantillas',
      'Campo «Acepta comunicaciones»',
    ],
    steps: [
      'Redacta o pide las cuatro plantillas.',
      'Pide el flujo con esperas y relectura antes de cada envío.',
      'Prueba con tu correo y esperas de minutos; luego pide la versión definitiva.',
    ],
    prompts: [
      'Carga la skill workflow-building de Betty. Diseña una secuencia: cuando una Persona cambie a Etapa «Nutrición» y tenga «Acepta comunicaciones» = sí, envía la plantilla «Nutrición 1» desde mi buzón conectado; espera 2 días; vuelve a leer la persona y sigue solo si sigue en Nutrición y acepta comunicaciones; envía «Nutrición 2»; espera 3 días; relee y comprueba; envía «Nutrición 3»; espera 4 días; relee y comprueba; envía «Nutrición 4» y cambia la Etapa a «Frío». Enséñame el diseño. Para la primera prueba usa esperas de 2 minutos. No actives sin mi confirmación.',
    ],
    expectedResult:
      'Una secuencia que respeta el consentimiento y no escribe a quien ya avanzó.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Betty no detecta sola las respuestas: si alguien responde, cambia su etapa.',
      'Un buzón personal tiene límites diarios: no es un canal de envíos masivos.',
    ],
  },
  {
    title: 'Encuesta de satisfacción (NPS) con alerta si la nota es baja',
    level: 3,
    category: 'Comunicaciones y correo',
    persona: 'Gerente de una clínica dental',
    goal: 'Enviar una encuesta tras cada servicio, recoger la respuesta en Betty por webhook y atender a los detractores el mismo día.',
    prerequisites: [
      'Encuesta en Tally u otra herramienta con webhook',
      'Un objeto de citas o servicios',
      'Buzón conectado',
    ],
    steps: [
      'Crea en Tally la pregunta 0-10, un comentario y un campo oculto con el correo.',
      'Pide el objeto «Opinión».',
      'Flujo A: servicio realizado, esperar 1 día, enviar enlace.',
      'Flujo B: webhook de Tally, extraer respuestas, crear Opinión y alertar si nota de 6 o menos.',
    ],
    prompts: [
      'Carga metadata-building y workflow-building de Betty. 1) Crea el objeto «Opinión» con Paciente (relación con Persona), Nota (0-10), Comentario, Categoría (Promotor, Neutro, Detractor) y Fecha. 2) Flujo A: cuando una Cita pase a «Realizada», espera 1 día y envía desde el buzón de la clínica la plantilla «Encuesta» con el enlace https://tally.so/r/EJEMPLO?email={email del paciente}. 3) Flujo B: webhook que recibe el JSON de Tally; un paso de código en TypeScript puro extrae de data.fields la nota, el comentario y el email; busca la persona por email, crea la Opinión con su categoría (9-10 Promotor, 7-8 Neutro, 0-6 Detractor) y, si es Detractor, crea una tarea urgente para hoy y avisa a gerencia@sonrisanorte.example. Filtra además por el ID del formulario esperado. Enséñame los diseños; no actives sin mi OK.',
    ],
    expectedResult:
      'Cada servicio genera su encuesta y los detractores se atienden el mismo día.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El webhook no está autenticado: filtra al menos por el ID del formulario.',
      'El formato del JSON cambia según la herramienta: pide el código con un ejemplo real.',
    ],
  },
  {
    title: 'El flujo de ejemplo que vincula cada contacto a su empresa',
    level: 3,
    category: 'Automatizaciones',
    persona:
      'Responsable de operaciones de una consultora que recibe contactos de muchas fuentes',
    goal: 'Aprovechar y adaptar el flujo de ejemplo que vincula cada persona con su empresa por el dominio del correo.',
    prerequisites: ['Espacio con contenido de ejemplo', 'Permiso de flujos'],
    steps: [
      'Abre Flujos > «Create company when adding a new person».',
      'Pide al asistente que revise sus ejecuciones.',
      'Si quieres que no cree empresas sino que pida revisión, pide un borrador nuevo y revísalo antes de activarlo.',
    ],
    prompts: [
      'En Betty revisa las últimas 20 ejecuciones del flujo «Create company when adding a new person» y dime cuántas terminaron bien, cuántas fallaron y por qué. Explícame qué casos cubre y cuáles no.',
      'Carga workflow-building. Crea un borrador de ese flujo con un cambio: cuando la empresa no exista, en lugar de crearla, crea una tarea «Revisar empresa nueva: [dominio]» para mí con vencimiento mañana. Valídalo y enséñamelo; no lo actives sin mi confirmación.',
    ],
    expectedResult:
      'Personas vinculadas solas a su empresa y, en la variante, una tarea de revisión ante dominios nuevos.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los pasos de código corren con un máximo de 10 simultáneos: en importaciones de miles de personas, desactívalo si ves retrasos.',
    ],
  },
  {
    title: 'Arreglar una automatización que falló sin romper la versión activa',
    level: 3,
    category: 'Automatizaciones',
    persona:
      'Coordinador de una ONG cuyo correo de bienvenida a voluntarios dejó de salir',
    goal: 'Diagnosticar el fallo, corregirlo en un borrador validado y solo entonces sustituir la versión activa.',
    prerequisites: ['Permiso de flujos'],
    steps: [
      'Pide el diagnóstico de las ejecuciones fallidas.',
      'Aprueba la corrección: el asistente crea un borrador, lo cambia y lo valida.',
      'Actívalo y vigila la siguiente ejecución.',
    ],
    prompts: [
      'Carga la skill workflow-building de Betty. Mi flujo «Bienvenida voluntarios» dejó de enviar correos. Revisa sus últimas 10 ejecuciones, dime cuáles fallaron, en qué paso y con qué error, y explícame la causa en lenguaje sencillo. No cambies nada.',
      'Crea un borrador desde la versión activa, aplica la corrección, valídalo y enséñame la diferencia con la versión activa. Actívalo solo cuando diga «activa».',
    ],
    expectedResult:
      'La automatización vuelve a funcionar con un cambio controlado y la versión anterior en el historial.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El reintento de una ejecución se hace desde la app (Ejecuciones).',
      'Si la causa es una cuenta de correo desconectada, reconéctala en Ajustes > Cuentas.',
    ],
  },
  {
    title:
      'Aviso al equipo en Slack, Teams o Discord cuando se gana un trato grande',
    level: 3,
    category: 'Automatizaciones',
    persona: 'CEO de una consultora tecnológica',
    goal: 'Publicar en #ventas cliente, importe y responsable cuando una oportunidad de más de 10.000 € pasa a ganada, y registrar los fallos como tarea.',
    prerequisites: [
      'Webhook entrante de Slack, Teams o Discord',
      'Permiso de flujos',
    ],
    steps: [
      'Crea el webhook entrante y copia su URL.',
      'Pide el flujo con petición HTTP y «continuar si falla».',
      'Pega la URL real tú en el editor y prueba la petición.',
      'Actívalo.',
    ],
    prompts: [
      'Carga la skill workflow-building de Betty. Cuando una Oportunidad pase a Customer con Importe mayor de 10.000 EUR, busca su empresa y responsable y haz un POST a https://hooks.slack.com/services/EJEMPLO con un JSON cuyo campo text diga «Nuevo cliente: {empresa} por {importe} EUR. Responsable: {responsable}. {enlace}». Activa «continuar si falla» en el paso HTTP y añade un si/entonces que, si la petición no respondió bien, me cree una tarea con el error. Enséñame el diseño; la URL real la pondré yo. No lo actives sin mi OK.',
    ],
    expectedResult: 'El equipo se entera al momento de cada cierre importante.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'http_request no está en el conector, pero la acción HTTP de los flujos sí funciona.',
      'La URL del webhook es un secreto: la ve quien edita flujos.',
      'Las apps de Slack y Teams no están instaladas; esta es la alternativa.',
    ],
  },
  {
    title: 'Propuesta comercial desde el historial real del cliente',
    level: 3,
    category: 'Agente y conectores del chat',
    persona:
      'Socio de una agencia de marketing que prepara tres o cuatro propuestas al mes',
    goal: 'Redactar la propuesta con las notas, los correos y la plantilla de la agencia, enlazarla a la oportunidad y programar el seguimiento.',
    prerequisites: [
      'Conectores de Gmail y Google Drive',
      'Plantilla de propuesta en Drive',
    ],
    steps: [
      'El asistente lee oportunidad, notas, correos y plantilla, y te da un esquema.',
      'Corriges y redacta la propuesta completa.',
      'La subes y le das el enlace; lo guarda, mueve la etapa y crea el seguimiento.',
    ],
    prompts: [
      'Voy a preparar la propuesta para «Campaña de lanzamiento – Bodegas Valdecierzo» en Betty. Lee la oportunidad (importe, contacto, etapa) y sus notas; mis últimos hilos de Gmail con Bodegas Valdecierzo; y en Drive «Plantilla propuesta 2026». Dame primero un esquema: necesidades (indica la fuente de cada una), alcance por fases, calendario y precio orientativo coherente con el importe. No redactes la propuesta hasta que apruebe.',
      'Aprobado con estos cambios: la fase 2 dura 6 semanas y quita influencers. Redacta la propuesta con la estructura y el tono de la plantilla y entrégamela como documento.',
      'Ya la subí; el enlace es <pega el enlace>. En Betty, si no existe, propónme el campo de enlace «Propuesta» en Oportunidades. Guarda el enlace, mueve la oportunidad a Proposal y crea la tarea «Seguimiento propuesta» a 3 días hábiles para mí. Enséñame los cambios antes.',
    ],
    expectedResult:
      'Propuesta personalizada en menos tiempo, enlazada desde la oportunidad, con seguimiento agendado.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail', 'Google Drive'],
    caveats: [
      'Adjuntar archivos a Betty desde el chat no es práctico: guarda el enlace.',
      'El documento lo genera el chat; las skills pdf y docx de Betty no funcionan.',
    ],
  },
  {
    title: 'Relaciones que se enfrían: a quién llevas tiempo sin escribir',
    level: 3,
    category: 'Agente y conectores del chat',
    persona: 'Consultor independiente que vive de recomendaciones',
    goal: 'Detectar contactos clave sin correo reciente, guardar la fecha real en Betty y planificar el reencuentro con un motivo concreto.',
    prerequisites: ['Conector de Betty', 'Conector de Gmail'],
    steps: [
      'El asistente toma tus 25 contactos clave de Betty.',
      'Busca el último correo de cada uno en Gmail.',
      'Guarda la fecha en un campo y propone motivos y tareas repartidas.',
    ],
    prompts: [
      'En Betty busca mis contactos clave: personas de empresas cliente y personas marcadas como aliados (mira qué campos uso para eso). Quédate con los 25 más relevantes y busca en Gmail la fecha del último correo enviado o recibido con cada uno. Dame una tabla con nombre, empresa, fecha y días sin contacto. No cambies nada.',
      'Propón crear en Personas el campo de fecha «Último contacto por email» y, cuando confirme, rellénalo. Para los que llevan más de 45 días, sugiere un motivo para escribir basado en sus notas y crea una tarea «Retomar contacto con <nombre>» por persona, repartidas entre lunes y jueves de las próximas dos semanas. Enséñame la lista antes.',
    ],
    expectedResult:
      'Relaciones en riesgo identificadas y un plan de reactivación en el calendario.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail'],
    caveats: ['La fecha es una foto: repite el análisis cada mes.'],
  },
  {
    title:
      'Betty desde el editor de código: feedback de clientes priorizado por valor',
    level: 3,
    category: 'Agente y conectores del chat',
    persona:
      'Fundadora técnica de una startup B2B que programa en Cursor o VS Code',
    goal: 'Registrar feedback de clientes sin salir del editor y priorizar según cuántas cuentas, y cuánto negocio, hay detrás de cada petición.',
    prerequisites: [
      'Betty conectado al editor desde Ajustes > IA > MCP',
      'Permiso de modelo de datos',
    ],
    steps: [
      'Sigue la tarjeta de tu editor en Ajustes > IA > MCP.',
      'Crea el objeto Feedback y su kanban.',
      'Registra peticiones en una línea.',
      'Antes del sprint, pregunta por valor.',
    ],
    prompts: [
      'Usa el conector de Betty. Carga metadata-building y propón un objeto «Feedback» con título, descripción, empresa (relación), tipo (Error, Mejora, Nueva función), estado (Nuevo, Valorado, Planificado, Hecho), prioridad (1-5) y enlace a la incidencia. Espera mi OK y después crea un kanban por estado.',
      'Registra en Betty: Conservas Bahía Azul pide exportar facturas en CSV desde el panel de clientes; Nueva función, prioridad 3, enlace <incidencia>.',
      'Agrupa el Feedback en Nuevo o Valorado por peticiones similares y dime para cada una cuántas empresas la pidieron y la suma de sus oportunidades ganadas y abiertas, de más a menos valor.',
    ],
    expectedResult:
      'Feedback enlazado a cuentas reales y prioridades basadas en negocio.',
    bettyFeatures: [],
    connectors: ['Betty (MCP) en Cursor, VS Code, Zed, Warp o Gemini CLI'],
    caveats: [
      'Agrupar peticiones similares lo hace el asistente con su criterio: revisa los grupos.',
    ],
  },
  {
    title: 'Habilidad propia: reglas del embudo y de los datos de la casa',
    level: 3,
    category: 'Equipo y gobierno',
    persona:
      'Gerente de una red de clínicas o de una cadena de ópticas con varias personas usando Betty desde el chat',
    goal: 'Que todos los asistentes conectados apliquen las mismas definiciones de etapa, campos obligatorios, formatos y forma de evitar duplicados.',
    prerequisites: ['Permiso de ajustes de IA'],
    steps: [
      'El asistente lee tu modelo real y redacta la skill.',
      'Ajusta el texto y pégalo en Ajustes > IA > Skills > New Skill con una descripción que diga cuándo cargarla.',
      'Pruébalo desde otro chat.',
      'Revísalo cada trimestre.',
    ],
    prompts: [
      'Lee en Betty los campos y las opciones de Personas, Empresas y Oportunidades (incluidas las etapas) y redáctame una skill en Markdown llamada «reglas-de-la-casa» con: 1) definición de cada etapa y su criterio de entrada; 2) datos obligatorios antes de pasar a Propuesta; 3) formato de nombres, teléfonos (+34), ciudades y correos; 4) el procedimiento antes de crear: buscar por correo, luego LinkedIn, luego nombre y apellidos, y por dominio para empresas; 5) prohibido borrar, sobrescribir lo escrito por personas sin preguntar o enviar correos sin aprobación; 6) al marcar Perdido, pedir siempre el motivo. Máximo una página, con nombre corto y una descripción de una línea que diga cuándo cargarla.',
      'Lista las skills de Betty, carga «reglas-de-la-casa» y revisa las personas en Propuesta: dime cuáles incumplen los datos obligatorios, sin cambiar nada.',
    ],
    expectedResult:
      'Una skill común que todos los asistentes cargan y datos creados con el mismo criterio.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'La skill se crea a mano en Ajustes: el asistente redacta, pero no tiene herramienta para guardarla.',
      'Al principio, pide explícitamente que la cargue.',
    ],
  },
  {
    title: 'Conectar al equipo con el mínimo permiso necesario',
    level: 3,
    category: 'Equipo y gobierno',
    persona: 'Responsable de operaciones de una pyme de ocho personas',
    goal: 'Que cada persona use su asistente con Betty, pero sin poder borrar, exportar ni tocar modelo de datos, flujos o ajustes.',
    prerequisites: ['Ser administrador del espacio'],
    steps: [
      'El asistente carga la habilidad roles y te enseña los roles actuales.',
      'Propone el rol nuevo; revisa la protección contra bloqueos.',
      'Crea el rol y lo asigna.',
      'Cada persona conecta su chat con su cuenta y hereda su rol.',
    ],
    prompts: [
      'Carga la habilidad roles de Betty y enséñame los roles y a quién están asignados. Propónme un rol «Equipo comercial – asistente»: puede ver, crear y editar Personas, Empresas, Oportunidades, Tareas y Notas; no puede borrar definitivamente, exportar CSV ni cambiar modelo de datos, flujos, roles o ajustes. Muéstrame la configuración exacta y no apliques nada hasta que confirme.',
      'Confirmado. Crea el rol y asígnaselo a Laura Méndez, Diego Ferrer y Nuria Campos. Después dime qué pasaría si uno le pide a su asistente borrar 50 personas.',
    ],
    expectedResult:
      'Un rol de mínimo privilegio y asistentes que operan dentro de esos límites.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los permisos por fila no están disponibles en la beta.',
      'Revisa también quién puede enviar correos o crear eventos desde herramientas.',
    ],
  },
  {
    title: 'Traspaso de cartera por vacaciones o salida de un comercial',
    level: 3,
    category: 'Equipo y gobierno',
    persona: 'Jefe de equipo cuando alguien se va un mes de baja',
    goal: 'Que ninguna cuenta quede huérfana: resumen de cada cuenta, reparto equilibrado, reasignación y aviso a cada nuevo responsable.',
    prerequisites: [
      'Permiso para editar empresas, oportunidades y tareas',
      'Opcional: Slack o Gmail',
    ],
    steps: [
      'El asistente reúne todo lo asignado y resume cada cuenta.',
      'Propone un reparto según la carga de cada compañero.',
      'Te enseña el recuento exacto y reasigna por grupos filtrando por IDs.',
      'Redacta los mensajes de traspaso.',
    ],
    prompts: [
      'Sergio Llorente se va de baja un mes desde el lunes. En Betty búscame lo que tiene asignado: empresas, oportunidades abiertas y tareas pendientes. Para cada empresa dame un estado de 2 líneas y el siguiente paso. Mira con group_by cuántas oportunidades abiertas tiene cada compañero y propón un reparto equilibrado entre Ana Pujol, Marcos Vidal y Elena Ruiz, explicando el criterio. No cambies nada.',
      'Aplica el reparto con un cambio: Distribuciones Arenal va a Elena. Antes, enséñame para cada responsable cuántos registros vas a reasignar. Cuando diga «ok», reasigna con una actualización por responsable filtrando por esos IDs exactos, y añade en cada empresa la nota «Traspaso temporal desde Sergio». Después redacta un mensaje de traspaso para cada persona y publícalo por mensaje directo en Slack si el conector lo permite; si no, déjamelo para copiar.',
    ],
    expectedResult:
      'Traspaso ordenado en media hora, carga equilibrada y cada persona con contexto.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Slack o Gmail'],
    caveats: [
      'Un filtro demasiado amplio cambia registros que no querías: exige el recuento antes.',
      'Revisa los flujos que avisan al responsable.',
    ],
  },
  {
    title: 'Contratos y renovaciones en calendario',
    level: 3,
    category: 'Por sector',
    persona:
      'Responsable de cuentas en una empresa de mantenimiento de climatización',
    goal: 'Que ninguna renovación pille por sorpresa: verlas en un calendario y en una lista de los próximos 60 días.',
    prerequisites: ['Permiso de modelo de datos'],
    steps: [
      'Crea el objeto Contrato.',
      'Carga los contratos desde tu hoja.',
      'Crea el calendario y la vista de 60 días.',
      'Añade los contratos a la ficha de Empresa con «Editar diseño de la página».',
    ],
    prompts: [
      'En Betty crea el objeto «Contrato» con: empresa (relación, una empresa puede tener varios), importe anual (moneda), fecha de inicio, fecha de renovación, tipo de servicio (Preventivo, Correctivo, Integral) y estado (Vigente, En renovación, Renovado, Cancelado). Enséñame el diseño antes.',
      'Te adjunto contratos.xlsx. Cárgalos vinculando cada contrato a su empresa por nombre o dominio; si una empresa no existe, dímelo en lugar de crearla. Después crea un calendario mensual por fecha de renovación y la vista «Renuevan en 60 días» (próximos 60 días, estado Vigente), ordenada por fecha, en mis favoritos.',
    ],
    expectedResult:
      'Contratos visibles en un calendario y en una lista de próximas renovaciones.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Lectura de archivos del chat'],
    caveats: [
      'El aviso automático por correo se añade con el caso «Renovaciones sin sorpresas».',
    ],
  },
  {
    title: 'Recordatorio de cita 24 horas antes',
    level: 3,
    category: 'Por sector',
    persona:
      'Administradora de una clínica de fisioterapia con muchas ausencias',
    goal: 'Enviar al paciente un recordatorio la víspera a las 10:00, solo si la cita sigue confirmada.',
    prerequisites: ['Buzón conectado', 'Pacientes con correo'],
    steps: [
      'Crea el objeto Cita y su calendario semanal.',
      'Pide el flujo: calcular la víspera a las 10:00 hora de Madrid, esperar y releer.',
      'Prueba con una cita cercana.',
    ],
    prompts: [
      'Carga metadata-building y view-building de Betty. Crea el objeto «Cita» con Paciente (relación con Persona), Fecha y hora, Profesional (texto), Tratamiento (selección) y Estado (Confirmada, Cancelada, Realizada, No asistió), y un calendario semanal por Fecha y hora. Enséñame el diseño.',
      'Con workflow-building: al crear una Cita, un paso de código en TypeScript puro calcula la víspera a las 10:00 de Madrid con el cambio de horario bien resuelto (o ahora mismo si faltan menos de 24 horas); espera hasta ese momento; relee la cita y, si sigue Confirmada y la fecha no cambió, envía al paciente desde el buzón de la clínica la plantilla «Recordatorio de cita» con fecha, hora, profesional y dirección. Enséñame el diseño; no lo actives sin mi OK.',
    ],
    expectedResult:
      'Menos ausencias y ningún recordatorio de citas canceladas.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Betty envía correos, no SMS ni WhatsApp; para eso haría falta una petición HTTP a un proveedor externo.',
    ],
  },
  {
    title: 'Campo calculado: porcentaje de ficha completa',
    level: 4,
    category: 'Orden y datos',
    persona: 'Jefa de ventas de un distribuidor sanitario',
    goal: 'Que cada persona tenga un número de 0 a 100 que diga lo completa que está su ficha, calculado solo.',
    prerequisites: ['Permisos de modelo de datos y flujos'],
    steps: [
      'Crea el campo «Completitud %».',
      'Pide el flujo que vigile solo los campos que cuentan.',
      'Pruébalo editando una ficha.',
      'Crea la vista de fichas por completar y rellena una vez las antiguas.',
    ],
    prompts: [
      'En Betty crea en Personas el campo numérico «Completitud %» sin decimales.',
      'Carga workflow-building y construye «Calcular completitud de ficha»: se dispara al crear una persona o al cambiar solo correos, teléfonos, cargo, empresa, LinkedIn o ciudad (nunca Completitud %, para no entrar en bucle). Un paso de código en TypeScript puro devuelve el porcentaje de esos seis campos rellenos, redondeado, y un paso de actualización lo guarda en la misma persona. Valídalo y enséñamelo antes de activarlo.',
      'Crea la vista «Fichas por completar» con Completitud % menor que 60, de menor a mayor. Después calcula y rellena una vez el campo en las fichas antiguas, en tandas de 20.',
    ],
    expectedResult:
      'Cada ficha muestra su completitud al momento y hay una lista de prioridades.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Si el disparador vigila el propio campo calculado, el flujo entra en bucle.',
    ],
  },
  {
    title: 'Rutina nocturna de higiene con resumen semanal por correo',
    level: 4,
    category: 'Orden y datos',
    persona:
      'Director de una red de franquicias de fisioterapia con altas diarias',
    goal: 'Marcar cada noche las fichas nuevas mal rellenadas y recibir cada lunes un resumen con enlaces para corregirlas.',
    prerequisites: ['Permiso de flujos', 'Buzón conectado'],
    steps: [
      'Crea el campo «Revisar datos».',
      'Flujo nocturno que marca; flujo del lunes que resume y envía.',
      'Revisa los dos antes de activarlos y crea la vista de trabajo.',
    ],
    prompts: [
      'Dime qué cuentas de correo tengo conectadas en Betty y su identificador.',
      'Carga workflow-building. Crea en Personas el campo sí/no «Revisar datos». Construye dos flujos (horas en UTC): 1) «Higiene nocturna», cada día a las 01:00 UTC: busca personas creadas en las últimas 24 horas sin correo, teléfono o empresa y marca Revisar datos = sí. 2) «Resumen de higiene», los lunes a las 07:00 UTC con cron personalizado: busca las marcadas (hasta 200); si no hay, termina; si hay, un paso de código arma un HTML con nombre, qué falta y enlace, y lo envía desde mi cuenta conectada a direccion@fisio-ejemplo.es. Enséñamelos antes de activar.',
      'Crea la vista «Revisar datos» y explícame cómo desmarcar una ficha corregida.',
    ],
    expectedResult:
      'Fichas incompletas marcadas cada noche y un resumen semanal con enlaces.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los flujos programados no siguen el cambio de hora.',
      'Con más de 200 altas incompletas por noche, programa la búsqueda cada pocas horas.',
    ],
  },
  {
    title:
      'Seguimiento de propuestas que espera y, si no hay respuesta, deja un borrador',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Socia de un despacho de arquitectura o comercial de climatización que envía 15-20 propuestas al mes',
    goal: 'Que ninguna propuesta se enfríe: si en unos días la oportunidad no avanza, Betty deja un borrador personalizado en tu buzón y una tarea de llamada, sin enviar nada sin tu revisión.',
    prerequisites: [
      'Buzón IMAP/SMTP conectado',
      'Oportunidades con contacto principal y correo',
    ],
    steps: [
      'El asistente busca tu buzón conectado y diseña el flujo.',
      'Para probar, pide una copia con un plazo de 5 minutos y una oportunidad de prueba con tu correo.',
      'Vuelve pasados 6 minutos y pide que revise la ejecución; luego limpia la prueba.',
      'Activa la versión real con 4 días. Variante: el mismo patrón sirve tras una demo.',
    ],
    prompts: [
      'En Betty Dime qué buzones tengo conectados. Carga workflow-building y diseña «Seguimiento de propuesta»: se dispara cuando una oportunidad cambia de etapa a Proposal; guarda la fecha de hoy en «Fecha de propuesta» (créalo si no existe, tras enseñármelo); crea una tarea «Confirmar recepción» a 2 días; espera hasta 4 días a que esa misma oportunidad cambie de etapa; si cambia, termina; si se agota el plazo, busca el contacto principal y crea un BORRADOR (no un envío) desde mi buzón con el asunto «¿Pudiste revisar la propuesta?» y un cuerpo breve que use su nombre y el de la oportunidad, y crea la tarea «Llamar a <contacto> por la propuesta» para el responsable con vencimiento al día siguiente. Enséñame el diseño, valídalo y no lo actives hasta que escriba «activar».',
      'Crea una copia «Seguimiento de propuesta – PRUEBA» con un plazo de 5 minutos y una oportunidad «Prueba seguimiento» con contacto Pablo Prueba (con mi correo). Cuando diga «ok», activa la copia y mueve la oportunidad a Proposal. Dime a qué hora debo volver.',
      'Revisa la ejecución de la PRUEBA en su historial de ejecuciones y dime si se crearon el borrador y la tarea. Después propón la limpieza (desactivar la copia y borrar los registros de prueba) y hazla solo cuando la confirme.',
    ],
    expectedResult:
      'Cada propuesta con confirmación de recepción y, si se enfría, un borrador y una llamada agendada.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Gmail y Outlook con OAuth no están disponibles: conecta por IMAP/SMTP (en Gmail, contraseña de aplicación).',
      'Las ejecuciones en espera cuentan como activas.',
      'Comprueba que la carpeta Borradores de tu proveedor se sincroniza.',
    ],
  },
  {
    title: 'Reparto de leads entre comerciales',
    level: 4,
    category: 'Embudo y ventas',
    persona: 'Jefa de ventas de un concesionario con tres vendedores',
    goal: 'Repartir los leads de la web al instante, por turnos o por carga, con tarea y aviso al vendedor.',
    prerequisites: [
      'Vendedores como miembros del espacio',
      'Relación «Vendedor asignado» de Persona a Miembro del espacio',
      'Buzón conectado',
    ],
    steps: [
      'Crea el campo de relación.',
      'Construye el flujo eligiendo turnos (ROUND_ROBIN) o carga (LOAD_BALANCED).',
      'Prueba con dos o tres personas de origen Web.',
    ],
    prompts: [
      'Betty: carga metadata-building y crea en Personas una relación «Vendedor asignado» hacia Miembros del espacio; enséñame el plan antes. Después lista los miembros con su id.',
      'Betty: carga workflow-building y crea «Reparto de leads web»: cuando se crea una Persona con Origen «Web», elige un vendedor entre Javier Ruiz, Carmen Lago y Pablo Soria con LOAD_BALANCED contando las Personas por «Vendedor asignado» (o ROUND_ROBIN si te lo pido). Asigna el vendedor, crea para él la tarea «Llamar al lead en 1 h» y envíale desde mi buzón, con copia a mí, nombre, teléfono, «Modelo de interés» y enlace a la ficha. Explícame qué cuenta exactamente LOAD_BALANCED y espera mi confirmación.',
    ],
    expectedResult: 'Cada lead asignado al momento con tarea y aviso.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'La lista de vendedores es fija: edítala cuando cambie el equipo.',
      'LOAD_BALANCED cuenta todas las personas asignadas, no solo las abiertas.',
      'Si el lead entra por el webhook del formulario, añade estos pasos al final de ese flujo.',
    ],
  },
  {
    title: 'Puntuación automática de leads con reglas',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Responsable de crecimiento de un SaaS que recibe 150 leads al mes',
    goal: 'Que cada lead tenga una puntuación y una temperatura que se recalculan solas, y avisar cuando uno se calienta.',
    prerequisites: [
      'Campos de cargo, origen, tamaño de empresa y demo',
      'Permiso de flujos',
    ],
    steps: [
      'Define las reglas en una tabla con el asistente.',
      'Crea los campos y el flujo, vigilando solo los campos de entrada.',
      'Revisa el código con 5 casos de prueba.',
      'Crea un kanban por temperatura.',
    ],
    prompts: [
      'Propón un lead scoring de 0 a 100 para un software de facturación: cargo (CEO/CFO/Finanzas +25, administrativo +10), tamaño (más de 50 empleados +20, 10-50 +10), origen (Referido +20, Webinar +10, Web +5), pidió demo (+25) y país objetivo (+10). Temperatura: 70+ Caliente, 40-69 Templado, menos de 40 Frío. Solo la tabla.',
      'Con esas reglas, carga metadata-building y workflow-building. Propón en Personas «Puntuación» (número) y «Temperatura» (selección) y espera mi OK. Después diseña un flujo que se dispare al crear o actualizar una persona vigilando solo Cargo, Origen, Pidió demo, País y empresa (nunca Puntuación ni Temperatura): un paso de código en TypeScript puro calcula ambas; se actualiza la persona; y solo si pasa a Caliente desde otra temperatura, se crea la tarea «Contactar hoy» y se avisa al responsable desde mi buzón. Enséñame el código con 5 casos de prueba antes de crear nada.',
      'Crea un kanban de Personas por Temperatura con recuento y dime cuántos calientes hay sin tarea abierta.',
    ],
    expectedResult:
      'Leads puntuados y clasificados, con la fórmula transparente y ajustable.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Los pasos de IA no funcionan en la beta: la puntuación es por reglas.',
      'Evita recalcular miles de leads de golpe: el código corre con 10 ejecuciones simultáneas.',
    ],
  },
  {
    title: 'Alertas de oportunidades estancadas con escalado',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Directora comercial de una distribuidora industrial con seis comerciales',
    goal: 'Recibir la lista de oportunidades que no cambian de etapa desde hace 7 días o más, por responsable, con copia a dirección a partir de 14 días.',
    prerequisites: [
      'Campo «Fecha de entrada en etapa» en Oportunidades',
      'Buzón conectado',
    ],
    steps: [
      'Crea el flujo que guarda la fecha de entrada en etapa.',
      'Rellena una vez esa fecha en las oportunidades antiguas.',
      'Crea el resumen programado (hora UTC).',
      'Los viernes, complementa con deal-review.',
    ],
    prompts: [
      'Carga workflow-building de Betty. Crea dos flujos. 1) «Marca de entrada en etapa»: cuando una Oportunidad cambia de etapa, guarda la fecha actual en «Fecha de entrada en etapa» (créalo si no existe, tras enseñármelo). 2) «Oportunidades estancadas»: cron personalizado de lunes a viernes a las 07:00 UTC; un paso de código calcula las fechas de hace 7 y 14 días; busca oportunidades no ganadas ni perdidas con fecha de entrada en etapa anterior a hace 7 días; si no hay, termina; si hay, otro paso de código las agrupa por responsable; recorre los responsables y envía a cada uno desde mi buzón una tabla HTML (oportunidad, empresa, etapa, días parada, importe, enlace), con copia a direccion@suministrosdelta.example si alguna supera 14 días. Enséñamelos antes de activar.',
      'Para las oportunidades abiertas con «Fecha de entrada en etapa» vacía, rellénala con su fecha de última actualización. Dime cuántas tocarás y enséñame cinco ejemplos antes.',
    ],
    expectedResult:
      'Ningún negocio dormido sin que alguien se entere, con escalado automático.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'No uses «última actualización» para medir estancamiento: cambia con cualquier edición.',
      'Más de 200 oportunidades: divide la búsqueda.',
    ],
  },
  {
    title: 'Reactivación mensual de oportunidades perdidas',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Responsable de ventas de un software de reservas para restaurantes',
    goal: 'Recontactar en la fecha prevista a quienes se perdieron por plazo o por «no era el momento», con un mensaje adaptado al motivo.',
    prerequisites: [
      'Caso «Motivos de pérdida» implantado',
      'Opcional: Gmail o buzón conectado',
    ],
    steps: [
      'Construye el flujo mensual (hora UTC).',
      'El día 1 crea las tareas de reactivación.',
      'Con el segundo prompt el asistente redacta mensajes según el motivo.',
    ],
    prompts: [
      'Betty: carga workflow-building y crea «Reactivación mensual», cron personalizado el día 1 de cada mes a las 08:00 UTC: busca oportunidades en Perdida cuyo motivo no sea «Eligió competidor» y cuya fecha de recontacto caiga en los próximos 30 días; para cada una crea la tarea «Reactivar: [nombre]» para su responsable y pon «Estado de reactivación» en Pendiente (crea ese campo con Pendiente, Contactado, Reabierta, Descartada, tras enseñármelo). Espera mi confirmación.',
      'Betty: busca las oportunidades con reactivación Pendiente. Para cada una lee motivo, notas y empresa y redacta un correo corto distinto según el motivo (precio: novedades de planes; plazo: «¿es buen momento ahora?»; sin respuesta: muy breve). Enséñamelos y déjalos como borradores en mi Gmail. Pon Contactado solo cuando confirme que los envié.',
    ],
    expectedResult:
      'Una cartera perdida que se revisa sola cada mes con mensajes adaptados.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Gmail (opcional)'],
    caveats: [
      'Comprueba antes que el contacto no pidió dejar de recibir comunicaciones.',
    ],
  },
  {
    title: 'Programa de referidos con agradecimiento automático',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Dueño de una instaladora de climatización que vive del boca a boca',
    goal: 'Saber qué clientes traen clientes, agradecerlo al momento cuando el referido compra y ver el ranking de embajadores.',
    prerequisites: ['Buzón conectado', 'Oportunidades con contacto principal'],
    steps: [
      'Crea la relación «Referido por» y el contador.',
      'Indica quién recomendó a cada lead nuevo.',
      'Construye el flujo de agradecimiento.',
      'Consulta el ranking.',
    ],
    prompts: [
      'Betty: carga metadata-building. En Personas crea la relación «Referido por» hacia otra Persona (inversa «Ha referido a») y el número «Referidos ganados» con valor inicial 0. Si una relación de Personas consigo misma no está permitida, dímelo y propón una alternativa.',
      'Betty: carga workflow-building y crea «Gracias por recomendarnos»: cuando una Oportunidad pasa a Customer, busca su contacto principal; si tiene «Referido por», suma 1 a «Referidos ganados» del referidor, envíale desde mi buzón un agradecimiento cercano que mencione a quien recomendó y créame la tarea «Enviar regalo de agradecimiento». Espera mi confirmación.',
      'Betty: dame los 10 clientes con más referidos ganados y el importe ganado de las personas que refirieron.',
    ],
    expectedResult:
      'Cada recomendación que compra genera agradecimiento, recordatorio de regalo y suma en el ranking.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Comprueba primero que la relación Persona a Persona funciona en tu espacio.',
    ],
  },
  {
    title: 'Previsión semanal automática por correo',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Gerente de una pyme que quiere la previsión en su correo cada lunes',
    goal: 'Recibir cada lunes la previsión bruta y ponderada del mes y del siguiente, los negocios grandes y las fechas vencidas.',
    prerequisites: [
      'Oportunidades con importe, etapa y fecha de cierre',
      'Buzón conectado',
    ],
    steps: [
      'Acordad la probabilidad por etapa.',
      'Construye el flujo (hora UTC) y revisa el código.',
      'Antes de activar, pide la misma previsión calculada desde el chat para comparar.',
    ],
    prompts: [
      'Betty: carga workflow-building y crea «Previsión del lunes», cron personalizado los lunes a las 06:30 UTC. Un paso de código calcula hoy y el último día del mes que viene; busca oportunidades abiertas con cierre entre esas fechas; otro paso de código en TypeScript puro aplica New 10 %, Screening 20 %, Meeting 40 %, Proposal 60 %, calcula bruto y ponderado de este mes y del siguiente, las 5 mayores y las de fecha vencida, y devuelve un HTML. Envíamelo desde mi buzón con el asunto «Previsión semanal». Enséñame el código y el flujo, valídalo y espera mi confirmación.',
      'Antes de activarlo, calcula tú ahora la misma previsión con los datos actuales para comparar.',
    ],
    expectedResult:
      'Un correo semanal con la previsión y las fechas que conviene corregir.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Más de 200 oportunidades en el periodo: divide por responsable.',
      'Las probabilidades viven en el código; para editarlas sin tocar el flujo, usa un campo Probabilidad.',
    ],
  },
  {
    title: 'Cierre ganado: traspaso a operaciones y bienvenida al cliente',
    level: 4,
    category: 'Embudo y ventas',
    persona:
      'Directora de una agencia que debe arrancar el proyecto en 48 horas tras la firma',
    goal: 'Al ganar un negocio, la empresa pasa a cliente, se crea el proyecto con sus tareas fechadas, el cliente recibe la bienvenida y a los 30 días se programa la revisión.',
    prerequisites: [
      'Campo «Tipo de cuenta» en Empresas',
      'Plantilla «Bienvenida cliente»',
      'Buzón conectado',
    ],
    steps: [
      'Si hace falta, crea un objeto Proyecto relacionado con Empresa.',
      'Pide el flujo y revisa tareas y plazos.',
      'Prueba con una oportunidad ficticia y bórrala.',
      'En el día a día, el asistente puede mover la oportunidad a Customer y preparar la agenda de arranque.',
    ],
    prompts: [
      'Carga metadata-building y workflow-building de Betty. Si no existe, propón un objeto «Proyecto» (nombre, empresa, fecha de inicio, estado Onboarding/Activo/Pausado/Cerrado, responsable). Después diseña «Cierre ganado»: cuando una Oportunidad pasa a Customer, pon la empresa en Tipo de cuenta = Cliente; crea el Proyecto «Onboarding {empresa}»; crea 4 tareas para el responsable con fechas calculadas en código: «Kickoff» (+2 días), «Pedir accesos» (+3), «Plan de 90 días» (+7) y «Revisión del primer mes» (+30); envía desde mi buzón al contacto principal la plantilla «Bienvenida cliente» con sus variables rellenadas; y si el contacto no tiene correo, crea la tarea «Falta contacto». Enséñame todo y no actives sin mi OK.',
      'Acabo de cerrar con Talleres Ribera Alta. Mueve su oportunidad a Customer. Después redacta una agenda de 45 minutos para la reunión de arranque con las notas de la oportunidad y propónme un evento en Google Calendar el próximo martes a las 10:00 con el contacto principal. No envíes la invitación sin mi OK.',
    ],
    expectedResult: 'Cada trato ganado arranca igual y sin olvidos.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Calendar (opcional)'],
    caveats: [
      'Si la oportunidad vuelve atrás y se gana otra vez, el flujo se repite: añade un filtro si la empresa ya era Cliente.',
    ],
  },
  {
    title:
      'Motor de envíos programados: una cola de comunicaciones que sale sola',
    level: 4,
    category: 'Comunicaciones y correo',
    persona:
      'Fundador de una comunidad profesional que programa avisos y recordatorios a socios',
    goal: 'Que programar un correo sea crear un registro «Comunicación», y que un único flujo envíe cada 15 minutos lo que toca, rellene variables y marque Enviada o Error. Es la arquitectura del espacio del fundador.',
    prerequisites: ['Objeto Plantilla', 'Buzón conectado'],
    steps: [
      'Crea el objeto Comunicación.',
      'Pide el flujo cada 15 minutos con validación de variables.',
      'Crea el calendario y el panel de envíos.',
      'Prueba con dos comunicaciones a tu correo para dentro de 20 minutos.',
    ],
    prompts: [
      'Carga metadata-building y workflow-building de Betty. 1) Crea el objeto «Comunicación» con Persona (relación), Plantilla (relación con mi objeto Plantilla), Fecha de envío (fecha-hora), Estado (Borrador, Programada, Enviada, Error), Enviada el (fecha-hora) y Detalle (texto). 2) Crea un flujo cada 15 minutos: busca Comunicaciones Programadas con fecha de envío anterior o igual a ahora, ordenadas, máximo 50; para cada una lee Plantilla y Persona; un paso de código en TypeScript puro sustituye {nombre}, {empresa} y las demás variables del asunto y el cuerpo y avisa si falta alguna; si falta, marca Error con el detalle; si no, envía desde mi buzón y marca Enviada con la hora. Enséñame el diseño y el código; no actives sin mi confirmación.',
      'Crea el panel «Envíos»: enviadas por semana (línea), estado actual (circular), errores en 7 días (KPI) y una tabla con las próximas 20 programadas. Y un calendario de Comunicaciones por fecha de envío.',
    ],
    expectedResult:
      'Una infraestructura de envíos propia, trazada registro a registro.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Un paso de código por correo con 10 simultáneos: lotes de decenas, no de miles.',
      'Freno de 100 ejecuciones por minuto y 5.000 por hora, más el límite diario de tu proveedor SMTP. No es un canal de marketing masivo.',
      'Las campañas nativas existen pero están desactivadas en la beta.',
    ],
  },
  {
    title: 'Carta mensual a inversores con datos del CRM',
    level: 4,
    category: 'Comunicaciones y correo',
    persona: 'Fundador de una startup seed con nueve inversores',
    goal: 'Redactar la carta con cifras de Betty y de la hoja de métricas, personalizarla por inversor y registrar cada envío.',
    prerequisites: [
      'Conectores de Google Drive y Gmail',
      'Inversores marcados en Betty',
    ],
    steps: [
      'El asistente calcula los indicadores en Betty y lee la hoja de métricas.',
      'Recoge compromisos pendientes de Gmail.',
      'Redacta la carta y una versión por inversor como borrador.',
      'Registra cada envío en Betty como Borrador o nota.',
    ],
    prompts: [
      'Prepara la carta a inversores de octubre. De Betty, con group_by: nuevos leads por origen, oportunidades ganadas e importe, y pipeline abierto por etapa, frente a septiembre. De Drive: «Métricas mensuales 2026», pestaña octubre. De Gmail: los hilos del mes con las personas marcadas como inversores en Betty, para recoger lo que prometí o me preguntaron. Estructura: 3 titulares, métricas en tabla, lo que fue bien, lo que no, prioridades de noviembre y dos peticiones de ayuda. Indica la fuente de cada cifra. Enséñamela antes.',
      'Personalízala: añade al inicio de cada versión una línea según las notas del inversor y crea un borrador en Gmail por inversor. Registra en Betty cada envío: si existe mi objeto Comunicación, un registro por inversor con estado Borrador; si no, una nota en su ficha. Enséñame la lista antes.',
    ],
    expectedResult:
      'Carta sólida en una sesión, versiones personalizadas y trazabilidad en Betty.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Drive', 'Gmail'],
    caveats: [
      'Si tus flujos envían al crear comunicaciones Programadas, crea los registros como Borrador.',
    ],
  },
  {
    title: 'Informe semanal por cliente combinando Betty, Slack y Notion',
    level: 4,
    category: 'Agente y conectores del chat',
    persona:
      'Directora de cuentas de un estudio creativo con siete clientes activos',
    goal: 'Que cada cliente reciba los viernes un informe de avances, próximos pasos y lo que necesitamos de él, construido con lo que pasó de verdad.',
    prerequisites: [
      'Conectores de Slack, Notion y Gmail',
      'Objeto Proyecto enlazado a Empresas',
    ],
    steps: [
      'Si no tienes objeto Proyecto, pide al asistente que lo cree.',
      'Cada viernes pega el prompt para un cliente.',
      'El asistente cruza Betty, Slack y Notion y señala contradicciones.',
      'Deja el borrador en Gmail, guarda copia en Betty y cierra tareas confirmadas.',
    ],
    prompts: [
      'Prepara el informe semanal para Cervecera Montes Claros. Fuentes: en Betty, el proyecto activo, las tareas completadas en 7 días, las pendientes con fecha y las notas de la semana; en Slack, los mensajes de 7 días de #cliente-montes-claros; en Notion, la página «Entregables – Montes Claros». Tres bloques (hecho, la semana que viene, lo que necesitamos de vosotros), tono cercano y profesional, menos de 250 palabras. Señala contradicciones entre fuentes. Enséñamelo antes.',
      'Déjalo como borrador en Gmail para el contacto principal de la empresa en Betty, con el asunto «Informe semanal – <fecha>». Guárdalo también como nota en la empresa y cierra en Betty las tareas que Slack confirma como entregadas, enseñándome antes cuáles.',
    ],
    expectedResult:
      'Un informe por cliente en minutos, coherente entre herramientas y con histórico en Betty.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Slack', 'Notion', 'Gmail'],
    caveats: [
      'Haz uno o dos clientes por conversación; las tandas largas pierden calidad.',
      'Comprueba que el canal no tiene información de otros clientes.',
    ],
  },
  {
    title: 'Espacio de demostración por sector para formar o vender',
    level: 4,
    category: 'Equipo y gobierno',
    persona: 'Consultor que implanta Betty en clínicas dentales',
    goal: 'Montar en minutos un espacio de prueba con datos realistas de un sector sin tocar el espacio real.',
    prerequisites: [
      'Un espacio de pruebas distinto del de trabajo',
      'Conector apuntando a ese espacio',
    ],
    steps: [
      'Conecta el chat a la dirección del espacio de pruebas.',
      'El asistente confirma el nombre del espacio y presenta el plan.',
      'Aprueba y deja que cree objetos, registros y vistas.',
      'Usa el espacio para practicar el resto de casos.',
    ],
    prompts: [
      'Estoy conectado a mi espacio de PRUEBAS de Betty, no al de trabajo. Confírmame el nombre del espacio antes de seguir. Carga la habilidad workspace-demo-seeding y preséntame un plan para una demo de clínica dental de tres sillones: cómo usarías Personas, Empresas y Oportunidades, qué dos o tres objetos propios añadirías, qué campos, relaciones, registros de ejemplo y vistas. No ejecutes nada hasta que diga «adelante».',
    ],
    expectedResult:
      'Un espacio de demo creíble con objetos propios, datos y vistas.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Esta habilidad archiva los objetos personalizados existentes: nunca en el espacio de trabajo.',
    ],
  },
  {
    title:
      'Tu CRM inmobiliario: inmuebles, visitas y emparejamiento con compradores',
    level: 4,
    category: 'Por sector',
    persona:
      'Agente de una inmobiliaria de costa con 40 inmuebles y 120 compradores',
    goal: 'Modelar inmuebles, visitas y lo que busca cada comprador, registrar a diario las visitas de la agenda y proponer a cada comprador lo que encaja.',
    prerequisites: [
      'Permiso de modelo de datos',
      'Conectores de Google Calendar y Gmail',
    ],
    steps: [
      'Primera sesión: el asistente propone el modelo con metadata-building; confirmas y crea objetos, campos, relaciones y vistas.',
      'Cada mañana: registra las visitas del día desde Calendar.',
      'Tras las visitas: le dictas cómo fueron.',
      'Emparejamiento: cruza presupuesto, zona y habitaciones y deja borradores en Gmail.',
    ],
    prompts: [
      'Carga metadata-building de Betty. Quiero un CRM inmobiliario sin tocar lo que ya tengo. Propón: «Inmueble» (referencia, dirección, tipo, operación venta o alquiler, precio, metros, habitaciones, zona como selección Centro, Playa, Casco antiguo, Urbanizaciones, estado Captado, Publicado, Reservado, Vendido/Alquilado, Retirado, y propietario como relación con Personas); «Visita» (fecha y hora, inmueble, comprador como relación con Personas, valoración 1-5, comentarios); y en Personas «Presupuesto máximo» (moneda), «Zonas deseadas» (selección múltiple) y «Habitaciones mínimas». Enséñame el plan y espera mi «adelante». Después crea un kanban de Inmuebles por estado con la suma de precio y un calendario mensual de Visitas, y tres inmuebles y dos visitas de ejemplo.',
      'Lee mis eventos de hoy en Google Calendar que empiecen por «Visita». Identifica el inmueble por la referencia del título y el comprador por el invitado, y crea cada Visita enlazada. Si el comprador no existe, propón el alta. Enséñame la lista antes.',
      'Para cada comprador con alguna visita en 30 días, busca Inmuebles Publicados dentro de su presupuesto, en sus zonas, con al menos sus habitaciones y que aún no haya visitado. Dame la tabla comprador -> inmuebles y deja en Gmail un borrador para los 3 compradores con mejores opciones.',
    ],
    expectedResult:
      'Un CRM inmobiliario en una tarde, con la agenda reflejada cada día y selecciones personalizadas listas.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Calendar', 'Gmail'],
    caveats: [
      'No uses workspace-demo-seeding en el espacio real.',
      'Las fotos se suben desde la interfaz; desde el chat, guarda enlaces.',
    ],
  },
  {
    title:
      'Pipeline de selección: de los CV en Drive a candidaturas con consentimiento',
    level: 4,
    category: 'Por sector',
    persona: 'Reclutadora de una agencia con seis vacantes a la vez',
    goal: 'Tener candidaturas por vacante, darlas de alta desde CV con un resumen objetivo y no olvidar el consentimiento y la retención.',
    prerequisites: [
      'Permisos de modelo de datos y flujos',
      'Conectores de Google Drive y Calendar',
    ],
    steps: [
      'Crea los objetos Vacante y Candidatura y un kanban por etapa.',
      'Da de alta desde la carpeta de CV.',
      'Tras cada entrevista, dicta impresiones.',
      'Pide el flujo mensual de consentimiento vencido.',
    ],
    prompts: [
      'Carga metadata-building en Betty y propón «Vacante» (puesto, empresa cliente, estado Abierta/En pausa/Cerrada, fecha límite) y «Candidatura» (persona, vacante, etapa Recibida, Preselección, Entrevista, Finalista, Oferta, Descartada, puntuación 1-5, enlace al CV, origen y «Consentimiento hasta»). Espera mi OK y crea un kanban de Candidaturas por etapa.',
      'Lee en Drive los CV de «Vacante – Responsable de almacén – Transportes Moncayo». Extrae solo datos profesionales: nombre, correo, teléfono, último puesto, años de experiencia y competencias. Nada de edad, foto, estado civil ni salud. Propón el alta: persona, candidatura en Recibida, enlace al CV, «Consentimiento hasta» a 12 meses y una nota de 5 líneas. Enséñame la tabla antes.',
      'Carga workflow-building y diseña un flujo el día 1 de cada mes a las 07:00 UTC: busca Candidaturas con «Consentimiento hasta» vencido y crea para cada una la tarea «Renovar consentimiento o anonimizar» para mí. Valídalo y no lo actives hasta que diga «activar».',
    ],
    expectedResult:
      'Selección visual por vacante, altas rápidas y cumplimiento automático.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Drive', 'Google Calendar'],
    caveats: [
      'Valora solo con criterios del puesto; la puntuación final la pones tú.',
    ],
  },
  {
    title: 'Renovaciones sin sorpresas: avisos a 60, 30 y 7 días',
    level: 4,
    category: 'Por sector',
    persona: 'Corredor de seguros con 300 pólizas',
    goal: 'Avisar al responsable y al cliente a 60, 30 y 7 días, con un correo distinto por tramo y sin repetir avisos.',
    prerequisites: [
      'Pólizas importadas',
      'Tres plantillas de renovación',
      'Buzón conectado',
    ],
    steps: [
      'Crea el objeto Póliza con «Último aviso».',
      'Pide el flujo diario que solo actúa cuando cambia el tramo.',
      'Crea el panel de primas en juego.',
    ],
    prompts: [
      'Carga metadata-building, workflow-building y dashboard-building de Betty. 1) Crea «Póliza» con Cliente (Persona), Empresa, Aseguradora, Prima anual (moneda), Fecha de renovación, Responsable (miembro) y Último aviso (Ninguno, 60, 30, 7). 2) Flujo diario a las 06:30 UTC: busca pólizas con renovación en los próximos 60 días; un paso de código calcula días y tramo y devuelve solo las que pasan a un tramo más urgente que su Último aviso; para cada una crea la tarea «Renovación {aseguradora} de {cliente} en {n} días», envía al cliente la plantilla del tramo desde mi buzón y actualiza Último aviso. 3) Panel con renovaciones por mes y prima en juego en 90 días. Enséñame los diseños y no actives sin mi OK.',
    ],
    expectedResult:
      'Ninguna renovación perdida por olvido, tres avisos como máximo por cliente.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Máximo 200 por búsqueda: divide por responsable si hace falta.',
      'Pon el código fuera del iterador.',
    ],
  },
  {
    title: 'Calendario editorial con revisión, aprobación y aviso del día',
    level: 4,
    category: 'Por sector',
    persona:
      'Community manager de una agencia de turismo rural con una revisora',
    goal: 'Gestionar publicaciones de redes y blog con calendario, avisos de revisión y aprobación y un correo diario con lo que toca. Es el patrón del objeto Publicación del fundador.',
    prerequisites: ['Autora y revisora como miembros', 'Buzón conectado'],
    steps: [
      'Crea el objeto Publicación con calendario y kanban.',
      'Pide los tres flujos.',
      'Opcional: el chat redacta la semana con tu skill de tono.',
    ],
    prompts: [
      'Carga metadata-building y view-building de Betty. Crea «Publicación» con Título, Canal (Instagram, LinkedIn, Blog, Newsletter), Texto (enriquecido), Fecha de publicación, Estado (Idea, Borrador, En revisión, Cambios pedidos, Aprobada, Publicada), Autora y Revisora (miembros) y Enlace final. Crea un calendario mensual y un kanban por Estado. Enséñame el diseño.',
      'Con workflow-building crea y enséñame antes de activar: 1) al pasar a «En revisión», correo a la Revisora con título, canal, fecha, texto y enlace; 2) al pasar a «Aprobada» o «Cambios pedidos», aviso a la Autora; 3) cada día a las 07:30 UTC, resumen de las Aprobadas con fecha de hoy.',
      'Carga mi skill de tono y redacta 5 publicaciones de Instagram sobre rutas de otoño; créalas como Borrador, una por día laborable a las 12:00.',
    ],
    expectedResult:
      'Nada se publica sin revisión y el día empieza con la lista exacta.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Betty no publica en redes; haría falta una petición HTTP a una herramienta externa.',
    ],
  },
  {
    title: 'Migración completa desde hojas de cálculo con sus relaciones',
    level: 5,
    category: 'Orden y datos',
    persona: 'Gerente de una empresa de reformas con tres hojas separadas',
    goal: 'Pasar empresas, contactos y presupuestos sin perder vínculos, con un informe de conciliación que demuestre que no se perdió nada.',
    prerequisites: [
      'Permisos de modelo de datos, vistas y diseño',
      'Los tres archivos',
    ],
    steps: [
      'El asistente analiza columnas, claves y calidad sin tocar Betty.',
      'Acordáis el modelo, campos nuevos y traducción de etapas.',
      'Carga en orden: empresas, personas, oportunidades (20 por llamada) o prepara CSV si son más de 500 filas.',
      'Concilia y crea kanban y panel.',
    ],
    prompts: [
      'Te adjunto empresas.xlsx, contactos.xlsx y presupuestos.xlsx. Analízalos sin tocar Betty: columnas, cómo se relacionan, duplicados internos, vacíos y valores distintos del estado de los presupuestos. Propón el mapeo a Empresas, Personas y Oportunidades, los campos nuevos y una tabla para traducir los estados a etapas de oportunidad.',
      'Adelante. Crea los campos en una llamada por objeto. Carga en lotes de 20: empresas con upsert por dominio (sin dominio, busca antes por nombre exacto); personas con upsert por correo, vinculadas; oportunidades vinculadas a empresa y contacto, con importe en euros, fecha prevista y etapa traducida. Guarda aparte las filas que no puedas vincular, sin inventar. Si son más de 500 filas en total, para y prepárame CSV limpios para el importador.',
      'Concilia: por archivo, filas de origen, creados, actualizados y no vinculados, comprobado con agrupaciones. Después carga dashboard-building y crea «Cartera de obras» (importe por etapa, oportunidades por tipo de obra, valor abierto) y un kanban de Oportunidades con suma de importe.',
    ],
    expectedResult:
      'Un CRM relacionado, un informe de conciliación, una lista corta de casos a mano, kanban y panel.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Lectura de archivos del chat'],
    caveats: [
      'El nombre de empresa no es único: busca antes de crear.',
      'Con archivos grandes o sucios, ensaya primero en un espacio de pruebas.',
    ],
  },
  {
    title: 'Embudo completo de la web: de la visita al cliente',
    level: 5,
    category: 'Embudo y ventas',
    persona: 'Gerente de una clínica dental con 150 solicitudes al mes',
    goal: 'Un sistema auditable: entrada validada y sin duplicados, reparto a la recepcionista con menos carga, bienvenida, segundo contacto automático si no avanza y panel de control.',
    prerequisites: [
      'Diseño del embudo implantado',
      'Buzón conectado',
      'Recepcionistas como miembros',
      'Formulario que envíe el webhook desde el servidor',
    ],
    steps: [
      'Pide un plan completo y apruébalo.',
      'Construye el flujo principal.',
      'Prueba: lead nuevo, repetido, secreto incorrecto y uno que no avanza (con espera corta).',
      'Ajusta la espera a 3 días y activa.',
      'Crea el panel y revisa los fallos cada semana.',
    ],
    prompts: [
      'Betty: quiero el embudo completo de la clínica. Lista mis objetos, los campos de Personas y los flujos activos, y propón un plan: campos que faltan, flujo nuevo o existente a ampliar, cómo validar el webhook, cómo evitar duplicados y cómo repartir entre Nuria Gil, Ana Ferro y Celia Prado. No construyas nada.',
      'Betty: carga workflow-building y construye «Embudo web clínica»: webhook POST con nombre, apellidos, email, telefono, tratamiento, mensaje, utm_source, utm_campaign y secreto; filtro de secreto «SN-2026-cambia-esto»; código en TypeScript puro para normalizar; busca la persona por email; si existe, nota «Nueva solicitud» y fin; si es nueva, elige recepcionista con LOAD_BALANCED por «Responsable de recepción», crea la persona en Nuevo, la tarea «Llamar en 2 h», envía desde el buzón una bienvenida con un párrafo según el tratamiento, espera hasta 3 días a que cambie su etapa y, si no cambia, deja un borrador de segundo contacto y la tarea «Segundo intento». Enséñamelo con la URL, valídalo y no lo actives.',
      'Betty: carga dashboard-building y crea «Embudo clínica»: personas por etapa, solicitudes por semana en 90 días, personas por origen, personas por recepcionista y etapa, y una tabla de leads de hoy.',
      'Betty: revisa las ejecuciones de «Embudo web clínica» de los últimos 7 días: cuántas bien, cuántas fallaron, en qué paso y por qué, y propón la corrección sin aplicarla.',
    ],
    expectedResult:
      'Un embudo de punta a punta que funciona solo y se gestiona desde un panel.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El webhook no tiene autenticación: el secreto se envía desde el servidor, nunca desde la web visible.',
      'Datos de salud: guarda solo el tratamiento de interés y revisa el consentimiento del formulario.',
    ],
  },
  {
    title: 'Ferias y eventos de principio a fin, con retorno por evento',
    level: 5,
    category: 'Embudo y ventas',
    persona:
      'Responsable de marketing de una empresa de ciberseguridad que va a seis ferias al año',
    goal: 'Saber cuántos leads, oportunidades e ingresos trae cada feria y cuánto cuesta cada lead, con seguimiento preparado el mismo día.',
    prerequisites: [
      'Permisos de modelo de datos, flujos, vistas y diseño',
      'Buzón conectado',
    ],
    steps: [
      'Crea el objeto Evento y sus relaciones.',
      'Crea el formulario de captura del stand.',
      'Al volver, selecciona los contactos y lanza «Seguimiento post-feria».',
      'Construye el panel de retorno y pide el análisis de coste por lead.',
    ],
    prompts: [
      'Betty: carga metadata-building. Crea «Evento» con Nombre, Fecha de inicio, Ciudad, Coste total (moneda), Objetivo de leads (número) y Tipo (Feria, Congreso, Webinar, Evento propio), y las relaciones «Evento de origen» de Persona y de Oportunidad a Evento. Crea «CiberSur 2026» (Sevilla, 18-02-2027, 12.000 €) y «Data Defense Forum» (Bilbao, 22-04-2027, 8.500 €). Enséñame el plan.',
      'Betty: carga workflow-building. Crea un flujo manual global «Lead de feria» con formulario: nombre, apellidos, email, empresa, dominio, cargo, interés (Auditoría, SOC gestionado, Formación), evento (selector de Evento) y ¿quiere demo?. Busca la empresa por dominio, o por nombre exacto si no hay dominio, y créala solo si no existe; upsert de la persona por email con Evento de origen y Origen «Feria»; si quiere demo, crea una Oportunidad en Meeting vinculada a persona, empresa y evento. Crea también un flujo manual sobre varias Personas seleccionadas, «Seguimiento post-feria», que para cada una deje en Borradores un correo con su nombre, evento e interés y cree la tarea «Llamar tras la feria» a 3 días. Enséñamelos y espera mi confirmación.',
      'Betty: carga dashboard-building y crea «Retorno de eventos»: personas por evento, importe de oportunidades por evento, ganadas del año con evento y tabla de eventos con coste y objetivo. Después calcula tú el coste por lead y el importe ganado por euro invertido en cada evento.',
    ],
    expectedResult:
      'Cada feria registrada con sus leads y negocios, seguimiento el mismo día y un panel de qué compensa.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Sin dominio, la búsqueda por nombre no reconoce variantes como «Acme» frente a «Acme S.L.».',
      'El coste por lead lo calcula el asistente al consultar.',
    ],
  },
  {
    title: 'Demo agendada: invitación, recordatorio y registro del resultado',
    level: 5,
    category: 'Embudo y ventas',
    persona: 'Ejecutivo de cuentas de un software para clínicas veterinarias',
    goal: 'Al fijar la fecha de demo en Betty, crear el evento, recordar al cliente la víspera (si no cambió) y dejar una tarea para registrar el resultado.',
    prerequisites: [
      'Calendario CalDAV conectado (iCloud, Fastmail, Nextcloud...)',
      'Buzón conectado',
      'Campo «Fecha de demo»',
    ],
    steps: [
      'Conecta calendario y buzón y crea el campo.',
      'Pide el flujo; revisa la comprobación previa al recordatorio.',
      'Prueba con tu propio correo.',
      'Sin CalDAV, usa la variante: el chat crea el evento en Google Calendar y Betty hace el resto.',
    ],
    prompts: [
      'Betty: carga workflow-building y crea «Demo agendada»: cuando cambia «Fecha de demo» de una Oportunidad y no está vacía, un paso de código en TypeScript puro calcula fin (demo + 45 min), recordatorio (demo - 24 h) y cierre (demo + 2 h). Busca el contacto principal y crea en mi calendario conectado el evento con él como invitado, título «Demo VetNube – [empresa]» y agenda breve. Pon la etapa en Meeting. Espera hasta el recordatorio, relee la oportunidad y sigue solo si la fecha de demo es la misma; envía un recordatorio desde mi buzón; espera hasta el cierre y créame la tarea «Registrar resultado de la demo». Valídalo y espera mi confirmación.',
      'Crea en mi Google Calendar una demo de 45 minutos el jueves a las 11:00 con laura.mendez@clinicapatitas.example, título «Demo VetNube – Clínica Patitas». Después pon esa fecha en «Fecha de demo» de la oportunidad «Clínica Patitas – plan Pro» en Betty (usa la versión del flujo sin paso de calendario).',
    ],
    expectedResult:
      'Demos agendadas, recordadas y cerradas sin trabajo manual, sin recordatorios obsoletos.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Google Calendar (variante)'],
    caveats: [
      'Google Calendar por CalDAV suele exigir OAuth, no disponible en la beta. El envío de invitaciones por CalDAV no se ha verificado en la beta.',
      'Si la fecha cambia, el evento anterior se borra a mano.',
    ],
  },
  {
    title:
      'Ritual semiautomático: Betty marca las estancadas y el asistente analiza',
    level: 5,
    category: 'Embudo y ventas',
    persona:
      'Directora comercial de maquinaria agrícola con ciclo de venta largo',
    goal: 'Que Betty marque cada mañana lo que lleva 14 días sin moverse y lo desmarque cuando avanza, y que los viernes el asistente analice solo lo marcado.',
    prerequisites: ['Permisos de modelo de datos y flujos', 'Opcional: Slack'],
    steps: [
      'Crea «En riesgo», «Días sin movimiento» y «Último movimiento».',
      'Construye los dos flujos (el que marca no se dispara a sí mismo).',
      'Crea la vista «Oportunidades en riesgo».',
      'Cada viernes, el ritual con deal-review.',
    ],
    prompts: [
      'Carga metadata-building y propón en Oportunidades «En riesgo» (sí/no), «Días sin movimiento» (número) y «Último movimiento» (fecha-hora). Espera mi OK.',
      'Carga workflow-building y diseña dos flujos. A) «Marcar estancadas», cada día a las 06:30 UTC: busca oportunidades no ganadas; un paso de código en TypeScript puro calcula los días desde «Último movimiento» (o desde la creación si está vacío) y devuelve las de 14 o más; recórrelas y pon En riesgo = sí y los días. No uses la última actualización. B) «Registrar movimiento»: al actualizar una oportunidad vigilando solo etapa, importe y fecha de cierre, pone Último movimiento = ahora, En riesgo = no y días = 0. Valídalos y no actives hasta que escriba «activar».',
      'Crea la vista «Oportunidades en riesgo» (En riesgo = sí, por días de mayor a menor) con nombre, empresa, responsable, etapa, importe y días.',
      'Ritual del viernes: carga deal-review y analiza solo las oportunidades con En riesgo = sí: motivo probable y un siguiente paso. Cuando apruebe, crea una tarea por oportunidad para su responsable el martes y publica en #ventas un resumen de 10 líneas con el número, el valor total y las 3 más urgentes.',
    ],
    expectedResult:
      'Un sistema que vigila solo y un análisis semanal centrado en lo que importa.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Slack (opcional)'],
    caveats: [
      'FIND_RECORDS trae 200 como máximo por ejecución.',
      'Al activar, «Último movimiento» está vacío y se usa la fecha de creación.',
    ],
  },
  {
    title: 'Previsión ponderada: campo calculado, panel e informe al consejo',
    level: 5,
    category: 'Embudo y ventas',
    persona:
      'Fundador de un software industrial que presenta la previsión al consejo cada mes',
    goal: 'Que Betty calcule el importe ponderado de cada oportunidad, lo muestre en un panel y que el asistente prepare el informe mensual con comparación y riesgos.',
    prerequisites: [
      'Permisos de modelo de datos, flujos y diseño',
      'Opcional: Slack',
    ],
    steps: [
      'Crea «Probabilidad» e «Importe ponderado».',
      'Diseña el flujo con el código y revísalo.',
      'Rellena las abiertas en tandas pequeñas.',
      'Crea el panel y prepara el informe cada mes.',
    ],
    prompts: [
      'Carga metadata-building y propón en Oportunidades «Probabilidad» (número 0-100) e «Importe ponderado» (moneda, euros). Espera mi OK.',
      'Carga workflow-building y diseña «Importe ponderado»: al crear o actualizar una oportunidad, vigilando solo importe, etapa y probabilidad (no el ponderado). Un paso de código en TypeScript puro: si la probabilidad está vacía usa la de la etapa (New 10, Screening 20, Meeting 40, Proposal 60, Customer 100), calcula importe × probabilidad / 100 y devuélvelo en el formato de moneda de Betty (amountMicros y currencyCode, conservando la moneda). Después actualiza el importe ponderado. Enséñame el código, valídalo y no actives hasta que escriba «activar».',
      'Carga dashboard-building y propón «Previsión»: KPI de ponderado abierto, barras por etapa y líneas por mes de cierre. Enséñame el plan.',
      'Previsión de noviembre: con group_by dame el ponderado abierto por mes de cierre y responsable, compáralo con mis notas de previsión anteriores, lista las 5 oportunidades que más pesan y sus riesgos. Entrégamelo como hoja de cálculo, guarda un resumen como nota «Previsión noviembre» y publica 6 líneas en #direccion.',
    ],
    expectedResult:
      'Previsión siempre al día, panel de un vistazo e informe al consejo en minutos.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)', 'Slack', 'Herramientas de archivos del chat'],
    caveats: [
      'Las monedas se guardan en micros; si el código no devuelve ese formato, la actualización falla.',
      'Las actualizaciones masivas, en tandas pequeñas.',
    ],
  },
  {
    title: 'Serie de bienvenida de 10 lecciones a las 9:00 hora local',
    level: 5,
    category: 'Comunicaciones y correo',
    persona: 'Directora de una escuela online que inscribe alumnos a diario',
    goal: 'Que cada alumno reciba 10 lecciones, una cada dos días, siempre a las 9:00 de Madrid aunque haya cambio de horario, programadas en la cola y enviadas por el motor de envíos.',
    prerequisites: [
      'Motor de envíos programados activo',
      'Plantillas «Lección 1» a «Lección 10»',
      'Buzón conectado',
    ],
    steps: [
      'Pide el flujo que calcula las 10 fechas y crea las 10 Comunicaciones.',
      'Revisa el código con pruebas en marzo y octubre.',
      'Prueba con una alumna ficticia y mira el calendario.',
      'Revisa con el chat qué series están incompletas.',
    ],
    prompts: [
      'Carga workflow-building de Betty. Cuando se cree una Persona con Etapa «Inscrito»: 1) un paso de código en TypeScript puro, sin dependencias ni red, recibe la fecha de alta y los desfases [0,2,4,6,8,10,12,14,16,18] y devuelve 10 instantes UTC equivalentes a las 9:00 en Europe/Madrid, con los cambios de horario de marzo y octubre bien resueltos (usa Intl.DateTimeFormat); 2) recorre esas fechas: busca la Plantilla «Lección {n}» y crea una Comunicación con la persona, esa plantilla, la fecha calculada y Estado Programada. Enséñame el código con dos pruebas (alta el 20 de marzo y el 20 de octubre) y sus resultados esperados. No actives sin mi OK.',
      'En Betty dime qué alumnos inscritos en 30 días no tienen sus 10 comunicaciones o tienen alguna en Error, y propón cómo arreglarlo sin cambiar nada.',
    ],
    expectedResult:
      'Una serie fiable y visible en el calendario, con cada fallo marcado en su registro.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'Para pausar una serie basta con pasar sus Programadas a Borrador.',
      'Si el alta llega por webhook, el disparador puede ser ese webhook (es lo que hace el espacio del fundador).',
      'Importa alumnos en tandas: freno de 100 ejecuciones por minuto y 10 pasos de código a la vez.',
    ],
  },
  {
    title: 'Factura en Stripe (modo prueba) al ganar un trato',
    level: 5,
    category: 'Automatizaciones',
    persona:
      'Fundador de un estudio de desarrollo web que factura proyectos cerrados',
    goal: 'Al ganar una oportunidad, crear cliente y factura en Stripe por API, guardar ID y enlace en la oportunidad y registrar los fallos como tarea.',
    prerequisites: [
      'Cuenta de Stripe con clave restringida en modo prueba',
      'Campos de facturación en Oportunidades',
    ],
    steps: [
      'Crea «ID factura», «Enlace factura» y «Estado facturación».',
      'Pide el flujo: cliente, factura en borrador, concepto, finalizar.',
      'Cabecera content-type en minúsculas y «continuar si falla» en cada paso HTTP.',
      'Prueba en modo test; pasar a real es decisión del dueño.',
    ],
    prompts: [
      'Carga metadata-building y propón en Oportunidades ID factura (texto), Enlace factura (enlace) y Estado facturación (Pendiente, Emitida, Error). Espera mi OK.',
      'Carga workflow-building. Cuando una Oportunidad pase a Customer: 1) busca empresa y contacto principal; 2) un paso de código en TypeScript puro prepara nombre, email, importe en céntimos desde amountMicros, moneda en minúsculas y descripción; 3) POST a https://api.stripe.com/v1/customers; 4) POST a /v1/invoices con customer; 5) POST a /v1/invoiceitems con customer, invoice, amount, currency y description; 6) POST a /v1/invoices/{id}/finalize; 7) guarda ID y hosted_invoice_url y pon Emitida. En todos los pasos HTTP usa las cabeceras «authorization: Bearer {CLAVE_DE_PRUEBA}» y «content-type: application/x-www-form-urlencoded» en minúsculas, cuerpo con campos planos y «continuar si falla». Si algún paso no devuelve ID, pon Error y créame una tarea con el mensaje. La clave la pondré yo. No actives sin mi OK.',
    ],
    expectedResult:
      'Del «ganado» a la factura sin copiar datos, con ID y enlace en la oportunidad.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'La clave queda en el flujo y la ve quien edita flujos: usa una clave restringida.',
      'Sin content-type en minúsculas, Betty envía JSON y Stripe lo rechaza.',
      'Las llamadas a internet van en HTTP_REQUEST; el código es solo cálculo.',
    ],
  },
  {
    title: 'Mesa de soporte: tickets, prioridad, reparto y control de SLA',
    level: 5,
    category: 'Por sector',
    persona:
      'Jefe de soporte de un software para restaurantes con cuatro técnicos',
    goal: 'Cada solicitud crea un ticket con número y prioridad, se asigna al técnico con menos tickets, el cliente recibe acuse y Betty escala cada hora lo que supera su SLA.',
    prerequisites: [
      'Técnicos como miembros',
      'Buzón de soporte conectado',
      'Formulario que haga POST en JSON',
    ],
    steps: [
      'Crea el objeto Ticket, el kanban y el panel.',
      'Flujo de entrada por webhook con prioridad por palabras clave.',
      'Flujo horario de escalado.',
      'Flujo de encuesta al resolver.',
    ],
    prompts: [
      'Carga metadata-building, view-building y dashboard-building de Betty. Propón «Ticket» con Número, Cliente (Persona), Empresa, Asunto, Descripción, Prioridad (Urgente, Alta, Normal), Estado (Nuevo, En curso, Esperando cliente, Resuelto), Técnico (miembro), Límite SLA (fecha-hora) y Escalado (sí/no); un kanban por Estado y un panel con abiertos por técnico, por prioridad y SLA incumplidos en 7 días. Espera mi OK.',
      'Con workflow-building diseña sin activar: 1) webhook POST {clave, nombre, email, restaurante, asunto, descripcion}; filtro por clave; código que asigna prioridad por palabras («caído», «no puedo cobrar», «no imprime comandas» = Urgente; «error», «lento» = Alta; resto Normal), calcula el Límite SLA (2, 8 o 24 h) y un número SOP-AAAAMMDD-HHMMSS; upsert de la persona por email; PICK_RECORD LOAD_BALANCED entre Andrea Sanz, Bruno Ortega, Carla Ibáñez y Diego Luna por el campo Técnico; crea el Ticket y envía el acuse con su número desde soporte@comanda360.example. 2) Cada hora: tickets no resueltos con SLA vencido y no escalados -> correo a jefe.soporte@comanda360.example -> Escalado = sí. 3) Al pasar a Resuelto: correo con la encuesta. Explícame qué cuenta LOAD_BALANCED.',
    ],
    expectedResult:
      'Ningún ticket sin dueño, carga repartida, cliente informado e incumplimientos escalados.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'LOAD_BALANCED cuenta también los tickets resueltos; para equilibrar solo los abiertos, vacía Técnico al resolver o usa ROUND_ROBIN.',
      'La prioridad es por reglas, no por IA.',
      'El webhook necesita la clave y el filtro.',
    ],
  },
  {
    title:
      'Evento propio de principio a fin: inscripción, aforo, recordatorio, asistencia y encuesta',
    level: 5,
    category: 'Por sector',
    persona:
      'Coordinadora de un coworking que organiza un desayuno de networking al mes',
    goal: 'Gestionar un evento completo en Betty: inscripción con aforo, confirmación, recordatorio, asistencia en bloque y encuesta o «te echamos de menos».',
    prerequisites: [
      'Formulario que haga POST en JSON',
      'Cinco plantillas de evento',
      'Buzón conectado',
    ],
    steps: [
      'Crea Evento e Inscripción y el panel.',
      'Flujo de inscripción con aforo.',
      'Flujo de recordatorio la víspera.',
      'Botón en bloque «Marcar asistió».',
      'Flujo diario de seguimiento.',
    ],
    prompts: [
      'Carga metadata-building, view-building y dashboard-building. Crea «Evento» (Nombre, Fecha y hora, Lugar, Aforo, Estado Abierto/Completo/Celebrado) e «Inscripción» (Persona, Evento, Estado Inscrito, Lista de espera, Asistió, No asistió, Cancelado; Origen). Panel por evento con inscritos frente a aforo, asistencia e inscripciones por origen. Enséñame el diseño.',
      'Con workflow-building diseña sin activar: 1) webhook {clave, nombre, email, empresa, evento_id, origen}: filtro por clave, upsert de la persona, cuenta las Inscripciones Inscrito del evento; si hay hueco, crea Inscrito y envía «Confirmación evento»; si no, Lista de espera y «Lista de espera». 2) Al crear una Inscripción Inscrito: código que calcula la víspera a las 18:00 de Madrid, espera, relee y, si sigue Inscrito, envía «Recordatorio evento». 3) Flujo manual en bloque, fijado, «Marcar asistió». 4) Cada día a las 09:00 UTC: eventos celebrados ayer; a Asistió, «Encuesta evento»; a Inscrito sin marcar, cambiar a No asistió y enviar «Te echamos de menos». Todo desde eventos@colmenahub.example.',
    ],
    expectedResult:
      'Un evento casi sin trabajo manual, con datos para mejorar el siguiente.',
    bettyFeatures: [],
    connectors: ['Betty (MCP)'],
    caveats: [
      'El control de aforo no es atómico: dos inscripciones simultáneas pueden ocupar el último hueco.',
      '«Marcar asistió» se lanza desde la app, no desde el chat.',
    ],
  },
];

export const BETTY_TEMPLATES_EXPLAINED: BettyTemplateExplained[] = [
  {
    name: 'Habilidades de trabajo comercial: Meeting Prep, Deal Review, CRM Hygiene y Enrich',
    purpose:
      'Son las cuatro habilidades que se ven por defecto en Ajustes > IA > Skills. No son plantillas que se aplican, sino guías de trabajo que ChatGPT o Claude cargan cuando les pides algo. Meeting Prep prepara una ficha de un minuto antes de una reunión. Deal Review ordena las oportunidades por riesgo y propone un siguiente paso. CRM Hygiene busca duplicados, vacíos y fichas abandonadas, y solo corrige lo que apruebas. Enrich investiga una empresa en la web y propone cambios con su fuente. Enrich depende de un buscador que no está instalado en Betty, así que el chat usa su propia búsqueda web.',
    where: 'Ajustes > IA > Skills (pestaña Skills)',
    example:
      '«Carga la habilidad deal-review de Betty y dime qué oportunidades abiertas están en riesgo y por qué. Solo lectura.»',
  },
  {
    name: 'Habilidades para construir: workflow-building, data-manipulation, metadata-building, view-building, dashboard-building y roles',
    purpose:
      'Son habilidades «de sistema», ocultas tras el filtro de Skills. Enseñan al asistente a construir dentro de Betty: flujos automáticos, cargas y cambios de datos en bloque, objetos y campos nuevos, vistas (tabla, kanban, calendario), paneles con gráficos y roles con permisos. Son el motor de todos los casos de la campaña que dicen «crea un flujo» o «crea un campo». Las instrucciones del conector piden cargar workflow-building antes de tocar flujos.',
    where: 'Ajustes > IA > Skills, filtro de habilidades de sistema',
    example:
      '«Carga la skill view-building de Betty y crea un kanban de Personas agrupado por Etapa del embudo, con el recuento por columna.»',
  },
  {
    name: 'Habilidad de demostración por sector (workspace-demo-seeding)',
    purpose:
      'Convierte un espacio en una demo realista de un sector: propone un plan, añade dos o tres objetos propios, carga entre 20 y 50 registros de ejemplo y crea vistas. Sirve para formar o para enseñar Betty a un cliente. Archiva los objetos personalizados que ya existan, así que solo debe usarse en un espacio de pruebas.',
    where: 'Ajustes > IA > Skills (sistema)',
    example:
      '«Estoy en mi espacio de PRUEBAS. Carga workspace-demo-seeding y preséntame el plan para una demo de clínica dental. No ejecutes nada hasta que diga adelante.»',
  },
  {
    name: 'Habilidades de archivos y código: Code Interpreter, Excel, PDF, Word y PowerPoint',
    purpose:
      'Están pensadas para un intérprete de Python que en Betty está desactivado, así que hoy no funcionan aunque aparezcan en la lista. El mismo trabajo (hojas de cálculo, PDF, documentos) lo hace ChatGPT o Claude con sus propias herramientas sobre los datos que lee de Betty. Un administrador puede desactivarlas para que no confundan.',
    where: 'Ajustes > IA > Skills (sistema)',
    example:
      'En lugar de la skill xlsx: «Lee de Betty las oportunidades abiertas y entrégame tú una hoja de cálculo con una pestaña por responsable.»',
  },
  {
    name: 'Habilidades propias («New Skill»)',
    purpose:
      'Permiten escribir tus propias guías de trabajo: un nombre, una descripción que dice cuándo usarla y el contenido en Markdown. ChatGPT y Claude las ven y las cargan igual que las estándar. Son la única forma de que tus reglas (tono de marca, definición de etapas, normas de datos) lleguen al chat, porque las instrucciones generales de IA del espacio no viajan por el conector.',
    where: 'Ajustes > IA > Skills > New Skill',
    example:
      'Una skill «reglas-embudo» con la definición de cada etapa y qué dato hace falta para pasar a la siguiente.',
  },
  {
    name: 'Ajustes > Diseño (Layout) > Resumen',
    purpose:
      'Es el inventario de piezas con las que está montado Betty: unas 25 páginas de ficha (Empresa, Persona, Oportunidad, Tarea, Flujo...), las vistas estándar, los elementos del menú lateral, unos 90 comandos y los widgets. Es informativo: son las definiciones del CRM, no plantillas que se apliquen. Es la sección con más candidatas a ser «las muchas plantillas que no sé para qué sirven». Para cambiar una ficha se usa «Editar diseño de la página» desde la propia ficha.',
    where: 'Ajustes > Diseño > Resumen (requiere permiso de diseño)',
    example:
      'Desde la ficha de una Empresa, «Editar diseño de la página» y añadir una sección con sus oportunidades abiertas.',
  },
  {
    name: 'Ajustes > IA > MCP: tarjetas de conexión por cliente',
    purpose:
      'Instrucciones y enlaces para conectar Betty a distintos asistentes: Claude y ChatGPT (también en Ajustes > Conectar ChatGPT o Claude) y herramientas como Cursor, VS Code, Goose, Zed, Windsurf, Warp, JetBrains, Gemini CLI, Cline, LM Studio, Replit, Amazon Q y Augment. La idea es «un CRM, muchos asistentes».',
    where: 'Ajustes > IA > MCP',
    example:
      'Conectar Betty a Cursor para registrar el feedback de un cliente sin salir del editor de código.',
  },
  {
    name: 'Ajustes > IA > Herramientas (Tools)',
    purpose:
      'El catálogo de acciones que pueden ejecutar los asistentes: crear, leer y editar registros de cada objeto, vistas, modelo de datos, flujos, paneles, correo. «New Tool» crea una herramienta propia basada en una función de código. Sirve para auditar qué puede hacer un asistente conectado.',
    where: 'Ajustes > IA > Tools',
    example:
      'Revisar si el envío de correo y la creación de eventos están disponibles antes de pedir al chat que envíe algo.',
  },
  {
    name: 'Ajustes > Apps (Instaladas y Disponibles)',
    purpose:
      '«Instaladas» muestra la app Standard (los objetos, vistas y páginas de serie) y la app Custom (tus objetos y campos propios, como Plantilla o Comunicación). «Disponibles» es el mercado de apps (Slack, Teams, Exa, Last Contact, People Data Labs, Call Recorder), que en la beta aparece vacío porque la sincronización del catálogo está apagada.',
    where: 'Ajustes > Apps',
    example:
      'Explicar a un cliente que su objeto «Contrato» vive en la app Custom y que se puede ampliar como cualquier objeto estándar.',
  },
  {
    name: 'Flujo de ejemplo «Quick Lead»',
    purpose:
      'Un flujo manual que viene activo en cada espacio nuevo. Se lanza desde el menú de comandos, abre un formulario (nombre, apellidos, email, cargo, empresa y dominio) y crea la Empresa y la Persona vinculadas. Sirve para capturar un contacto en diez segundos, por ejemplo en una feria, y como modelo para tus propios formularios.',
    where: 'Flujos (barra lateral) o Ctrl/Cmd+K > Quick Lead',
    example:
      '«Crea un flujo como Quick Lead llamado Nuevo candidato, con los campos puesto, enlace al CV y disponibilidad.»',
  },
  {
    name: 'Flujo de ejemplo «Create company when adding a new person»',
    purpose:
      'Cuando se crea o actualiza una persona con email de empresa, extrae el dominio, busca la empresa y la vincula, o la crea si no existe. Descarta los correos personales. Es el mejor ejemplo dentro de Betty de un flujo con código, filtro y ramas.',
    where: 'Flujos (barra lateral)',
    example:
      '«Explícame paso a paso el flujo Create company when adding a new person y dime cuántas ejecuciones fallaron esta semana.»',
  },
  {
    name: 'Panel de ejemplo «My First Dashboard»',
    purpose:
      'Un panel con un texto de bienvenida y siete gráficos sobre las oportunidades de muestra: negocios por empresa, importe por etapa, evolución de ingresos, oportunidades por responsable, creadas este mes y otros. Sirve de referencia para construir tus propios paneles o se puede duplicar y apuntar a tus datos.',
    where: 'Paneles (barra lateral)',
    example:
      '«Carga dashboard-building y crea un panel como My First Dashboard pero sobre Personas por etapa del embudo.»',
  },
  {
    name: 'Registros de ejemplo',
    purpose:
      'Empresas, personas y oportunidades de muestra (Airbnb, Anthropic, Stripe, Figma, Notion y sus fundadores) para practicar con el kanban, las fichas y los paneles. Conviene borrarlos antes de trabajar con datos reales.',
    where: 'Empresas, Personas y Oportunidades de un espacio nuevo',
    example:
      '«Lista los registros de ejemplo que trae mi espacio y propónme borrarlos; no borres nada sin mi confirmación.»',
  },
  {
    name: 'Paleta de pasos del editor de flujos',
    purpose:
      'Los bloques con los que se construye una automatización. Disparadores: registro creado, actualizado o borrado, manual, programado (CRON) y webhook. Acciones: crear, actualizar, buscar, elegir registro (por turnos o por carga), filtro, si/entonces, recorrer listas, esperar, esperar a un evento, formulario, código, enviar o redactar correo, crear evento de calendario y petición HTTP. Los pasos de IA (agente y clasificar) están en la paleta pero no funcionan en la beta.',
    where: 'Flujos > editor',
    example:
      'Programado cada lunes > buscar oportunidades paradas > recorrer > enviar un correo al responsable.',
  },
  {
    name: 'Menú de comandos (Ctrl/Cmd+K)',
    purpose:
      'Unos 90 comandos: navegar, crear, importar y exportar CSV, fusionar registros, editar el diseño de una ficha, duplicar paneles, activar y probar flujos, ver ejecuciones, redactar un correo desde una ficha, y los flujos manuales que tú crees (como Quick Lead).',
    where: 'Ctrl/Cmd+K en cualquier pantalla',
    example:
      'Seleccionar dos fichas duplicadas y usar «Fusionar registros» después de una auditoría de higiene.',
  },
  {
    name: 'Sugerencias del chat de IA interno',
    purpose:
      'Frases de ejemplo que aparecen en el chat de IA dentro de Betty («Crea un flujo», «Resume esta vista», «Añade una nota»...). En la beta ese chat interno no funciona porque no hay proveedor de IA configurado, pero las mismas frases sirven tal cual en ChatGPT o Claude con el conector de Betty.',
    where: 'Chat de IA en la app',
    example:
      '«Cuando una oportunidad pase a Customer, crea una tarea de seguimiento para su responsable.»',
  },
  {
    name: 'Campañas de correo nativas (Message Campaigns)',
    purpose:
      'Un editor de correos por bloques con variables, listas, envío de prueba, programación y temas de baja. Está oculto en la beta: depende de una función desactivada en la beta. Hoy las campañas se hacen con objetos propios (Plantilla y Comunicación) y flujos que envían desde un buzón conectado.',
    where: 'No visible para el usuario',
    example:
      'Explicar a un cliente que la «biblioteca de plantillas» de Betty se monta con un objeto Plantilla mientras no estén activas las campañas nativas.',
  },
  {
    name: 'Agentes de IA internos (Helper y agentes de apps)',
    purpose:
      'Asistentes que viven dentro de Betty. El agente Helper responde dudas de uso. En la beta no funcionan porque no hay modelo de IA configurado en el servidor. Mientras tanto, el papel de «agente» lo hacen ChatGPT o Claude cargando habilidades propias.',
    where: 'Página de Agentes',
    example:
      'Escribir una skill «triaje-leads» y pedir a Claude que la cargue, en lugar de crear un agente interno.',
  },
  {
    name: 'Tus objetos Plantilla, Comunicación y Publicación',
    purpose:
      'No vienen de serie: son objetos propios que creó el fundador para guardar textos reutilizables, programar envíos y llevar el calendario editorial. Viven en la app Custom y son el patrón a copiar para cualquier cliente que quiera gestionar comunicaciones desde Betty.',
    where: 'Barra lateral del espacio del fundador; Ajustes > Modelo de datos',
    example:
      '«Crea en Betty una Comunicación para Marta Ruiz con la plantilla Lección 1, programada para mañana a las 9:00.»',
  },
  {
    name: 'Correos del sistema',
    purpose:
      'Invitaciones, alta en Betty, cambio de contraseña, verificación de email y códigos de seguridad. Los envía Betty y el usuario no puede editarlos ni reutilizarlos. No son las «Plantillas» de las que habla la campaña.',
    where: '',
    example:
      'Aclarar en la Academia que la plantilla de invitación no se puede personalizar desde el espacio.',
  },
];

export const BETTY_CAMPAIGN_TRACKS: BettyCampaignTrack[] = [
  {
    name: 'Orden y datos',
    description:
      'Meter los contactos en Betty y tenerlos limpios: tarjetas, firmas, importaciones, duplicados, normalización, segmentos, vistas y paneles de la base.',
  },
  {
    name: 'Embudo y ventas',
    description:
      'De lead a cliente: diseño del embudo, captación desde la web y ferias, cualificación, reparto, puntuación, seguimiento, previsión, pérdidas y reactivación.',
  },
  {
    name: 'Comunicaciones y correo',
    description:
      'Betty como gestor de comunicaciones: biblioteca de plantillas, voz de marca, triaje de la bandeja, secuencias, encuestas, cola de envíos programados y series de bienvenida.',
  },
  {
    name: 'Automatizaciones',
    description:
      'Los fundamentos de los flujos: entender los que ya tienes, crear los primeros, botones con formulario, resúmenes diarios, arreglar fallos y conectar con Slack o Stripe.',
  },
  {
    name: 'Agente y conectores del chat',
    description:
      'ChatGPT o Claude con Betty más Gmail, Google Calendar, Drive, Notion y Slack: preparar reuniones, investigar cuentas, propuestas, informes a clientes e inversores.',
  },
  {
    name: 'Equipo y gobierno',
    description:
      'Usar Betty en equipo con seguridad: habilidades propias con las reglas de la casa, roles de mínimo permiso, privacidad, traspasos de cartera y espacios de prueba.',
  },
  {
    name: 'Por sector',
    description:
      'Betty a medida de un negocio concreto: inmobiliaria, selección, clínicas, seguros, mantenimiento, turismo, soporte de software y eventos.',
  },
];

export const BETTY_LIMITS_TO_STATE: BettyLimit[] = [
  'Betty no lee tu Gmail, tu Google Calendar ni tu Drive. Lo hace ChatGPT o Claude con sus propios conectores; Betty guarda, ordena y automatiza.',
  'Gmail y Microsoft no se pueden conectar a Betty con OAuth en la beta. Los buzones y calendarios se conectan por IMAP/SMTP/CalDAV (en Gmail, con contraseña de aplicación). Los mensajes sincronizados se pueden leer, pero las automatizaciones no los modifican.',
  'Los correos de los flujos salen del buzón que conectes, con sus límites diarios. Betty no es un canal de envíos masivos de marketing.',
  'No hay IA dentro de Betty en la beta. El chat interno, los agentes internos y los pasos de flujo Agente de IA y Clasificar no funcionan porque no hay proveedor de IA configurado. Toda la inteligencia viene de ChatGPT o Claude.',
  'El intérprete de código está desactivado. Las habilidades Code Interpreter, Excel, PDF, Word y PowerPoint aparecen en la lista pero no funcionan, y la receta de importación masiva no aplica. El chat hace ese trabajo con sus propias herramientas.',
  'La habilidad Enrich espera un buscador que no está instalado. Se usa la búsqueda web del chat con el mismo método de proponer y aprobar.',
  'El conector no puede lanzar flujos. El asistente los crea, valida y activa, pero se disparan al cambiar un registro, por programación, por webhook o con un botón dentro de Betty. Los formularios de flujo solo se rellenan en la app.',
  'El webhook de los flujos no tiene autenticación propia: quien conozca la URL puede lanzarlo. Hay que validar siempre una clave secreta con un filtro y enviarla desde el servidor, nunca desde el código visible de la web.',
  'Por el chat se crean o actualizan como máximo 20 registros por llamada. Para miles de filas se usa el importador CSV de Betty (hasta 10.000 por archivo).',
  'Dentro de los flujos, una búsqueda trae como máximo 200 registros. Los pasos de código corren con un máximo de 10 a la vez. Hay un freno de 100 ejecuciones por minuto y 5.000 por hora, y el historial de ejecuciones se borra a los 14 días.',
  'Los flujos programados usan la hora UTC y no siguen el cambio de horario: las 8:00 de Madrid son las 7:00 UTC en invierno y las 6:00 en verano.',
  'El asistente no puede fusionar registros ni subir archivos de forma práctica. La fusión se hace en la interfaz (Fusionar registros) y los archivos se adjuntan a mano; desde el chat se guardan enlaces.',
  'Las instrucciones generales de IA del espacio no llegan a ChatGPT ni a Claude. Para compartir reglas, tono o definiciones de etapas hay que escribir una habilidad propia en Ajustes > IA > Skills.',
  'No están disponibles en la beta : campañas de correo nativas, permisos por fila, reglas de validación y campos obligatorios, SSO, dominios propios, registros de auditoría y facturación. Tampoco el mercado de apps (Slack, Teams, Exa, Last Contact, People Data Labs, grabación de llamadas).',
  'La habilidad workspace-demo-seeding archiva los objetos personalizados existentes: solo debe usarse en un espacio de pruebas.',
  'Las actualizaciones en bloque no tienen deshacer. Una actualización sobre un campo de selección múltiple sustituye su contenido. Antes de cambios masivos: exportar a CSV y pedir siempre el recuento.',
  'Datos personales: guarda solo lo necesario para la relación profesional. No guardes datos de salud, documentos de identidad ni datos bancarios en las notas, y revisa la base legal antes de importar o escribir a contactos.',
  'Las claves y URL secretas que pegues en un paso HTTP (Stripe, Slack) quedan visibles para quien pueda editar flujos. Usa claves restringidas y empieza siempre en modo prueba.',
];
