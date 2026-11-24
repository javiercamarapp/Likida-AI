// ═══════════════════════════════════════════════════════════════════════════
// TAXONOMÍA DE SOLICITUDES — qué le piden al equipo de servicio al cliente de un transportista, y cómo reconocerlo en texto real.
//
// Los ids vienen de leer ~33,000 mensajes de grupos reales de transporte (cruces a EUA). Una misma petición lleva a menudo 2-3 tipos
// («hora de salida + programa»), así que el clasificador devuelve ETIQUETAS (varias a la vez), nunca un único tipo. Reconoce el habla
// telegráfica real: abreviaturas («hr», «xfas», «pls»), sin acentos, mayúsculas, «meurgen», referencias sueltas.
//
// ESTO NO CONTESTA NADA NI ES UNA INTENCIÓN GUARDADA: `INTENCIONES` tiene un CHECK en la base. Son etiquetas de lectura que alimentan
// `decidirAccion`. Lo que no se reconoce devuelve ['otro'] y va a una persona. `peticion.ts` (etiquetas de lectura previas) no se toca:
// aquí hay un puente (`etiquetasDeLectura`) para que ambas vistas coincidan.
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';
import { tiposDeSolicitud, type TipoSolicitud as TipoLectura } from '../peticion';

export const TIPOS_SOLICITUD = [
  'ficha_unidad', 'eta', 'cuenta_espejo', 'ccp', 'sello_foto', 'autorizacion_salida', 'estatus_planta_ingreso', 'estatus_cruce',
  'estatus_ruta_detencion', 'caja_vacia_colocacion', 'pool_programa', 'prealerta_acceso', 'qr_acceso', 'pod_doda', 'facturacion_documentos',
  'cancelacion_falso', 'cambio_instruccion', 'cambio_unidad_operador', 'incidencia', 'datos_operador', 'candado_gps_stock', 'custodia',
  'urgencia', 'otro',
] as const;
export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number];

export interface MetaSolicitud {
  definicion: string;
  /** Cuándo suele pedirse respecto a la cita o al hito (texto para ayudas en pantalla). */
  ventanaTipica: string;
  /** Es un modificador de prioridad, no un tipo de petición por sí mismo. */
  modificador?: boolean;
}

