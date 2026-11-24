// ═══════════════════════════════════════════════════════════════════════════
// GLOSARIO DEL SECTOR — vocabulario de transporte con cruces a EUA como DATOS tipados.
//
// Sirve para dos cosas: (1) armar el contexto de un prompt del modelo (`glosarioParaPrompt`) y (2) ayudas en pantalla («¿qué es un DODA?»).
// Cada término dice qué significa, quién lo usa y el riesgo de malinterpretarlo. Sin nombres de clientes, personas ni cifras de una flota.
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';

export type CategoriaTermino = 'documento' | 'servicio' | 'ubicacion' | 'seguridad' | 'equipo';

export interface Termino {
  id: string;
  termino: string;
  /** Siglas y variantes de escritura reales (sin acentos, minúsculas). */
  siglas: readonly string[];
  categoria: CategoriaTermino;
  significado: string;
  quienLoUsa: string;
  /** Qué pasa si se malinterpreta, y qué NO debe hacer el agente. */
  riesgo: string;
}

const t = (id: string, termino: string, siglas: string[], categoria: CategoriaTermino, significado: string, quienLoUsa: string, riesgo: string): Termino =>
  Object.freeze({ id, termino, siglas: Object.freeze(siglas), categoria, significado, quienLoUsa, riesgo });

