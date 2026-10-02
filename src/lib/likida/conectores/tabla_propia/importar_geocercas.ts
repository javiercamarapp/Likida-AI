import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import type { SitioCsv, TipoSitio } from '../../conductor/sitios';
import { importarSitios, type ResultadoImportacion } from '../../conductor/repo_validacion';
import { leerCredencial } from '../credenciales';
import { httpReal, type Http, type ValoresCredencial } from '../tipos';
import { ErrorTablaPropia, type FilaRechazada, type GeocercaTablaPropia, type LectorTablaPropia } from './contrato';
import { crearLectorTablaPropia } from './lector';
import { haversineM } from './validar';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTADOR DE GEOCERCAS DE SU TABLA/CSV al catálogo de sitios del Conductor
// (el que consumen la conciliación de hitos, el cruce de peajes y el mapa).
//
//  · Círculo (centro + radio): entra tal cual.
//  · Polígono: el catálogo de sitios guarda centro + radio (la validación de
//    llegada es «dentro del radio»). Un polígono se APROXIMA por el círculo que
//    lo CONTIENE (centro = promedio de vértices, radio = vértice más lejano
//    +5 %): siempre lo cubre, a costa de ser más grande. Cada aproximación se
//    REPORTA con su radio para decidir a la vista si hace falta soporte nativo
//    de polígonos. NO se inventa ni se simplifica en silencio.
//  · Todo-o-nada con la base (la RPC `importar_sitios_conductor` revisa clientes,
//    padres y nombres): si una fila está mal, no se importa NINGUNA y se dice cuál.
//  · Re-importar es seguro: la llave es el código de su sistema (actualiza, no duplica).
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoSitios {
  filas: SitioCsv[];
  /** Polígonos que hubo que aproximar a un círculo que los contiene. */
  aproximadas: Array<{ codigo: string; radioM: number }>;
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
  geocercas.forEach((g, k) => {
    const linea = k + 2;
    let centro = g.centro; let radio = g.radioM;
    if (g.tipo === 'poligono' && g.poligono) {
      const lat = g.poligono.reduce((s, p) => s + p.lat, 0) / g.poligono.length;
      const lon = g.poligono.reduce((s, p) => s + p.lon, 0) / g.poligono.length;
      centro = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
      const c = centro;
      radio = Math.max(25, Math.ceil(Math.max(...g.poligono.map((p) => haversineM(c, p))) * 1.05));
      if (radio > 100_000) return void rechazadas.push({ fila: linea, motivo: `el polígono ${g.codigo} es demasiado grande para representarlo como círculo (> 100 km)` });
      aproximadas.push({ codigo: g.codigo, radioM: radio });
    }
    if (!centro || radio === null) return void rechazadas.push({ fila: linea, motivo: `la geocerca ${g.codigo} no tiene centro y radio` });
    filas.push({ linea, codigo: g.codigo, nombre: g.nombre, tipo: tipoDe(g), lat: centro.lat, lng: centro.lon, radio_m: radio, direccion: null, cliente: g.cliente, padre: null });
  });
  return { filas, aproximadas, rechazadas };
}

export type ResultadoImportGeocercas =
  | { ok: true; creados: number; actualizados: number; aproximadas: ResultadoSitios['aproximadas']; rechazadas: FilaRechazada[]; leidas: number }
  | { ok: false; error: string; detalles?: string[] };

export interface DepsImportGeocercas {
  lector: LectorTablaPropia;
  importar: (tenantId: string, filas: readonly SitioCsv[]) => Promise<ResultadoImportacion>;
}

const MAX_DETALLES = 30;

/** El caso de uso, con puertos: lee las geocercas por el lector, las traduce a sitios y las importa todo-o-nada. */
export async function importarGeocercasConLector(tenantId: string, d: DepsImportGeocercas): Promise<ResultadoImportGeocercas> {
  let leido;
  try {
    leido = await d.lector.leerGeocercas();
  } catch (e) {
    if (e instanceof ErrorTablaPropia) return { ok: false, error: e.message };
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
  try {
    const r = await d.importar(tenantId, sitios.filas);
    if (!r.ok) return { ok: false, error: 'No se importó nada: revisa estos puntos.', detalles: r.errores.slice(0, MAX_DETALLES).map((e) => `Línea ${e.linea}: ${e.mensaje}`) };
    return { ok: true, creados: r.creados, actualizados: r.actualizados, aproximadas: sitios.aproximadas, rechazadas: [], leidas: leido.filas.length };
  } catch (e) {
    logger.error('tabla_propia.geocercas_importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude importar ahorita. No se guardó nada; intenta de nuevo en un momento.' };
  }
}

/**
 * La acción del panel: el permiso se comprueba AQUÍ (una acción de servidor es un endpoint) y el `tenantId` sale de
 * la SESIÓN. Lee la credencial de la flota, arma el lector y importa. La credencial no sale de esta función.
 */
export async function importarGeocercasDeTablaPropia(
  ctx: { tenantId: string; rol: string },
  deps: { leerCredencial?: (tenantId: string, conectorId: string) => Promise<ValoresCredencial | null>; http?: Http; importar?: DepsImportGeocercas['importar'] } = {},
): Promise<ResultadoImportGeocercas> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan sitios.' };
  let valores: ValoresCredencial | null;
  try {
    valores = await (deps.leerCredencial ?? leerCredencial)(ctx.tenantId, 'tabla_propia');
  } catch {
    return { ok: false, error: 'No pude abrir la conexión guardada de su tabla. Vuelve a capturarla en Conexiones.' };
  }
  if (!valores) return { ok: false, error: 'Primero conecta tus tablas de GPS en Conexiones.' };
  const c = crearLectorTablaPropia(valores, { http: deps.http ?? httpReal() });
  if (!c.ok) return { ok: false, error: `La conexión de su tabla no es válida: ${c.motivo}.` };
  return importarGeocercasConLector(ctx.tenantId, { lector: c.lector, importar: deps.importar ?? importarSitios });
}
