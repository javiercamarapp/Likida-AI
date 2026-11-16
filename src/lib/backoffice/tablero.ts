// TABLERO del Back-office: una lectura de las ocho áreas con estado honesto. Dos capas:
//   · PURA: `resumenFacturacion`, `resumenGastos`, `resumenContratos`, `resumenObligaciones`, `resumenCierres`, `estadosDeAreas`, `armarTablero`.
//   · IO: `leerTablero`, que lee cada fuente POR SU LADO (una que falla no tumba a las demás) y entrega `Lectura<…>` por fuente.
//
// Reglas: `no_disponible` (la tabla o el módulo aún no existe) NO es cero; `error` (no se pudo leer) NO es «todo en orden»; el estado de un área
// es lo que dicen sus datos, nunca un adjetivo. Gastos y comisiones llegan de los módulos de su lote; contratos y obligaciones se leen directo
// de sus tablas `bo_*` (conteos, nada más) para no depender de la forma de esos módulos.
import { hoyMx } from '@/lib/formato';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listarFacturasSaas, TECHO_FACTURAS_SAAS } from '@/lib/saas/transferencia';
import { candadoDeEntidad, leerEntidad, type CandadoEntidad, type EntidadGuardada } from './entidad';
import {
  deOtroLote, esCobradoDelMes, facturaInsumoDe, leerCierresRecientes, type CierreGuardado, type FacturaInsumo,
} from './cierre';
import { desdeRespuesta, leerSeguro, OK, type Lectura } from './lectura';
import { desplazarMes, diaMxDeInstante, diasCalendarioEntre, mesDeMx, ultimosMeses } from './periodo';
import { diasDeCierre } from './reporte';
import type { ComisionMes, GastoMes } from './tipos';

// ───────────────────────────── Áreas ─────────────────────────────

export type AreaId = 'facturacion' | 'contabilidad' | 'gastos' | 'comisiones' | 'nomina' | 'legal' | 'compliance' | 'reporting';
export const AREAS: readonly AreaId[] = ['facturacion', 'contabilidad', 'gastos', 'comisiones', 'nomina', 'legal', 'compliance', 'reporting'];

/** A dónde lleva cada tarjeta (la primera entrada es la principal). */
export const ENLACES_AREA: Record<AreaId, string> = {
  facturacion: '/admin/cobranza',
  contabilidad: '/admin/back-office/contabilidad',
  gastos: '/admin/back-office/gastos',
  comisiones: '/admin/back-office/comisiones',
  nomina: '/admin/back-office/contratistas',
  legal: '/admin/back-office/contratos',
  compliance: '/admin/compliance',
  reporting: '/admin/back-office/cierre',
};

/** Los enlaces secundarios del área de facturación y cobro (el resto de las áreas tiene uno). */
export const ENLACES_FACTURACION = ['/admin/cobranza', '/admin/costos-facturacion', '/admin/facturas'] as const;

/** operativa · bloqueada_entidad (falta razón social/RFC propios) · no_disponible (la tabla o módulo no existe: no es cero) · error (no se pudo
 *  leer) · compra (se compra, no se construye). */
export type EstadoArea = 'operativa' | 'bloqueada_entidad' | 'no_disponible' | 'error' | 'compra';

/** Corte del % de automatización por área (metricas-del-back-office.md §5). El método: 1.0 si el mecanismo ya corre en código o un agente
 *  diseñado lo resuelve completo con un humano solo aprobando; 0.5 si el agente prepara pero el paso central no tiene apoyo; 0 si no hay
 *  ni código ni agente diseñado. Es un ESTIMADO declarado a una fecha: solo sube cuando se construye una pieza o se destraba un bloqueante. */
export const AUTOMATIZACION_CORTE = '2026-08-15';
export const AUTOMATIZACION_POR_AREA: ReadonlyArray<{ id: AreaId; pct: number | null }> = [
  { id: 'facturacion', pct: 70 },
  { id: 'contabilidad', pct: 20 },
  { id: 'gastos', pct: 40 },
  { id: 'comisiones', pct: 35 },
  { id: 'nomina', pct: null }, // N/A: decisión de comprar
  { id: 'legal', pct: 45 },
  { id: 'compliance', pct: 85 },
  { id: 'reporting', pct: 90 },
];

// ───────────────────────────── Resúmenes puros ─────────────────────────────

