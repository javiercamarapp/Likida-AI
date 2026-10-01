import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo } from '../pg';
import { listarCasetas, listarUnidades } from './datos';
import {
  clasificarVerificacion, resumirVerificacion, textoMotivoGps,
  type EstadoConciliado, type MotivoVerificacion, type ResumenVerificacion,
} from './verificacion';

// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA CONCILIADA — el cruce del proveedor, línea por línea, con su
// estado honesto y exportable a CSV.
//
// A diferencia de la bitácora RMF 9.1.8 (`bitacoraRmf918`: solo las líneas que
// cuadran, para el documento fiscal), esta lista TODAS las líneas del desglose
// con uno de tres estados —cuadra / sin respaldo / por verificar— y el motivo.
// Es la herramienta del contralor para resolver lo que el agente no pudo
// afirmar, y el insumo del CSV a SAP/Excel. El estado se calcula al leer, con
// `clasificarVerificacion` (pura), sobre lo que el cruce dejó en cada línea.
// ═══════════════════════════════════════════════════════════════════════════

export const ETIQUETA_ESTADO: Record<EstadoConciliado, string> = {
  cuadra: 'cuadra',
  sin_respaldo: 'sin respaldo',
  por_verificar: 'por verificar',
};

export interface FilaConciliada {
  indice: number;
  fecha: string;
  hora: string;
  casetaProveedor: string;
  casetaCatalogo: string;
  tag: string;
  unidad: string;
  monto: number;
  estado: EstadoConciliado;
  motivo: MotivoVerificacion;
  explicacion: string;
  viaje: string;
  diferencia: number | null;
  gps: 'confirma' | 'no coincide' | 'sin datos' | 'sin evaluar';
  gpsDistanciaM: number | null;
  gpsNota: string;
}

export interface BitacoraConciliada {
  desgloseId: string;
  proveedor: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  filas: FilaConciliada[];
  resumen: ResumenVerificacion;
  /** Líneas que el cruce no ha evaluado con GPS (desglose anterior a la 0375): conviene re-conciliar. */
  sinEvaluarGps: number;
  leyendas: readonly string[];
}

export const LEYENDAS_BITACORA_CONCILIADA: readonly string[] = [
  'Bitácora conciliada del desglose del proveedor de peaje: TODAS las líneas del archivo, cada una con su estado y el motivo. Es una herramienta de revisión: el estado es una anotación recalculable sobre el archivo, no un sello fiscal.',
  'cuadra = un gasto de caseta respalda el cobro (monto y día) y ninguna otra evidencia lo contradice.',
  'sin respaldo = hay tickets de caseta cargados en el periodo y ninguno respalda este cobro, y el GPS (si existe) tampoco lo confirma. Es un hecho sobre los datos de Likida; NO afirma que el cobro sea indebido.',
  'por verificar = el dato no alcanza para afirmar nada, o hay una señal que un humano debe mirar (monto distinto, dos gastos igual de posibles, TAG de otra unidad, GPS que no ubica la unidad en la caseta, falta de fecha o de tickets cargados). El motivo dice qué falta.',
  'El GPS compara la trayectoria de la unidad contra las coordenadas de la caseta del catálogo (distancia Haversine) en una ventana de minutos alrededor de la hora del cobro; la hora es hora local de México tal como la trae el archivo. «sin datos» significa que el dato no alcanzó (sin hora, TAG sin dar de alta, caseta sin coordenadas, sin posiciones cerca) — no es evidencia en contra de nadie.',
];

const rotuloGps = (v: unknown): FilaConciliada['gps'] =>
  v === 'confirma' ? 'confirma' : v === 'no_coincide' ? 'no coincide' : v === 'sin_datos' ? 'sin datos' : 'sin evaluar';

