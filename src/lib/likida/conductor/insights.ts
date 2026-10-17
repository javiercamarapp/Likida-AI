import type { FuenteHito, HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DEL CONDUCTOR (T-A5-31) — reglas deterministas, SIN IA, sin I/O.
//
// Responde tres preguntas con números que se pueden defender (12 §F4, agente 5):
//   1. ¿cuántos hitos se registraron SIN intervención de la oficina?
//   2. ¿cuántos minutos pasan entre el evento y su registro?
//   3. ¿cuántas llamadas se evitaron? (solo con la línea base del cliente)
// y cuenta las excepciones y la escalera de avisos.
//
// DEFINICIONES (las mismas que ve el usuario en la pantalla):
//  • HITO SIN INTERVENCIÓN = hito registrado (estado recibido o validado) con fuente
//    sistema | boton | texto | ubicacion. Un hito con fuente `oficina` es una corrección
//    o captura de la oficina y NUNCA cuenta. Una fuente `foto` o desconocida no se
//    cuenta como «sin intervención» (la ficha no la incluye); se reporta aparte.
//  • MINUTOS ENTRE EVENTO Y REGISTRO — dos medidas que NO se mezclan:
//      GPS    = registrado_en − detectado_en de la tabla de cruces: el retraso del propio SISTEMA
//               (la muestra de GPS que prueba el cruce vs. la hora en que se registró).
//      CHOFER = recibido_en − mensaje_en: el retraso de ENTREGA del mensaje.
//               NO es telemetría del evento físico: el chofer pudo llegar antes de escribir (regla del 0380).
//    Un retraso negativo (reloj desordenado) se descarta y se cuenta, nunca se promedia.
//  • LLAMADAS EVITADAS = hitos sin intervención × consultas por hito de la línea base.
//    Es una ESTIMACIÓN y solo existe si hay línea base positiva; sin ella es `null`
//    y se muestra el mensaje que la pide. Nunca se inventa un porcentaje de ahorro.
//
// Cada cifra lleva su `fuente` (tabla/columna) y su rótulo: «medido» o «estimación».
// ═══════════════════════════════════════════════════════════════════════════

export type Rotulo = 'medido' | 'estimación';

export interface Cifra<T> {
  valor: T;
  /** De dónde sale: tabla.columna. */
  fuente: string;
  rotulo: Rotulo;
}

/** Fuentes que cuentan como «sin intervención» de la oficina. */
export const FUENTES_SIN_INTERVENCION: readonly FuenteHito[] = ['sistema', 'boton', 'texto', 'ubicacion'];

/** Fuentes en que el dato lo manda el chofer (tienen `mensaje_en`). */
const FUENTES_CHOFER: readonly FuenteHito[] = ['texto', 'boton', 'ubicacion', 'foto'];

/** `viajeId` y `tipo` son opcionales: solo hacen falta para el KPI «viajes completos» (T-A5-61). */
export type HitoParaInsights = Pick<HitoFila, 'estado' | 'fuente' | 'mensajeEn' | 'recibidoEn'> & Partial<Pick<HitoFila, 'viajeId' | 'tipo'>>;

/** Una fila de `viaje_cruce_geocerca`. */
export interface CruceParaInsights {
  detectadoEn: string;
  registradoEn: string;
}

/** Un episodio de señal de vida (`viaje_senal_vida`): solo lo que se cuenta. */
export interface EpisodioParaInsights {
  motivo: string;
  aviso1En: string | null;
  aviso2En: string | null;
  escaladoEn: string | null;
}

export interface LineaBase {
  /** Llamadas/consultas por viaje (u hito) que se hacían antes. Debe ser > 0. */
  llamadasPorViaje: number | null;
  /** Fecha (AAAA-MM-DD) en que el cliente la dio. */
  registradaEn: string | null;
}

/** Líneas base que DECLARA el cliente para los KPIs del piloto (T-A5-61). `null`/ausente/inválida = no declarada. */
export interface LineaBasePiloto {
  /** % de hitos que hoy se registran sin intervención de la oficina (0–100). */
  hitosSinIntervencionPct?: number | null;
  /** Minutos que hoy tarda en quedar registrado un evento (> 0). */
  minutosGpsRegistro?: number | null;
  /** % de viajes con todos sus hitos registrados (0–100). */
  viajesCompletosPct?: number | null;
  /** Minutos de la salida de la terminal al primer cliente (> 0). */
  minutosSalidaTerminalPrimerCliente?: number | null;
  /** Reubicaciones por cliente que hoy se dan (≥ 0). */
  reubicacionesPorCliente?: number | null;
}

/** Datos extra del piloto que no salen de los hitos. Todo opcional: lo que no llega, queda «sin dato». */
export interface DatosPiloto {
  lineaBase?: LineaBasePiloto | null;
  /** Minutos por viaje de la salida de la terminal al primer cliente (se descartan negativos y no finitos). */
  minutosSalidaTerminalPrimerCliente?: readonly number[];
  /** Salida de `reubicacionesPorCliente` (T-A5-63): total de reubicaciones (`null` = sin dato) y clientes con dato. */
  reubicaciones?: { total: number | null; clientes: number } | null;
}

export interface EntradaInsights {
  hitos: readonly HitoParaInsights[];
  cruces: readonly CruceParaInsights[];
  episodios: readonly EpisodioParaInsights[];
  /** Viajes que el GPS no pudo evaluar por no tener sitio asignado (contador de la corrida). `null` = no disponible. */
  viajesSinSitio: number | null;
  lineaBase: LineaBase | null;
  piloto?: DatosPiloto;
}

export const SIN_DATO = 'sin dato' as const;

export type IdKpiPiloto =
  | 'hitos_sin_intervencion' | 'minutos_gps_registro' | 'viajes_completos' | 'mensajes_supervisor_evitados'
  | 'salida_terminal_primer_cliente' | 'reubicaciones_por_cliente';

export type ComparacionBase =
  | typeof SIN_DATO
  | { lineaBase: number; diferencia: number | null; mejoraPct: number | null; mejor: boolean | null };

export interface KpiPiloto {
  id: IdKpiPiloto;
  nombre: string;
  unidad: string;
  /** `null` = sin dato. */
  valor: number | null;
  rotulo: Rotulo;
  fuente: string;
  calculo: string;
  /** Comparación con la línea base declarada; «sin dato» si no hay base válida. */
  contraBase: ComparacionBase;
}

export interface RetrasoMinutos {
  /** Promedio exacto en minutos; `null` si no hay ninguna medición válida. */
  promedioMin: number | null;
  mediciones: number;
  descartadas: number;
  fuente: string;
  rotulo: 'medido';
  /** Qué mide (y qué NO). */
  nota: string;
}

export interface InsightsConductor {
  hitosRegistrados: Cifra<number>;
  sinIntervencion: Cifra<number> & { porcentaje: number | null };
  /** Registrados con fuente oficina. */
  deOficina: Cifra<number>;
  /** Registrados con fuente foto o sin fuente: no cuentan como sin intervención ni como oficina. */
  otraFuente: Cifra<number>;
  retrasoGps: RetrasoMinutos;
  retrasoChofer: RetrasoMinutos;
  llamadasEvitadas: (Cifra<number | null> & { mensaje: string });
  excepciones: {
    sinRespuesta: Cifra<number>;
    sinSitio: Cifra<number | null>;
    sinSenal: Cifra<number>;
  };
  escalera: {
    aviso1: Cifra<number>;
    aviso2: Cifra<number>;
    jefe: Cifra<number>;
  };
  /** Los KPIs del piloto (T-A5-61), siempre en el mismo orden; ver `docs/operacion/agente-conductor-piloto.md` §6. */
  kpisPiloto: KpiPiloto[];
}

export const MENSAJE_SIN_LINEA_BASE = 'Falta tu línea base: cuántas llamadas hacen hoy tus supervisores por viaje';

const resuelto = (h: HitoParaInsights) => h.estado === 'recibido' || h.estado === 'validado';

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

function promediar(pares: ReadonlyArray<readonly [string | null, string | null]>, fuente: string, nota: string): RetrasoMinutos {
  let suma = 0;
  let n = 0;
  let descartadas = 0;
  for (const [desde, hasta] of pares) {
    const a = ms(desde);
    const b = ms(hasta);
    if (a === null || b === null || b < a) { descartadas++; continue; }
    suma += (b - a) / 60_000;
    n++;
  }
  return { promedioMin: n > 0 ? suma / n : null, mediciones: n, descartadas, fuente, rotulo: 'medido', nota };
}

function fechaLegible(f: string | null): string {
  return f && /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : 'fecha no registrada';
}


const redondear1 = (n: number): number => Math.round(n * 10) / 10;

type TipoBase = 'pct' | 'minutos' | 'conteo';

/** Una base declarada es válida si es finita y: % en 0–100, minutos > 0, conteo ≥ 0. Si no, cuenta como no declarada. */
function baseValida(b: number | null | undefined, tipo: TipoBase): b is number {
  if (typeof b !== 'number' || !Number.isFinite(b)) return false;
  if (tipo === 'pct') return b >= 0 && b <= 100;
  if (tipo === 'minutos') return b > 0;
  return b >= 0;
}

function comparar(valor: number | null, base: number | null | undefined, tipo: TipoBase, menorEsMejor: boolean): ComparacionBase {
  if (valor === null || !baseValida(base, tipo)) return SIN_DATO;
  const dif = redondear1(valor - base);
  const mejor = menorEsMejor ? valor < base : valor > base;
  // El % de mejora solo existe donde «menos es mejor» y la base es > 0: dividir entre cero o inventar un % de puntos sería falsear.
  const mejoraPct = menorEsMejor && base > 0 ? redondear1(((base - valor) / base) * 100) : null;
  return { lineaBase: base, diferencia: dif, mejoraPct, mejor };
}

/** Viajes con todos sus hitos (no omitidos) registrados / viajes con algún hito que cuente. `null` si ningún hito trae viajeId. */
function porcentajeViajesCompletos(hitos: readonly HitoParaInsights[]): number | null {
  const porViaje = new Map<string, boolean>();
  for (const h of hitos) {
    if (!h.viajeId || h.estado === 'omitido') continue;
    porViaje.set(h.viajeId, (porViaje.get(h.viajeId) ?? true) && resuelto(h));
  }
  if (porViaje.size === 0) return null;
  const completos = [...porViaje.values()].filter(Boolean).length;
  return redondear1((completos / porViaje.size) * 100);
}

function calcularKpisPiloto(
  base: InsightsConductor['llamadasEvitadas'], sinInt: number | null, retrasoGps: number | null,
  hitos: readonly HitoParaInsights[], lineaBaseLlamadas: LineaBase | null, piloto: DatosPiloto | undefined,
): KpiPiloto[] {
  const lb = piloto?.lineaBase ?? null;

  const salidas = (piloto?.minutosSalidaTerminalPrimerCliente ?? []).filter((m) => Number.isFinite(m) && m >= 0);
  const salidaMedia = salidas.length > 0 ? redondear1(salidas.reduce((a, b) => a + b, 0) / salidas.length) : null;
  const salidaBase = lb?.minutosSalidaTerminalPrimerCliente;
  // Los dos KPIs de referencia (16b) solo se muestran con línea base declarada y válida.
  const salidaValor = baseValida(salidaBase, 'minutos') ? salidaMedia : null;

  const r = piloto?.reubicaciones ?? null;
  const reubMedia = r && r.total !== null && Number.isFinite(r.total) && r.total >= 0 && r.clientes > 0 ? redondear1(r.total / r.clientes) : null;
  const reubBase = lb?.reubicacionesPorCliente;
  const reubValor = baseValida(reubBase, 'conteo') ? reubMedia : null;

  const completos = porcentajeViajesCompletos(hitos);
  const llamadasBase = lineaBaseLlamadas?.llamadasPorViaje;

  return [
    {
      id: 'hitos_sin_intervencion', nombre: 'Hitos sin intervención', unidad: '% de hitos registrados',
      valor: sinInt, rotulo: 'medido', fuente: 'viaje_hito.fuente (sistema, botón, texto, ubicación)',
      calculo: 'hitos registrados por el sistema o el chofer ÷ hitos registrados × 100; los de la oficina no cuentan',
      contraBase: comparar(sinInt, lb?.hitosSinIntervencionPct, 'pct', false),
    },
    {
      id: 'minutos_gps_registro', nombre: 'Minutos del GPS al registro', unidad: 'min (promedio)',
      valor: retrasoGps === null ? null : redondear1(retrasoGps), rotulo: 'medido', fuente: 'viaje_cruce_geocerca.registrado_en − detectado_en',
      calculo: 'promedio de (registrado_en − detectado_en); se descartan los negativos y los sin fecha',
      contraBase: comparar(retrasoGps === null ? null : redondear1(retrasoGps), lb?.minutosGpsRegistro, 'minutos', true),
    },
    {
      id: 'viajes_completos', nombre: 'Viajes completos', unidad: '% de viajes',
      valor: completos, rotulo: 'medido', fuente: 'viaje_hito.estado por viaje',
      calculo: 'viajes con todos sus hitos no omitidos en recibido o validado ÷ viajes con algún hito que cuente × 100',
      contraBase: comparar(completos, lb?.viajesCompletosPct, 'pct', false),
    },
    {
      id: 'mensajes_supervisor_evitados', nombre: 'Mensajes del supervisor evitados', unidad: 'mensajes (estimación)',
      valor: base.valor, rotulo: 'estimación', fuente: base.fuente,
      calculo: 'hitos sin intervención × llamadas por viaje declaradas por el cliente; sin esa línea base no hay cifra',
      contraBase: baseValida(llamadasBase, 'conteo') && llamadasBase > 0
        ? { lineaBase: llamadasBase, diferencia: null, mejoraPct: null, mejor: null }
        : SIN_DATO,
    },
    {
      id: 'salida_terminal_primer_cliente', nombre: 'Tiempo de salida de terminal al primer cliente', unidad: 'min (promedio por viaje)',
      valor: salidaValor, rotulo: 'medido', fuente: 'mediciones por viaje de la salida de terminal al primer cliente (referencia 16b)',
      calculo: 'promedio de las mediciones válidas; solo se muestra con línea base declarada',
      contraBase: comparar(salidaValor, salidaBase, 'minutos', true),
    },
    {
      id: 'reubicaciones_por_cliente', nombre: 'Reubicaciones por cliente', unidad: 'reubicaciones por cliente',
      valor: reubValor, rotulo: 'medido', fuente: 'reubicacionesPorCliente (T-A5-63), bitácora de la llegada',
      calculo: 'reubicaciones totales ÷ clientes con dato; solo se muestra con línea base declarada',
      contraBase: comparar(reubValor, reubBase, 'conteo', true),
    },
  ];
}

export function calcularInsights(e: EntradaInsights): InsightsConductor {
  const registrados = e.hitos.filter(resuelto);
  const sinInt = registrados.filter((h) => h.fuente !== null && FUENTES_SIN_INTERVENCION.includes(h.fuente));
  const deOficina = registrados.filter((h) => h.fuente === 'oficina');
  const otra = registrados.filter((h) => h.fuente === null || h.fuente === 'foto');

  // GPS y chofer en grupos separados: nunca se mezclan.
  const delChofer = registrados.filter((h) => h.fuente !== null && FUENTES_CHOFER.includes(h.fuente));

  const base = e.lineaBase;
  const hayBase = !!base && typeof base.llamadasPorViaje === 'number' && Number.isFinite(base.llamadasPorViaje) && base.llamadasPorViaje > 0;
  const llamadas: InsightsConductor['llamadasEvitadas'] = hayBase
    ? {
        valor: sinInt.length * (base!.llamadasPorViaje as number),
        fuente: 'viaje_hito.fuente × agente_conductor_config.linea_base_llamadas_por_viaje',
        rotulo: 'estimación',
        mensaje: `Estimación con tu línea base de ${fechaLegible(base!.registradaEn)}`,
      }
    : {
        valor: null,
        fuente: 'agente_conductor_config.linea_base_llamadas_por_viaje',
        rotulo: 'estimación',
        mensaje: MENSAJE_SIN_LINEA_BASE,
      };

  const res: InsightsConductor = {
    hitosRegistrados: { valor: registrados.length, fuente: 'viaje_hito.estado', rotulo: 'medido' },
    sinIntervencion: {
      valor: sinInt.length,
      fuente: 'viaje_hito.fuente',
      rotulo: 'medido',
      porcentaje: registrados.length > 0 ? Math.round((sinInt.length / registrados.length) * 1000) / 10 : null,
    },
    deOficina: { valor: deOficina.length, fuente: 'viaje_hito.fuente', rotulo: 'medido' },
    otraFuente: { valor: otra.length, fuente: 'viaje_hito.fuente', rotulo: 'medido' },
    retrasoGps: promediar(
      e.cruces.map((c) => [c.detectadoEn, c.registradoEn] as const),
      'viaje_cruce_geocerca.registrado_en − detectado_en',
      'Retraso del propio sistema entre la muestra de GPS que prueba el cruce y su registro.',
    ),
    retrasoChofer: promediar(
      delChofer.map((h) => [h.mensajeEn, h.recibidoEn] as const),
      'viaje_hito.recibido_en − mensaje_en',
      'Retraso de entrega del mensaje del chofer; no mide cuándo ocurrió el evento físico.',
    ),
    llamadasEvitadas: llamadas,
    excepciones: {
      sinRespuesta: { valor: e.hitos.filter((h) => h.estado === 'escalado').length, fuente: 'viaje_hito.estado = escalado', rotulo: 'medido' },
      sinSitio: { valor: e.viajesSinSitio, fuente: 'corrida del GPS: viajes sin sitio asignado', rotulo: 'medido' },
      sinSenal: { valor: e.episodios.length, fuente: 'viaje_senal_vida', rotulo: 'medido' },
    },
    escalera: {
      aviso1: { valor: e.episodios.filter((x) => x.aviso1En !== null).length, fuente: 'viaje_senal_vida.aviso_1_en', rotulo: 'medido' },
      aviso2: { valor: e.episodios.filter((x) => x.aviso2En !== null).length, fuente: 'viaje_senal_vida.aviso_2_en', rotulo: 'medido' },
      jefe: { valor: e.episodios.filter((x) => x.escaladoEn !== null).length, fuente: 'viaje_senal_vida.escalado_en', rotulo: 'medido' },
    },
    kpisPiloto: [],
  };
  res.kpisPiloto = calcularKpisPiloto(
    llamadas, res.sinIntervencion.porcentaje, res.retrasoGps.promedioMin, e.hitos, e.lineaBase, e.piloto,
  );
  return res;
}