export interface ResumenFacturacion {
  /** Cobrado (con IVA, con evidencia de banco) del mes en curso. */
  cobradoMesCent: number;
  nCobradasMes: number;
  /** Por cobrar (pendientes y fallidas). `null` si la lista llegó recortada: no se presenta como completa. */
  porCobrarCent: number | null;
  nPorCobrar: number | null;
  /** Cobrado por mes, los últimos 6 (mes en curso al final). `null` si la lista llegó recortada. */
  serieCobrado: Array<{ periodo: string; cent: number }> | null;
  /** Mensualidades del mes en curso por estado (canceladas fuera). */
  estadosMes: { cobradas: number; pagadasSinEvidencia: number; pendientes: number; fallidas: number };
  /** DSO: días promedio entre emisión y cobro de lo cobrado en los últimos 6 meses. `null` sin historial de cobros (no se reporta). */
  dsoDias: number | null;
  nParaDso: number;
  /** Días que lleva la mensualidad por cobrar más vieja. `null` si no hay ninguna o la lista llegó recortada. */
  masViejaDias: number | null;
}

/** PURA. Lo que el tablero necesita de la lista de facturas. `hoy` es el día de México (`AAAA-MM-DD`). */
export function resumenFacturacion(facturas: readonly FacturaInsumo[], truncada: boolean, periodo: string, hoy: string): ResumenFacturacion {
  const cobradasDe = (p: string) => facturas.filter((f) => esCobradoDelMes(f, p));
  const delMes = cobradasDe(periodo);
  const abiertas = facturas.filter((f) => f.estado === 'pendiente' || f.estado === 'fallida');
  const mensualidadesMes = facturas.filter((f) => f.periodoInicio.slice(0, 7) === periodo.slice(0, 7) && f.estado !== 'cancelada');

  const meses = ultimosMeses(periodo, 6);
  const recientes = meses.flatMap(cobradasDe);
  const dias = recientes
    .map((f) => {
      const emitida = diaMxDeInstante(f.creadaEn);
      const pagada = diaMxDeInstante(f.pagadaEn);
      return emitida === null || pagada === null ? null : diasCalendarioEntre(emitida, pagada);
    })
    .filter((d): d is number => d !== null && d >= 0);

  const antiguedad = abiertas
    .map((f) => {
      const emitida = diaMxDeInstante(f.creadaEn);
      return emitida === null ? null : diasCalendarioEntre(emitida, hoy);
    })
    .filter((d): d is number => d !== null);

  return {
    cobradoMesCent: delMes.reduce((s, f) => s + f.totalCent, 0),
    nCobradasMes: delMes.length,
    porCobrarCent: truncada ? null : abiertas.reduce((s, f) => s + f.totalCent, 0),
    nPorCobrar: truncada ? null : abiertas.length,
    serieCobrado: truncada ? null : meses.map((p) => ({ periodo: p, cent: cobradasDe(p).reduce((s, f) => s + f.totalCent, 0) })),
    estadosMes: {
      cobradas: mensualidadesMes.filter((f) => f.estado === 'pagada' && f.conciliadaEn !== null && (f.referenciaBanco ?? '').trim() !== '').length,
      pagadasSinEvidencia: mensualidadesMes.filter((f) => f.estado === 'pagada' && (f.conciliadaEn === null || (f.referenciaBanco ?? '').trim() === '')).length,
      pendientes: mensualidadesMes.filter((f) => f.estado === 'pendiente').length,
      fallidas: mensualidadesMes.filter((f) => f.estado === 'fallida').length,
    },
    // Con cero cobros no hay DSO que reportar (metricas-del-back-office.md §3): `null`, no 0.
    dsoDias: dias.length === 0 ? null : Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10,
    nParaDso: dias.length,
    masViejaDias: truncada || antiguedad.length === 0 ? null : Math.max(...antiguedad),
  };
}

export interface ResumenGastos {
  totalCent: number;
  n: number;
  conciliados: number;
  sinComprobante: number;
}

/** PURA. Los gastos del mes en conteos y total (MXN). «Conciliados» siempre se muestra como «n de m», nunca como porcentaje solo. */
export function resumenGastos(g: readonly GastoMes[]): ResumenGastos {
  return {
    totalCent: g.reduce((s, x) => s + x.totalCent, 0),
    n: g.length,
    conciliados: g.filter((x) => x.conciliado).length,
    sinComprobante: g.filter((x) => x.comprobante === 'sin_comprobante').length,
  };
}

