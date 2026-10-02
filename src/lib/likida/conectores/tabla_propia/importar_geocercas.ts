import { createHash } from 'node:crypto';
import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import type { SitioCsv, TipoSitio } from '../../conductor/sitios';
import { importarSitios, type ResultadoImportacion } from '../../conductor/repo_validacion';
import { leerCredencial } from '../credenciales';
import { httpReal, type Http, type ValoresCredencial } from '../tipos';
import { ErrorTablaPropia, type FilaRechazada, type GeocercaTablaPropia, type LectorTablaPropia } from './contrato';
import { crearLectorTablaPropia } from './lector';
import { haversineM } from './validar';
import { poligonoGuardable } from '../../conductor/geo';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTADOR DE GEOCERCAS DE SU TABLA/CSV al catálogo de sitios del Conductor
// (el que consumen la conciliación de hitos, el cruce de peajes y el mapa).
//
//  · Círculo (centro + radio): entra tal cual.
//  · Polígono (P1, 0630): se guarda NATIVO (sus vértices) y la decisión «¿está dentro?» la
//    toma `dentroDeGeocerca()` contra el polígono. El catálogo conserva además el círculo que lo
//    CONTIENE (centro = promedio de vértices, radio = vértice más lejano, SIN inflarlo: antes +5 %,
//    que abarcaba la carretera de junto): es el respaldo de quien no conozca el polígono, siempre
//    lo cubre. Un polígono que no se puede guardar (más de 500 vértices o sin área) entra solo como
//    ese círculo y queda marcado `aproximada`: se REPORTA y quien acusa con él baja su confianza.
//    NO se inventa ni se simplifica en silencio.
//  · Todo-o-nada con la base (la RPC `importar_sitios_conductor` revisa clientes,
//    padres, nombres y polígonos): si una fila está mal, no se importa NINGUNA y se dice cuál.
//  · Re-importar es seguro: la llave es el código de su sistema (actualiza, no duplica).
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoSitios {
  filas: SitioCsv[];
  /** Polígonos que NO se pudieron guardar y entran solo como el círculo que los contiene (la decisión con ellos es menos fiable). */
  aproximadas: Array<{ codigo: string; radioM: number }>;
  /** Cuántos polígonos se guardan nativos (con sus vértices). */
  poligonos: number;
  /** Geocercas que no se pueden representar (radio fuera de 25–100,000 m tras aproximar). */
  rechazadas: FilaRechazada[];
}

/** Tipo de sitio por omisión: «patio» si su código o nombre lo dice; «planta» si trae cliente; si no, punto de interés. */
export function tipoDeSitioPorOmision(g: GeocercaTablaPropia): TipoSitio {
  if (/patio/i.test(`${g.codigo} ${g.nombre}`)) return 'patio';
  return g.cliente ? 'planta' : 'punto_interes';
}

export function geocercasASitios(geocercas: readonly GeocercaTablaPropia[], tipoDe: (g: GeocercaTablaPropia) => TipoSitio = tipoDeSitioPorOmision): ResultadoSitios {
  const filas: SitioCsv[] = []; const aproximadas: ResultadoSitios['aproximadas'] = []; const rechazadas: FilaRechazada[] = [];
  let poligonos = 0;
  geocercas.forEach((g, k) => {
    const linea = k + 2;
    let centro = g.centro; let radio = g.radioM;
    let poligono: Array<{ lat: number; lng: number }> | null = null; let aproximada = false;
    if (g.tipo === 'poligono' && g.poligono) {
      const lat = g.poligono.reduce((s, p) => s + p.lat, 0) / g.poligono.length;
      const lon = g.poligono.reduce((s, p) => s + p.lon, 0) / g.poligono.length;
      centro = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
      const c = centro;
      // El círculo que CONTIENE al polígono, sin inflarlo: todos los vértices caen dentro y un círculo es convexo.
      radio = Math.max(25, Math.ceil(Math.max(...g.poligono.map((p) => haversineM(c, p)))));
      if (radio > 100_000) return void rechazadas.push({ fila: linea, motivo: `el polígono ${g.codigo} es demasiado grande para representarlo como círculo (> 100 km)` });
      const vertices = g.poligono.map((p) => ({ lat: p.lat, lng: p.lon }));
      if (poligonoGuardable(vertices)) { poligono = vertices; poligonos++; } else { aproximada = true; aproximadas.push({ codigo: g.codigo, radioM: radio }); }
    }
    if (!centro || radio === null) return void rechazadas.push({ fila: linea, motivo: `la geocerca ${g.codigo} no tiene centro y radio` });
    filas.push({ linea, codigo: g.codigo, nombre: g.nombre, tipo: tipoDe(g), lat: centro.lat, lng: centro.lon, radio_m: radio, direccion: null, cliente: g.cliente, padre: null, poligono, aproximada });
  });
  return { filas, aproximadas, poligonos, rechazadas };
}

