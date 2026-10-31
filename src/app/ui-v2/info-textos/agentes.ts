import type { InfoTexto } from '../info-catalogo';
import { V } from './constructores';

// Textos de ⓘ: agentes de vigía, carta porte, conductores y peajes. Claves `<pagina>.<recuadro>`; tono de guía (ANEXO C), solo lo que el lector hace de verdad.
export const INFO_AGENTES = {
  // ═══ Carta Porte · agente ═══════════════════════════════════════════════
  'carta_porte_agente.cola': V(
    'Esperando al jefe', 'Viajes en curso cuyo veredicto de Carta Porte espera una declaración tuya.',
    'Toma los viajes abiertos o en cuadre y deja los que el árbol legal marca como «falta declarar»; cada renglón muestra lo que falta. Las tarjetas de arriba cuentan sobre esos mismos viajes.',
    'Viajes de tu flota con estatus abierto o en cuadre. Se evalúan hasta 50: primero los que salen de hoy en adelante y luego los anteriores o sin fecha; el total de viajes en curso se cuenta aparte. Se lee al abrir la página.',
    'Abre la pantalla de Carta Porte con el enlace «Declarar y capturar» y responde lo que falta.',
  ),
  'carta_porte_agente.alcance': V(
    'Lo que hace y no hace', 'Texto fijo sobre lo que el agente de Carta Porte hace y lo que nunca hará.',
    'No calcula nada: es el texto de la pantalla. Describe que pregunta por WhatsApp lo que falta, arma y valida el borrador, y que no timbra.',
    'Texto escrito en la pantalla; no lee datos de tu flota ni cambia con tu rol.',
  ),
  'carta_porte_agente.como_mandar': V(
    'Cómo mandar documentos', 'Las tres vías por las que llega un documento y la dirección de correo de tu flota.',
    'Muestra la dirección de tu buzón si ya está activo, si está apagado o si no se pudo leer. Las otras dos vías (WhatsApp 1:1 de la oficina y el panel) son texto fijo.',
    'Buzón de tu flota, leído al abrir la página. Si no hay dirección que dar, la pantalla lo dice en vez de inventarla.',
    'Reenvía el embarque a la dirección del buzón o sube el archivo en la bandeja de documentos.',
  ),
  'carta_porte_agente.resultados': V(
    'Cómo le va al agente', 'Resultados del agente sobre los documentos de Carta Porte de los últimos días.',
    'Cuenta los documentos aprobados y qué porcentaje no recibió correcciones de una persona, los envíos al sistema del cliente por estado, las causas de rechazo y los campos que más se corrigen. Si no hay base, muestra «—», no 0 %.',
    'Documentos de tu flota de los últimos 30 días, hasta 500 listados. Si hay más, la pantalla avisa que las cifras son parciales. Solo conteos: no guarda valores de los documentos.',
    'Revisa las tarjetas «Qué hacer» cuando aparezcan y corrige en el catálogo del cliente lo que más se repite.',
  ),
  'carta_porte_agente.sin_ccp': V(
    'Viajes salidos sin Carta Porte', 'Viajes que ya salieron y no tienen un complemento aprobado ligado.',
    'Agrupa por cliente los viajes con salida registrada y sin documento aprobado ligado. Cada renglón muestra las horas desde la salida: desde 24 horas se pinta ámbar y desde 72 horas rojo. Solo lee: no envía mensajes ni cierra viajes.',
    'Viajes de tu flota con salida en los últimos 45 días. La salida es el hito de salida de carga o, en flotas con perfil de cinco agentes, la fecha de inicio del viaje en el TMS; ahí la liga con el documento es por cliente y folio. Si no hay viajes importados, muestra «Sin datos del TMS», no cero.',
    'Descarga el reporte CSV y revisa primero los renglones rojos.',
  ),

  // ═══ Carta Porte · catálogo del cliente ═════════════════════════════════
  'carta_porte_catalogo.cliente': V(
    'Cliente del catálogo', 'Elige de qué cliente ves y editas el catálogo.',
    'No calcula nada: lista los clientes de tu flota y abre el catálogo del que elijas. Con más de 8 clientes aparece un buscador por nombre.',
    'Clientes de tu flota, leídos al abrir la página. Un cliente que no sea de tu flota no abre nada.',
  ),
  'carta_porte_catalogo.importar': V(
    'Importar un CSV', 'Carga por lotes de productos, remitentes y destinatarios o el número interno.',
    'Eliges el tipo, subes el CSV y primero ves la vista previa con filas nuevas, filas que cambian y filas con error. Nada se guarda hasta que confirmas.',
    'El archivo que subes, de hasta 4 MB. Se guarda en el catálogo del cliente que tengas abierto.',
    'Descarga la plantilla del tipo que necesitas, llénala y revisa la vista previa antes de confirmar.',
  ),
  'carta_porte_catalogo.numero_interno': V(
    'Número interno del cliente', 'El número con el que el sistema de la empresa conoce al cliente que paga.',
    'No calcula nada: muestra el número guardado y permite capturarlo o corregirlo. Si falta, el documento no se liga y el agente no lo inventa.',
    'Catálogo de tu flota para el cliente elegido. Lo editan los roles con permiso en esta pantalla.',
  ),
  'carta_porte_catalogo.productos': V(
    'Productos del cliente', 'Productos del cliente con su clave SAT, unidad, embalaje y fracción.',
    'Lista las filas guardadas del cliente elegido y las ordena por SKU. El filtro busca en SKU, descripción, clave, unidad y fracción; se dibujan hasta 200 filas a la vez.',
    'Catálogo de tu flota para ese cliente. Si es tan grande que solo se leyó una parte, la pantalla lo avisa.',
    'Edita una fila abriéndola o agrega una con «Agregar una fila».',
  ),
  'carta_porte_catalogo.partes': V(
    'Remitentes y destinatarios', 'Remitentes y destinatarios del cliente con su RFC y domicilio.',
    'Lista las filas guardadas del cliente elegido, ordenadas por rol y alias. El filtro busca en rol, alias, razón social, RFC, código postal, municipio y estado; se dibujan hasta 200 filas a la vez.',
    'Catálogo de tu flota para ese cliente. Si es tan grande que solo se leyó una parte, la pantalla lo avisa.',
    'Edita una fila abriéndola o agrega una con «Agregar una fila».',
  ),

  // ═══ Carta Porte · referencia del cliente ═══════════════════════════════
  'carta_porte_referencia.pendientes_cliente': V(
    'Pendientes por cliente', 'Viajes ya cargados que no traen la referencia que su cliente exige.',
    'Por cada cliente que exige referencia, cuenta los viajes con carga hecha y sin referencia, y muestra las horas del más antiguo. Solo informa: no frena el viaje ni el timbrado, y la referencia no entra a la Carta Porte.',
    'La carga es el hito de salida de carga recibido o validado o, en flotas con perfil de cinco agentes, el inicio del viaje en el TMS de los últimos 45 días. Se leen hasta 5,000 cargas; si se rebasa, la pantalla lo dice. Se listan hasta 50 viajes por cliente.',
    'Escribe la referencia en el renglón del viaje y pulsa «Guardar».',
  ),
  'carta_porte_referencia.exigen': V(
    'Clientes que exigen referencia', 'Interruptor por cliente: exigir o no su referencia comercial.',
    'No calcula nada: cada cliente muestra si la exige o no y un botón para cambiarlo. Solo los clientes que la exigen entran a los pendientes.',
    'Clientes de tu flota y su regla guardada; por omisión ningún cliente la exige.',
    'Enciende «Exigir» solo en los clientes que necesitan la referencia para cobrar.',
  ),

  // ═══ Conductores · tablero (cifras y recuadros) ═════════════════════════
  'conductores.viajes_en_curso': V(
    'Viajes en curso', 'Viajes de tu flota que siguen abiertos o en cuadre.',
    'Conteo exacto en la base de los viajes con estatus abierto o en cuadre. Si no se pudo contar, muestra «—», no 0.',
    'Todos los viajes en curso de tu flota, no una muestra. Se lee al abrir la página.',
  ),
  'conductores.aceptados': V(
    'Aceptados', 'Viajes en curso que el chofer aceptó diciendo que sí.',
    'Cuenta los viajes abiertos o en cuadre con hora de aceptación, sin contar los que entraron por importación de archivo. Si no se pudo contar, muestra «—».',
    'Viajes en curso de tu flota, conteo exacto al abrir la página.',
  ),
  'conductores.importados': V(
    'En seguimiento por importación', 'Viajes en curso que entraron por archivo, sin que el chofer los aceptara.',
    'Cuenta los viajes abiertos o en cuadre con hora de aceptación cuyo origen es la importación. No se suman a «Aceptados».',
    'Viajes en curso de tu flota, conteo exacto al abrir la página.',
  ),
  'conductores.tiempo_aceptar': V(
    'Tiempo en aceptar', 'Tiempo medio entre que se avisó el viaje y el chofer lo aceptó.',
    'Promedia el tiempo del aviso a la aceptación de los viajes aceptados por el chofer. No cuenta los que entraron por importación y la nota dice cuántos se excluyeron. Sin viajes medibles, muestra «—».',
    'Los 200 viajes recientes de tu flota, no todo el historial, según lo que dice la propia nota de la cifra.',
  ),
  'conductores.esperan': V(
    'Esperan aceptar', 'Viajes en curso avisados al chofer que aún no responde y no se han escalado.',
    'Cuenta los viajes abiertos o en cuadre con aviso, sin aceptación y sin escalamiento. Si no se pudo contar, muestra «—».',
    'Viajes en curso de tu flota, conteo exacto al abrir la página.',
    'Revisa la lista «Esperan aceptar» de abajo.',
  ),
  'conductores.escalados': V(
    'Escalados', 'Viajes en curso escalados que siguen sin aceptación del chofer.',
    'Cuenta los viajes abiertos o en cuadre con hora de escalamiento y sin aceptación; la nota los describe como en espera de cambio de chofer.',
    'Viajes en curso de tu flota, conteo exacto al abrir la página.',
  ),
  'conductores.cola': V(
    'Esperan aceptar', 'Lista de viajes avisados sin respuesta, el más urgente primero.',
    'Lista los viajes con aviso, sin aceptación y sin escalamiento, ordenados por antigüedad del aviso, con las horas transcurridas y cuántos avisos se mandaron. Al plazo que indica la pantalla el agente escala solo.',
    'Viajes de tu flota. Se listan hasta 20; el total exacto se cuenta aparte y la pantalla dice cuántos faltan por listar.',
    'Si hay viajes sin aviso, el botón Avisar está en Despacho.',
  ),
  'conductores.bitacora': V(
    'Bitácora', 'Los últimos sellos de aviso, aceptación, escalamiento y llegada de los viajes recientes.',
    'Aplana los sellos de cada viaje (avisado, aceptó, rechazó, escaló, llegó, descargando, de regreso), distingue los que entraron por importación y muestra los 15 más recientes.',
    'Los 60 viajes más recientes de tu flota, según lo que dice la pantalla; no es un historial completo.',
  ),
  'conductores.entiende': V(
    'Lo que entiende por WhatsApp', 'Texto fijo sobre lo que el agente entiende de choferes y del jefe de tráfico.',
    'No calcula nada: es el texto de la pantalla. Resume los avisos del chofer, el despacho por WhatsApp del jefe y lo que el agente hace solo.',
    'Texto escrito en la pantalla; no lee datos de tu flota. El plazo para escalar es el que muestra la propia tarjeta.',
  ),
  'conductores.insights': V(
    'Insights del periodo', 'Resumen de qué pasó, qué significa y qué hacer con los hitos del periodo.',
    'Cuenta hitos registrados y cuántos nadie capturó, los corregidos por la oficina, los retrasos medidos del GPS y del chofer y las excepciones. Las llamadas evitadas son una estimación y solo se calculan si capturaste tu línea base.',
    'Hitos de los viajes de tu flota en los últimos días que eliges en el filtro de indicadores, con sus mismos filtros de patio, cliente y chofer. Si la lectura llega a su tope, la pantalla lo avisa.',
    'Atiende las acciones de «Qué hacer»; captura tu línea base en Configuración si quieres ver llamadas evitadas.',
  ),
  'conductores.kpis_piloto': V(
    'KPIs del piloto', 'Indicadores de referencia del piloto, comparados con la línea base que declaraste.',
    'Muestra el valor medido de cada KPI y su comparación con la línea base. Sin valor o sin línea base declarada dice «sin dato»; no inventa un porcentaje.',
    'Mismo periodo y filtros que los insights de arriba; cada renglón dice su fuente.',
  ),

  // ═══ Conductores · tablero de hitos ═════════════════════════════════════
  'conductores_tablero.sin_insistencia': V(
    'Hitos reportados sin insistencia', 'Porcentaje de hitos reportados con a lo más un mensaje del agente.',
    'De los hitos recibidos o validados, cuenta los que tuvieron como máximo un recordatorio y no se escalaron, entre el total de recibidos. Sin hitos recibidos, muestra «—», no 0 %.',
    'Hitos de tu flota con actividad en el periodo que eliges (último día, 7 o 30 días), con los filtros de patio, cliente y chofer.',
  ),
  'conductores_tablero.tiempo_respuesta': V(
    'Tiempo medio de respuesta', 'Minutos promedio entre que el agente pidió el hito y el chofer contestó.',
    'Promedia solo los hitos recibidos o validados con hora de solicitud y de respuesta válidas. Sin solicitudes medibles, muestra «—». Mide la entrega del mensaje, no la hora del evento físico.',
    'Hitos de tu flota con actividad en el periodo y filtros elegidos.',
  ),
  'conductores_tablero.escalados': V(
    'Hitos escalados', 'Hitos que agotaron la escalera de recordatorios.',
    'Cuenta los hitos con hora de escalamiento en el periodo.',
    'Hitos de tu flota con actividad en el periodo y filtros elegidos.',
    'Revisa la cola de excepciones y atiende los escalados.',
  ),
  'conductores_tablero.validados_ubicacion': V(
    'Validados con ubicación', 'Hitos de llegada cuya ubicación quedó dentro del sitio.',
    'Cuenta los hitos con veredicto de ubicación «validado». La nota suma los de «sin coincidencia» que esperan revisión.',
    'Hitos de tu flota con actividad en el periodo y filtros elegidos, contra el catálogo de sitios.',
    'Revisa los «sin coincidencia» en la cola de excepciones.',
  ),
  'conductores_tablero.validacion_degradada': V(
    'Validación en modo degradado', 'Porcentaje de llegadas validadas sin GPS real o sin ubicación con qué comparar.',
    'Entre las llegadas de carga y descarga recibidas o validadas, cuenta las que quedaron sin dato de ubicación, sin registro de validación o validadas solo con el pin que el chofer eligió. Sin llegadas validables, muestra «—», no 0 %.',
    'Hitos de tu flota con actividad en el periodo y filtros elegidos.',
    'Asigna sitios a los viajes y conecta el GPS para que las llegadas se validen con ubicación real.',
  ),
  'conductores_tablero.viajes_en_curso': V(
    'Viajes en curso', 'Tablero de los viajes abiertos y aceptados con su semáforo de hitos.',
    'Lista los viajes abiertos con aceptación, con sus hitos y el semáforo de cada uno; los conteos junto al título suman cada color. El filtro de semáforo mueve también la cola de excepciones.',
    'Viajes de tu flota con los filtros de patio, cliente y chofer. Hay un tope de viajes por lectura: si se rebasa, la pantalla avisa que faltan viajes y pide filtrar.',
    'Usa los filtros para ver el resto cuando aparezca el aviso de tope.',
  ),
  'conductores_tablero.excepciones': V(
    'Cola de excepciones', 'Lo que pide una decisión tuya, lo más urgente primero.',
    'Reúne las excepciones de los viajes listados (por ejemplo escalado sin atender, sin reporte, atrasado, ubicación sin coincidencia) y las ordena por gravedad. Se muestran las 50 más urgentes.',
    'Viajes del tablero con sus filtros. Los botones de acción solo aparecen si tu rol puede asignar.',
    'Abre cada excepción y usa su botón para capturar, atender o validar el hito.',
  ),
  'conductores_tablero.sin_senal': V(
    'Sin señal de vida', 'Episodios en que un tractor quedó sin señal de vida, con su cadena de avisos.',
    'Lista cada episodio con su folio, chofer, motivo, si sigue abierto y los pasos de aviso con su hora. Si no hay ninguno, lo dice; si no se pudo leer, no pinta un cero.',
    'Episodios de tu flota de los últimos días del periodo elegido y con los mismos filtros. Solo hay episodios si tu flota encendió este aviso en la configuración del Conductor. Si hay más de los que se listan, se muestran los más recientes.',
  ),
  'conductores_tablero.reubicaciones': V(
    'Reubicaciones por cliente', 'Veces y minutos que cada cliente reubicó a los choferes.',
    'Por cliente suma reubicaciones y minutos, del primer al último cambio registrado, y en cuántos viajes con dato ocurrieron. Un cliente sin respuestas del chofer muestra «Sin dato», no 0.',
    'Llegadas con reporte del chofer en los viajes del tablero. Solo aparece si tu flota encendió el reporte de llegada. El CSV sirve como evidencia.',
    'Descarga el CSV cuando necesites disputar un «no se presentó».',
  ),

  // ═══ Conductores · estadías ═════════════════════════════════════════════
  'conductores_estadias.paradas': V(
    'Paradas del periodo', 'Paradas de carga y descarga con llegada registrada en el periodo.',
    'Cuenta cada parada con hora de llegada, de cualquier estado (cerrada, en curso, sin salida, horas incoherentes). La nota separa cerradas y en curso.',
    'Viajes de tu flota cuyo aviso de llegada cae en el periodo, en días de México y ambos inclusive, con tus filtros de patio, cliente y chofer. La lectura tiene un tope y la pantalla avisa si lo rebasa.',
  ),
  'conductores_estadias.medio_carga': V(
    'Tiempo medio en carga', 'Minutos promedio de las paradas de carga ya cerradas.',
    'Promedia los minutos entre llegada y salida de las cargas cerradas con minutos válidos. Sin ninguna cerrada, muestra «—», no 0.',
    'Las paradas que ves en la tabla, con sus filtros. La nota dice sobre cuántas se calculó.',
  ),
  'conductores_estadias.medio_descarga': V(
    'Tiempo medio en descarga', 'Minutos promedio de las paradas de descarga ya cerradas.',
    'Promedia los minutos entre llegada y salida de las descargas cerradas con minutos válidos. Sin ninguna cerrada, muestra «—», no 0.',
    'Las paradas que ves en la tabla, con sus filtros. La nota dice sobre cuántas se calculó.',
  ),
  'conductores_estadias.en_anden': V(
    'En el andén ahora', 'Paradas con llegada registrada y sin aviso de salida.',
    'Cuenta las paradas en curso: llegaron y aún no avisan su salida. Su tiempo corre hasta este momento y no cuenta como cerrado.',
    'Las paradas del periodo y filtros elegidos, calculadas al abrir la página.',
  ),

  // ═══ Conductores · catálogo de sitios ═══════════════════════════════════
  'conductores_sitios.registrados': V(
    'Sitios registrados', 'Clientes, plantas, andenes y patios con su centro y su radio.',
    'No calcula nada: lista los sitios con tipo, código, coordenadas, radio, cliente y origen del dato (captura manual o CSV). El buscador filtra por nombre o código.',
    'Catálogo de sitios de tu flota. Si hay más de los que se listan, la pantalla pide afinar la búsqueda. Contra estos sitios se valida cada llegada; Editar y Archivar solo los ve el dueño o el jefe de tráfico.',
  ),
  'conductores_sitios.formulario': V(
    'Nuevo sitio o edición', 'Formulario para crear un sitio o corregir uno existente.',
    'Guarda nombre, tipo, código, dirección, coordenadas, radio, cliente y sitio padre. Ninguna coordenada se calcula ni se inventa: la capturas tú.',
    'Catálogo de sitios de tu flota. Solo el dueño de la flota o el jefe de tráfico lo ven y lo guardan.',
  ),
  'conductores_sitios.importar_csv': V(
    'Importar sitios desde CSV', 'Carga por lotes de sitios con las columnas que indica la pantalla.',
    'Es todo o nada: si una fila falla, no se importa ninguna y te dice cuál corregir. Volver a importar el mismo archivo actualiza por código y no duplica.',
    'El archivo que subes, de hasta 1 MB. Solo el dueño de la flota o el jefe de tráfico lo ven y lo usan.',
    'Descarga el formato de ejemplo y llena las coordenadas reales: el ejemplo las trae en blanco a propósito.',
  ),
  'conductores_sitios.catalogo_depurado': V(
    'Catálogo depurado de orígenes y destinos', 'Análisis e importación por lotes de un catálogo depurado de sitios.',
    'Analiza tu archivo sin tope de filas. Reporta posibles duplicados (mismo nombre o a 100 m o menos) y nunca los fusiona solos. Las coordenadas ausentes, (0, 0), fuera de rango o fuera de México sin país declarado quedan «por validar» y no se importan.',
    'El archivo que subes, de hasta 8 MB. Solo lee tu archivo: no escribe en el sistema del cliente. Solo el dueño o el jefe de tráfico lo ven.',
  ),
  'conductores_sitios.textos_sin_sitio': V(
    'Textos sin sitio', 'Textos de origen y destino frecuentes que aún no se ligan a ningún sitio.',
    'Cuenta, entre los viajes abiertos de los últimos días que muestra la pantalla, los textos de origen y destino que más se repiten y que no están ligados a un sitio. Ante la duda no se asigna nada.',
    'Viajes abiertos de tu flota. Si hay más viajes de los que se leyeron, la pantalla avisa que la cuenta es de una muestra. Asignar y subir equivalencias solo está disponible para el dueño o el jefe de tráfico.',
    'Dile al sistema qué es cada texto: un sitio de tu catálogo, una instrucción o algo que se ignora.',
  ),
  'conductores_sitios.importar_equivalencias': V(
    'Importar equivalencias desde CSV', 'Carga por lotes de qué sitio, instrucción o texto ignorado es cada texto.',
    'Cada fila se aprueba o se rechaza sola y la pantalla dice cuál y por qué; las filas sin completar se omiten. El código del sitio debe existir ya en el catálogo. Volver a importar el mismo archivo no cambia nada.',
    'El archivo que subes, de hasta 1 MB. Solo el dueño de la flota o el jefe de tráfico lo ven.',
  ),

  // ═══ Conductores · configuración ════════════════════════════════════════
  'conductores_config.rutas': V(
    'Rutas autorizadas de Google Maps', 'Base de rutas hechas con anticipación, por corredor y opcionalmente por sitio.',
    'Importas un CSV de rutas. El agente nunca arma ni corrige un link: solo se aceptan links de maps.app.goo.gl o google.com/maps, y una ruta vencida se trata como si no existiera. Cada fila se aprueba o rechaza sola y volver a subir el mismo archivo no cambia nada.',
    'El archivo que subes. Este recuadro solo aparece si tu rol puede asignar.',
  ),
  'conductores_config.rutas_por_revisar': V(
    'Rutas por revisar', 'Rutas autorizadas que llevan 90 días o más sin revisarse, la más descuidada primero.',
    'Lista las rutas cuya última revisión supera 90 días, o que nunca se revisaron, y marca las vencidas. El botón «Revisada» solo registra la revisión: no envía mensajes ni programa nada.',
    'Rutas autorizadas de tu flota, a la fecha de hoy en la zona de tu flota. Si no se pudieron leer, no se pinta la lista.',
    'Abre la ruta en Google Maps, confirma que sigue bien y pulsa «Revisada».',
  ),
  'conductores_config.documentos_cliente': V(
    'Documentos que pide cada cliente', 'Qué papeles pide cada cliente al cerrar el viaje y cuáles son indispensables.',
    'Registras documentos por cliente (por ejemplo carta porte firmada, pedimento, fitosanitario) y marcas los indispensables. Un cliente sin documentos propios sigue como hoy: solo se le pide el comprobante de entrega.',
    'Clientes activos de tu flota y los documentos que guardes. Este recuadro solo aparece si tu rol puede asignar.',
  ),

  // ═══ Peajes · cifras ════════════════════════════════════════════════════
  'peajes.lineas_conciliadas': V(
    'Líneas conciliadas', 'Líneas de estados de cuenta ligadas a un gasto de caseta de un viaje.',
    'Cuenta las líneas de los CFDI consolidados con estatus «conciliada». La nota da el porcentaje sobre todas las líneas recibidas. Sin estados de cuenta, muestra «—».',
    'Todas las líneas de los estados de cuenta de tu flota, sin recorte de fechas, al abrir la página. No incluye el desglose del proveedor de abajo.',
  ),
  'peajes.por_conciliar': V(
    'Por conciliar', 'Líneas que el cruce automático no pudo ligar solo a un gasto.',
    'Es el total de líneas menos las conciliadas y las sin gasto que corresponda.',
    'Todas las líneas de los estados de cuenta de tu flota, al abrir la página.',
    'Resuélvelas en la mesa de Combustible y casetas.',
  ),
  'peajes.sin_gasto': V(
    'Sin gasto que corresponda', 'Líneas marcadas sin match: ningún gasto de caseta les corresponde.',
    'Cuenta las líneas con estatus «sin match».',
    'Todas las líneas de los estados de cuenta de tu flota, al abrir la página.',
  ),
  'peajes.estados_cuenta': V(
    'Estados de cuenta', 'CFDI consolidados recibidos de tu flota.',
    'Cuenta los CFDI consolidados distintos que tienen al menos una línea guardada.',
    'Todos los estados de cuenta de tu flota, al abrir la página.',
  ),
  'peajes.cuadran': V(
    'Cuadran', 'Cobros del desglose abierto que tienen un gasto de caseta que los respalda.',
    'Cuenta las líneas del desglose elegido cuyo cobro tiene un gasto de caseta con monto y día coincidentes y ninguna otra evidencia en contra. La nota suma su monto.',
    'El desglose del proveedor que tienes abierto, calculado al abrir la página. Solo aparece si tu flota usa la evidencia GPS.',
  ),
  'peajes.por_verificar': V(
    'Por verificar', 'Cobros del desglose abierto donde el dato no alcanza o hay una señal que mirar.',
    'Cuenta las líneas que ante la duda quedan por verificar, por ejemplo monto distinto, dos gastos igual de buenos, TAG de otra unidad o GPS que no coincide. La nota suma su monto.',
    'El desglose del proveedor que tienes abierto, calculado al abrir la página.',
    'Revisa la bitácora conciliada para ver el motivo de cada línea.',
  ),
  'peajes.sin_respaldo': V(
    'Sin respaldo', 'Cobros donde no se encontró gasto de caseta ni evidencia GPS que los respalde.',
    'Cuenta las líneas con cobro del proveedor, con tickets de caseta cargados para el periodo, que ninguno respalda y que el GPS tampoco confirma. Es un hecho sobre tus datos, no una acusación de cobro indebido.',
    'El desglose del proveedor que tienes abierto, calculado al abrir la página.',
  ),

  // ═══ Peajes · recuadros ═════════════════════════════════════════════════
  'peajes.subir_estado_cuenta': V(
    'Subir estado de cuenta', 'Carga manual del XML del CFDI consolidado del TAG o monedero.',
    'Al subir el XML, el agente lo guarda y lo cruza al instante contra los gastos de los viajes. Solo acepta el consolidado; los tickets individuales entran por WhatsApp con su foto.',
    'El archivo que subes, de hasta 4 MB. Disponible para roles del área de dinero y solo si tu flota no está en el perfil de cinco agentes.',
  ),
  'peajes.esperan_humano': V(
    'Esperan a un humano', 'Líneas a las que el cruce automático no les encontró un gasto único.',
    'Lista las líneas con estatus «por conciliar» con su fecha, descripción, monto y número de candidatos. El botón de barrido las vuelve a cruzar contra los gastos que llegaron después.',
    'Las líneas más recientes de tu flota, hasta un tope; el total se cuenta aparte y la pantalla dice cuántas faltan por listar.',
    'Abre «Resolver en la mesa» o corre el barrido.',
  ),
  'peajes.estados_recibidos': V(
    'Estados de cuenta recibidos', 'Cada consolidado recibido con el saldo de su cruce.',
    'Agrupa las líneas por CFDI y muestra su monto total y cuántas están conciliadas, por conciliar y sin match. Un consolidado marcado «parcial» rebasa la ventana que se lee: su importe es un mínimo, no el total.',
    'Las líneas más recientes de tu flota; se muestran los 8 consolidados más recientes.',
  ),
  'peajes.desglose_proveedor': V(
    'Desglose del proveedor de peaje', 'Cruce del Excel, CSV o PDF del proveedor contra los gastos de caseta de los viajes.',
    'Cruza cada línea contra los gastos de caseta por fecha (más o menos un día) y monto, usando el TAG de cada unidad para desempatar. Cada línea queda «cuadra», «no cuadra» o «sin contraparte». Lo que el dato no alcanza a afirmar no se acusa.',
    'El archivo que subes. Muestra los 8 desgloses más recientes no anulados; el que abres lo eliges de la lista.',
    'Sube el archivo, pulsa «Conciliar» y revisa las cubetas.',
  ),
  'peajes.desgloses_importados': V(
    'Desgloses importados', 'Lista de los desgloses del proveedor ya importados con su porcentaje que cuadra.',
    'Muestra por desglose el proveedor o archivo, el periodo y el total de líneas. El porcentaje es la proporción de líneas que cuadran, redondeada; sin líneas muestra «—».',
    'Desgloses de tu flota que no están anulados, los 8 más recientes.',
  ),
  'peajes.estimulo': V(
    'Estímulo de peaje', 'Lo que esta pantalla produce frente a lo que corre por cuenta de tu flota.',
    'Cada renglón dice qué sostiene su ficha normativa: lo que esta pantalla produce, lo que es trámite o dato de tu flota y lo que queda abierto. No afirma que el estímulo proceda. El monto de peaje con factor aplicado es bruto y sujeto a esas condiciones.',
    'Peaje con el factor ya aplicado, histórico de tu flota. No aparece si tu flota está en el perfil de cinco agentes.',
    'Consulta a tu contador antes de usar el monto: es ingreso acumulable.',
  ),

  // ═══ Peajes · configuración ═════════════════════════════════════════════
  'peajes_config.buzon': V(
    'Buzón automático del proveedor', 'Buzón firmado por donde el proveedor o un script manda el archivo de cada corte.',
    'Activa o desactiva el buzón y muestra su URL, la cabecera de flota y la llave de firma. Los envíos se validan con la firma; sin el secreto del servidor el buzón rechaza todo envío.',
    'Estado del buzón de tu flota. La llave de firma, rotar y desactivar solo los ve quien administra la flota.',
    'Rota la llave si sospechas que se expuso: la anterior deja de servir al instante.',
  ),
  'peajes_config.archivos_recibidos': V(
    'Archivos recibidos', 'Archivos que llegaron por el buzón con su estado de procesamiento.',
    'Lista cada archivo con su estado (en cola, procesando, procesado o falló), proveedor, tamaño, hora en UTC e intentos. Un archivo con error muestra el último error y, si se puede, el botón Reintentar.',
    'Archivos recibidos por el buzón de tu flota. Los que llegan sin proveedor piden que lo escribas antes de reintentar.',
  ),
  'peajes_config.mapeo': V(
    'Mapeo de columnas por proveedor', 'Qué columna del archivo de cada proveedor es fecha, caseta, importe y demás.',
    'Declaras por proveedor las columnas por su encabezado exacto o por su letra. Fecha, caseta e importe son obligatorios; hora, TAG, unidad y clase son opcionales. Sin mapeo, las columnas se detectan por nombre. Guardar el mismo proveedor reemplaza su mapeo.',
    'Mapeos guardados de tu flota.',
  ),
  'peajes_config.tags': V(
    'TAGs de telepeaje por unidad', 'Qué TAG pertenece a qué unidad.',
    'Con el TAG dado de alta, el cruce sabe qué unidad pasó, desempata entre dos gastos iguales y avisa si el TAG es de otra unidad que la del viaje. Dar de baja un TAG marca para revisar los cruces posteriores a esa fecha.',
    'TAGs de tu flota; se muestran los primeros 300. La carga masiva acepta un CSV con tag, unidad y proveedor.',
  ),
  'peajes_config.casetas': V(
    'Catálogo de casetas', 'Casetas por nombre, con carretera, si cobra por pasada y coordenadas opcionales.',
    'Solo el nombre es obligatorio. Con coordenadas se puede validar con el GPS que la unidad estuvo ahí. Nace vacío a propósito: Likida no inventa coordenadas. Volver a cargar el mismo nombre actualiza sus datos.',
    'Catálogo de casetas de tu flota; se muestran las primeras 300. Sin catálogo, el cruce por caseta queda «sin datos», nunca una acusación.',
  ),
  'peajes_config.geocercas': V(
    'Geocercas', 'Círculos con centro y radio para patios, orígenes, destinos y puntos de interés.',
    'Guardas nombre, tipo, latitud, longitud y radio. Mismo nombre actualiza la geocerca. Las usan estadías, el briefing y la facturación.',
    'Geocercas de tu flota. No se muestra si tu flota está en el perfil de cinco agentes.',
  ),
  'peajes_config.cursos': V(
    'Cursos (rutas autorizadas)', 'Casetas que cada unidad o convenio puede cruzar.',
    'Un pase en una caseta fuera del curso aparece en el reporte de reclamación como «Cruce fuera de curso». Sin curso declarado no se reclama nada por este motivo. Cargas CSV o Excel con código, nombre, unidad, convenio y casetas.',
    'Cursos de tu flota; se muestran los primeros 300. El corredor en polilínea se acepta, pero el formato real de tus rutas sigue pendiente. No se muestra en el perfil de cinco agentes.',
  ),

  // ═══ Peajes · reclamación ═══════════════════════════════════════════════
  'peajes_reclamacion.cruces': V(
    'Cruces para pedir revisión', 'Cruces del desglose con evidencia para pedir una revisión al proveedor.',
    'Entran solo las líneas con evidencia en contra del cobro, cada una con un solo motivo (el más fuerte) y su confianza. «Sin datos» no cuenta como evidencia. El monto reclamable es la suma de esos cruces; no significa que el cobro sea indebido.',
    'El desglose del proveedor que abriste, con el GPS y los cursos de tu flota. Con el perfil de cinco agentes, los cruces se llaman candidatos y no hay descargas.',
    'Revisa cada cruce y decide tú si pides la revisión.',
  ),
  'peajes_reclamacion.leyendas': V(
    'Qué significa y qué no afirma', 'Leyendas del reporte sobre sus límites.',
    'No calcula nada: muestra las leyendas que acompañan al reporte para que se lea sin exagerar lo que afirma.',
    'Texto del propio reporte de reclamación.',
  ),

  // ═══ Vigía · tablero ════════════════════════════════════════════════════
  'vigia.conversaciones_activas': V(
    'Conversaciones activas', 'Clientes con un hilo de WhatsApp abierto con el Vigía.',
    'Cuenta las conversaciones con estado activo que se leen para el tablero.',
    'Las 100 conversaciones activas más recientes de tu flota. Con más de 100 abiertas, la cifra no llega más arriba de 100.',
  ),
  'vigia.por_aprobar': V(
    'Por aprobar', 'Respuestas que el Vigía redactó y esperan tu toque.',
    'Cuenta los mensajes salientes en estado pendiente de aprobación.',
    'Los 50 más antiguos de tu flota, leídos al abrir la página.',
    'Aprueba o descarta cada borrador en la cola de aprobación.',
  ),
  'vigia.sin_respuesta': V(
    'Sin respuesta', 'Conversaciones que esperan más que el SLA de respuesta de tu configuración.',
    'Cuenta las conversaciones activas con un mensaje del cliente sin contestar cuya espera iguala o supera el SLA en minutos que muestra el título de la cifra.',
    'Conversaciones activas leídas al abrir la página; la espera se mide a esa hora.',
    'Toma el hilo con «Yo me encargo» en Excepciones.',
  ),
  'vigia.molestos_escalados': V(
    'Molestos o escalados', 'Conversaciones con un cliente molesto o ya escaladas a una persona.',
    'Cuenta las conversaciones activas con nivel de molestia 2 o mayor, o con nivel de escalamiento mayor que 0.',
    'Las conversaciones activas leídas al abrir la página (hasta 100).',
    'Revisa el recuadro de Excepciones.',
  ),

  // ═══ Vigía · recuadros del tablero ══════════════════════════════════════
  'vigia.cola_aprobacion': V(
    'Cola de aprobación', 'Respuestas redactadas por el Vigía que esperan que las apruebes.',
    'Lista cada borrador con el mensaje del cliente, la intención detectada, el riesgo y las señales. Las respuestas también te llegan por WhatsApp con botones.',
    'Mensajes salientes pendientes de aprobación de tu flota, los 50 más antiguos. Decide el dueño o el encargado; los demás roles solo ven el texto.',
    'Edita el borrador si hace falta y apruébalo o descártalo.',
  ),
  'vigia.excepciones': V(
    'Excepciones', 'Clientes molestos, sin respuesta pasado el SLA o ya escalados, y envíos fallidos.',
    'Filtra las conversaciones activas que tienen al menos un motivo (molestia, espera igual o mayor al SLA, escalamiento) y las ordena por prioridad y tiempo de espera. Añade los envíos que fallaron.',
    'Conversaciones activas de tu flota y envíos fallidos de las últimas 24 horas, hasta 20. «Yo me encargo» solo lo usa quien puede decidir.',
    'Pulsa «Yo me encargo» para contestar tú desde el tablero.',
  ),
  'vigia.conversaciones': V(
    'Conversaciones activas', 'Lista de hilos abiertos, con quién los lleva y cuánto esperan.',
    'Ordena los hilos activos por prioridad alta y luego por quién lleva más tiempo esperando. Cada uno muestra si lo lleva el Vigía o una persona, su espera y el último mensaje del cliente.',
    'Las 100 conversaciones activas más recientes de tu flota. Los botones para tomar, devolver, cerrar y responder los ve quien puede decidir.',
    'Al tomar un hilo el Vigía deja de redactar en él y contestas tú desde aquí.',
  ),
  'vigia.configuracion': V(
    'Configuración y SLA', 'Si el Vigía está encendido, su modo de aprobación, sus tiempos y la retención.',
    'No calcula nada: muestra los valores guardados. El dueño los edita en el formulario; el resto los ve en lista.',
    'Configuración del Vigía de tu flota. Solo el dueño de la flota cambia estos valores.',
  ),
  'vigia.bitacora': V(
    'Bitácora', 'Lo último que hizo el Vigía y quienes lo atienden, sin texto de clientes.',
    'Lista los eventos más recientes con su nombre en lenguaje llano, el nivel si aplica y la hora. No guarda el texto de los clientes ni sus teléfonos.',
    'Los 40 eventos más recientes de tu flota.',
  ),
  'vigia.clientes_autorizados': V(
    'Clientes autorizados', 'Números de clientes a los que el Vigía puede atender, con su consentimiento.',
    'Lista los contactos de tu flota con cliente, nombre, últimas 4 cifras del teléfono, estado y fecha de consentimiento. Solo estos números reciben atención del Vigía.',
    'Contactos de tu flota que no han sido suprimidos, hasta 200. El dueño autoriza, da de baja o suprime; los demás roles solo ven.',
  ),
  'vigia.directores': V(
    'A quién avisa el Vigía', 'Lista de personas a quienes avisa cuando un cliente espera de más o se molesta.',
    'Avisa al nivel 1 y, si nadie atiende, al nivel 2, por WhatsApp, correo o ambos. Sin lista, se avisa como siempre: al responsable del cliente o al jefe de la flota (nivel 1) y al dueño (nivel 2). Si alguien solo tiene correo y el respaldo está apagado, la pantalla lo señala.',
    'Lista de directores de tu flota, hasta 40. Solo el dueño la edita.',
  ),
  'vigia.servicio': V(
    'A quién avisa cuando no hay dato', 'Personas de servicio al cliente a quienes el Vigía avisa si no tiene el dato.',
    'Cuando un cliente pregunta algo que el sistema no tiene, el Vigía avisa en privado a estas personas. Sin lista, se avisa como siempre: al responsable del cliente o al jefe de la flota. Admite hasta 10 personas.',
    'Lista de servicio al cliente de tu flota. Solo el dueño la edita; quien solo mira ve el teléfono enmascarado y ningún correo.',
  ),
  'vigia.correos': V(
    'Avisos por correo', 'Últimos avisos intentados por correo porque el WhatsApp no salió.',
    'Lista cada intento con su estado (en curso, enviado, rechazado, falta configuración o falla de red), su nivel y la hora.',
    'Los 15 avisos más recientes de tu flota. Si dice «falta configuración», el correo de Likida aún no está encendido para tu flota.',
  ),
  'vigia.limites': V(
    'Los límites del Vigía', 'Texto fijo sobre lo que el Vigía nunca hace.',
    'No calcula nada: es el texto de la pantalla. Resume que solo contesta a clientes autorizados, que cada cifra sale de un dato real del viaje de ese cliente y qué pasa con la ventana de 24 horas de WhatsApp.',
    'Texto escrito en la pantalla; no lee datos de tu flota.',
  ),
  'vigia.resultados': V(
    'Resultados del agente', 'Tarjetas con qué pasó, qué significa y qué hacer, cada una con su fuente.',
    'Arma cuatro tarjetas a partir de avisos y mensajes: tiempo ahorrado, avisos a tiempo, primera respuesta y mensajes priorizados. El ahorro es una estimación con un supuesto de minutos por aviso, rotulada así, y nunca un porcentaje. Sin datos dice «—».',
    'Avisos y mensajes de tu flota; cada tarjeta indica su fuente.',
    'Cambia el supuesto de minutos por aviso por el tiempo real que mides con tu equipo.',
  ),

  // ═══ Vigía · avisos de viaje ════════════════════════════════════════════
  'vigia_avisos.dia': V(
    'Avisos por día', 'Avisos de viaje que el Vigía arma, agrupados por día y por cliente.',
    'Agrupa los avisos por la fecha del programa de despacho de su fila (el día más próximo primero y «sin fecha» al final) y dentro de cada día por cliente. Cada tarjeta se confirma, edita o descarta.',
    'Avisos de tu flota de los últimos 14 días, más los pendientes de cualquier edad, hasta 300. Con «Solo pendientes» ves lo que falta resolver. Decide el dueño o el encargado; el resto ve sin teléfonos completos.',
    'Confirma, edita o descarta cada aviso pendiente.',
  ),

  // ═══ Vigía · grupos e histórico ═════════════════════════════════════════
  'vigia_historial.grupos': V(
    'Grupos', 'Grupos de WhatsApp de tus clientes, con su marca de crítico y su histórico.',
    'No calcula nada: lista cada grupo con su cliente, si es crítico y cuántos mensajes tiene subidos. El Vigía no lee los grupos en vivo.',
    'Grupos que registraste en tu flota. Marcar crítico y borrar los hace solo el dueño de la flota.',
  ),
  'vigia_historial.alta': V(
    'Agregar un grupo', 'Alta de un grupo de WhatsApp de un cliente.',
    'Registra el grupo con su cliente; después puedes marcarlo como crítico y subirle chats exportados.',
    'Grupos de tu flota. Solo el dueño de la flota lo ve y lo guarda.',
  ),
  'vigia_historial.importar': V(
    'Subir el chat exportado', 'Carga del chat exportado de un grupo para analizarlo.',
    'Subes el archivo exportado de un grupo ya registrado. El reporte de abajo se arma con lo que subes.',
    'El archivo que subes. Solo el dueño de la flota lo ve y lo usa; aparece cuando ya hay al menos un grupo.',
  ),
  'vigia_historial.rapidas': V(
    'Respuestas rápidas aprobadas', 'Respuestas que aprobaste para preguntas parecidas a las que ya hicieron tus clientes.',
    'Cuando un cliente escribe algo que el Vigía no entiende y se parece a una de estas preguntas, el borrador sale con la respuesta que aprobaste. Siempre te llega para aprobar antes de enviarse.',
    'Respuestas rápidas de tu flota. Dueño o encargado aprueban y retiran. Con el perfil de cinco agentes no se muestra.',
    'Apruébalas desde las preguntas frecuentes del reporte.',
  ),
  'vigia_historial.reporte': V(
    'Reporte del histórico', 'Análisis de los chats que subiste: preguntas frecuentes, temas y tiempos.',
    'Analiza los mensajes importados sin modelo de IA: los temas salen de reglas de palabras clave y lo que no encaja queda en «Otros». Se puede descargar en Excel o PDF.',
    'Chats que subiste, del grupo elegido o de todos. Usa hasta los 50,000 mensajes más recientes y avisa si hay más.',
  ),
  'vigia_historial.pendientes': V(
    'Pendientes en el chat subido', 'Mensajes de clientes que el equipo no contestó en el chat exportado.',
    'Detecta los mensajes del cliente sin respuesta del equipo dentro de una hora, con nivel alta o normal. Oculta los «gracias», los avisos de monitoreo y lo que ya contestaron. La antigüedad se mide contra el último mensaje del archivo, no contra hoy.',
    'Es una foto del momento de la exportación, no un tablero en vivo.',
  ),
  'vigia_historial.tiempos': V(
    'Tiempo de respuesta del equipo', 'Mediana y percentil 90 de lo que tarda tu equipo en contestar.',
    'Mide, por cada mensaje del cliente que pide algo, los minutos hasta la siguiente respuesta del equipo. Muestra la mediana, el percentil 90 y cuántas esperas pasaron del umbral, e incluye los mensajes que nadie contestó.',
    'Chats subidos del grupo elegido o de todos. Los saludos y agradecimientos no cuentan como esperas.',
  ),
  'vigia_historial.faqs': V(
    'Preguntas frecuentes', 'Preguntas parecidas de tus clientes que se repiten, con la respuesta que suele dar tu equipo.',
    'Agrupa preguntas con palabras en común y muestra las que se repiten al menos 2 veces, con cuántas veces y en cuántos días. Deja fuera quejas y peticiones de hablar con una persona. La respuesta típica es la que más veces dio el equipo dentro de la hora siguiente.',
    'Chats subidos del grupo elegido o de todos.',
    'Si tu rol aprueba, conviértela en respuesta rápida desde aquí.',
  ),
  'vigia_historial.temas': V(
    'Temas y tendencia', 'Cuántos mensajes de clientes hay por tema y si suben o bajan.',
    'Cuenta los mensajes de cliente por tema y compara las últimas 4 semanas contra las 4 anteriores. Con menos de 8 semanas de chat dice «Histórico corto», no un cambio.',
    'Chats subidos del grupo elegido o de todos. Los temas salen de palabras clave.',
  ),

  // ═══ Vigía · estatus de importación ═════════════════════════════════════
  'vigia_importacion.subir': V(
    'Subir el programa del día', 'Carga del CSV del programa para calcular el estatus de cada caja.',
    'Eliges la terminal y subes el archivo; el estatus se deriva de sus columnas TRANSITO y CCP. Solo se lee el archivo: no se guarda ni se escribe en ningún otro sistema.',
    'El archivo que subes, de hasta 12 MB. El Excel con colores (.xlsx) todavía no se lee: guárdalo como CSV.',
  ),
  'vigia_importacion.estatus_dia': V(
    'Estatus por día', 'Cajas de importación por día, con su estatus derivado del programa.',
    'Cuenta cajas distintas por día en la sección de importación y las reparte entre en patio, pendiente de cruce, en ruta, documentos listos, pendiente de requisito y sin estatus. Las filas sin fecha de sección no se cuentan.',
    'El archivo que acabas de subir. Es derivado del programa y no está verificado contra Track & Trace.',
    'Descarga el CSV para pegarlo en tu programa.',
  ),
  'vigia_importacion.incoherencias': V(
    'Filas que no cuadran', 'Filas del programa donde TRANSITO y CCP se contradicen.',
    'Señala dos casos: documentos en «LISTO» con la columna TRANSITO vacía, y caja «EN RUTA» con documentos aún pendientes de requisito.',
    'El archivo que acabas de subir; se listan las primeras y el resto está en el CSV.',
    'Corrige esas filas en tu programa.',
  ),
  'vigia_importacion.track_trace': V(
    'Comparación con Track & Trace', 'Cajas donde el programa y Track & Trace no coinciden.',
    'Si Track & Trace estuviera conectado, compara el estatus del programa con el suyo. Hoy dice que no está conectado y no hay con qué comparar.',
    'Track & Trace no está conectado en esta pantalla, así que no se muestra ninguna comparación.',
  ),

  // ═══ Vigía · programa de despacho ═══════════════════════════════════════
  'vigia_programa.subir': V(
    'Subir el programa del día', 'Carga del CSV del programa de despacho para que el Vigía avise a tus clientes.',
    'Eliges la terminal y subes el archivo completo del día. Si ya estaba cargado no se duplica nada; si cambió, se guarda qué cambió.',
    'El archivo que subes, hasta el tope que dice la pantalla, sin contar las columnas vacías. Solo el dueño o el encargado de la flota sube; el resto ve la pantalla sin cargar. Con el Vigía apagado se guarda, pero no se avisa a clientes.',
  ),
  'vigia_programa.entendi': V(
    'Qué entendí', 'Resumen de lo que se leyó y se guardó del archivo.',
    'Dice cuántas filas leyó, de cuántos días y cuántas no se pudieron leer, y qué guardó: filas nuevas, con cambios y sin cambios. Las filas que ya no vienen se dejan ocultas, no se borran.',
    'El archivo que acabas de subir.',
  ),
  'vigia_programa.descarte': V(
    'Lo que descarté', 'Filas del archivo que no se pudieron leer, con su motivo.',
    'Lista las primeras filas descartadas con su línea del archivo y el motivo, por ejemplo que no traía caja, unidad ni cliente, y cuántas más hay.',
    'El archivo que acabas de subir.',
  ),
  'vigia_programa.por_dia': V(
    'Por día', 'Filas del programa por día, con cuántas no traen caja y cuántas llevan aviso.',
    'Agrupa las filas leídas por su fecha de sección y cuenta, por día, filas, filas sin caja y filas con aviso.',
    'El archivo que acabas de subir.',
  ),
  'vigia_programa.revisar': V(
    'Filas que conviene revisar', 'Filas del programa con avisos que una persona debe mirar.',
    'Lista las primeras filas que traen avisos, con su línea del archivo, su fecha y el texto de cada aviso, y cuántas más hay.',
    'El archivo que acabas de subir.',
    'Corrige esas filas en tu programa y vuelve a subirlo.',
  ),
} as const satisfies Record<string, InfoTexto>;