export interface FilaContrato { vence_el: string | null; estado: string | null }
export interface ResumenContratos {
  /** Contratos que no están terminados ni en borrador. */
  vivos: number;
  /** Vencen en los próximos 30 días (hoy incluido). */
  vencenEn30: number;
  /** Ya vencieron y siguen sin terminarse. */
  vencidos: number;
  /** Sin fecha de vencimiento declarada: «sin fecha», jamás «vigente». */
  sinFecha: number;
  total: number;
}

export const DIAS_VENTANA_TABLERO = 30;

/** PURA. Conteos de contratos a partir de sus filas (`vence_el` null = «sin fecha declarada»). */
export function resumenContratos(filas: readonly FilaContrato[], hoy: string): ResumenContratos {
  const activos = filas.filter((f) => f.estado !== 'terminado');
  const dias = (f: FilaContrato): number | null => (f.vence_el === null ? null : diasCalendarioEntre(hoy, f.vence_el.slice(0, 10)));
  return {
    vivos: activos.filter((f) => f.estado === 'vigente' || f.estado === 'por_renovar').length,
    vencenEn30: activos.filter((f) => { const d = dias(f); return d !== null && d >= 0 && d <= DIAS_VENTANA_TABLERO; }).length,
    vencidos: activos.filter((f) => { const d = dias(f); return d !== null && d < 0; }).length,
    sinFecha: activos.filter((f) => f.vence_el === null).length,
    total: filas.length,
  };
}

export interface FilaObligacion { clave: string; estado_catalogo: string | null }
export interface ResumenObligaciones {
  catalogadas: number;
  /** Con el catálogo todavía «pendiente de contador» (un contador las revisa antes de la primera declaración). */
  pendientesDeContador: number;
}

/** PURA. */
export function resumenObligaciones(filas: readonly FilaObligacion[]): ResumenObligaciones {
  return { catalogadas: filas.length, pendientesDeContador: filas.filter((f) => (f.estado_catalogo ?? 'pendiente_de_contador') === 'pendiente_de_contador').length };
}

export interface ResumenCierres {
  /** El estado del cierre del mes ANTERIOR (el que toca cerrar ahora): `null` = aún sin borrador. */
  mesPorCerrar: { periodo: string; estado: CierreGuardado['estado'] | null };
  /** El cierre cerrado más reciente y sus días hábiles de cierre (`null` si no hay ninguno cerrado). */
  ultimoCerrado: { periodo: string; dias: number | null } | null;
  /** Días hábiles de cierre de los últimos cierres cerrados, del más viejo al más reciente. */
  serieDias: Array<{ periodo: string; dias: number | null }>;
}

/** PURA. De los cierres guardados a lo que muestra el tablero. */
export function resumenCierres(cierres: readonly CierreGuardado[], periodoActual: string): ResumenCierres {
  const porCerrar = desplazarMes(periodoActual, -1);
  const cerrados = cierres.filter((c) => c.estado === 'cerrado' && c.cerradoEn !== null).sort((a, b) => a.periodo.localeCompare(b.periodo));
  const conDias = cerrados.map((c) => ({ periodo: c.periodo, dias: diasDeCierre(c.periodo, c.cerradoEn) }));
  return {
    mesPorCerrar: { periodo: porCerrar, estado: cierres.find((c) => c.periodo === porCerrar)?.estado ?? null },
    ultimoCerrado: conDias.length === 0 ? null : conDias[conDias.length - 1],
    serieDias: conDias.slice(-6),
  };
}

// ───────────────────────────── El tablero ─────────────────────────────

export interface DatosTablero {
  periodo: string;
  hoy: string;
  entidad: Lectura<EntidadGuardada | null>;
  facturas: Lectura<{ filas: FacturaInsumo[]; truncada: boolean }>;
  gastos: Lectura<GastoMes[]>;
  comisiones: Lectura<ComisionMes>;
  contratos: Lectura<FilaContrato[]>;
  obligaciones: Lectura<FilaObligacion[]>;
  cierres: Lectura<CierreGuardado[]>;
}

