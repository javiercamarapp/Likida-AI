import type { InfoTexto } from '../info-catalogo';
import { V } from './constructores';

// Textos de ⓘ: administración y cuenta. Claves `<pagina>.<recuadro>`; tono de guía (ANEXO C), solo lo que el lector hace de verdad.
export const INFO_ADMIN = {
  // ── arco ──
  'arco.por_responder': V(
    'Por responder', 'Solicitudes ARCO de tus operadores que todavía no se contestan.',
    'Cuenta las solicitudes de tu flota con estado «recibida» o «en proceso». Si la lectura falla muestra «—», no 0.',
    'Tabla de solicitudes ARCO de tu flota, completa (sin corte por fecha), leída al abrir la página.',
    'Abre la lista de abajo y responde cada una.',
  ),
  'arco.vencen_pronto': V(
    'Vencen pronto', 'Solicitudes por responder cuyo plazo vence hoy o en los próximos 5 días.',
    'De las solicitudes por responder, cuenta las que tienen fecha de vencimiento entre hoy y 5 días después, ambos incluidos. Las ya vencidas no entran aquí.',
    'Fecha de vencimiento guardada en cada solicitud; «hoy» es la fecha de México al abrir la página. Si la lectura falla muestra «—».',
    'Responde primero las de fecha más cercana.',
  ),
  'arco.vencidas': V(
    'Vencidas sin responder', 'Solicitudes por responder cuya fecha de vencimiento ya pasó.',
    'De las solicitudes por responder, cuenta las que vencían antes de hoy. Una que vence hoy todavía no cuenta como vencida.',
    'Fecha de vencimiento guardada en cada solicitud, comparada con la fecha de hoy en México. Si la lectura falla muestra «—», no 0.',
    'Responde estas primero desde la lista.',
  ),
  'arco.solicitudes': V(
    'Solicitudes de tus operadores', 'Lista de las solicitudes ARCO registradas para tu flota.',
    'No se calcula: es la lista de solicitudes con su fecha de recepción, derecho, titular, vencimiento, estado y respuesta, de la más reciente a la más antigua.',
    'Tabla de solicitudes ARCO de tu flota. Las acciones de responder solo las ve y puede usar un rol con permiso de administrar la cuenta.',
    'Abre cada solicitud y responde con el botón de la fila.',
  ),
  // ── arranque ──
  'arranque.avance': V(
    'Avance de la puesta en marcha', 'Cuántos pasos de la puesta en marcha ya están hechos.',
    'Cuenta los pasos obligatorios en estado «hecho» contra el total de obligatorios. Los pasos opcionales no cuentan. Un paso que no se pudo comprobar no cuenta como hecho.',
    'Cada paso se evalúa con una señal real de tu cuenta (datos capturados, filas dadas de alta) al abrir la página.',
    'Abre el enlace «Siguiente» para hacer el primer paso pendiente.',
  ),
  'arranque.grupo_flota': V(
    'Tu flota y su cuenta', 'Pasos sobre los datos de tu empresa y su cuenta.',
    'No se calcula como grupo: cada paso muestra si está hecho, pendiente o «no pude comprobarlo» según su propia señal.',
    'Señales de tu cuenta leídas al abrir la página. Algunos pasos solo los hace el dueño.',
    'Abre el enlace de cada paso pendiente.',
  ),
  'arranque.grupo_gente': V(
    'Tu gente y tus camiones', 'Pasos sobre operadores, unidades, patios y jefes de tráfico.',
    'No se calcula como grupo: cada paso muestra si está hecho, pendiente o «no pude comprobarlo» según su propia señal. Patios y jefes de tráfico son opcionales.',
    'Señales de tu cuenta leídas al abrir la página.',
    'Abre el enlace de cada paso pendiente.',
  ),
  'arranque.grupo_operacion': V(
    'Tu primera operación', 'Pasos del primer ciclo: viaje, ticket por WhatsApp y liquidación.',
    'No se calcula como grupo: cada paso es «hecho» cuando ya existe el primer viaje, el primer comprobante o la primera liquidación de tu flota.',
    'Señales de tu cuenta leídas al abrir la página.',
    'Abre el enlace de cada paso pendiente.',
  ),
  'arranque.automatizaciones': V(
    'Automatizaciones', 'Enlaces a las pantallas de las automatizaciones disponibles.',
    'No se calcula: es la lista de automatizaciones. Las que tu rol no puede ver aparecen sin enlace.',
    'Lista fija de automatizaciones del producto; el enlace depende de los permisos de tu rol.',
  ),
  // ── carta_porte_docs ──
  'carta_porte_docs.recibidos': V(
    'Documentos recibidos', 'Documentos de clientes que llegaron en los últimos 90 días.',
    'Cuenta los documentos de los últimos 90 días, sin contar los archivos que se partieron en varios embarques; cuenta cada embarque.',
    'Documentos de tu flota con corte de 90 días. Si hay más de 500, se leen los más recientes y la página lo avisa.',
  ),
  'carta_porte_docs.aprobados': V(
    'Aprobados', 'Documentos de los últimos 90 días que una persona ya aprobó.',
    'Cuenta los documentos en estado «aprobado» dentro de la misma ventana de 90 días. Los rechazados se muestran aparte en la nota.',
    'Documentos de tu flota, últimos 90 días.',
  ),
  'carta_porte_docs.sin_correccion': V(
    'Aprobados sin corrección', 'Porcentaje de aprobados en los que nadie cambió un valor.',
    'Aprobados sin correcciones registradas entre aprobados totales. Confirmar un dato dudoso no cuenta como corregirlo. Sin aprobados muestra «—», no 0 %.',
    'Documentos aprobados de tu flota en 90 días y las correcciones registradas por documento.',
  ),
  'carta_porte_docs.tiempo_ahorrado': V(
    'Tiempo ahorrado por embarque', 'Estimación de minutos ahorrados frente a capturar el embarque a mano.',
    'Promedio de max(0, 12 min de captura manual menos los minutos de revisión medidos) por aprobado medido. Los 12 min son un supuesto de diseño, no una medición.',
    'Tiempo de revisión medido desde que se abre el documento hasta que se aprueba, solo en aprobados que lo traen. Sin medidos muestra «—».',
  ),
  'carta_porte_docs.subir': V(
    'Subir un documento', 'Formulario para cargar a mano un documento de un cliente.',
    'No se calcula: al enviarlo, el agente lee el archivo y lo deja en la bandeja de revisión.',
    'El archivo que subes; indicar el cliente es opcional y ayuda a reconocer su formato. Solo aparece si tu rol puede subir.',
    'Elige el archivo y pulsa «Subir y leer».',
  ),
  'carta_porte_docs.bandeja': V(
    'Bandeja de revisión', 'Lista de los documentos recibidos, con los que esperan a una persona primero.',
    'No se calcula: ordena por prioridad de estado y luego por fecha de recepción, más recientes primero. Puedes filtrar por estado de envío al TMS.',
    'Los 200 documentos más recientes de tu flota más todos los por revisar o sin poder leer, sin importar su antigüedad.',
    'Abre un documento por revisar y apruébalo o recházalo.',
  ),
  'carta_porte_docs.correo': V(
    'Correo de tu flota', 'Buzón propio al que tus clientes pueden mandar documentos.',
    'No se calcula: muestra la dirección del buzón y su estado, y permite guardar la lista de remitentes de tus clientes.',
    'Configuración del buzón de tu flota. Sin buzón activado, la dirección no existe.',
    'Activa el buzón y escribe los remitentes de tus clientes.',
  ),
  'carta_porte_docs.whatsapp': V(
    'WhatsApp', 'Explica cómo reenviar por WhatsApp el documento de un cliente.',
    'No se calcula: es texto de ayuda sobre qué formatos entran solos y qué pie debe llevar una foto.',
    'Texto fijo de la pantalla; el canal funciona en las flotas que activaron el buzón.',
  ),
  'carta_porte_docs.formatos': V(
    'Formatos que Likida ya conoce', 'Perfiles de formato aprendidos de los documentos que has aprobado.',
    'No se calcula: lista cada perfil con su formato, versión activa y número de campos reconocidos, y permite volver a una versión anterior.',
    'Perfiles guardados de tu flota. Sin ninguno, aún no se ha aprobado un documento que cree el primero.',
    'Abre un perfil y usa «Volver a esta» si una versión nueva lee peor.',
  ),
  'carta_porte_docs.exportar': V(
    'Exportar lo aprobado', 'Descargas de los documentos aprobados y formatos de salida a medida.',
    'No se calcula: genera el archivo al descargarlo, solo con documentos aprobados, en el formato estándar o en uno que declares.',
    'Documentos aprobados de tu flota y los formatos destino que hayas guardado.',
    'Descarga el estándar o declara un formato destino.',
  ),
  // ── carta_porte ──
  'carta_porte.datos_transportista': V(
    'Datos del transportista', 'Los 18 datos del complemento Carta Porte que responde tu flota, uno por uno.',
    'Cada dato marca si ya está capturado, si falta o si Likida aún no tiene casilla para él. Un dato sin casilla cuenta como faltante del transportista.',
    'Se arma al abrir la página con lo capturado del viaje, la unidad y el operador. Si falta, indica en qué pantalla se captura.',
    'Captura lo que falte en la pantalla que indica cada renglón.',
  ),
  'carta_porte.datos_cliente': V(
    'Datos del cliente', 'Los 19 datos del complemento Carta Porte que aporta tu cliente, uno por uno.',
    'Cada dato marca si ya está capturado, si falta o si Likida aún no tiene casilla para él. Su hueco se reporta, pero no cambia el avance de los datos del transportista.',
    'Se arma al abrir la página con lo capturado del viaje y del cliente.',
    'Pídele a tu cliente lo que falte antes del viaje.',
  ),
  // ── combustible_casetas ──
  'combustible_casetas.el_gasto': V(
    'El gasto', 'Gasto histórico en combustible y casetas, litros elegibles y comprobantes sin CFDI.',
    'Agrupa los gastos de tu flota por concepto (suma y número de registros) y muestra cuatro cifras: combustible, casetas, litros elegibles y porcentaje sin CFDI.',
    'Gastos de tu flota. Combustible y casetas son históricos sin ventana; las otras dos cifras declaran su propia ventana.',
  ),
  'combustible_casetas.gastado_combustible': V(
    'Gastado en combustible', 'Suma histórica de los gastos de diésel registrados de tu flota.',
    'Suma los gastos con concepto «diesel» y cuenta cuántas cargas son. No tiene ventana de fechas: crece con todo el histórico. Sin cargas muestra 0 y la nota lo dice.',
    'Tabla de gastos de tu flota, agrupada por concepto al abrir la página.',
  ),
  'combustible_casetas.gastado_casetas': V(
    'Gastado en casetas', 'Suma histórica de los gastos de caseta registrados de tu flota.',
    'Suma los gastos con concepto «caseta» y cuenta cuántas casetas son. No tiene ventana de fechas. Sin casetas muestra 0 y la nota lo dice.',
    'Tabla de gastos de tu flota, agrupada por concepto al abrir la página.',
  ),
  'combustible_casetas.litros_elegibles': V(
    'Litros elegibles para el estímulo', 'Litros de diésel de las liquidaciones del ejercicio en curso.',
    'Suma los litros de diésel elegibles de las liquidaciones de tu flota desde el 1 de enero hasta hoy. No convierte los litros a pesos. Si la lectura falla muestra «—», no 0.',
    'Liquidaciones de tu flota; la ventana (ejercicio en curso, de enero a hoy en México) va en la nota de la cifra.',
  ),
  'combustible_casetas.sin_cfdi': V(
    'Sin CFDI', 'Porcentaje de comprobantes de combustible y casetas que no traen CFDI.',
    'Entre los últimos 100 comprobantes de tu flota, toma los de diésel y caseta y calcula el porcentaje que no tiene folio fiscal de CFDI. Sin comprobantes o con lectura fallida muestra «—», no 0 %.',
    'Los 100 comprobantes más recientes, no todo el histórico; la nota dice cuántos de cuántos.',
    'Pide la factura de los que no la tienen: sin CFDI no se deduce.',
  ),
  'combustible_casetas.carga_repetida': V(
    'Posible carga repetida', 'Comprobantes de combustible o caseta que aparecen en más de un viaje.',
    'Busca CFDI o folios que se repiten en gastos de viajes distintos y deja los que mencionan diésel o caseta. Es una coincidencia, no un veredicto.',
    'Gastos de tu flota. Si la revisión falla, la página lo dice y no afirma que esté limpio.',
    'Verifica el caso con los viajes que se listan antes de hablar con el operador.',
  ),
  'combustible_casetas.cfdi_consolidado': V(
    'CFDI consolidado (monedero y TAG)', 'Cuánto de un CFDI consolidado de monedero o TAG quedó ligado a gastos.',
    'Cuenta las líneas del CFDI consolidado ligadas solas a un gasto, las que esperan revisión y las que una persona revisó sin encontrar gasto. Sin consolidados muestra un aviso, no ceros.',
    'Líneas de CFDI consolidado de tu flota; la lista para resolver trae las 200 más recientes y el conteo es de todas.',
  ),
  'combustible_casetas.lineas_ligadas': V(
    'Líneas ligadas automáticamente', 'Líneas del CFDI consolidado que se ligaron solas a un gasto.',
    'Cuenta las líneas conciliadas sin intervención, contra el número de CFDI consolidados recibidos.',
    'Líneas de CFDI consolidado de tu flota, sin ventana de fechas.',
  ),
  'combustible_casetas.por_revisar': V(
    'Por revisar a mano', 'Líneas del CFDI consolidado que esperan que una persona decida.',
    'Total de líneas menos las ligadas solas y menos las ya revisadas sin gasto. Una línea llega aquí cuando no hay exactamente un ticket que cuadre por fecha y monto.',
    'Líneas de CFDI consolidado de tu flota, sin ventana de fechas.',
    'Elige el candidato correcto en la lista de abajo o marca «ninguno de estos».',
  ),
  'combustible_casetas.sin_gasto': V(
    'Revisadas, sin gasto que corresponda', 'Líneas que una persona revisó y quedaron sin gasto ligado.',
    'Cuenta las líneas marcadas «sin match» al resolverlas a mano. Quedan documentadas y ya no cuentan como por revisar.',
    'Líneas de CFDI consolidado de tu flota, sin ventana de fechas.',
  ),
  // ── conexiones ──
  'conexiones.conector': V(
    'Estado de una conexión', 'Estado medido de una conexión de tu flota: listo, incompleto o sin conectar.',
    'Cada conexión muestra una de cinco etiquetas: listo, incompleto, sin conectar, no se pudo medir o en ensayo. «No se pudo medir» significa que la lectura falló, no que falte la conexión.',
    'Configuración y credenciales de tu flota leídas al abrir la página; el detalle de cada renglón dice qué se midió y qué falta.',
    'Revisa la lista de faltantes de cada conexión y captura lo que pida.',
  ),
  // ── configuracion ──
  'configuracion.empresa': V(
    'La empresa', 'RFC de tu flota contra el que se valida cada CFDI de gasto.',
    'No se calcula: muestra el RFC guardado. Si no coincide con el receptor del comprobante, el motor marca el CFDI como no verificable.',
    'Configuración de tu flota. El RFC principal no se edita aquí.',
  ),
  'configuracion.rfcs_adicionales': V(
    'Otras razones sociales que facturas', 'RFC adicionales cuyos CFDI de gasto el motor acepta como tuyos.',
    'No se calcula: guarda la lista que escribes tras comprobar forma y dígito verificador del RFC. Guardar la lista vacía la borra.',
    'Configuración de tu flota. El máximo y la validación los aplica el servidor al guardar.',
    'Escribe un RFC por línea y pulsa «Guardar RFC adicionales».',
  ),
  'configuracion.ajustes': V(
    'Ajustes de tu operación', 'Parámetros que el motor usa para cuadrar tus viajes.',
    'No se calcula: es un formulario con rendimiento, factor de carga, precio del diésel, umbral de desviación y catálogo de cuentas. El servidor valida los valores al guardar.',
    'Configuración de tu flota. El ejemplo de kilómetros sale del viaje más reciente que tenga kilómetros recorridos.',
    'Ajusta los valores y guarda.',
  ),
  'configuracion.unidades': V(
    'Unidades calibradas', 'Placas con rendimiento y tanque propios, que ganan al valor por defecto.',
    'No se calcula: lista cada placa con su rendimiento base y su capacidad de tanque tal como están guardados.',
    'Configuración de tu flota. Sin placas calibradas, todas usan el rendimiento por defecto de arriba.',
  ),
  // ── conocimiento ──
  'conocimiento.ficha': V(
    'Ficha normativa', 'Una norma de la que depende una cifra de tu liquidación, con su estado de verificación.',
    'No se calcula: cada ficha muestra su instrumento, artículo o regla, su estado de verificación y dónde se aplica en el cálculo. Con una ficha sin verificar o contradicha, Likida no afirma nada.',
    'Corpus de normas incluido en la aplicación; es el mismo para todas las flotas. «Revisada el» es la fecha de verificación de la ficha.',
    'Abre «Leer la fuente» y confirma con tu contador antes de decidir con una ficha corroborada.',
  ),
  // ── contador ──
  'contador.iva_liquidaciones': V(
    'IVA acreditable de tus liquidaciones', 'IVA acreditable que el motor calculó al cerrar tus liquidaciones del ejercicio.',
    'Suma el IVA acreditable guardado en cada liquidación de tu flota, desde el 1 de enero hasta hoy. Es aritmética de columnas ya calculadas por el motor; no recalcula el impuesto.',
    'Liquidaciones de tu flota, ejercicio en curso hasta hoy en México. Si la lectura falla, la sección dice que no se pudo cargar.',
  ),
  'contador.estimulo_peaje': V(
    'Estímulo de peaje 50%', 'Estímulo de peaje de tus liquidaciones del ejercicio, sujeto a elegibilidad.',
    'Suma el estímulo de peaje guardado en cada liquidación de tu flota, desde el 1 de enero hasta hoy. La nota indica que la base es el subtotal sin IVA de casetas con CFDI.',
    'Liquidaciones de tu flota, ejercicio en curso. No es un derecho ya ganado: depende de la elegibilidad.',
  ),
  'contador.recuperable': V(
    'Recuperable pidiendo factura', 'Gasto cuya factura aún se puede pedir.',
    'Suma el monto de los gastos del ejercicio cuya causa dominante de pérdida es de las que se arreglan pidiendo la factura. No es IVA: es el monto del gasto.',
    'Gastos fiscales de tu flota del ejercicio en curso. Si no se pudo calcular, muestra un error con «Reintentar», no 0.',
    'Pide la factura a los proveedores que el motor señala abajo.',
  ),
  'contador.diesel_elegible': V(
    'Diésel elegible para el estímulo', 'Litros de diésel de tus liquidaciones del ejercicio.',
    'Suma los litros de diésel elegibles guardados en cada liquidación, desde el 1 de enero hasta hoy. Se muestra en litros, no en pesos: la cuota semanal del DOF no se aplica aquí.',
    'Liquidaciones de tu flota, ejercicio en curso. Tu contador aplica la cuota que corresponde a cada fecha.',
  ),
  'contador.gasto_leido': V(
    'Gasto comprobado leído', 'Suma de los comprobantes leídos del ejercicio, con cuántos traen CFDI.',
    'Suma el monto de los comprobantes leídos del ejercicio. Es lo que salió de caja, no la base gravable. La nota cuenta cuántos comprobantes son, con y sin CFDI.',
    'Gastos fiscales de tu flota, ejercicio en curso. Sin comprobantes, la sección muestra un aviso en lugar de ceros.',
  ),
  'contador.iva_documentado': V(
    'IVA acreditable documentado', 'IVA que se puede documentar como acreditable con los CFDI leídos.',
    'Suma el IVA trasladado de comprobantes con CFDI cuya vigencia, emisor y deducibilidad no lo impiden. Con combustible prorrateado, es una estimación agregada que puede diferir de PDFs ya firmados.',
    'Gastos fiscales de tu flota, ejercicio en curso. Un CFDI sin desglose de IVA leído no se afirma.',
  ),
  'contador.iva_no_acreditable': V(
    'IVA desglosado que no se acredita', 'IVA desglosado de comprobantes que no lo sostienen.',
    'Suma el IVA de los comprobantes que no sostienen el acreditamiento, más la parte no deducible de los viáticos sobre el tope. Junto con el acreditable suma todo el IVA desglosado del periodo.',
    'Gastos fiscales de tu flota, ejercicio en curso.',
  ),
  // ── conversaciones ──
  'conversaciones.hilos': V(
    'Hilos de tu flota', 'Número de conversaciones de WhatsApp entre el bot y números de tu flota.',
    'Cuenta las conversaciones guardadas de tu flota. Si el conteo falla muestra «—»: eso no significa que no haya ninguna.',
    'Conversaciones de WhatsApp de tu flota, sin ventana de fechas. Solo el dueño y el superadmin ven esta pantalla.',
  ),
  'conversaciones.mensajes': V(
    'Mensajes en los hilos listados', 'Mensajes guardados en los hilos que se listan abajo.',
    'Suma los mensajes de los hilos listados, que son como máximo los 30 más recientes. Si hay más hilos, la cifra no los incluye.',
    'Ventana reciente de cada conversación: se guardan los últimos turnos, no el historial completo.',
  ),
  // ── cotizaciones ──
  'cotizaciones.costos': V(
    'Costos declarados de la flota', 'Costos que tú declaras y que el cotizador usa para sugerir un precio.',
    'No se calcula: guarda diésel y fijos por kilómetro, salario y viáticos por día, factor de regreso y markup objetivo. Un campo vacío es «sin declarar» y el cotizador no sugiere precio.',
    'Lo que declaras para tu flota; el cotizador no supone ningún valor por ti.',
    'Declara cada costo y pulsa «Guardar costos». Si no pagas viáticos, escribe 0.',
  ),
  'cotizaciones.nueva': V(
    'Nueva cotización', 'Formulario para cotizar una ruta con tus costos declarados.',
    'No se calcula aquí: al cotizar se arma un desglose con cada supuesto. Si la ruta tiene viajes liquidados, las casetas salen medidas de ellos y la captura manual se ignora.',
    'Costos declarados de tu flota, viajes liquidados de la ruta y los datos que escribes en el formulario.',
    'Llena la ruta y el precio y pulsa «Cotizar».',
  ),
  'cotizaciones.lista': V(
    'Cotizaciones', 'Lista de las cotizaciones de tu flota, con costo, precio y ganancia.',
    'Ganancia es el precio menos el costo estimado, con su porcentaje del precio. Si falta el precio o un dato del costo, dice qué falta y nunca muestra 0.',
    'Cotizaciones de tu flota, de la más reciente a la más antigua, sin ventana de fechas. El desglose citable muestra cada supuesto.',
    'En las cotizaciones vivas, márcalas como enviada o perdida, o conviértelas en viaje si tu rol puede despachar.',
  ),
  // ── descarga_sat ──
  'descarga_sat.intro': V(
    'Descarga del buzón del SAT', 'Explica qué baja esta pantalla del buzón del SAT y qué se necesita para usarla.',
    'No se calcula: es texto de contexto. Dice que la e.firma no se guarda en Likida y muestra si hay un proveedor conectado o el motivo por el que no.',
    'Estado de la configuración del proveedor de descarga al abrir la página.',
  ),
  'descarga_sat.bajados': V(
    'CFDI bajados del buzón', 'Total de CFDI únicos que se han descargado del buzón del SAT de tu flota.',
    'Cuenta todas las filas de comprobantes descargados de tu flota. Un mismo folio fiscal no entra dos veces. Es el total del que se reparten las otras cuatro cifras.',
    'Comprobantes descargados de tu flota, contados en la base, sin ventana de fechas. Si la lectura falla muestra «no se pudo leer», no 0.',
  ),
  'descarga_sat.casados': V(
    'Casaron solos con un gasto', 'CFDI descargados que quedaron ligados a un gasto sin intervención.',
    'Cuenta los comprobantes descargados con estatus «casado».',
    'Comprobantes descargados de tu flota, contados en la base, sin ventana de fechas.',
    'Abre «los que ya cuadraron» para ver la lista.',
  ),
  'descarga_sat.ambiguos': V(
    'Esperan que tú decidas', 'CFDI descargados con varios gastos posibles, sin uno elegido.',
    'Cuenta los comprobantes descargados con estatus «ambiguo». Likida no adivina cuál gasto corresponde.',
    'Comprobantes descargados de tu flota, contados en la base, sin ventana de fechas.',
    'Abre «los que esperan tu decisión» y elige el gasto.',
  ),
  'descarga_sat.disponibles': V(
    'Sin gasto que les corresponda', 'CFDI descargados que ningún gasto de tu flota reclama.',
    'Cuenta los comprobantes descargados con estatus «disponible».',
    'Comprobantes descargados de tu flota, contados en la base, sin ventana de fechas.',
    'Abre «los que ningún gasto reclama» y revisa si falta capturar un gasto.',
  ),
  'descarga_sat.ignorados': V(
    'Archivados a propósito', 'CFDI descargados que el motor archivó porque ya entraron por otro camino.',
    'Cuenta los comprobantes descargados con estatus «ignorado». Los cinco grupos suman el total de bajados.',
    'Comprobantes descargados de tu flota, contados en la base, sin ventana de fechas.',
  ),
  // ── facturacion ──
  'facturacion.cartera': V(
    'Lo que facturaste y lo que te deben', 'Cartera de las facturas que tu flota emitió, con lo cobrado y lo que falta por cobrar.',
    'Suma solo las facturas vivas (emitidas o pagadas). Las borradores y las canceladas no cuentan como cobrables. El saldo se reparte en cubetas de antigüedad y por cliente.',
    'Facturas emitidas de tu flota, sin ventana de fechas, fechadas contra un solo día de hoy en México. La tabla lista las 100 más atrasadas; las cifras son de todas.',
    'Registra una factura emitida con el botón de arriba si aún no la capturaste.',
  ),
  'facturacion.facturado': V(
    'Facturado a clientes', 'Total de las facturas emitidas vivas de tu flota.',
    'Suma el total de las facturas emitidas o pagadas. No incluye borradores ni canceladas.',
    'Facturas emitidas de tu flota, sin ventana de fechas.',
  ),
  'facturacion.cobrado': V(
    'Cobrado', 'Pagos registrados contra las facturas emitidas vivas.',
    'Suma lo pagado de cada factura emitida o pagada. Depende de que los pagos estén registrados en Likida.',
    'Facturas emitidas y pagos registrados de tu flota, sin ventana de fechas.',
  ),
  'facturacion.por_cobrar': V(
    'Por cobrar', 'Saldo vivo de las facturas emitidas con saldo pendiente.',
    'Suma el saldo de las facturas vivas con saldo mayor a un centavo. No incluye borradores ni canceladas. Es la suma de las cubetas de antigüedad.',
    'Facturas emitidas de tu flota, sin ventana de fechas.',
    'Revisa la antigüedad de saldos y el corte por cliente para decidir a quién cobrar primero.',
  ),
  'facturacion.vencido': V(
    'Vencido', 'Parte del saldo por cobrar que ya pasó su fecha pactada.',
    'Suma el saldo de las facturas cuya fecha de vencimiento ya pasó. Una factura sin días de crédito del cliente no tiene fecha y no entra aquí.',
    'Facturas emitidas de tu flota y días de crédito de cada cliente, contra el día de hoy en México.',
    'Captura los días de crédito del cliente si el aviso dice que faltan.',
  ),
  'facturacion.en_la_mesa': V(
    'Viajes liquidados que nadie facturó', 'Viajes con liquidación cerrada que no tienen una factura viva.',
    'Un viaje liquidado cuenta como facturado si lo ampara una factura emitida o pagada. Un borrador no cuenta; una factura cancelada devuelve el viaje a esta lista.',
    'Viajes liquidados y facturas de tu flota, contra el día de hoy en México. La lista muestra una parte y las cifras cuentan todos.',
    'Registra la factura de cada viaje de la lista.',
  ),
  'facturacion.sin_factura': V(
    'Viajes liquidados sin factura', 'Número de viajes liquidados que no tienen una factura viva.',
    'Cuenta los viajes liquidados sin factura emitida o pagada que los ampare. La nota da el total de viajes liquidados.',
    'Viajes liquidados y facturas de tu flota, sin ventana de fechas.',
  ),
  'facturacion.ingreso_sin_facturar': V(
    'Ingreso capturado sin facturar', 'Suma del ingreso de flete de los viajes sin factura que sí lo traen capturado.',
    'Suma el ingreso de flete de esos viajes. Los que no traen ingreso no entran a la suma, así que es un mínimo, no el total que dejaste de facturar.',
    'Ingreso capturado en los viajes liquidados sin factura de tu flota.',
    'Captura el ingreso de los viajes que no lo traen para completar la cifra.',
  ),
  'facturacion.mas_viejo': V(
    'El más viejo, sin facturar', 'Días que lleva sin facturarse el viaje liquidado más antiguo.',
    'Cuenta los días desde el cierre de la liquidación hasta hoy y toma el máximo. Si ningún viaje tiene fecha de cierre, muestra «—» y lo explica: no es cero días.',
    'Fecha de cierre de las liquidaciones de los viajes sin factura, contra el día de hoy en México.',
  ),
  'facturacion.auditor': V(
    'Auditor de cobranza', 'Cruce por viaje de lo pactado, lo entregado, lo facturado y lo cobrado.',
    'Para cada viaje iniciado en la ventana, compara el monto pactado con la prueba de entrega, las facturas y los pagos, y clasifica cada discrepancia en una cubeta con su monto.',
    'Viajes iniciados en los últimos 30 días de tu flota; la pantalla dice las fechas exactas. La lista muestra los primeros 25 hallazgos y el conteo cuenta todos.',
    'Abre cada hallazgo y corrige la factura, la prueba de entrega o el cobro que falta.',
  ),
  'facturacion.dinero_dormido': V(
    'Dinero dormido', 'Monto de viajes entregados que no tienen ninguna factura viva.',
    'Suma el monto de los hallazgos «entregado sin facturar». Los que no tienen monto resoluble no suman; la nota dice cuántos son, así que es un mínimo.',
    'Viajes iniciados en la ventana del auditor (30 días) de tu flota.',
    'Factura los viajes entregados de la lista.',
  ),
  'facturacion.facturado_de_menos': V(
    'Facturado de menos', 'Brecha entre lo pactado y lo que suman las facturas, en viajes facturados por debajo.',
    'Suma el monto de los hallazgos «facturado menor» que traen monto.',
    'Viajes iniciados en la ventana del auditor (30 días) de tu flota.',
    'Revisa esos viajes y emite el complemento o corrige la factura.',
  ),
  'facturacion.margen_medido': V(
    'Margen real medido', 'Pactado menos gastos liquidados, solo en viajes que tienen ambos datos.',
    'Suma el pactado y el total comprobado de los viajes que tienen las dos mitades y resta; el porcentaje es el margen sobre el pactado. Los viajes sin una mitad no se miden.',
    'Viajes iniciados en la ventana del auditor (30 días): pactado por tarifa o ingreso capturado y total comprobado de la liquidación.',
  ),
  // ── importador ──
  'importador.carga': V(
    'Carga desde Excel o CSV', 'Carga masiva en tres pasos: plantilla, revisión del archivo y confirmación.',
    'No se calcula: al revisar el archivo no se escribe nada y se cuentan las filas que entrarían, las que ya estaban y las que traen problema. Escribe solo si confirmas; el servidor vuelve a validar todo.',
    'El archivo que subes (CSV o Excel, con máximo de MB y de filas que dice la pantalla) y los datos ya existentes de tu flota.',
    'Descarga la plantilla, sube tu archivo, revisa los problemas y confirma.',
  ),
  'importador.nuevas': V(
    'Filas que entrarían', 'Filas del archivo que se darían de alta o se ligarían al confirmar.',
    'Antes de confirmar es una previsión: cuenta las filas leídas que cumplen las reglas. Tras confirmar, el rótulo cambia y es el número de filas que se escribieron.',
    'El archivo revisado, comparado con los datos de tu flota.',
    'Confirma solo si el número y la muestra coinciden con lo que esperabas.',
  ),
  'importador.ya_estaban': V(
    'Ya estaban', 'Filas del archivo que ya existen en tu flota y no se tocan.',
    'Cuenta las filas leídas que ya están en tu flota. No se modifican ni se duplican.',
    'El archivo revisado, comparado con los datos de tu flota.',
  ),
  'importador.con_problema': V(
    'Con problema', 'Filas del archivo que no entran, cada una con su motivo.',
    'Cuenta las filas que no pasan la validación (archivo, patio, otra flota o baja). La lista muestra hasta 300 problemas; esta cifra es el total.',
    'El archivo revisado, comparado con los datos de tu flota.',
    'Descarga el CSV de errores, corrige el archivo y revísalo de nuevo.',
  ),
  // ── legal ──
  'legal.responsable': V(
    'Responsable de privacidad de tu flota', 'Datos de tu empresa que aparecen en el aviso de privacidad que reciben tus choferes.',
    'No se calcula: guarda razón social, domicilio y contacto de privacidad. Si falta alguno, el aviso sale igual y dice qué falta.',
    'Datos guardados de tu flota. Solo el dueño puede editarlos; otros roles ven un texto que lo indica.',
    'Completa los tres datos y pulsa «Guardar datos del responsable».',
  ),
  'legal.documentos': V(
    'Documentos vigentes', 'Versión vigente de los Términos y del Aviso de privacidad, y si ya los aceptaste.',
    'No se calcula: compara las versiones que aceptó tu usuario contra las vigentes. Si ya aceptaste ambas, lo dice; si no, ofrece el botón de aceptación.',
    'Registro de aceptaciones de tu flota. Solo el dueño puede aceptar. Si la lectura falla, la página lo dice y no afirma que no aceptaste.',
    'Abre cada documento y, si eres el dueño, acepta las versiones vigentes.',
  ),
  'legal.mandato': V(
    'Mandato de autofacturación', 'Texto del mandato y su estado: otorgado, retirado o aún sin otorgar.',
    'No se calcula: muestra el texto vigente tal como está publicado, su versión y, si existe, la fecha en que se otorgó. Sin el mandato, Likida prepara las facturas pero no las emite.',
    'Registro de aceptaciones de tu flota. Otorgarlo o retirarlo lo hace el dueño; en algunas cuentas el mandato no está disponible y la página lo indica.',
    'Si eres el dueño y quieres que Likida emita en tu nombre, otórgalo con el botón.',
  ),
  // ── llaves_api ──
  'llaves_api.emitir': V(
    'Emitir una llave', 'Formulario para crear una llave de API de tu flota.',
    'No se calcula: al emitir, la llave se muestra una sola vez y de ella solo se guarda un hash. La vigencia que elijas fija cuándo deja de valer; una llave sin caducidad vale hasta que se revoque.',
    'Sesión del dueño de la flota: solo ese rol emite y revoca llaves. La lista de llaves de arriba sale de las llaves de tu flota.',
    'Copia la llave al emitirla; después no se puede volver a ver. Revoca desde la lista las que ya no uses.',
  ),
  // ── mi_perfil ──
  'mi_perfil.segundo_factor': V(
    'Segundo factor', 'Código de una app de autenticación como segundo paso de seguridad de tu cuenta.',
    'No se calcula: muestra si tienes un segundo factor activo y permite activarlo, verificar tu sesión con el código de 6 dígitos o quitarlo. Quitarlo exige el código.',
    'Factores de autenticación de tu cuenta. Activarlo hace que las acciones sensibles exijan el código.',
    'Activa el segundo factor y verifica tu sesión con el código de tu app.',
  ),
  'mi_perfil.sesiones': V(
    'Sesiones activas', 'Cierre de todas tus sesiones en todos los dispositivos.',
    'No se calcula: el botón cierra tu sesión en todos los dispositivos, incluida esta, y te manda a iniciar sesión de nuevo.',
    'Tu cuenta de acceso; no muestra una lista de sesiones, solo el cierre global.',
    'Úsalo si perdiste un teléfono o laptop donde quedaste conectado, o si sospechas que alguien entró.',
  ),
  'mi_perfil.clientes_mcp': V(
    'Clientes MCP conectados', 'Clientes externos con acceso de solo lectura a los datos de tu flota en tu nombre.',
    'No se calcula: lista los clientes conectados con tu usuario. El nombre lo declaró quien registró el cliente. Cortar el acceso corta todos los que tengas, no uno.',
    'Conexiones MCP de tu usuario en tu flota. Si la lectura falla, la página lo dice y no afirma que no tengas ninguna.',
    'Corta los accesos si no reconoces alguno; no hay deshacer.',
  ),
  // ── politicas ──
  'politicas.topes': V(
    'Topes por concepto', 'Tope por comprobante y exigencia de CFDI para cada concepto de gasto.',
    'No se calcula: son las reglas que el motor usa al cuadrar cada viaje. Vacío es sin tope; un 0 es tope de cero y el concepto deja de permitirse. El motor los trata distinto.',
    'Política de tu flota. Si no ha guardado la suya, usa la política base y la etiqueta lo dice. Solo un rol que puede administrar edita; los demás ven la tabla.',
    'Ajusta los topes y pulsa «Guardar política»; el motor los aplica desde el siguiente cuadre.',
  ),
  'politicas.reglas_ruta': V(
    'Reglas por ruta', 'Topes que aplican a una ruta concreta, de solo lectura.',
    'No se calcula: lista los topes por concepto y ruta tal como están guardados. Al guardar la política por concepto se conservan intactos; aquí no se editan.',
    'Política de tu flota, solo las reglas que traen ruta. La sección aparece únicamente si existen.',
  ),
  'politicas.topes_fiscales': V(
    'Topes fiscales que aplica el motor', 'Valores fiscales de la configuración que el motor usa al revisar gastos.',
    'No se calcula: muestra los valores de la configuración de tu flota (tope diario de alimentación, tope de efectivo, factor de peaje y umbral de desviación de consumo). No se editan desde aquí.',
    'Configuración de tu flota leída al abrir la página.',
  ),
  // ── proximamente ──
  'proximamente.que_hara': V(
    'Qué hará por tu operación', 'Lista fija de lo que hará un módulo que aún no está activo en tu cuenta.',
    'No se calcula: es texto fijo del módulo. Esta pantalla no consulta datos de tu flota ni envía mensajes.',
    'Descripción del módulo incluida en la aplicación; no depende de tu cuenta ni de tu rol.',
  ),
  // ── reglas ──
  'reglas.vigilancia': V(
    'Lo que sé vigilar hoy', 'Tipos de vigilancia que Likida puede declarar para tu rol, cada uno con un ejemplo.',
    'No se calcula: lista las plantillas de vigilancia disponibles para tu rol, con su título y un ejemplo de frase. Lo que no está aquí, Likida no lo vigila.',
    'Catálogo de vigilancias del producto, filtrado por tu rol.',
    'Escribe una vigilancia con una frase parecida a los ejemplos.',
  ),
  // ── soporte ──
  'soporte.abiertos': V(
    'Abiertos', 'Tickets de soporte de tu flota que no están resueltos ni cerrados.',
    'Cuenta los tickets con estado distinto de «resuelto» y «cerrado».',
    'Todos los tickets de soporte de tu flota, sin ventana de fechas, leídos al abrir la página.',
    'Abre el asunto de un ticket para ver la conversación con Likida.',
  ),
  'soporte.sla_vencido': V(
    'SLA vencido', 'Tickets abiertos cuyo plazo de atención ya pasó.',
    'Cuenta los tickets abiertos con fecha de vencimiento anterior al momento de abrir la página.',
    'Tickets de soporte de tu flota. El plazo es el que quedó pactado al abrir cada ticket.',
    'Abre el ticket y escribe en la conversación para dar seguimiento.',
  ),
  'soporte.sin_sla': V(
    'Sin SLA pactado', 'Tickets abiertos que no tienen plazo de atención.',
    'Cuenta los tickets abiertos sin fecha de vencimiento. No están vencidos: nadie les puso plazo.',
    'Tickets de soporte de tu flota, sin ventana de fechas.',
  ),
  // ── suscripcion ──
  'suscripcion.como_pagar': V(
    'Cómo pagar tu mensualidad', 'Datos para pagar por transferencia la factura de tu mensualidad que está pendiente.',
    'No se calcula: muestra beneficiario, banco, CLABE, monto y referencia de la factura pendiente. Si los datos bancarios o la referencia no están configurados, no muestra datos a medias.',
    'Factura pendiente de tu flota y datos bancarios configurados por Likida. La factura pasa a pagada cuando Likida ve el depósito en el estado de cuenta.',
    'Transfiere con la referencia exacta que se muestra.',
  ),
  'suscripcion.plan': V(
    'Tu plan', 'Plan contratado, mensualidad, fecha de inicio y próximo corte.',
    'No se calcula: son los datos guardados de tu suscripción. Sin precio configurado o sin fecha de corte, lo dice en lugar de mostrar 0.',
    'Suscripción de tu flota leída al abrir la página. Si la lectura falla, la página lo dice y no afirma que no tengas una.',
  ),
  'suscripcion.uso': V(
    'Lo que llevas este mes', 'Viajes creados en el mes y operadores activos, contra los límites de tu plan.',
    'Cuenta los viajes creados desde el primer día del mes en México y los operadores activos de tu flota. Un límite vacío significa sin límite, no cero.',
    'Viajes y operadores de tu flota al abrir la página; los límites son los de tu plan. Pasarse del límite no apaga nada.',
  ),
  'suscripcion.datos_factura': V(
    'Datos para tu factura', 'Datos fiscales con los que se emite el CFDI de cada mensualidad.',
    'No se calcula: guarda RFC, razón social, código postal, régimen, uso del CFDI, correo y domicilio fiscal. El RFC se valida al guardar. «Completos» o «Faltan» refleja si ya se puede facturar.',
    'Datos fiscales de tu flota. Solo el dueño los captura; otros roles ven un aviso.',
    'Cópialos tal cual de tu Constancia de Situación Fiscal y guarda.',
  ),
  'suscripcion.planes': V(
    'Planes', 'Planes disponibles con sus límites y el botón para contratar o cambiar.',
    'No se calcula: lista los planes y marca el actual. Sin cobro en línea conectado no hay botón de pago y la página lo dice. Contratar o cambiar de plan exige ser el dueño y tener los datos fiscales completos.',
    'Planes configurados por Likida y la suscripción de tu flota.',
    'Captura tus datos fiscales y elige el plan.',
  ),
  'suscripcion.facturas': V(
    'Tus facturas de Likida', 'Facturas de tu mensualidad con periodo, monto, estado de pago y CFDI.',
    'No se calcula: lista las facturas con su estado. Una factura pagada sin UUID se marca «Sin timbrar»: el dinero entró pero aún no hay CFDI.',
    'Las 12 facturas más recientes de tu flota; si hay más, la página lo avisa.',
  ),
  // ── usuarios ──
  'usuarios.equipo': V(
    'Tu equipo', 'Las cuentas con acceso al panel de tu flota, con su rol y WhatsApp.',
    'No se calcula: lista cada cuenta con su nombre, su rol, lo que ese rol puede hacer y su teléfono. Las cuentas dadas de baja siguen visibles, tachadas.',
    'Cuentas de tu flota leídas al abrir la página. Solo el dueño puede invitar, cambiar roles o dar de baja; otros roles ven la lista sin acciones.',
    'Si eres el dueño, invita a alguien o ajusta su rol desde la fila.',
  ),
} as const satisfies Record<string, InfoTexto>;