export const GLOSARIO: readonly Termino[] = Object.freeze([
  t('ci', 'Carta o correo de instrucciones', ['ci', 'carta de instrucciones'], 'documento', 'Instrucción por servicio con referencia, planta, hora de cita, tipo de caja o tracto, accesorios y fechas de colocación, cruce y entrega.', 'cliente a flota', 'Sin instrucciones no se programa. Una instrucción nueva no es una confirmación.'),
  t('referencia', 'Referencia', ['ref', 'referencia', 'folio del servicio'], 'documento', 'Folio del servicio del cliente; llave para amarrar todos los datos. Puede cambiar.', 'cliente', 'Confundir referencia con número de caja: el cliente habla en referencia y la flota en caja. Cada respuesta debe traer ambas.'),
  t('ccp', 'Complemento de carta porte', ['ccp', 'cp', 'carta porte', 'cartaporte', 'timbrado'], 'documento', 'Documento fiscal timbrado que la unidad necesita para salir de patio y cruzar. Lo emite una persona (importación o cruces).', 'cliente lo pide; la flota lo emite', 'El agente NUNCA lo emite, corrige, valida ni promete hora de timbrado. La CP sellada no es POD.'),
  t('doda', 'DODA', ['doda'], 'documento', 'Documento de despacho aduanero. Si cambia el sello o la caja se necesita uno nuevo. Caduca. En importación, DODA sellado más remisión suele hacer de POD.', 'cruces, cliente, agente aduanal', 'Afirmar vigencia sin registro o entregar la carta porte sellada como si fuera POD.'),
  t('bol', 'BOL / packing list', ['bol', 'pl', 'bill of lading', 'packing list'], 'documento', 'Documento de carga firmado en planta; viaja en el porta papeles de la caja.', 'operador, planta', 'Operador que se va sin dejarlo.'),
  t('pod', 'Prueba de entrega (POD)', ['pod', 'prueba de entrega', 'comprobante de entrega'], 'documento', 'Prueba de que se entregó: sello, firma y fecha, o ticket de pesaje, o DODA sellado más remisión, según el cliente. Sin POD no se factura.', 'cliente (facturación)', 'Aceptar un archivo ilegible o la carta porte como POD. Prometer fecha del documento.'),
  t('entry', 'Entry / aviso de importación', ['entry', 'entry alert'], 'documento', 'Aviso de importación a EUA.', 'cruces, transfer', 'El agente no lo toca.'),
  t('avc', 'AVC / gafete / TAG / CAAT / SCAC', ['avc', 'gafete', 'tag', 'caat', 'scac'], 'documento', 'Identificadores del operador, del tracto y del transportista para registrar cruce y dar acceso. El operador presente debe coincidir con el declarado.', 'cruces, transfer', 'Operador distinto del declarado: la caja no sale.'),
  t('fianza', 'Fianza', ['fianza'], 'documento', 'Trámite por caja de línea extranjera; condiciona ingreso o QR según el cliente.', 'importación', 'Olvidarla bloquea el QR o el ingreso.'),
  t('seguro', 'Seguro, póliza, COI, tarjeta de circulación', ['seguro', 'poliza', 'coi', 'tarjeta de circulacion', 'vin'], 'documento', 'Documentos vigentes del tracto y de la caja que el cliente pide para despachar o confirmar tarifa.', 'cliente', 'Un documento vencido bloquea envíos. El agente solo responde si está registrado y vigente.'),
  t('rc', 'Confirmación de tarifa (RC) / tender', ['rc', 'rate confirmation', 'tender', 'loadconfirmation'], 'documento', 'Confirmación de tarifa y de carga, que se acepta y se pide para facturar.', 'cliente y flota', 'El agente nunca acepta ni comenta tarifas.'),
  t('layout', 'Layout', ['layout'], 'documento', 'Archivo del cliente con datos para la carta porte, o la orden de carga de la planta.', 'cliente, planta', 'Sin layout no cargan o no se timbra: el retraso es ajeno a la flota.'),
  t('ficha', 'Ficha de unidad', ['ficha', 'datos de la unidad', 'datos', 'ficha remolque', 'datos de las cargas'], 'servicio', 'Bloque con caja (línea, número, placas, estado), unidad (económico, placa) y operador; a veces licencia, vigencia y celular.', 'cliente pide; el equipo de servicio arma', 'Una placa o caja mal causa rechazo en acceso. Contiene datos personales: política de privacidad por flota.'),
  t('cuenta_espejo', 'Cuenta espejo / enlace de rastreo', ['ce', 'cuenta espejo', 'link', 'link de rastreo', 'espejo'], 'servicio', 'Enlace de seguimiento de la unidad que ve el cliente. Expira.', 'cliente pide; la flota entrega', 'Un enlace vencido es una segunda petición. No enviar el enlace de otra unidad.'),
  t('eta', 'ETA', ['eta', 'hora de llegada', 'hr de llegada'], 'servicio', 'Hora estimada de llegada. Distinguir llegada a patio de llegada a planta, y la zona horaria.', 'todos', 'Un ETA que cambia sin causa es el principal detonante de enojo. El agente nunca calcula ni promete un ETA.'),
  t('etd', 'ETD / hora de salida', ['etd', 'hora de salida', 'hr de salida'], 'servicio', 'Hora de salida; no es la hora de llegada.', 'todos', 'Presentar la salida como si fuera llegada.'),
  t('cita', 'Cita / ventana', ['cita', 'cita limite', 'ventana'], 'servicio', 'Hora fijada por el cliente o la planta para llegar.', 'cliente', 'Llegar tarde o, a veces, demasiado temprano.'),
  t('prealerta', 'Prealerta', ['pa', 'prealerta', 'pre alerta'], 'servicio', 'Aviso del cliente a la planta o caseta con unidad, operador, caja, placas y a veces sello. Sin ella no hay ingreso. La hace el cliente; la flota solo entrega los datos.', 'cliente', 'Un cambio de datos después de la prealerta obliga a rehacerla.'),
  t('qr', 'QR de acceso', ['qr'], 'servicio', 'Pase de ingreso a planta o recinto; se genera con datos de unidad y caja (8 campos).', 'cliente genera', 'Datos mal escritos generan un QR de otra caja; un QR con otro número de remolque se invalida.'),
  t('sello', 'Sello / candado electrónico / GPS de caja', ['sello', 'sellos', 'candado', 'candado satelital', 'gps de caja', 'precinto'], 'seguridad', 'Precinto numérico de la caja, candado satelital (debe marcar cerrado) y GPS de la caja. El número o la foto solo existen DESPUÉS de que la planta o el patio lo coloca.', 'todos', 'Sello distinto al declarado = rechazo. El agente nunca da, recuerda ni teclea un número de sello.'),
  t('luz_verde', 'Autorización de salida', ['luz verde', 'adelante con el viaje', 'salida', 'dar salida'], 'servicio', 'Autorización explícita del cliente para iniciar la ruta, normalmente tras ver las fotos. Nadie sale sin ella cuando el cliente la exige.', 'cliente', 'El agente jamás la emite ni la sugiere; solo registra la que dio el cliente y avisa a una persona.'),
  t('drop', 'Drop / colocación', ['drop', 'dropear', 'colocar', 'colocacion', 'posicionar', 'posicionamiento'], 'servicio', 'Dejar la caja en la planta sin esperar; se recolecta otro día. Para el transportista se vive como cancelación del servicio en vivo.', 'cliente, planta', 'Un drop mal colocado estorba la rampa.'),
  t('vivo', 'Carga en vivo', ['vivo', 'carga en vivo'], 'servicio', 'El operador espera mientras cargan. Opuesto al drop.', 'todos', 'Confundirlo con drop cambia el costo y el plan.'),
  t('quitapon', 'Quitapón (QP)', ['qp', 'quitapon', 'quita pon'], 'servicio', 'Caja vacía que se deja en lugar del drop recolectado; debe ir en los datos.', 'cliente, planta', 'Sin ese dato no los dejan ingresar.'),
  t('vacia', 'Vacía / empate / stock / pool', ['vacia', 'vacias', 'empate', 'stock', 'pool', 'inventario', 'nos deben cajas'], 'equipo', 'Caja vacía disponible; el stock son las cajas del cliente en patios de la flota; el pool es la lista diaria de cajas vacías válidas con su ubicación.', 'cliente exige', 'Duplicados, cajas que «figuran» pero no están, caja en taller reportada como disponible. Nunca confirmar disponibilidad por decisión propia.'),
  t('transfer', 'Transfer / tractor de patio', ['transfer', 'patiero', 'tractor de patio'], 'servicio', 'Tractor de frontera que cruza la caja entre patios, con horario acotado, vs tractor de ruta larga.', 'cruces', 'Pedir cruce fuera de la ventana.'),
  t('impo_expo', 'Importación / exportación', ['impo', 'expo', 'importacion', 'exportacion', 'subida', 'bajada'], 'servicio', 'Sentido del servicio. «Subida» hacia la frontera; «bajada» el regreso.', 'todos', 'Aplicar a una importación las reglas de exportación.'),
  t('team', 'Team / blindado / custodia / convoy', ['team', 'team driver', 'blindado', 'regular', 'custodia', 'custodias', 'convoy'], 'seguridad', 'Dos operadores; tracto blindado (siempre con team); tracto regular; escoltas de otra empresa con horario y datos propios.', 'cliente decide', 'Una instrucción regular con datos de blindado es una discrepancia a detectar. El agente no confirma identidad ni número de custodias.'),
  t('parador', 'Parador autorizado / ruta autorizada / reinicio', ['parador', 'ruta autorizada', 'reinicio', 'paro de motor', 'motivo de detencion'], 'seguridad', 'Paradas permitidas; toda otra parada se reporta de antemano. «Reinicio» es retomar tras detenerse mucho tiempo. El monitoreo del cliente pide el motivo.', 'monitoreo del cliente', 'Una parada no autorizada puede costar el veto de la flota. El agente no inventa motivos ni autoriza paradas.'),
  t('restriccion_horario', 'Restricción de horario', ['restriccion', 'restriccion de horario'], 'ubicacion', 'Ventana de una zona metropolitana sin camiones de carga; explica ETAs tardíos aunque la unidad esté cerca.', 'planta, ciudad', 'Interpretarlo como retraso de la flota.'),
  t('rojo', 'Rojo / modulación / inspección', ['rojo', 'modulacion', 'modulando', 'fila', 'semaforo', 'rayos', 'inspeccion'], 'servicio', 'Revisión aduanal física, módulo o fila. Tras un rojo el sello cambia y se necesita documento nuevo.', 'cruces', 'Prometer hora de cruce.'),
  t('extraordinario', 'Extraordinario', ['extraordinario', 'festivo', 'domingo'], 'servicio', 'Cruce en festivo o domingo, con costo y autorización humana.', 'cruces, gerencia', 'El agente nunca lo confirma ni lo cobra.'),
  t('falso', 'Falso / demora / estadía', ['falso', 'movimiento en falso', 'demora', 'demoras', 'estadia', 'estadias'], 'servicio', 'Cobro por servicio no realizado o por retención de equipo.', 'flota y cliente', 'Cotizar, aceptar o negar un cobro está prohibido para el agente.'),
  t('hazmat', 'Material peligroso', ['hazmat', 'msds', 'un'], 'seguridad', 'Carga que exige unidad y documentación especiales.', 'cliente', 'Flota limitada: no confirmar disponibilidad.'),
  t('linea', 'Línea / dueño de caja', ['linea', 'dueno de caja', 'propietario'], 'equipo', 'Prefijo del propietario del remolque. En el programa, línea es el transportista, cliente es el pagador y consignatario el destino.', 'todos', 'Confundir línea con cliente.'),
  t('economico', 'Económico', ['eco', 'economico', 'numero economico'], 'equipo', 'Número económico del tracto.', 'flota', 'Confundirlo con la placa.'),
  t('patio', 'Patio / recinto / almacén de colocación', ['patio', 'recinto', 'almacen'], 'ubicacion', 'Patio de la flota, del cliente o de un recinto con horario y cupo propios.', 'todos', 'Decir «en patio» sin aclarar de quién.'),
  t('estatus_planta', 'Estatus de planta', ['estatus', 'status'], 'servicio', 'Estado de la unidad en planta: esperando acceso, en sitio, en rampa, carga en proceso, cargado esperando liberación o documentos.', 'todos', 'Afirmar «ya cargó» sin estado registrado.'),
]);

