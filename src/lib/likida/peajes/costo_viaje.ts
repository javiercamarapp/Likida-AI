import { normalizarNombre } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-23 — COSTO POR VIAJE.
//
// Requisito del cliente: «yo no cobro GPS ni casetas, cobro viaje… quisiera entender que el viaje
// sí me da el movimiento correcto de costo». Por cada viaje con cruces ligados (T-A2-21):
//   · nº de cruces ligados, suma de importe, casetas distintas;
//   · cuántos de esos cruces son candidatos a reclamación (null = no se calcularon);
//   · cuántos cruces ambiguos lo tienen como posible viaje (NO suman: decide una persona);
//   · referencia opcional: mediana del costo de los viajes con el mismo origen→destino cuando hay
//     al menos `minViajes` (5), rotulada «referencia histórica, no es tarifa».
// NO inventa casetas esperadas ni «ruta correcta»: el cliente aún no lo pidió.
//
// PURO: sin base ni red; mismo insumo = mismo resultado, sin depender del orden de las líneas.
// Todo número lleva su fuente en el mismo objeto.
// ═══════════════════════════════════════════════════════════════════════════

export const MIN_VIAJES_REFERENCIA = 5;
export const ROTULO_REFERENCIA = 'referencia histórica, no es tarifa';

export interface LineaCosto { id: string; caseta: string | null; importe: number }

export interface VinculoCosto {
  lineaId: string;
  estado: 'ligado' | 'ambiguo' | 'sin_viaje' | 'sin_unidad' | 'conflicto';
  viajeId: string | null;
  candidatos: readonly string[];
}

export interface ViajeCosto { id: string; folio: string; origen: string | null; destino: string | null }

export interface ReferenciaViaje {
  aplica: boolean;
  /** Viajes con cruces ligados y el mismo origen→destino (el propio incluido). */
  nViajes: number;
  mediana: number | null;
  /** costo − mediana, en pesos; null si no aplica. */
  desviacion: number | null;
  /** (costo − mediana) / mediana en %, 1 decimal; null si no aplica o la mediana es 0. */
  desviacionPct: number | null;
  /** Por qué no aplica (vacío si aplica). */
  motivo: string;
  rotulo: string;
  fuente: string;
}

export interface CostoViaje {
  viajeId: string;
  folio: string;
  cruces: number;
  costo: number;
  casetasDistintas: number;
  /** Cruces ligados al viaje que son candidatos a reclamación; null = no se calcularon. */
  candidatos: number | null;
  /** Cruces ambiguos o en conflicto que lo tienen como posible viaje; no suman al costo. */
  ambiguos: number;
  aviso: string | null;
  /** Null si el viaje no tiene cruces ligados (no hay costo que comparar). */
  referencia: ReferenciaViaje | null;
  fuente: string;
}

export interface EntradaCostoViaje {
  lineas: readonly LineaCosto[];
  vinculos: readonly VinculoCosto[];
  viajes: readonly ViajeCosto[];
  /** Ids de línea que son candidatos a reclamación. `null`/ausente = no se calcularon. */
  lineasCandidatas?: ReadonlySet<string> | null;
}

const centavos = (n: number): number => Math.round(n * 100) / 100;

function mediana(ordenados: readonly number[]): number {
  const m = ordenados.length >> 1;
  return ordenados.length % 2 ? ordenados[m] : centavos((ordenados[m - 1] + ordenados[m]) / 2);
}

const ruta = (v: ViajeCosto | undefined): string | null => {
  const o = normalizarNombre(v?.origen ?? ''), d = normalizarNombre(v?.destino ?? '');
  return o && d ? `${o}→${d}` : null;
};

