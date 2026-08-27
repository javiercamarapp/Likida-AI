import { round2 } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR DE ESTADÍAS Y DETENCIÓN (0207, ficha §8.3) — puro a propósito:
// hitos + política + presencia GPS entran ya leídos, episodios salen, y las
// pruebas cubren cada rama sin base de por medio (el molde es
// peajes/evidencia_gps.ts).
//
// ── EL RELOJ ES EL DE LOS HITOS, Y ESO SE DICE ─────────────────────────────
// llegada_en → regreso_en (0090) es la puerta a puerta en el sitio: "ya
// llegué" abre el episodio, "voy de regreso" lo cierra. La 0090 ya avisa que
// la hora es la del MENSAJE, no la del evento físico — por eso cada episodio
// declara su fuente. La presencia GPS (0207), cuando existe sitio dibujado y
// posiciones, es la medición INDEPENDIENTE que acompaña al reloj: el paquete
// que la flota le enseña a su cliente trae las dos, no una fundida con otra.
//
// ── EL DINERO ES PROPUESTA, Y FAIL-CLOSED ──────────────────────────────────
// Sin horas libres pactadas no hay "excedido" (no hay umbral que exceder);
// sin tarifa no hay monto; dentro de las horas libres no hay cobro. En los
// tres casos el episodio SALE — con sus minutos medidos y el motivo exacto de
// por qué no trae monto. Un episodio que exceda el pacto produce un renglón
// PROPUESTO para el contralor: el agente prepara, el humano factura (jamás se
// emite un CFDI desde aquí — eso vive en el circuito de facturación).
// ═══════════════════════════════════════════════════════════════════════════

/** El pacto vigente para un episodio. NULL en cualquier perilla = no pactado. */
export interface PoliticaDetencion {
  horasLibres: number | null;
  tarifaHora: number | null;
  moneda: string;
}

/** De dónde salió el pacto aplicado — el paquete citable lo dice. */
export type OrigenPolitica = 'cliente' | 'flota' | 'sin_politica';

/**
 * El pacto del cliente GANA sobre el de flota (mismo criterio que
 * `tarifa.cliente_id`, 0048). Sin ninguno de los dos, el episodio se mide
 * igual — solo que sin umbral ni tarifa contra los cuales valorarlo.
 */
export function resolverPolitica(
  clienteId: string | null,
  porCliente: ReadonlyMap<string, PoliticaDetencion>,
  deFlota: PoliticaDetencion | null,
): { politica: PoliticaDetencion | null; origen: OrigenPolitica } {
  const propia = clienteId ? porCliente.get(clienteId) : undefined;
  if (propia) return { politica: propia, origen: 'cliente' };
  if (deFlota) return { politica: deFlota, origen: 'flota' };
  return { politica: null, origen: 'sin_politica' };
}

export type FaseEpisodio =
  /** Llegó y no ha avisado regreso, con el viaje aún vivo: el reloj CORRE. */
  | 'corriendo'
  /** Llegada y regreso sellados: la ventana quedó medida. */
  | 'cerrado'
  /** El viaje se liquidó sin hito de regreso: la salida no es medible y no se
   *  inventa — los minutos quedan en null, jamás en "lo que haya durado". */
  | 'sin_salida_medible'
  /** regreso_en antes que llegada_en (un sello a mano, un reloj movido): la
   *  ventana es incoherente y se dice, en vez de calcular minutos negativos. */
  | 'sellos_incoherentes';

const ESTATUS_VIVOS: ReadonlySet<string> = new Set(['abierto', 'en_cuadre']);

export interface VentanaEpisodio {
  fase: FaseEpisodio;
  /** Minutos puerta a puerta en el sitio según los hitos. null cuando la fase
   *  no permite medirlos (sin salida medible, sellos incoherentes). */
  minutosSitio: number | null;
}

/**
 * La ventana del episodio a partir de los hitos. Devuelve null si no hay
 * llegada sellada: sin "ya llegué" no hay episodio que medir.
 */
export function ventanaDeViaje(
  v: { llegadaEn: string | null; regresoEn: string | null; estatus: string },
  ahoraIso: string,
): VentanaEpisodio | null {
  if (!v.llegadaEn) return null;
  const llegada = Date.parse(v.llegadaEn);
  if (Number.isNaN(llegada)) return null;

  if (v.regresoEn) {
    const regreso = Date.parse(v.regresoEn);
    if (Number.isNaN(regreso)) return { fase: 'sin_salida_medible', minutosSitio: null };
    if (regreso < llegada) return { fase: 'sellos_incoherentes', minutosSitio: null };
    return { fase: 'cerrado', minutosSitio: Math.floor((regreso - llegada) / 60_000) };
  }

  if (ESTATUS_VIVOS.has(v.estatus)) {
    const ahora = Date.parse(ahoraIso);
    // Una llegada "en el futuro" (reloj del servidor movido entre lecturas) no
    // produce minutos negativos: produce cero corriendo, que es lo que se ve.
    const minutos = Math.max(0, Math.floor((ahora - llegada) / 60_000));
    return { fase: 'corriendo', minutosSitio: minutos };
  }

  return { fase: 'sin_salida_medible', minutosSitio: null };
}