export const META_SOLICITUD: Readonly<Record<TipoSolicitud, MetaSolicitud>> = Object.freeze({
  ficha_unidad: { definicion: 'Datos de caja, unidad y operador de un servicio.', ventanaTipica: 'La noche previa y de madrugada; el cliente la quiere 1-3 h antes de la cita para la prealerta.' },
  eta: { definicion: 'Hora estimada de llegada a planta o patio, hora de salida, «cómo vamos».', ventanaTipica: '2-6 h antes de la cita (pico 1-3 h); cada 15-60 min si hay retraso.' },
  cuenta_espejo: { definicion: 'Enlace de seguimiento de la unidad (o su renovación cuando vence).', ventanaTipica: 'Con la ficha, al salir a ruta, 1-2 h antes de la llegada o cuando el enlace vence.' },
  ccp: { definicion: 'Pedir, urgir o corregir la carta porte (complemento) o el timbrado. El agente nunca la emite.', ventanaTipica: '1-6 h antes de la salida o del cruce; correcciones el mismo día.' },
  sello_foto: { definicion: 'Número o foto de sello, candado, GPS de caja, display y combustible.', ventanaTipica: '30-90 min antes de la cita; solo existe después de colocarse.' },
  autorizacion_salida: { definicion: 'Salida a ruta: la pide el equipo y la autoriza el cliente. El agente nunca la emite.', ventanaTipica: 'Tras cargar y sellar, antes de salir de planta o patio.' },
  estatus_planta_ingreso: { definicion: 'Acceso, rampa, carga y liberación en planta.', ventanaTipica: 'Desde la llegada a planta; cada 20-60 min si hay espera.' },
  estatus_cruce: { definicion: 'Cruce fronterizo: fila, modulación, inspección, folio, «cruzó».', ventanaTipica: 'Mañana y tarde; 1-4 h antes de la hora de cruce acordada.' },
  estatus_ruta_detencion: { definicion: 'Unidad detenida, reinicio, motivo, desvío o parada no autorizada.', ventanaTipica: 'Casi siempre madrugada y noche; el cliente lo ve por GPS.' },
  caja_vacia_colocacion: { definicion: 'Cajas vacías, colocación, empate, stock y disponibilidad.', ventanaTipica: '24 h antes o al llegar la unidad; listas diarias por la mañana.' },
  pool_programa: { definicion: 'Programa o forecast del día siguiente; pool o inventario de cajas.', ventanaTipica: 'Programa: tarde de D-1; inventario: antes del corte matutino.' },
  prealerta_acceso: { definicion: 'Prealerta no enviada o sin datos; operador sin ingreso en caseta.', ventanaTipica: 'Antes de llegar a planta o ya en caseta.' },
  qr_acceso: { definicion: 'QR de ingreso o retiro y los datos para generarlo.', ventanaTipica: '1-24 h antes del ingreso; madrugada.' },
  pod_doda: { definicion: 'Prueba de entrega (POD), DODA sellado, remisión, ticket de pesaje.', ventanaTipica: '12-48 h después de entregar (a veces semanas).' },
  facturacion_documentos: { definicion: 'Factura, confirmación de tarifa, fianza, seguro, tarjeta de circulación.', ventanaTipica: 'Variable; fianza al ingreso, seguro al despachar.' },
  cancelacion_falso: { definicion: 'Cancelar, reprogramar, dejar de drop, cobro de falso, demora o estadía.', ventanaTipica: 'La noche anterior o el mismo día.' },
  cambio_instruccion: { definicion: 'Cambio de destino, dirección, fecha o instrucción el mismo día.', ventanaTipica: 'Mismo día.' },
  cambio_unidad_operador: { definicion: 'Cambio de tracto, operador, caja o remolque.', ventanaTipica: 'A última hora, a menudo tras la prealerta.' },
  incidencia: { definicion: 'Falla, accidente, daño o rechazo de caja, robo o riesgo de seguridad.', ventanaTipica: 'En el momento.' },
  datos_operador: { definicion: 'Teléfono, ubicación o identidad del operador.', ventanaTipica: 'Cualquier hora; riesgo de ingeniería social.' },
  candado_gps_stock: { definicion: 'Candados y GPS para recolecciones: cuántos llevar, existencias.', ventanaTipica: 'Antes de recolecciones blindadas.' },
  custodia: { definicion: 'Custodios que se presentan; verificación de caja y custodia.', ventanaTipica: 'Salida de importación o blindado.' },
  urgencia: { definicion: 'Marca de prioridad sobre cualquier otra petición («me urge», «ASAP»).', ventanaTipica: 'Cualquiera.', modificador: true },
  otro: { definicion: 'Todo lo demás: lo no reconocido va siempre a una persona.', ventanaTipica: 'Cualquiera.' },
});

// Texto normalizado (sin acentos ni signos). Cuantificadores acotados: sin retroceso exponencial.
// Preprocesos: «qr de acceso» y «cp de cruce» no deben disparar estatus de planta ni de cruce.
const sinFalsosAcceso = (n: string): string => n.replace(/\bqr (de |para )?(acceso|ingreso|retiro)\b/g, 'qr').replace(/\bpre ?alerta\b/g, 'prealerta');
const sinDocsDeCruce = (n: string): string => n.replace(/\b(ccp|cp|cps|carta porte|doda|documentos?|docs?|papeles) (de |del |para )?cruces?\b/g, 'doc');

type Regla = readonly [TipoSolicitud, RegExp, ((n: string) => string)?];