export async function bitacoraConciliada(tenantId: string, desgloseId: string): Promise<BitacoraConciliada | null> {
  const admin = supabaseAdmin();
  const { data: desglose, error: errD } = await acotada(admin.from('desglose_peaje')
    .select('id, proveedor, periodo_desde, periodo_hasta').eq('tenant_id', tenantId).eq('id', desgloseId).maybeSingle(), 'bitacora_conciliada.desglose');
  if (errD) throw new Error(`bitacoraConciliada: ${errD.message}`);
  if (!desglose) return null;

  const crudas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(admin.from('desglose_peaje_linea')
      .select('indice, fecha, hora, caseta, monto, tag, estatus, diferencia, detalle, viaje_id, unidad_id, caseta_id, gps_veredicto, gps_distancia_m, gps_detalle', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId)
      .order('indice').order('id').range(d, h), 'bitacora_conciliada.lineas'),
    'bitacora_conciliada.lineas',
  );

  const viajeIds = [...new Set(crudas.map((l) => l.viaje_id as string | null).filter((v): v is string => !!v))];
  const folioPorViaje = new Map<string, string>();
  if (viajeIds.length > 0) {
    const vs = await traerPorIds<{ id: unknown; folio: unknown }>(
      viajeIds,
      (tanda) => acotada(admin.from('viaje').select('id, folio').eq('tenant_id', tenantId).in('id', tanda), 'bitacora_conciliada.viajes'),
      'bitacora_conciliada.viajes',
    );
    for (const v of vs) folioPorViaje.set(String(v.id), String(v.folio ?? ''));
  }
  const [unidades, casetas] = await Promise.all([listarUnidades(tenantId), listarCasetas(tenantId)]);
  const ecoPorUnidad = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));
  const nombrePorCaseta = new Map(casetas.map((c) => [c.id, c.nombre]));

  let sinEvaluarGps = 0;
  const filas: FilaConciliada[] = crudas.map((l) => {
    const estatus = String(l.estatus) as 'cuadra' | 'no_cuadra' | 'sin_contraparte';
    const detalle = (l.detalle as Record<string, unknown> | null) ?? null;
    const gpsVeredicto = (l.gps_veredicto as 'confirma' | 'no_coincide' | 'sin_datos' | null) ?? null;
    const gpsDetalle = (l.gps_detalle as Record<string, unknown> | null) ?? null;
    const gpsMotivo = typeof gpsDetalle?.motivo === 'string' ? gpsDetalle.motivo : null;
    if (gpsVeredicto === null) sinEvaluarGps++;
    const v = clasificarVerificacion({ estatus, detalle, gpsVeredicto, gpsMotivo });
    return {
      indice: Number(l.indice),
      fecha: (l.fecha as string | null) ?? '',
      hora: l.hora ? String(l.hora).slice(0, 8) : '',
      casetaProveedor: (l.caseta as string | null) ?? '',
      casetaCatalogo: l.caseta_id ? (nombrePorCaseta.get(String(l.caseta_id)) ?? '') : '',
      tag: (l.tag as string | null) ?? '',
      unidad: l.unidad_id ? (ecoPorUnidad.get(String(l.unidad_id)) ?? '') : '',
      monto: Number(l.monto),
      estado: v.estado,
      motivo: v.motivo,
      explicacion: v.explicacion,
      viaje: l.viaje_id ? (folioPorViaje.get(String(l.viaje_id)) ?? '') : '',
      diferencia: l.diferencia === null || l.diferencia === undefined ? null : Number(l.diferencia),
      gps: rotuloGps(gpsVeredicto),
      gpsDistanciaM: l.gps_distancia_m === null || l.gps_distancia_m === undefined ? null : Number(l.gps_distancia_m),
      gpsNota: gpsVeredicto === 'sin_datos' ? textoMotivoGps(gpsMotivo) : '',
    };
  });

  return {
    desgloseId,
    proveedor: (desglose.proveedor as string | null) ?? null,
    periodoDesde: (desglose.periodo_desde as string | null) ?? null,
    periodoHasta: (desglose.periodo_hasta as string | null) ?? null,
    filas,
    resumen: resumirVerificacion(filas.map((f) => ({ estado: f.estado, monto: f.monto }))),
    sinEvaluarGps,
    leyendas: LEYENDAS_BITACORA_CONCILIADA,
  };
}

// ── El CSV ──────────────────────────────────────────────────────────────────

/**
 * Neutraliza la inyección de fórmulas (CSV injection): un texto del PROVEEDOR
 * que empiece con =, +, -, @, tab o retorno se abriría en Excel como fórmula.
 * Se antepone «'» a los TEXTOS peligrosos; los números no se tocan.
 */
export function celdaCsvSegura(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const ENCABEZADOS_CSV_CONCILIADA = [
  'linea', 'fecha_cruce', 'hora_cruce', 'caseta_proveedor', 'caseta_catalogo', 'tag', 'unidad_tag', 'monto', 'estado', 'motivo',
  'explicacion', 'viaje', 'diferencia_mxn', 'gps', 'gps_distancia_m', 'gps_nota',
] as const;

export function bitacoraConciliadaACsv(b: BitacoraConciliada): string {
  const r = b.resumen;
  const cab = [
    ...b.leyendas.map((l) => `# ${l}`),
    `# Desglose: ${b.desgloseId}${b.proveedor ? ` · Proveedor: ${b.proveedor}` : ''}${b.periodoDesde && b.periodoHasta ? ` · Periodo medido: ${b.periodoDesde} a ${b.periodoHasta}` : ''}`,
    `# Resumen: ${r.total} líneas · cuadra ${r.cuadra} ($${r.montoCuadra.toFixed(2)}) · sin respaldo ${r.sinRespaldo} ($${r.montoSinRespaldo.toFixed(2)}) · por verificar ${r.porVerificar} ($${r.montoPorVerificar.toFixed(2)})`,
    ...(b.sinEvaluarGps > 0 ? [`# Aviso: ${b.sinEvaluarGps} líneas no tienen evaluación GPS (el cruce es anterior a la hora del cobro): vuelve a conciliar el desglose para evaluarlas.`] : []),
    '#',
  ].map((l) => l.replace(/[\r\n]+/g, ' ')).join('\n');

  if (b.filas.length === 0) return `${cab}\n# (El desglose no tiene líneas.)\n`;
  const filas = b.filas.map((f) => [
    f.indice + 1, f.fecha, f.hora, f.casetaProveedor, f.casetaCatalogo, f.tag, f.unidad, f.monto,
    ETIQUETA_ESTADO[f.estado], f.motivo, f.explicacion, f.viaje, f.diferencia, f.gps, f.gpsDistanciaM, f.gpsNota,
  ].map(celdaCsvSegura).join(','));
  return `${cab}\n${ENCABEZADOS_CSV_CONCILIADA.join(',')}\n${filas.join('\n')}\n`;
}