/** Por qué un episodio no trae monto. Cada motivo dice qué falta y de quién
 *  depende: pactar, dibujar, o nada (dentro de lo pactado no se cobra). */
export type MotivoSinMonto =
  | 'sin_minutos'
  | 'sin_horas_libres_pactadas'
  | 'dentro_de_horas_libres'
  | 'sin_tarifa_pactada';

export interface Detencion {
  horasLibres: number | null;
  /** Minutos por encima de las horas libres. null cuando no hay umbral o no
   *  hay minutos; 0 es un cero REAL (medido y dentro del pacto). */
  minutosExcedentes: number | null;
  /** Horas cobrables: hora o fracción iniciada (la convención de detención de
   *  los tarifarios — media hora excedida es una hora que la unidad no
   *  trabajó). null cuando no hay monto que proponer. */
  horasCobrables: number | null;
  monto: number | null;
  moneda: string | null;
  motivoSinMonto: MotivoSinMonto | null;
}

export function calcularDetencion(
  minutosSitio: number | null,
  politica: PoliticaDetencion | null,
): Detencion {
  const vacia = (motivo: MotivoSinMonto): Detencion => ({
    horasLibres: politica?.horasLibres ?? null,
    minutosExcedentes: null,
    horasCobrables: null,
    monto: null,
    moneda: null,
    motivoSinMonto: motivo,
  });

  if (minutosSitio === null) return vacia('sin_minutos');
  if (!politica || politica.horasLibres === null) return vacia('sin_horas_libres_pactadas');

  const libresMin = Math.round(politica.horasLibres * 60);
  const excedente = minutosSitio - libresMin;
  if (excedente <= 0) {
    return {
      horasLibres: politica.horasLibres,
      minutosExcedentes: 0,
      horasCobrables: null,
      monto: null,
      moneda: null,
      motivoSinMonto: 'dentro_de_horas_libres',
    };
  }

  if (politica.tarifaHora === null) {
    return {
      horasLibres: politica.horasLibres,
      minutosExcedentes: excedente,
      horasCobrables: null,
      monto: null,
      moneda: null,
      motivoSinMonto: 'sin_tarifa_pactada',
    };
  }

  const horasCobrables = Math.ceil(excedente / 60);
  return {
    horasLibres: politica.horasLibres,
    minutosExcedentes: excedente,
    horasCobrables,
    monto: round2(horasCobrables * politica.tarifaHora),
    moneda: politica.moneda,
    motivoSinMonto: null,
  };
}

/** La medición independiente del GPS, o el motivo exacto de su ausencia. */
export type EvidenciaSitio =
  | { tipo: 'medida'; primeraEnSitio: string; ultimaEnSitio: string; posiciones: number }
  | { tipo: 'sin_medicion'; motivo: 'sin_sitio_del_cliente' | 'sin_unidad' | 'sin_posiciones_en_sitio' };

export interface EpisodioEstadia {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  unidadId: string | null;
  unidadEconomico: string | null;
  sitioNombre: string | null;
  llegadaEn: string;
  descargaEn: string | null;
  regresoEn: string | null;
  fase: FaseEpisodio;
  minutosSitio: number | null;
  origenPolitica: OrigenPolitica;
  detencion: Detencion;
  evidencia: EvidenciaSitio;
}

export interface ViajeParaEstadia {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  clienteId: string | null;
  unidadId: string | null;
  estatus: string;
  llegadaEn: string | null;
  descargaEn: string | null;
  regresoEn: string | null;
}

export interface ContextoEstadias {
  politicaFlota: PoliticaDetencion | null;
  politicaPorCliente: ReadonlyMap<string, PoliticaDetencion>;
  clientePorId: ReadonlyMap<string, { nombre: string; geocercaId: string | null }>;
  geocercaPorId: ReadonlyMap<string, { nombre: string }>;
  unidadPorId: ReadonlyMap<string, { economico: string }>;
  /** viajeId → presencia medida (RPC 0207). Sin fila = sin posiciones en el
   *  radio, y el motivo lo pone `evidenciaDelEpisodio`, no un cero. */
  presenciaPorViaje: ReadonlyMap<string, { primera: string; ultima: string; n: number }>;
}