const REGLAS: readonly Regla[] = [
  ['ficha_unidad', /\bdatos\b|\b(datos?|informacion)\b.{0,30}\b(unidad|unidades|operador|operadores|chofer|choferes|conductor|conductores|cajas?|cajitas?|camion|tracto|remolques?|termos?|thermos?|cargas?|referencias?)\b|\b(unidad|unidades|operador|caja)\b.{0,12}\bdatos\b|\b(tenemos|tendran|tienen|faltan?|falta|necesito|necesitamos|mandan|pasan) (los |sus )?datos\b|\bdatos (plis|pls|porfa|porfis|xfa|xfas|pf|por favor)\b|\blos datos\b|\bficha (de )?(unidad|remolque|caja)\b|\b(me )?faltan?\b.{0,20}\b(telefono|licencia|celular|apellido)\b|\bsegundo apellido\b|\b(confirman?|pasan?|mandan?) (el )?numero de caja\b/],
  ['eta', /\beta\b|\ba (que|q) (hr|hrs|hora|horas)\b|\b(hora|hr|hrs|horario) (de )?(salida|llegada|arribo)\b|\bcuando llega\b|\bya llego\b|\bya (viene|salio)\b|\b(status|estatus) cada\b|\bcada (media hora|hora|\d{1,2} ?(min|minutos|hr|hrs|horas?))\b|\bya son las\b|\bnuevo eta\b|\bmismo eta\b|\bpor que cambio\b.{0,12}\beta\b/],
  ['cuenta_espejo', /\bcuenta espejo\b|\bce de\b|\bmi ce\b|\blink (de )?(rastreo|seguimiento)\b|\blink\b.{0,20}\b(expiro|vencio|caduco|expirado|vencido)\b|\b(expiro|expirado|expiraron|caduco)\b|\bomnitracs\b|\bsamsara\b|\bpasan? (el )?link\b|\bcuenta espejo\b/],
  ['ccp', /\bccp\b|\bccps\b|\bcp\b|\bcps\b|\bcarta porte\b|\bcartaporte\b|\bcarta de porte\b|\btimbr\w{0,5}\b|\bfolio fiscal\b|\bcp de (cruce|transito)\b/],
  ['sello_foto', /\b(sello|sellos|candado|candados|precinto|precintos)\b|\bgps de (la )?caja\b|\bfotos? (de |del )?(tablero|display|combustible)\b|\bnivel de combustible\b|\bdisplay\b/],
  ['autorizacion_salida', /\badelante con el viaje\b|\bluz verde\b|\b(me|nos) (apoyan|ayudan|apoyas|ayudas) con (la )?salida\b|\bya (puedo|puedes|pueden) salir\b|\bautorizacion (para|de) salir\b|\bautorizacion de salida\b|\bdar (la )?salidas?\b|\bsalir a ruta\b|\bocupan autorizacion\b/],
  ['estatus_planta_ingreso', /\b(ya )?(le |nos |les )?(dieron|dan) acceso\b|\brampa\b|\bembarcador\b|\besperando (ingreso|acceso|carga)\b|\b(nos |me )?(ayudan|apoyan|ayudas|apoyas) con (el )?ingreso\b|\bcomo va la carga\b|\bya cargo\b|\bcomo (vamos|van|va|andamos)\b|\bstatus de cada caja\b|\bestatus de cada caja\b|\bsin ingreso\b|\bsin rampa\b|\bseguimos sin\b|\ben sitio\b/, sinFalsosAcceso],
  ['estatus_cruce', /\b(cruzo|cruzaron|cruzar|cruzamos|cruzan)\b|\bcruces?\b|\bmodulando\b|\bmodulacion\b|\binspeccion\b|\baduana\b|\ben fila\b|\bfolio de cruce\b|\bsemaforo\b|\bpatio nld\b|\ben patio\b|\bentregada\b|\bdoda\b.{0,20}\b(vigente|caduc\w+|vencid\w+)\b|\bvigente\b.{0,12}\bdoda\b/, sinDocsDeCruce],
  ['estatus_ruta_detencion', /\bdetenid[ao]s?\b|\bdetencion\b|\breinicio\b|\bdesvi\w{0,6}\b|\bparada\b|\bparadas\b|\bparador\b|\bparo total\b|\bno es parador\b|\bparo de motor\b|\bse visualiza\b|\bno esta autorizad[ao]\b/],
  ['caja_vacia_colocacion', /\bvacias?\b|\bcolocar\b|\bcolocando\b|\bcolocacion\b|\bcolocad[ao]s?\b|\bcoloquen\b|\bposicionar\b|\bposicionamiento\b|\bempate\b|\bstock\b|\bnos deben\b|\bdrop\b|\bdropear\b|\bcajitas?\b.{0,15}\b(colocar|dejar|vacias?)\b|\bintercambio\b/],
  ['pool_programa', /\bprograma\b|\bprogramas\b|\bprogramacion\b|\bprogramando\b|\bprogramad[ao]s?\b|\bforecast\b|\bpool\b|\binventario\b|\bciti?as? de manana\b|\b(para|de) manana\b.{0,10}\b(unidades?|servicios?|cajas?)\b/],
  ['prealerta_acceso', /\bprealerta\b|\bpre alerta\b|\bsin ingreso\b|\bcaseta\b|\boperador sin ingreso\b/, sinFalsosAcceso],
  ['qr_acceso', /\bqr\b/],
  ['pod_doda', /\bpod\b|\bdoda\b|\bremision\b|\bremisiones\b|\bticket de pesaje\b|\bacuse\b|\bcomprobante de entrega\b|\bsello,? firma\b/],
  ['facturacion_documentos', /\bfactura\w{0,4}\b|\bfacturar\b|\bcfdi\b|\brc\b|\brate confirmation\b|\btender\b|\bloadconfirmation\b|\bfianza\b|\bseguro\b|\bpoliza\b|\bcoi\b|\btarjeta de circulacion\b|\bvin\b|\bcarta responsiva\b/],
  ['cancelacion_falso', /\bcancel\w{0,8}\b|\breprogram\w{0,6}\b|\bno (enviar|envien|enviemos|colocar|coloquen|mandar|manden)\b|\bse queda de drop\b|\bretiren? (con todo|la caja|las cajas)\b|\bcon todo y caja\b|\bfalsos?\b|\bdemoras?\b|\bestadias?\b|\bcargo por\b|\bhabra cargo\b|\bhagan caso omiso\b|\bse les traspasa\b|\bnos van a cobrar\b|\bpenalizacion\b|\bextraordinario\b/],
  ['cambio_instruccion', /\bcambio de (destino|direccion|fecha|instruccion|instrucciones|planta)\b|\bentregar en\b|\bnuevo destino\b|\bcambiar (el )?destino\b|\ben lugar de (entregar|llevar)\b|\bnueva direccion\b/],
  ['cambio_unidad_operador', /\bcambio de (unidad|operador|tracto|caja|remolque|tractor|chofer)\b|\bcambiar (la |el )?(unidad|operador|tracto|caja|remolque|tractor|chofer)\b|\bcambiaron (la |el |al |los |las )?(unidad|operador|tracto|caja|remolque|tractor|chofer)\b|\bse cambio (la |el |al )?(unidad|operador|tracto|caja|remolque|tractor|chofer)\b|\bno le podemos estar cambiando\b/],
  ['incidencia', /\bllanta\b|\baccidente\b|\bfalla\b|\bfallo\b|\bfiltracion\b|\bgoteras?\b|\bolor\b|\brieles\b|\bbisagras?\b|\bdanad[ao]s?\b|\bdano\b|\balto total\b|\bse descompuso\b|\baveria\b|\bchoque\b|\brobo\b|\bsecador\b|\balternador\b|\bno marca cerrado\b|\brechaz\w{0,5} (de )?(la )?caja\b|\brechazan\b/],
  ['datos_operador', /\b(telefono|celular|numero|contacto|ubicacion|licencia|domicilio|nombre)\b.{0,6}\b(del|de el|de) (operador|chofer|conductor)\b|\bdonde (esta|anda|va) (el|ese) (operador|chofer|conductor)\b|\bpasame\b.{0,25}\b(operador|chofer)\b.{0,12}\b(telefono|celular|numero)\b|\b(operador|chofer|conductor)\b.{0,15}\b(telefono|celular)\b/],
  ['candado_gps_stock', /\bllev\w{0,5} \d{1,2} candados?\b|\bcandados? y gps\b|\binventario de (candados|gps)\b|\bstock de (candados|gps)\b|\b\d{1,2} candados?\b/],
  ['custodia', /\bcustodi\w{0,5}\b/],
  ['urgencia', /\b(urge|urgen|urgente|urgentes|urgencia|asap|meurge|meurgen|me urge|me urgen|nos urge|nos urgen)\b|\balguien en turno\b|\bchi+co{3,}s*\b|\brespuesta en \d{1,3} ?(min|minutos)\b|\b(cliente|lciente) (encima|presionando|molesto|escalando)\b|\bal cliente encima\b/],
];