/** La huella del CONTENIDO que se importaría (sha256 hex): lo mismo leído dos veces da la misma huella, sin importar el orden de las filas. */
export function huellaDeSitios(filas: readonly SitioCsv[]): string {
  const canonicas = filas.map((f) => ({
    codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, lat: f.lat, lng: f.lng, radio_m: f.radio_m, cliente: f.cliente,
    poligono: f.poligono ?? null, aproximada: f.aproximada === true,
  })).sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(canonicas)).digest('hex');
}

export type ResultadoImportGeocercas =
  | { ok: true; sinCambios: false; creados: number; actualizados: number; aproximadas: ResultadoSitios['aproximadas']; poligonos: number; rechazadas: FilaRechazada[]; leidas: number; huella: string }
  /** La tabla del cliente no cambió desde la última importación buena: no se escribió nada. */
  | { ok: true; sinCambios: true; creados: 0; actualizados: 0; aproximadas: ResultadoSitios['aproximadas']; poligonos: number; rechazadas: FilaRechazada[]; leidas: number; huella: string }
  /** `motivo`: 'sin_conexion' (no hay «mis propias tablas» guardadas) o 'sin_geocercas' (la conexión no trae vista/archivo/endpoint de geocercas): no son errores de la flota para el proceso automático. */
  | { ok: false; error: string; detalles?: string[]; motivo?: 'sin_conexion' | 'sin_geocercas' };

/** Los mensajes con que los lectores dicen «esta conexión no tiene geocercas configuradas» (no es una falla: es que no aplica). */
export const SIN_GEOCERCAS_CONFIGURADAS = /^no hay (?:vista|archivo|endpoint) de geocercas/i;

export interface DepsImportGeocercas {
  lector: LectorTablaPropia;
  /** La huella de la última importación buena de esta flota: si el contenido leído coincide, no se escribe nada (re-importación diaria). */
  huellaPrevia?: string | null;
  importar: (tenantId: string, filas: readonly SitioCsv[]) => Promise<ResultadoImportacion>;
  /** La re-importación automática no reactiva los sitios que la flota archivó (el botón manual sí, como siempre). */
  conservarActiva?: boolean;
}

const MAX_DETALLES = 30;