function evidenciaDelEpisodio(
  v: ViajeParaEstadia,
  ctx: ContextoEstadias,
): EvidenciaSitio {
  const cliente = v.clienteId ? ctx.clientePorId.get(v.clienteId) : undefined;
  if (!cliente?.geocercaId) return { tipo: 'sin_medicion', motivo: 'sin_sitio_del_cliente' };
  if (!v.unidadId) return { tipo: 'sin_medicion', motivo: 'sin_unidad' };
  const p = ctx.presenciaPorViaje.get(v.id);
  if (!p) return { tipo: 'sin_medicion', motivo: 'sin_posiciones_en_sitio' };
  return { tipo: 'medida', primeraEnSitio: p.primera, ultimaEnSitio: p.ultima, posiciones: p.n };
}

/**
 * Los episodios de la ventana, listos para la pantalla. Solo viajes con
 * llegada sellada (sin "ya llegué" no hay reloj). El orden es el de la cola
 * del contralor: primero lo que trae monto propuesto (mayor primero), luego
 * lo que corre, luego el resto por minutos.
 */
export function armarEpisodios(
  viajes: ReadonlyArray<ViajeParaEstadia>,
  ctx: ContextoEstadias,
  ahoraIso: string,
): EpisodioEstadia[] {
  const episodios: EpisodioEstadia[] = [];
  for (const v of viajes) {
    const ventana = ventanaDeViaje(v, ahoraIso);
    if (!ventana) continue;
    const { politica, origen } = resolverPolitica(v.clienteId, ctx.politicaPorCliente, ctx.politicaFlota);
    const cliente = v.clienteId ? ctx.clientePorId.get(v.clienteId) : undefined;
    const geocerca = cliente?.geocercaId ? ctx.geocercaPorId.get(cliente.geocercaId) : undefined;
    episodios.push({
      viajeId: v.id,
      folio: v.folio,
      origen: v.origen,
      destino: v.destino,
      clienteId: v.clienteId,
      clienteNombre: cliente?.nombre ?? null,
      unidadId: v.unidadId,
      unidadEconomico: v.unidadId ? ctx.unidadPorId.get(v.unidadId)?.economico ?? null : null,
      sitioNombre: geocerca?.nombre ?? null,
      llegadaEn: v.llegadaEn as string,
      descargaEn: v.descargaEn,
      regresoEn: v.regresoEn,
      fase: ventana.fase,
      minutosSitio: ventana.minutosSitio,
      origenPolitica: origen,
      detencion: calcularDetencion(ventana.minutosSitio, politica),
      evidencia: evidenciaDelEpisodio(v, ctx),
    });
  }
  episodios.sort((a, b) => {
    const montoA = a.detencion.monto ?? -1;
    const montoB = b.detencion.monto ?? -1;
    if (montoA !== montoB) return montoB - montoA;
    const corre = Number(b.fase === 'corriendo') - Number(a.fase === 'corriendo');
    if (corre !== 0) return corre;
    return (b.minutosSitio ?? -1) - (a.minutosSitio ?? -1);
  });
  return episodios;
}

export interface ResumenEstadias {
  total: number;
  corriendo: number;
  conMonto: number;
  /** Suma SOLO de los montos propuestos que existen. null si ningún episodio
   *  trae monto — una suma de nada no es $0. */
  montoPropuesto: number | null;
  moneda: string | null;
  sinPolitica: number;
  sinSalidaMedible: number;
}

export function resumirEstadias(episodios: ReadonlyArray<EpisodioEstadia>): ResumenEstadias {
  let corriendo = 0, conMonto = 0, sinPolitica = 0, sinSalida = 0;
  let suma = 0;
  let moneda: string | null = null;
  let monedasMezcladas = false;
  for (const e of episodios) {
    if (e.fase === 'corriendo') corriendo++;
    if (e.fase === 'sin_salida_medible' || e.fase === 'sellos_incoherentes') sinSalida++;
    if (e.origenPolitica === 'sin_politica') sinPolitica++;
    if (e.detencion.monto !== null) {
      conMonto++;
      suma += e.detencion.monto;
      if (moneda === null) moneda = e.detencion.moneda;
      else if (moneda !== e.detencion.moneda) monedasMezcladas = true;
    }
  }
  return {
    total: episodios.length,
    corriendo,
    conMonto,
    // Sumar pesos con dólares daría una cifra que no es de ninguna moneda:
    // con monedas mezcladas el total agregado se calla y los renglones hablan.
    montoPropuesto: conMonto > 0 && !monedasMezcladas ? round2(suma) : null,
    moneda: conMonto > 0 && !monedasMezcladas ? moneda : null,
    sinPolitica,
    sinSalidaMedible: sinSalida,
  };
}