// Señales que solo se ven en el texto SIN normalizar (la normalización quita los signos).
const URGENCIA_CRUDA = /\?{3,}|\bequipo\s*\?|!{2,}|\bchicooo+s?\b/i;

/** ¿El texto trae marcas de urgencia? Verbos, «equipo?», «???», «URGEN!!», «alguien en turno». */
export function detectarUrgencia(texto: string): boolean {
  const t = texto ?? '';
  if (URGENCIA_CRUDA.test(t)) return true;
  const n = normalizar(t);
  return REGLAS.some(([tipo, r]) => tipo === 'urgencia' && r.test(n));
}

/**
 * Etiquetas de solicitud que el texto contiene (varias a la vez). Si no reconoce nada devuelve ['otro']; nunca lanza ni devuelve [].
 * `urgencia` es modificador: puede venir sola («me urge»), junto a un tipo («me urge ccp») o junto a `otro` solo si nada más se reconoce.
 */
export function detectarSolicitudes(texto: string): TipoSolicitud[] {
  const bruto = typeof texto === 'string' ? texto : '';
  const n = normalizar(bruto);
  if (!n && !URGENCIA_CRUDA.test(bruto)) return ['otro'];
  const vistos = new Set<TipoSolicitud>();
  for (const [tipo, r, pre] of REGLAS) {
    if (tipo === 'urgencia') continue;
    const base = pre ? pre(n) : n;
    if (r.test(base)) vistos.add(tipo);
  }
  // «como vamos» solo es estatus de planta si no se refiere a otra cosa concreta.
  if (vistos.has('estatus_planta_ingreso') && vistos.size > 1 && /\bcomo (vamos|van|va|andamos)\b/.test(n)) {
    const sinGenerico = n.replace(/\bcomo (vamos|van|va|andamos)\b/g, ' ');
    const propio = REGLAS.find(([t]) => t === 'estatus_planta_ingreso')!;
    const base = propio[2] ? propio[2](sinGenerico) : sinGenerico;
    if (!propio[1].test(base)) vistos.delete('estatus_planta_ingreso');
  }
  // «drop» dentro de una cancelación es la modalidad, no una petición de colocación.
  if (vistos.has('cancelacion_falso') && vistos.has('caja_vacia_colocacion') && !/\bvacias?\b|\bcolocar\b|\bcolocando\b|\bcolocacion\b|\bposicionar\b|\bempate\b|\bstock\b|\bnos deben\b/.test(n)) vistos.delete('caja_vacia_colocacion');
  const urgente = detectarUrgencia(bruto);
  const salida = TIPOS_SOLICITUD.filter((t) => vistos.has(t));
  if (urgente) salida.push('urgencia');
  if (salida.length === 0) return ['otro'];
  return salida;
}