export interface Tablero {
  periodo: string;
  candado: CandadoEntidad;
  estados: Record<AreaId, EstadoArea>;
  facturacion: Lectura<ResumenFacturacion>;
  gastos: Lectura<ResumenGastos>;
  comisiones: Lectura<ComisionMes>;
  contratos: Lectura<ResumenContratos>;
  obligaciones: Lectura<ResumenObligaciones>;
  cierres: Lectura<ResumenCierres>;
}

const mapear = <A, B>(l: Lectura<A>, f: (a: A) => B): Lectura<B> => (l.estado === 'ok' ? OK(f(l.dato)) : l);

/** El estado de un área según lo que se pudo leer de su fuente. */
function estadoDeLectura(l: Lectura<unknown>): EstadoArea {
  return l.estado === 'ok' ? 'operativa' : l.estado === 'no_disponible' ? 'no_disponible' : 'error';
}

/** PURA. El estado honesto de cada una de las ocho áreas. */
export function estadosDeAreas(d: DatosTablero, candado: CandadoEntidad): Record<AreaId, EstadoArea> {
  return {
    facturacion: estadoDeLectura(d.facturas),
    // Sin RFC propio la contabilidad fiscal no se evalúa: se dice «bloqueada», no «sin datos». Una entidad ilegible no se asume.
    contabilidad: candado === 'sin_rfc' ? 'bloqueada_entidad' : candado === 'desconocido' ? 'error' : estadoDeLectura(d.obligaciones),
    gastos: estadoDeLectura(d.gastos),
    comisiones: estadoDeLectura(d.comisiones),
    nomina: 'compra',
    legal: estadoDeLectura(d.contratos),
    // Compliance es una pantalla que ya existe (ARCO, retención, bitácora): este tablero solo enlaza, no mide.
    compliance: 'operativa',
    reporting: estadoDeLectura(d.cierres),
  };
}

/** PURA. Arma el tablero a partir de las lecturas. */
export function armarTablero(d: DatosTablero): Tablero {
  const candado = candadoDeEntidad(d.entidad);
  return {
    periodo: d.periodo,
    candado,
    estados: estadosDeAreas(d, candado),
    facturacion: mapear(d.facturas, (f) => resumenFacturacion(f.filas, f.truncada, d.periodo, d.hoy)),
    gastos: mapear(d.gastos, resumenGastos),
    comisiones: d.comisiones,
    contratos: mapear(d.contratos, (c) => resumenContratos(c, d.hoy)),
    obligaciones: mapear(d.obligaciones, resumenObligaciones),
    cierres: mapear(d.cierres, (c) => resumenCierres(c, d.periodo)),
  };
}

/** Lee las filas de una tabla `bo_*` (solo las columnas pedidas). Tabla ausente = `no_disponible`; un fallo = `error`. Nunca lanza. */
async function leerFilas<T>(tabla: string, columnas: string, limite: number): Promise<Lectura<T[]>> {
  try {
    const r = desdeRespuesta(await supabaseAdmin().from(tabla).select(columnas).order('id').limit(limite));
    return r.estado === 'ok' ? OK((r.dato ?? []) as unknown as T[]) : r;
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** Lee todo el tablero. Nunca lanza: cada fuente cae por su lado a `no_disponible` o `error`. */
export async function leerTablero(ahora: Date = new Date()): Promise<Tablero> {
  const periodo = mesDeMx(ahora);
  const hoy = hoyMx(ahora);
  const [entidad, facturas, gastos, comisiones, contratos, obligaciones, cierres] = await Promise.all([
    leerEntidad(),
    leerSeguro(async () => {
      const r = await listarFacturasSaas({ limite: TECHO_FACTURAS_SAAS });
      return { filas: r.filas.map(facturaInsumoDe), truncada: r.truncado };
    }),
    deOtroLote(async () => (await import('./gastos')).getGastosDelMes(periodo)),
    deOtroLote(async () => (await import('./comisiones')).leerComisionesDelMes(periodo)),
    leerFilas<FilaContrato>('bo_contrato', 'vence_el, estado', 2000),
    leerFilas<FilaObligacion>('bo_obligacion_fiscal', 'clave, estado_catalogo', 500),
    leerCierresRecientes(12),
  ]);
  return armarTablero({ periodo, hoy, entidad, facturas, gastos, comisiones, contratos, obligaciones, cierres });
}