/** El caso de uso, con puertos: lee las geocercas por el lector, las traduce a sitios y las importa todo-o-nada. */
export async function importarGeocercasConLector(tenantId: string, d: DepsImportGeocercas): Promise<ResultadoImportGeocercas> {
  let leido;
  try {
    leido = await d.lector.leerGeocercas();
  } catch (e) {
    if (e instanceof ErrorTablaPropia) return { ok: false, error: e.message, ...(SIN_GEOCERCAS_CONFIGURADAS.test(e.message) ? { motivo: 'sin_geocercas' as const } : {}) };
    logger.error('tabla_propia.geocercas_lectura_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude leer las geocercas de su tabla ahorita.' };
  }
  const rechazadasLectura = leido.rechazadas.map((r) => `Fila ${r.fila}: ${r.motivo}`);
  if (leido.filas.length === 0) {
    return { ok: false, error: 'No se importó nada: no hay geocercas válidas en su tabla.', detalles: rechazadasLectura.slice(0, MAX_DETALLES) };
  }
  const sitios = geocercasASitios(leido.filas);
  const problemas = [...rechazadasLectura, ...sitios.rechazadas.map((r) => `Fila ${r.fila}: ${r.motivo}`)];
  // Todo-o-nada también aquí: una geocerca rechazada es un dato de su sistema que falta en el catálogo; importar
  // «lo que sí» dejaría un catálogo a medias que se ve completo.
  if (problemas.length > 0) {
    return { ok: false, error: `No se importó nada: ${problemas.length} geocerca(s) con problema.`, detalles: problemas.slice(0, MAX_DETALLES) };
  }
  const huella = huellaDeSitios(sitios.filas);
  if (d.huellaPrevia && d.huellaPrevia === huella) {
    return { ok: true, sinCambios: true, creados: 0, actualizados: 0, aproximadas: sitios.aproximadas, poligonos: sitios.poligonos, rechazadas: [], leidas: leido.filas.length, huella };
  }
  try {
    const r = await d.importar(tenantId, d.conservarActiva ? sitios.filas.map((f) => ({ ...f, conservar_activa: true })) : sitios.filas);
    if (!r.ok) return { ok: false, error: 'No se importó nada: revisa estos puntos.', detalles: r.errores.slice(0, MAX_DETALLES).map((e) => `Línea ${e.linea}: ${e.mensaje}`) };
    return { ok: true, sinCambios: false, creados: r.creados, actualizados: r.actualizados, aproximadas: sitios.aproximadas, poligonos: sitios.poligonos, rechazadas: [], leidas: leido.filas.length, huella };
  } catch (e) {
    logger.error('tabla_propia.geocercas_importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude importar ahorita. No se guardó nada; intenta de nuevo en un momento.' };
  }
}

export interface DepsFlota { leerCredencial?: (tenantId: string, conectorId: string) => Promise<ValoresCredencial | null>; http?: Http; importar?: DepsImportGeocercas['importar']; huellaPrevia?: string | null; conservarActiva?: boolean }

/**
 * Lee la credencial de la flota, arma el lector y importa — SIN comprobar permisos: lo llama la acción del panel (que ya
 * los comprobó) y la re-importación automática del cron (que no tiene sesión). El `tenantId` lo pone quien llama.
 */
export async function importarGeocercasDeFlota(tenantId: string, deps: DepsFlota = {}): Promise<ResultadoImportGeocercas> {
  let valores: ValoresCredencial | null;
  try {
    valores = await (deps.leerCredencial ?? leerCredencial)(tenantId, 'tabla_propia');
  } catch {
    return { ok: false, error: 'No pude abrir la conexión guardada de su tabla. Vuelve a capturarla en Conexiones.' };
  }
  if (!valores) return { ok: false, error: 'Primero conecta tus tablas de GPS en Conexiones.', motivo: 'sin_conexion' };
  const c = crearLectorTablaPropia(valores, { http: deps.http ?? httpReal() });
  if (!c.ok) return { ok: false, error: `La conexión de su tabla no es válida: ${c.motivo}.` };
  return importarGeocercasConLector(tenantId, { lector: c.lector, importar: deps.importar ?? importarSitios, huellaPrevia: deps.huellaPrevia, conservarActiva: deps.conservarActiva });
}

/**
 * La acción del panel: el permiso se comprueba AQUÍ (una acción de servidor es un endpoint) y el `tenantId` sale de
 * la SESIÓN. Lee la credencial de la flota, arma el lector y importa. La credencial no sale de esta función.
 */
export async function importarGeocercasDeTablaPropia(
  ctx: { tenantId: string; rol: string },
  deps: Pick<DepsFlota, 'leerCredencial' | 'http' | 'importar'> = {},
): Promise<ResultadoImportGeocercas> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan sitios.' };
  return importarGeocercasDeFlota(ctx.tenantId, deps);
}
