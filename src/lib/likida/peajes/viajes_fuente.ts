import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';

// ═══════════════════════════════════════════════════════════════════════════
// CONTRATO DEL CONSUMIDOR DE VIAJES Y POSICIONES CON `Icident` (T-A2-18).
//
// `Icident` = número de despacho → viaje; con él se trae la unidad y la
// caseta que cruzó. Este módulo SOLO define la forma de lo que el cruce
// cruce→viaje necesita y dos fuentes:
//   · `desdeTablaViajeLocal`: lee `viaje` local; funciona HOY sin API
//     (`icident` nace nulo: la tabla local aún no lo guarda).
//   · `desdeConectorTms`: interfaz + validador de contrato; se conectará
//     cuando el frente del conector TMS entregue la API (BLOQUEO EXTERNO).
// Solo lectura; sin red. No edita el conector (`conectores/tabla_propia`).
// ═══════════════════════════════════════════════════════════════════════════

export interface ViajeFuente {
  id: string;
  folio: string | null;
  /** Número de despacho del TMS; nulo mientras la fuente no lo entregue. */
  icident: string | null;
  /** Número económico de la unidad, tal como lo guarda la flota (no vacío). */
  unidadNumero: string;
  /** Fecha (YYYY-MM-DD): los viajes solo traen día, nunca hora. */
  inicio: string;
  fin: string | null;
  origen: string | null;
  destino: string | null;
}

export interface PosicionConViaje {
  unidad: string;
  icident: string;
  puntoInteres: string;
  /** Hora local sin zona, 'YYYY-MM-DDTHH:MM[:SS]'. */
  fechaHoraLocal: string;
  lat: number;
  lng: number;
}

export interface RangoFechas { desde: string; hasta: string }