const POR_ID = new Map(GLOSARIO.map((x) => [x.id, x]));
const POR_SIGLA = new Map<string, Termino>();
for (const x of GLOSARIO) for (const s of x.siglas) { const k = normalizar(s); if (!POR_SIGLA.has(k)) POR_SIGLA.set(k, x); }

/** Normaliza una sigla o variante («C.P.», «Cuenta  Espejo», «DODA») a su forma de búsqueda. */
export function normalizarSigla(s: string): string {
  return normalizar((s ?? '').replace(/\./g, ''));
}

/** Busca un término por id, sigla o variante exacta (sin acentos ni mayúsculas). null si no existe. */
export function buscarTermino(consulta: string): Termino | null {
  const k = normalizarSigla(consulta);
  if (!k) return null;
  return POR_ID.get(k) ?? POR_SIGLA.get(k) ?? null;
}

/** Términos del glosario cuyas siglas o nombre aparecen en un texto (para resaltar ayudas en pantalla). Sin repetir. */
export function terminosEnTexto(texto: string): Termino[] {
  const n = ` ${normalizar(texto ?? '')} `;
  const salida: Termino[] = [];
  for (const x of GLOSARIO) {
    if (x.siglas.some((s) => { const k = normalizarSigla(s); return k.length > 0 && n.includes(` ${k} `); })) salida.push(x);
  }
  return salida;
}

/** Texto compacto para meter en el prompt de un modelo: una línea por término. `categorias` filtra; por omisión todas. */
export function glosarioParaPrompt(opciones: { categorias?: readonly CategoriaTermino[]; maxTerminos?: number } = {}): string {
  const lista = GLOSARIO.filter((x) => !opciones.categorias || opciones.categorias.includes(x.categoria)).slice(0, opciones.maxTerminos ?? GLOSARIO.length);
  return lista.map((x) => `- ${x.termino} (${x.siglas.join(', ')}): ${x.significado} Riesgo: ${x.riesgo}`).join('\n');
}
