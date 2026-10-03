// ═══════════════════════════════════════════════════════════════════════════
// LOS DATOS DE /estado (E4) — lectura PURA de lo que la guardia ya midió.
//
// La página es pública y de solo lectura: no escribe, no toca tablas de flotas
// y no llama a `/api/health` (ese endpoint tiene efectos: alerta al operador).
// Lee dos cosas que la guardia del servidor deja cada 5 minutos:
//   · el ÚLTIMO latido de `guardia`, cuyo `detalle.componentes` es el estado
//     actual (con la hora del propio latido: si es viejo, el estado actual es
//     «sin medición reciente», no el último ok);
//   · `estado_dia` (30 días de contadores) vía `estado_30_dias`.
//
// Una página pública sin tope es un amplificador: cada visita sería dos
// consultas. Se memoiza 60 s por instancia — el dato solo cambia cada 5 min.
// ═══════════════════════════════════════════════════════════════════════════

import { COMPONENTES_ESTADO, CADENCIA_MS, leerEstado30Dias, leerLatido, type ComponenteEstado, type EstadoMedido } from '@/lib/admin/salud';
import { diaMx, resumirEstado, type ResumenComponente } from '@/lib/admin/estado';

/** Un estado actual más viejo que tres cadencias de la guardia ya no es «actual». */
export const VIGENCIA_MEDICION_MS = 3 * CADENCIA_MS.guardia;
const TTL_MS = 60_000;
/** M3 (ronda 19): una lectura ROTA también se memoiza, pero poco: en una caída de la base todos refrescan la página y cada
 *  visita lanzaba dos consultas que colgaban ~8 s (amplificando la carga sobre la base degradada). 12 s: la página se
 *  recupera sola en cuanto la base vuelve y, mientras tanto, la carga es de 2 consultas por ventana y no por visita. */
export const TTL_FALLO_MS = 12_000;

export interface EstadoPublico {
  /** `true` si la medición más reciente cabe en la vigencia. */
  reciente: boolean;
  /** ISO del último latido de la guardia; `null` si nunca latió o no se pudo leer. */
  ultimaMedicion: string | null;
  actual: Record<ComponenteEstado, EstadoMedido | null>;
  resumen: ResumenComponente[];
  /** Falló la lectura del latido (no es lo mismo que «sin medición»). */
  latidoIlegible: boolean;
  /** Falló la lectura del historial de 30 días. */
  historialIlegible: boolean;
}

const VALIDOS: ReadonlySet<string> = new Set(['ok', 'degradado', 'caido']);

/** `detalle.componentes` sin confiar en su forma: lo que no es un estado conocido queda `null`. */
export function componentesDeDetalle(detalle: unknown): Record<ComponenteEstado, EstadoMedido | null> {
  const salida = Object.fromEntries(COMPONENTES_ESTADO.map((c) => [c, null])) as Record<ComponenteEstado, EstadoMedido | null>;
  if (detalle === null || typeof detalle !== 'object') return salida;
  const comps = (detalle as Record<string, unknown>).componentes;
  if (comps === null || typeof comps !== 'object') return salida;
  for (const c of COMPONENTES_ESTADO) {
    const v = (comps as Record<string, unknown>)[c];
    if (typeof v === 'string' && VALIDOS.has(v)) salida[c] = v as EstadoMedido;
  }
  return salida;
}

/** Arma el estado público a partir de lo leído (puro, probable sin base). */
export function armarEstadoPublico(
  latido: { ultimoLatido: string; detalle: Record<string, unknown> } | null | undefined,
  historial: Parameters<typeof resumirEstado>[0] | null,
  ahoraMs: number,
): EstadoPublico {
  const sinComponentes = componentesDeDetalle(null);
  const edad = latido ? ahoraMs - Date.parse(latido.ultimoLatido) : Infinity;
  const reciente = latido ? edad >= 0 && edad <= VIGENCIA_MEDICION_MS : false;
  return {
    reciente,
    ultimaMedicion: latido ? latido.ultimoLatido : null,
    // Un estado viejo NO se enseña como actual.
    actual: latido && reciente ? componentesDeDetalle(latido.detalle) : sinComponentes,
    resumen: resumirEstado(historial ?? [], COMPONENTES_ESTADO, diaMx(ahoraMs)),
    latidoIlegible: latido === undefined,
    historialIlegible: historial === null,
  };
}

let memo: { en: number; valor: EstadoPublico; ttl: number } | null = null;

/** Lo último que se leyó (bueno o roto), SIN tocar la base y sin importar su edad; `null` si nada. Para cuando no se debe consultar (rate limit). */
export function estadoMemoizado(): EstadoPublico | null {
  return memo ? memo.valor : null;
}

export async function cargarEstadoPublico(ahoraMs: number = Date.now()): Promise<EstadoPublico> {
  if (memo && ahoraMs - memo.en < memo.ttl && ahoraMs >= memo.en) return memo.valor;
  const [latido, historial] = await Promise.all([
    leerLatido('guardia').catch(() => undefined),
    leerEstado30Dias().catch(() => null),
  ]);
  const valor = armarEstadoPublico(latido, historial, ahoraMs);
  // Una lectura sana vale 60 s; una rota, 12 s (M3): se DICE que está rota (no se vuelve verde), pero no se reintenta por visita.
  memo = { en: ahoraMs, valor, ttl: valor.latidoIlegible || valor.historialIlegible ? TTL_FALLO_MS : TTL_MS };
  return valor;
}

/** Solo para pruebas. */
export function olvidarEstadoMemoizado(): void {
  memo = null;
}