/** Lo que un conector TMS debe poder entregar para esta vinculación. */
export interface FuenteTms {
  viajes(tenantId: string, rango: RangoFechas): Promise<unknown>;
  posiciones(tenantId: string, rango: RangoFechas): Promise<unknown>;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const fechaReal = (s: string): boolean => {
  if (!FECHA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const opcional = (v: unknown): string | null => (v === null || v === undefined ? null : texto(v));

export type Validado<T> = { ok: true; valor: T } | { ok: false; motivo: string };

export function validarViajeFuente(x: unknown): Validado<ViajeFuente> {
  if (!x || typeof x !== 'object') return { ok: false, motivo: 'viaje: no es un objeto' };
  const o = x as Record<string, unknown>;
  const id = texto(o.id);
  if (!id) return { ok: false, motivo: 'viaje: falta id' };
  const unidadNumero = texto(o.unidadNumero);
  if (!unidadNumero) return { ok: false, motivo: `viaje ${id}: unidadNumero vacío` };
  const inicio = texto(o.inicio);
  if (!inicio || !fechaReal(inicio)) return { ok: false, motivo: `viaje ${id}: inicio no es una fecha YYYY-MM-DD` };
  const fin = opcional(o.fin);
  if (o.fin != null && fin === null) return { ok: false, motivo: `viaje ${id}: fin vacío (usa null)` };
  if (fin !== null && !fechaReal(fin)) return { ok: false, motivo: `viaje ${id}: fin no es una fecha YYYY-MM-DD` };
  if (fin !== null && fin < inicio) return { ok: false, motivo: `viaje ${id}: fin anterior a inicio` };
  return { ok: true, valor: { id, folio: opcional(o.folio), icident: opcional(o.icident), unidadNumero, inicio, fin, origen: opcional(o.origen), destino: opcional(o.destino) } };
}

export function validarPosicionConViaje(x: unknown): Validado<PosicionConViaje> {
  if (!x || typeof x !== 'object') return { ok: false, motivo: 'posición: no es un objeto' };
  const o = x as Record<string, unknown>;
  const unidad = texto(o.unidad);
  if (!unidad) return { ok: false, motivo: 'posición: unidad vacía' };
  const icident = texto(o.icident);
  if (!icident) return { ok: false, motivo: 'posición: icident vacío' };
  const puntoInteres = texto(o.puntoInteres);
  if (!puntoInteres) return { ok: false, motivo: 'posición: puntoInteres vacío' };
  const fh = texto(o.fechaHoraLocal);
  if (!fh || !FECHA_HORA.test(fh) || !fechaReal(fh.slice(0, 10))) return { ok: false, motivo: 'posición: fechaHoraLocal inválida' };
  const lat = o.lat, lng = o.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, motivo: 'posición: lat fuera de rango' };
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, motivo: 'posición: lng fuera de rango' };
  return { ok: true, valor: { unidad, icident, puntoInteres, fechaHoraLocal: fh, lat, lng } };
}

export interface LoteValidado<T> { validos: T[]; rechazados: Array<{ indice: number; motivo: string }> }

function validarLote<T>(entrada: unknown, f: (x: unknown) => Validado<T>): LoteValidado<T> {
  if (!Array.isArray(entrada)) return { validos: [], rechazados: [{ indice: -1, motivo: 'la respuesta no es una lista' }] };
  const validos: T[] = [];
  const rechazados: LoteValidado<T>['rechazados'] = [];
  entrada.forEach((x, indice) => {
    const r = f(x);
    if (r.ok) validos.push(r.valor); else rechazados.push({ indice, motivo: r.motivo });
  });
  return { validos, rechazados };
}

/** Contrato del conector: lo inválido se aparta con su motivo, nunca se arregla ni se descarta en silencio. */
export async function desdeConectorTms(
  fuente: FuenteTms, tenantId: string, rango: RangoFechas,
): Promise<{ viajes: LoteValidado<ViajeFuente>; posiciones: LoteValidado<PosicionConViaje> }> {
  const [v, p] = await Promise.all([fuente.viajes(tenantId, rango), fuente.posiciones(tenantId, rango)]);
  return { viajes: validarLote(v, validarViajeFuente), posiciones: validarLote(p, validarPosicionConViaje) };
}

/**
 * Viajes de la tabla local `viaje` cuyo [inicio, fin] toca el rango. Solo
 * lectura. `unidad_id` → `numero_economico`; un viaje sin unidad o con
 * unidad sin número se aparta en `sinUnidad` (no se inventa una).
 * El viaje abierto (sin fecha_fin) cuenta si empezó antes del fin del rango.
 */
export async function desdeTablaViajeLocal(
  tenantId: string, rango: RangoFechas,
): Promise<{ viajes: ViajeFuente[]; sinUnidad: Array<{ id: string; folio: string | null }> }> {
  if (!fechaReal(rango.desde) || !fechaReal(rango.hasta) || rango.hasta < rango.desde) throw new Error('rango de fechas inválido');
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin()
      .from('viaje').select('id, folio, unidad_id, fecha_inicio, fecha_fin, origen, destino', conteo(d))
      .eq('tenant_id', tenantId).lte('fecha_inicio', rango.hasta)
      // A37-S53-09: cota inferior en la base (mismo criterio que el filtro de abajo: abierto, o terminó desde `desde`).
      .or(`fecha_fin.is.null,fecha_fin.gte.${rango.desde}`).order('id').range(d, h), 'peajes.viajes_fuente'),
    'peajes.viajes_fuente',
  );
  const tocan = filas.filter((f) => {
    const ini = typeof f.fecha_inicio === 'string' ? f.fecha_inicio.slice(0, 10) : null;
    if (!ini) return false;
    const fin = typeof f.fecha_fin === 'string' ? f.fecha_fin.slice(0, 10) : null;
    return fin === null || fin >= rango.desde;
  });
  const ids = [...new Set(tocan.map((f) => f.unidad_id).filter((x): x is string => typeof x === 'string'))];
  const numeros = new Map<string, string>();
  // A37-S53-09: solo las unidades de los viajes que tocan el rango (tandas de 100 ids: la URL de PostgREST tiene tope).
  for (let i = 0; i < ids.length; i += 100) {
    const tanda = ids.slice(i, i + 100);
    const us = await traerTodo<{ id: unknown; numero_economico: unknown }>(
      (d, h) => acotada(supabaseAdmin()
        .from('unidad').select('id, numero_economico', conteo(d)).eq('tenant_id', tenantId).in('id', tanda).order('id').range(d, h), 'peajes.viajes_fuente_unidades'),
      'peajes.viajes_fuente_unidades',
    );
    for (const u of us) if (typeof u.id === 'string' && typeof u.numero_economico === 'string') numeros.set(u.id, u.numero_economico);
  }
  const viajes: ViajeFuente[] = [];
  const sinUnidad: Array<{ id: string; folio: string | null }> = [];
  for (const f of tocan) {
    const num = typeof f.unidad_id === 'string' ? numeros.get(f.unidad_id) : undefined;
    const v = num ? validarViajeFuente({
      id: String(f.id), folio: f.folio ?? null, icident: null, unidadNumero: num,
      inicio: String(f.fecha_inicio).slice(0, 10), fin: typeof f.fecha_fin === 'string' ? f.fecha_fin.slice(0, 10) : null,
      origen: f.origen ?? null, destino: f.destino ?? null,
    }) : null;
    if (v && v.ok) viajes.push(v.valor);
    else sinUnidad.push({ id: String(f.id), folio: typeof f.folio === 'string' ? f.folio : null });
  }
  return { viajes, sinUnidad };
}