/** Puente con las etiquetas de lectura de `peticion.ts`: qué tipos nuevos cubre cada etiqueta previa. */
export const EQUIVALENCIA_LECTURA: Readonly<Record<TipoLectura, readonly TipoSolicitud[]>> = Object.freeze({
  ficha_unidad: ['ficha_unidad'],
  urgencia: ['urgencia'],
  cp_cruce: ['ccp'],
  hora_salida: ['eta'],
  caja_colocacion: ['caja_vacia_colocacion'],
  qr: ['qr_acceso'],
  programa: ['pool_programa'],
  estatus: ['estatus_planta_ingreso', 'estatus_cruce', 'eta'],
  sello_gps: ['sello_foto', 'cuenta_espejo'],
  pod_doda: ['pod_doda'],
});

/** Etiquetas nuevas que corresponden a las etiquetas de lectura previas del texto (útil para verificar que ambas vistas coincidan). */
export function etiquetasDeLectura(texto: string): TipoSolicitud[] {
  const fuera = new Set<TipoSolicitud>();
  for (const l of tiposDeSolicitud(texto)) for (const t of EQUIVALENCIA_LECTURA[l]) fuera.add(t);
  return TIPOS_SOLICITUD.filter((t) => fuera.has(t));
}

/** Tipos que son una petición de algo (todos menos `otro` y el modificador `urgencia`). */
export function tiposDePeticion(tipos: readonly TipoSolicitud[]): TipoSolicitud[] {
  return tipos.filter((t) => t !== 'otro' && t !== 'urgencia');
}