export function costoPorViaje(
  entrada: EntradaCostoViaje, opciones: { minViajes?: number } = {},
): Map<string, CostoViaje> {
  const minViajes = opciones.minViajes ?? MIN_VIAJES_REFERENCIA;
  const lineas = new Map(entrada.lineas.map((l) => [l.id, l]));
  const viajes = new Map(entrada.viajes.map((v) => [v.id, v]));
  const porLinea = new Map(entrada.vinculos.map((v) => [v.lineaId, v]));

  const ligadas = new Map<string, LineaCosto[]>();
  const ambiguos = new Map<string, number>();
  const tocados = new Set<string>();
  for (const [lineaId, v] of porLinea) {
    const l = lineas.get(lineaId);
    if (!l) continue; // vínculo de una línea ajena a este desglose
    if (v.estado === 'ligado' && v.viajeId) {
      tocados.add(v.viajeId);
      ligadas.set(v.viajeId, [...(ligadas.get(v.viajeId) ?? []), l]);
    } else if (v.estado === 'ambiguo' || v.estado === 'conflicto') {
      for (const c of new Set(v.candidatos)) {
        tocados.add(c);
        ambiguos.set(c, (ambiguos.get(c) ?? 0) + 1);
      }
    }
  }

  const costos = new Map<string, number>();
  for (const [id, ls] of ligadas) costos.set(id, centavos(ls.reduce((s, l) => s + l.importe, 0)));

  // Muestra de la referencia: viajes CON cruces ligados, agrupados por origen→destino.
  const muestra = new Map<string, number[]>();
  for (const [id, costo] of costos) {
    const r = ruta(viajes.get(id));
    if (r) muestra.set(r, [...(muestra.get(r) ?? []), costo]);
  }

  const out = new Map<string, CostoViaje>();
  for (const id of [...tocados].sort()) {
    const ls = ligadas.get(id) ?? [];
    const costo = costos.get(id) ?? 0;
    const cruces = ls.length;
    const candidatas = entrada.lineasCandidatas ?? null;
    const viaje = viajes.get(id);

    let referencia: ReferenciaViaje | null = null;
    if (cruces > 0) {
      const r = ruta(viaje);
      const valores = r ? [...(muestra.get(r) ?? [])].sort((a, b) => a - b) : [];
      const base = { rotulo: ROTULO_REFERENCIA, nViajes: valores.length };
      if (!r) {
        referencia = { ...base, aplica: false, mediana: null, desviacion: null, desviacionPct: null,
          motivo: 'El viaje no tiene origen o destino capturado: no hay con qué compararlo.', fuente: 'datos del viaje' };
      } else if (valores.length < minViajes) {
        referencia = { ...base, aplica: false, mediana: null, desviacion: null, desviacionPct: null,
          motivo: `Hay ${valores.length} ${valores.length === 1 ? 'viaje' : 'viajes'} con ese origen y destino: menos de ${minViajes}, no alcanza para una referencia.`,
          fuente: `viajes de este archivo con el mismo origen y destino (${valores.length})` };
      } else {
        const med = mediana(valores);
        referencia = { ...base, aplica: true, mediana: med, desviacion: centavos(costo - med),
          desviacionPct: med === 0 ? null : Math.round(((costo - med) / med) * 1000) / 10, motivo: '',
          fuente: `mediana del costo de ${valores.length} viajes de este archivo con el mismo origen y destino` };
      }
    }

    out.set(id, {
      viajeId: id, folio: viaje?.folio ?? '', cruces, costo,
      casetasDistintas: new Set(ls.map((l) => normalizarNombre(l.caseta ?? '')).filter((c) => c !== '')).size,
      candidatos: candidatas ? ls.filter((l) => candidatas.has(l.id)).length : null,
      ambiguos: ambiguos.get(id) ?? 0,
      aviso: cruces === 0 ? 'sin cruces ligados: el costo 0 es falta de cruces, no un viaje gratis' : null,
      referencia,
      fuente: cruces === 0 ? 'ningún cruce del archivo del proveedor quedó ligado a este viaje'
        : `suma del importe de ${cruces} cruces ligados del archivo del proveedor`,
    });
  }
  return out;
}
