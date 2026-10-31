import type { InfoTexto } from '../info-catalogo';
import { V } from './constructores';

// Textos de ⓘ: agentes de liquidación, cobranza, facturas y proveedores. Claves `<pagina>.<recuadro>`; tono de guía (ANEXO C), solo lo que el lector hace de verdad.
export const INFO_LIQUIDACION = {
  // ── Cobranza de comprobantes: cifras ────────────────────────────────────────
  'cobranza.para_contactar': V(
    'Para contactar', 'Viajes con un tier de seguimiento alcanzado y un chofer con teléfono.',
    'Cuenta viajes abiertos o en cuadre, con fecha de inicio y aviso de Likida al chofer. Calcula los días desde la fecha de inicio y toma el mayor tier alcanzado que aún no se contactó. Cuenta viajes, no choferes.',
    'Viajes de tu flota al abrir la página; los tiers salen de tu estrategia guardada. Un contacto hecho en un tier consume también los menores.',
    'Revisa la tabla «Los va a contactar» o usa Ejecutar ahora en ese recuadro.',
  ),
  'cobranza.no_puede_contactar': V(
    'No puede contactar', 'Viajes con un tier alcanzado cuyo operador no tiene teléfono capturado.',
    'Mismo cálculo que «Para contactar», pero el operador del viaje no tiene teléfono. No cuenta los viajes que no han alcanzado ningún tier.',
    'Viajes abiertos o en cuadre de tu flota, al abrir la página.',
    'Captura el teléfono del operador para que el agente pueda escribirle.',
  ),
  'cobranza.viajes_vigilados': V(
    'Viajes vigilados', 'Viajes abiertos o en cuadre que el agente tiene bajo seguimiento.',
    'Cuenta los viajes abiertos o en cuadre con fecha de inicio y con aviso de Likida al chofer. Incluye los que todavía no alcanzan ningún tier.',
    'Viajes de tu flota al abrir la página; los viajes sin aviso de Likida no entran.',
  ),
  'cobranza.estado': V(
    'Estado del agente', 'Si el agente de seguimiento está activo o pausado, y su ventana de contacto.',
    'Muestra el estado de tu configuración guardada y los días y horas en que puede escribir. La ventana declarada en el perfil de tu flota, si existe, gana sobre la configurada aquí.',
    'Configuración de tu flota. Sin configuración guardada, el agente usa los valores por defecto.',
    'Pausa o reactiva el agente en el recuadro «Su estrategia».',
  ),
  // ── Cobranza de comprobantes: recuadros ──────────────────────────────────────
  'cobranza.cola': V(
    'Los va a contactar', 'La lista de viajes a los que el agente insistirá en su próxima corrida.',
    'Es la misma cola de «Para contactar»: viajes con tier alcanzado y chofer con teléfono, con los más atrasados arriba. El botón Ejecutar ahora corre el agente fuera de la ventana; un agente pausado no corre ni así.',
    'Viajes abiertos o en cuadre de tu flota al abrir la página, con la estrategia que guardaste. Operarlo exige un rol con acceso al área de dinero.',
    'Usa Ejecutar ahora si quieres contactar fuera de horario.',
  ),
  'cobranza.sin_telefono': V(
    'A quién no puede escribirle', 'Viajes con tier alcanzado cuyo operador no tiene teléfono capturado.',
    'Lista los mismos viajes que cuenta «No puede contactar», con los días sin comprobar. No hay cálculo extra.',
    'Viajes abiertos o en cuadre de tu flota, al abrir la página.',
    'Captura el teléfono del operador.',
  ),
  'cobranza.bitacora': V(
    'Bitácora de contactos', 'Los últimos intentos de contacto del agente, con o sin envío.',
    'Lista los 12 registros más recientes de contactos de cobranza, ordenados por fecha. Marca si salió o no, y el detalle cuando no salió. No resume ni agrupa.',
    'Registro de contactos de tu flota, leído al abrir la página; si no se pudo leer, lo dice en vez de mostrarse vacío.',
  ),
  'cobranza.estrategia': V(
    'Estrategia de seguimiento', 'Formulario donde fijas cuándo insiste el agente, en qué horario y con qué palabras.',
    'No calcula nada: guarda tus tiers de días, horario, días permitidos, una línea de instrucciones y la firma. La vista previa arma el mensaje con tus datos en el navegador. Al guardar se valida: de 1 a 5 tiers distintos de 1 a 60 días, hora de fin posterior a la de inicio y al menos un día permitido.',
    'Configuración de tu flota. Si el perfil declara una ventana de contacto, esa ventana gana sobre la guardada aquí.',
    'Edita los campos y usa Guardar estrategia; usa el botón de pausa para detener al agente.',
  ),
  // ── Cobranza por gasto ───────────────────────────────────────────────────────
  'cobranza.gasto': V(
    'Cobranza por gasto', 'Qué comprobante falta de qué gasto y a qué chofer le toca aviso hoy.',
    'Para cada gasto de un viaje abierto o en cuadre con aviso de Likida, decide si falta su comprobante (factura cancelada, sin foto ni factura, foto ilegible o ticket sin factura). Agrupa por chofer: un mensaje por chofer, con un tope diario que tú fijas.',
    'Gastos de los viajes abiertos o en cuadre de tu flota al abrir la página. Nace apagada: mientras no la enciendas, el agente cobra por viaje.',
    'Enciéndela o ajústala en «Configuración de la cobranza por gasto».',
  ),
  'cobranza.gasto_sin_comprobante': V(
    'Gastos sin comprobante', 'Gastos de viajes abiertos o en cuadre a los que les falta su comprobante.',
    'Cuenta todos los gastos con comprobante faltante, hayan alcanzado un tier o no. Falta comprobante si la factura está cancelada ante el SAT, si no hay foto ni factura, si la foto se lee por debajo de tu umbral sin factura, o si el concepto exige factura y no la trae.',
    'Gastos de viajes abiertos o en cuadre con aviso de Likida, al abrir la página. Un gasto sin lectura de foto medida no se acusa de ilegible.',
  ),
  'cobranza.gasto_les_toca_hoy': V(
    'Les toca hoy', 'Gastos con comprobante faltante que ya alcanzaron un tier y cuyo chofer tiene teléfono.',
    'Suma los gastos agrupados por chofer con teléfono cuyo tier de días desde la captura ya se alcanzó y no se había contactado. La nota cuenta los choferes: un mensaje cada uno.',
    'Gastos de tu flota al abrir la página, con la cadencia que configuraste. No descuenta el tope diario de mensajes: la cifra es lo que toca, no lo que saldrá.',
  ),
  'cobranza.gasto_sin_telefono': V(
    'Sin teléfono', 'Gastos con tier alcanzado cuyo chofer no tiene teléfono capturado.',
    'Suma los gastos en tier agrupados por choferes sin teléfono. Se muestran, no se pierden.',
    'Gastos de tu flota al abrir la página.',
    'Captura el teléfono del chofer.',
  ),
  'cobranza.gasto_avisos': V(
    'Avisos de los últimos 30 días', 'Avisos por gasto que sí salieron en los últimos 30 días.',
    'Cuenta los registros de contacto por gasto con envío exitoso, creados en los últimos 30 días. Los que no salieron no se cuentan. La nota dice cuántos siguen abiertos: ni resueltos ni cerrados.',
    'Registro de contactos por gasto de tu flota. Si no se pudo leer, la cifra muestra el error y no un cero.',
  ),
  'cobranza.gasto_efectividad': V(
    'Efectividad', 'Qué parte de los avisos terminó con el comprobante recibido.',
    'Divide los avisos que terminaron con comprobante entre los avisos enviados de los últimos 30 días. Con menos de 5 avisos no publica porcentaje y dice que hay pocos datos. La mediana son las horas entre el aviso y la resolución.',
    'Avisos por gasto de tu flota en los últimos 30 días. Un aviso cuenta como resuelto cuando el gasto ya no tiene comprobante faltante; eso no prueba que el aviso fue la causa.',
  ),
  'cobranza.gasto_faltantes': V(
    'Qué falta, gasto por gasto', 'Tabla de cada gasto con comprobante faltante, su motivo y su siguiente aviso.',
    'Lista los mismos gastos que cuenta «Gastos sin comprobante», con los más atrasados arriba y un máximo de 40 filas. «Toca hoy» significa que alcanzó un tier aún no contactado; «esperando su tier» que todavía no.',
    'Gastos de viajes abiertos o en cuadre de tu flota al abrir la página.',
  ),
  'cobranza.gasto_efectividad_desglose': V(
    'Efectividad por tier y por motivo', 'Cuántos avisos produjeron el comprobante, por tier de días y por motivo.',
    'Agrupa los avisos enviados de los últimos 30 días por tier y por motivo, y cuenta en cada grupo los que terminaron con comprobante. Añade cuántos avisos terminaron con el viaje cerrado y el comprobante aún faltando.',
    'Avisos por gasto de tu flota. Sin avisos o sin lectura, lo dice en vez de mostrar ceros.',
  ),
  'cobranza.gasto_bitacora': V(
    'Últimos avisos por gasto', 'Los avisos por gasto más recientes, hayan salido o no.',
    'Lista los 15 registros más recientes de contacto por gasto de los últimos 30 días, con chofer, concepto, monto, motivo, tier y si salió. No resume ni agrupa.',
    'Registro de contactos por gasto de tu flota; si no se pudo leer, lo dice.',
  ),
  'cobranza.gasto_config': V(
    'Configuración de la cobranza por gasto', 'Formulario para encender la cobranza por gasto y fijar su cadencia y topes.',
    'No calcula nada: guarda si está encendida, los días de insistencia desde la captura del gasto, el tope de mensajes por chofer y día, los conceptos que exigen factura y el umbral de lectura de la foto. Al guardar valida que sean de 1 a 5 días distintos, de 1 a 3 mensajes diarios y un umbral entre 0.10 y 0.95.',
    'Configuración de tu flota.',
    'Edita los campos y usa Guardar cobranza por gasto.',
  ),
  // ── Facturas en automático ───────────────────────────────────────────────────
  'facturas.por_facturar': V(
    'Por facturar', 'Tickets de gasto sin CFDI de los últimos 45 días, listos para repartirse.',
    'Cuenta los gastos de tu flota sin folio fiscal (CFDI), de concepto distinto a «factura», con fecha dentro de los últimos 45 días. Los gastos sin fecha entran por su fecha de captura. Incluye vencidos e incompletos.',
    'Gastos de tu flota al abrir la página. Un gasto con fecha más vieja que esa ventana no aparece aquí.',
  ),
  'facturas.monto_sin_factura': V(
    'Monto sin factura', 'Suma en pesos de los tickets contados en «Por facturar».',
    'Suma el monto de esos mismos gastos, vencidos e incompletos incluidos. Sin factura, el dinero ya salió y el gasto no tiene CFDI que lo respalde.',
    'Gastos de tu flota sin CFDI de los últimos 45 días, al abrir la página.',
  ),
  'facturas.urgentes': V(
    'Urgentes', 'Tickets cuyo plazo para facturar vence en 0 a 2 días.',
    'Cuenta los tickets sin CFDI a los que les quedan de 0 a 2 días de plazo. El plazo sale del comercio identificado en el ticket; sin comercio, se usa el mes natural. Los vencidos no se cuentan aquí.',
    'Gastos sin CFDI de los últimos 45 días. En la mayoría de los comercios es el plazo impreso del ticket, no un plazo legal verificado.',
    'Revisa «Te toca a ti» y captura primero los que vencen antes.',
  ),
  'facturas.vencidos': V(
    'Vencidos', 'Tickets cuyo plazo para facturar ya pasó.',
    'Cuenta los tickets sin CFDI con plazo vencido, con el mismo plazo por comercio que usa «Urgentes». Un ticket vencido se reporta como incompleto: ni la máquina ni una persona lo intentan.',
    'Gastos sin CFDI de los últimos 45 días, al abrir la página. Un ticket sin fecha legible no se cuenta como vencido.',
  ),
  'facturas.te_toca': V(
    'Te toca a ti', 'Tickets que necesitan a una persona: el portal pide tu cuenta o la máquina se topó con un muro.',
    'Reparte cada ticket con la regla de enrutamiento del agente. Entran aquí los de portal que exige cuenta, los bloqueados (por ejemplo un CAPTCHA) y los de portales que el agente aún no sabe operar. Muestra hasta 12 filas, con los vencimientos más cercanos primero, y declara el total.',
    'Gastos de tu flota sin CFDI. Capturar el folio exige un rol con acceso al área de dinero; el folio tecleado se valida de forma, no contra el SAT.',
    'Abre el portal con la liga de cada fila, factura y captura el folio en esa fila.',
  ),
  'facturas.hizo_solo': V(
    'Lo que hizo solo', 'Gastos que ya tienen factura amarrada, y los casos donde el agente se rindió a propósito.',
    'El número cuenta todos los gastos de tu flota con folio fiscal, sin importar la fecha: emitidos por el agente, tomados de un XML que mandaron o capturados a mano. Debajo lista hasta 5 tickets bloqueados con su motivo.',
    'Gastos de tu flota; si no se pudo contar, lo dice en vez de mostrar cero. Es un acumulado histórico, no el de un periodo.',
  ),
  'facturas.maquina': V(
    'La máquina se encarga', 'Tickets completos, sin cuenta de por medio, que van por la cola automática.',
    'Cuenta y suma los tickets que el enrutamiento manda al agente: portal reconocido, sin cuenta que pedir, con los campos requeridos leídos, sin bloqueo y con plazo vigente. Lista los primeros 5.',
    'Gastos de tu flota sin CFDI. El texto del recuadro dice si la emisión hoy está en ensayo o si emite de verdad, según el modo y el mandato de tu empresa.',
    'Si la emisión está en ensayo, el dueño otorga el mandato en Términos y mandato.',
  ),
  'facturas.incompletos': V(
    'Incompletos', 'Tickets que no se pueden facturar con lo que hay, con lo que falta.',
    'Cuenta y suma los tickets sin portal reconocido, con campos requeridos vacíos, con plazo vencido o de comercios que facturan mensual contra la cuenta. Agrupa por la primera falta de cada ticket y muestra las 4 más frecuentes.',
    'Gastos de tu flota sin CFDI de los últimos 45 días, al abrir la página.',
    'Completa el dato que falta en el ticket; uno vencido ya no se puede facturar.',
  ),
  'facturas.por_comercio': V(
    'Sin factura, por comercio', 'Cómo se reparte el monto sin factura entre los comercios identificados.',
    'Suma el monto de los tickets sin CFDI por comercio. Muestra los 4 mayores y agrupa el resto en «Otros»; los tickets sin comercio reconocido van como «Sin identificar».',
    'Gastos de tu flota sin CFDI de los últimos 45 días, al abrir la página.',
  ),
  // ── Liquidación automática (página del agente) ───────────────────────────────
  'liquidacion.monto_comprobado': V(
    'Monto comprobado', 'Dinero de gastos de ruta con comprobante, sumado sobre todo el historial de tu flota.',
    'Suma el total comprobado de todas las liquidaciones de tu flota, sin límite de fecha. No cuenta las revisiones rechazadas. Desde un millón se muestra abreviado.',
    'Liquidaciones de tu flota, leídas al abrir la página. Es un acumulado histórico, no el de un periodo.',
  ),
  'liquidacion.tasa_cuadre': V(
    'Tasa de cuadre', 'Porcentaje de liquidaciones que el agente cuadró sin diferencias.',
    'Divide las liquidaciones con estatus «cuadrada» entre todas las liquidaciones, redondeado a un entero. No cuenta las revisiones rechazadas. Sin liquidaciones muestra 0 %, que no es una tasa medida.',
    'Liquidaciones de tu flota, sobre todo el historial. La nota debajo es el total de liquidaciones contadas, no solo las cuadradas.',
  ),
  'liquidacion.por_revisar': V(
    'Por revisar', 'Liquidaciones que el agente no pudo cuadrar.',
    'Cuenta las liquidaciones de todo el historial con estatus «revisar». No cuenta las rechazadas. Es una cifra del motor; la cola de abajo cuenta lo que espera firma y sale de su propia consulta.',
    'Liquidaciones de tu flota, leídas al abrir la página.',
    'Abre la cola de revisión en esta misma página.',
  ),
  'liquidacion.con_diferencias': V(
    'Con diferencias', 'Liquidaciones donde el agente encontró diferencias.',
    'Cuenta las liquidaciones de todo el historial con estatus «con diferencias». No cuenta las rechazadas.',
    'Liquidaciones de tu flota, leídas al abrir la página. No suma dinero: el monto está en «Dinero observado».',
  ),
  'liquidacion.viajes_en_curso': V(
    'Viajes en curso', 'La foto de ahora mismo de tus viajes por etapa, y los liquidados en total.',
    'Cuenta los viajes abiertos y los viajes en cuadre. La barra «Por revisar» es la cifra de liquidaciones por revisar de arriba, no viajes. Debajo, una línea cuenta todos los viajes liquidados, histórico.',
    'Viajes y liquidaciones de tu flota al abrir la página. Si no se pudo contar, lo dice en vez de graficar un cero.',
  ),
  'liquidacion.cierres_por_dia': V(
    'Cierres por día', 'Calendario de las liquidaciones creadas cada día en las últimas 12 semanas.',
    'Cuenta las liquidaciones por día de la Ciudad de México en una ventana de 84 días. No cuenta las revisiones rechazadas. Cada cuadrito es un día; el total aparece debajo.',
    'Liquidaciones de tu flota, con corte por la fecha de creación. Si no se pudo leer, lo dice.',
  ),
  'liquidacion.hizo_solo': V(
    'Lo que hizo solo', 'Recordatorios y escalaciones recientes del agente, más acumulados históricos de su trabajo.',
    'Lista los 8 sellos más recientes entre recordatorios de comprobación y viajes escalados. Añade los comprobantes sin viaje que amarró solo y, al pie, los comprobantes leídos y las lecturas de IA sin contar el chat, ambos históricos.',
    'Sellos de los viajes de tu flota, comprobantes con lectura automática y registro de uso de IA. Cada parte que no se pudo leer se omite o se dice.',
  ),
  'liquidacion.dinero_observado': V(
    'Dinero observado', 'Importe de todas las diferencias que el motor registró, desglosado por tipo.',
    'Suma el valor absoluto de cada diferencia registrada en las liquidaciones, agrupada por tipo, sobre todo el historial. No cuenta las rechazadas. Incluye todos los tipos, no solo gasto fuera de política o duplicado.',
    'Liquidaciones de tu flota, sin filtro de fecha. Por eso no coincide con otras cifras de dinero observado que cuentan menos tipos.',
  ),
  'liquidacion.por_operador': V(
    'Diferencias por operador', 'Operadores con más liquidaciones con diferencia, con una etiqueta que no revela su nombre.',
    'Cuenta, por operador, las liquidaciones con diferencia. Muestra hasta 6 operadores con al menos una, de mayor a menor. Las revisiones rechazadas no cuentan y los operadores que se opusieron a la decisión automatizada no aparecen.',
    'Liquidaciones y operadores de tu flota. El nombre se sustituye por un seudónimo estable, no por el nombre del operador.',
  ),
  'liquidacion.reglas': V(
    'Sus reglas', 'Política de gastos con la que el agente juzga cada concepto.',
    'No calcula nada: lista cada concepto con su tope en pesos, o «Requiere CFDI», o «Sin tope», tal como está en la configuración.',
    'Política de gasto de tu flota. Si tu flota no ha guardado una, se muestra la política por defecto del sistema. El enlace Ver solo aparece si tu rol puede abrir Configuración, que hoy es de lectura.',
  ),
  'liquidacion.ultimos_cierres': V(
    'Últimos cierres', 'Las liquidaciones más recientes que no están por revisar.',
    'Toma las 50 liquidaciones más recientes que no son revisiones rechazadas, quita las de estatus «revisar» y muestra las primeras 5 con comprobado, diferencia y estatus.',
    'Liquidaciones de tu flota, ordenadas por fecha de creación.',
    'Usa Ver en cada fila para abrir el detalle.',
  ),
  // ── Desgloses de pago por correo ─────────────────────────────────────────────
  'desgloses.lista': V(
    'Desgloses de pago', 'Estado del envío por correo de cada desglose de pago que llega del sistema de tu empresa.',
    'Las fichas cuentan los desgloses recibidos hoy y los correos de los últimos 30 días por estado (enviado, entregado, rebotado), además de los retenidos y las bitácoras sin póliza. Rebotado suma correos rebotados, con queja o fallidos. La lista muestra el estado de cada destinatario; si un rol tiene varios correos, manda el peor.',
    'Desgloses y correos de tu flota. Una ficha que no se pudo medir muestra «—», no cero. Retenidos y sin póliza solo se miden si caben en una lectura acotada. La lista se filtra por estado y fechas.',
    'Corrige el correo que rebotó y reenvía desde el detalle de cada desglose.',
  ),
  'desgloses.detalle': V(
    'Detalle del desglose', 'Un desglose de pago con sus renglones, destinatarios, envíos y acciones.',
    'No calcula nada: muestra los renglones de percepciones y deducciones tal como llegaron, el estado de cada destinatario, el historial de envíos y las excepciones abiertas de esa bitácora.',
    'Desglose de tu flota. Reenviar, corregir un correo y liberar un envío retenido dependen de tu rol y solo se liberan cuando el desglose lo permite.',
    'Descarga el Excel, reenvía o, si está retenido y es liberable, libera el envío.',
  ),
  'desgloses.excepciones': V(
    'Excepciones', 'Lo que necesita a una persona antes de que un desglose llegue completo.',
    'Lista las excepciones abiertas de la flota, sin resolver, con su tipo, bitácora y desde cuándo. Muestra las 50 más recientes y avisa si hay más.',
    'Excepciones de tu flota, ordenadas por la última vez que ocurrieron. Si no se pudieron leer, lo dice en vez de mostrar «sin excepciones».',
    'Resuelve las visibles para ver el resto; cada una dice qué corregir.',
  ),
  // ── Configuración del desglose por correo ────────────────────────────────────
  'liquidacion_config.entrega': V(
    'Entrega del desglose', 'Canal por el que sale el desglose, remitente y si el envío por correo está encendido.',
    'No calcula nada: guarda el canal (correo, correo y WhatsApp, o WhatsApp), si el envío está activo, el nombre del remitente, a dónde llegan las respuestas, el correo emisor y una hora mínima de envío de 0 a 23. El envío por correo solo se enciende si marcas la casilla.',
    'Configuración de entrega de tu flota. Sin configuración guardada, el agente entrega por WhatsApp y no manda nada por correo. Solo el dueño de la flota puede cambiarla.',
    'Marca Activar el envío cuando esté todo listo y usa Guardar configuración.',
  ),
  'liquidacion_config.destinatarios': V(
    'Quién recibe el desglose', 'Correos de RH, buzón de archivo, coordinador y tipos de operador que reciben su desglose.',
    'No calcula nada: guarda hasta 3 correos de RH, un buzón de archivo, si se envía también al coordinador y qué tipos de operador (foráneos, locales, permisionarios) reciben. Un tipo sin marcar, o un operador sin tipo, queda retenido y no se envía.',
    'Configuración de entrega de tu flota. Solo el dueño de la flota puede cambiarla.',
  ),
  'liquidacion_config.fecha_corte': V(
    'Fecha de corte del arranque', 'Día desde el cual se envían desgloses; los de periodos anteriores se guardan sin enviarse.',
    'Compara el fin del periodo de cada desglose con la fecha que pones. Si termina antes, el desglose se guarda y queda «omitido», sin correo a nadie. Vacío significa que se envía todo lo que llegue.',
    'Configuración de entrega de tu flota. Solo el dueño de la flota puede cambiarla.',
    'Pon el día en que arranca el envío para no mandar nóminas viejas al subir el histórico.',
  ),
  'liquidacion_config.primer_mes': V(
    'Primer mes: revisión', 'Modo temporal en que cada departamento revisor recibe una copia del desglose.',
    'No calcula nada: con el modo activo, cada desglose, enviado o retenido, llega también por correo al revisor de cada departamento, con el mismo Excel. Pide al menos un revisor, hasta 5 y uno por departamento, y una fecha final. Al pasar esa fecha el modo se apaga solo.',
    'Configuración de entrega de tu flota. Solo el dueño de la flota puede cambiarla.',
  ),
  'liquidacion_config.formato': V(
    'Cómo se ve el desglose', 'Renglón de viaje y renombres de conceptos que cambian cómo se rotula el desglose.',
    'No calcula nada: el renglón de viaje junta en uno solo los conceptos que listes, con la etiqueta que pongas, y los renombres cambian el nombre con que un concepto aparece. El importe no cambia. Admite hasta 20 conceptos de viaje y 50 renombres.',
    'Configuración de entrega de tu flota. Solo el dueño de la flota puede cambiarla.',
  ),
  'liquidacion_config.retencion': V(
    'Qué retiene el envío', 'Conceptos y neto negativo que detienen un desglose hasta que alguien lo revise.',
    'No calcula nada: si un desglose trae alguno de los conceptos que listes, hasta 50, no sale y queda a la espera de revisión y liberación. Con neto negativo eliges entre retener el envío o enviarlo de todos modos.',
    'Configuración de entrega de tu flota. Solo el dueño de la flota puede cambiarla.',
    'Los retenidos se liberan desde el detalle de cada desglose en la página de desgloses.',
  ),
  // ── Formato de las liquidaciones ─────────────────────────────────────────────
  'liquidacion_formato.formato': V(
    'Tu formato', 'Excel de muestra del que Likida toma columnas, encabezados y datos de arriba.',
    'Lee el archivo de muestra y extrae sus columnas, sus encabezados y los datos sobre la tabla (operador, periodo, folio). Lo que no reconoce no se inventa y se avisa. No recalcula nada: imprime las cifras que mandas.',
    'Archivo que subes y configuración guardada de tu flota. Solo el dueño de la flota sube la muestra o cambia el formato.',
    'Sube el Excel con Subir muestra, o reemplázalo si ya hay uno.',
  ),
  'liquidacion_formato.avisos': V(
    'A quién se le avisa', 'Teléfonos para la copia de cada liquidación y para avisos de «No coincide», sin formato de Excel.',
    'No calcula nada: guarda hasta 3 teléfonos de copia al jefe de flota y hasta 3 para avisar cuando un operador responde «No coincide». Sin teléfonos de discrepancia, se avisa al jefe de la copia y, sin copia, a quien ve dinero.',
    'Configuración de tu flota; aparece solo mientras no hay un formato cargado. Solo el dueño de la flota puede guardarla.',
    'Captura los teléfonos y usa Guardar teléfonos.',
  ),
  'liquidacion_formato.impresion': V(
    'Cómo se imprime', 'Título, columnas, fechas y total con los que se genera el PDF y el Excel de cada liquidación.',
    'No calcula nada: guarda el título, el documento que viaja por WhatsApp (PDF o Excel), el formato de fechas, la fila de total y el rótulo de cada dato y columna leídos de tu muestra. También guarda los teléfonos de copia y de discrepancia.',
    'Formato guardado a partir de tu muestra; la muestra actual se indica arriba. Solo el dueño de la flota puede cambiarlo.',
    'Edita los rótulos y usa Guardar cambios, o Quitar el formato para eliminar el guardado.',
  ),
  // ── Facturas de proveedores ──────────────────────────────────────────────────
  'proveedores.esperan_decision': V(
    'Esperan tu decisión', 'Facturas de proveedor con estado pendiente, sin aprobar ni rechazar.',
    'Cuenta las facturas de la bandeja con estado «pendiente». Las pendientes se leen todas, hasta 500; si hay más, la página lo avisa.',
    'Facturas de proveedor de tu flota al abrir la página.',
    'Decide cada una con los botones de la columna Decidir en «La bandeja».',
  ),
  'proveedores.aprobadas': V(
    'Aprobadas', 'Facturas que una persona aprobó, con cuántas siguen sin exportar.',
    'Cuenta las facturas con estado «aprobada» entre las 100 más recientes del buzón y las pendientes leídas. La nota separa las que ya salieron en un CSV de las que no.',
    'Facturas de proveedor de tu flota. Con 100 o más facturas, esta cifra solo cubre las más recientes y hay más atrás.',
    'Exporta las aprobadas en CSV desde «Subir factura de proveedor».',
  ),
  'proveedores.rechazadas': V(
    'Rechazadas', 'Facturas que una persona rechazó.',
    'Cuenta las facturas con estado «rechazada» entre las 100 más recientes del buzón y las pendientes leídas.',
    'Facturas de proveedor de tu flota. Con 100 o más facturas, esta cifra solo cubre las más recientes y hay más atrás.',
  ),
  'proveedores.receptor_ajeno': V(
    'Con receptor ajeno', 'Facturas pendientes cuyo CFDI no está a nombre del RFC de tu flota.',
    'Cuenta solo las facturas pendientes donde el receptor del XML no coincide con el RFC de tu flota. Si tu flota no tiene RFC capturado, la validación queda pendiente y esas facturas no se cuentan aquí.',
    'Facturas pendientes de tu flota contra el RFC guardado de tu flota. No cuenta las ya aprobadas ni rechazadas.',
    'Revisa cada una antes de aprobar: una factura a otro RFC no es tuya.',
  ),
  'proveedores.subir': V(
    'Subir factura de proveedor', 'Carga de un XML o una foto de factura a la bandeja, y exportación de las aprobadas.',
    'El XML se lee como dato del CFDI; la foto se lee con IA y queda marcada para revisarse contra el papel antes de aprobar. Se valida el receptor contra el RFC de tu flota. Los CSV usan un layout estándar de importación para SAP B1 y CONTPAQi, no una compatibilidad certificada, y lo exportado queda marcado.',
    'Archivos que subes y facturas aprobadas de tu flota. Subir o decidir exige un rol con acceso al área de dinero.',
    'Sube el XML siempre que lo tengas; valida el CSV con tu contador antes del primer import.',
  ),
  'proveedores.buzon': V(
    'Buzón de facturas por correo', 'Dirección de correo de tu flota para que los XML adjuntos entren solos a la bandeja.',
    'No calcula nada: muestra la dirección de tu flota, o permite generarla una vez y rotarla. Los XML adjuntos de los correos que lleguen ahí entran a la bandeja. Si el dominio de correo no está configurado en el sistema, lo dice.',
    'Dirección única de tu flota. Generar o rotar la dirección lo hace solo el dueño de la flota; si no se pudo leer el buzón, la sección lo dice.',
    'Da la dirección a tus proveedores o reenvía ahí sus facturas.',
  ),
  'proveedores.bandeja': V(
    'La bandeja', 'Lista de facturas de proveedor con su estado, su validación ante el SAT y quién decidió.',
    'Muestra las 100 facturas más recientes y todas las pendientes, hasta 500, con las pendientes arriba. Cada fila indica la fecha y el origen, el RFC emisor, el concepto, el total, el estado y la consulta al SAT hecha al ingerir la factura. Lo leído por visión se marca para revisarse.',
    'Facturas de tu flota. El estado ante el SAT se consultó al ingerir la factura y puede decir sin consultar o sin contestar.',
    'Aprueba o rechaza cada pendiente; no apruebes una cancelada ante el SAT.',
  ),
} as const satisfies Record<string, InfoTexto>;
