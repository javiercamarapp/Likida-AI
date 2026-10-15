// ═══════════════════════════════════════════════════════════════════════════
// PAGINACIÓN del conector TMS: lee TODAS las páginas de un recurso (por página+tamaño, por cursor o por
// offset) y entrega las filas ya mapeadas, en orden y sin duplicados. La forma real de paginar del TMS no
// está documentada (BLOQUEO EXTERNO): se parametriza con `ConfigPaginacion` y se prueba con respuestas sintéticas.
//
// Se corta por (lo primero que ocurra):
//  · lista vacía (o, en cursor, sin cursor siguiente)  → completa
//  · cursor repetido / página que no trae nada nuevo   → se detiene con AVISO, `completa:false` (el origen
//    se está cerrando en círculo: no se declara completa una lectura que no lo es)
//  · MAX_PAGINAS_DEFENSIVO                             → `backlog:true` con punto de reanudación
//  · presupuesto de la corrida (`venceEn`)             → `backlog:true` con punto de reanudación
// Cuando hay `backlog`, `reanudar` apunta a la PRIMERA página aún no leída: el siguiente ciclo continúa de
// ahí sin repetir ni perder filas. Nunca se duerme ni se abre otra petición más allá de `venceEn`.
// ═══════════════════════════════════════════════════════════════════════════
import type { RespuestaHttp } from '../tipos';
import { MAX_PAGINAS_DEFENSIVO, jsonCualquiera, type FallaLectura } from '../posiciones_comun';
import { aplicarMapeo, leerRuta, type FilaMapeada, type MapeoTms } from './mapeo';
import type { SesionTms } from './sesion';
import type { FilaRechazadaTms } from './tipos';

export type ConfigPaginacion =
  /** `mapeo.params.pagina` (+ `tam`): páginas numeradas. */
  | { tipo: 'pagina'; tamano: number; inicio?: number }
  /** `mapeo.params.cursor`: la respuesta trae, en `ruta_siguiente`, el cursor de la siguiente página. */
  | { tipo: 'cursor'; ruta_siguiente: string; tamano?: number }
  /** `param`: cuántas filas se saltan; avanza lo realmente recibido. */
  | { tipo: 'offset'; param: string; tamano: number };

/** Dónde seguir. Se guarda tal cual entre ciclos. */
export type PuntoReanudo =
  | { tipo: 'pagina'; pagina: number }
  | { tipo: 'cursor'; cursor: string; vistos: string[] }
  | { tipo: 'offset'; offset: number };

export interface VentanaPaginar {
  /** ISO UTC (o el formato que el origen espere en `mapeo.params.desde`). */
  desde: string;
  hasta: string;
  /** Punto devuelto por una corrida anterior con `backlog:true`. Debe ser del mismo tipo de paginación. */
  reanudar?: PuntoReanudo;
}

export interface OpcionesPaginar {
  /** Por omisión se deduce del mapeo: con `params.pagina` → página (tamaño 100); con `params.cursor` → cursor en «siguiente». */
  paginacion?: ConfigPaginacion;
  /** Instante absoluto tras el que no se abre otra petición. Debe ser el mismo que usa la sesión. */
  venceEn?: number;
  ahora?: () => number;
  /** Fusible de páginas por corrida. Por omisión `MAX_PAGINAS_DEFENSIVO`. */
  maxPaginas?: number;
}

export interface LecturaPaginada<T> {
  filas: FilaMapeada<T>[];
  rechazadas: FilaRechazadaTms[];
  /** Páginas pedidas en ESTA corrida. */
  paginas: number;
  /** Filas descartadas por venir repetidas entre páginas. */
  duplicadas: number;
  /** Se leyó hasta el final real del origen. */
  completa: boolean;
  /** Quedó trabajo: seguir en el próximo ciclo desde `reanudar`. */
  backlog: boolean;
  reanudar?: PuntoReanudo;
  avisos: string[];
}

export type ResultadoPaginar<T> =
  | ({ ok: true } & LecturaPaginada<T>)
  /** Falla: lo leído hasta ahí NO se pierde (`parcial`) y, si procede, `reanudar` dice dónde seguir. */
  | { ok: false; motivo: string; falla?: FallaLectura; backlog?: boolean; parcial: LecturaPaginada<T> };

const TAMANO_POR_OMISION = 100;

function configDe(mapeo: MapeoTms, o: OpcionesPaginar): ConfigPaginacion | undefined {
  if (o.paginacion) return o.paginacion;
  if (mapeo.params.pagina !== undefined) return { tipo: 'pagina', tamano: TAMANO_POR_OMISION };
  if (mapeo.params.cursor !== undefined) return { tipo: 'cursor', ruta_siguiente: 'siguiente' };
  return undefined;
}

function problemaDeConfig(mapeo: MapeoTms, c: ConfigPaginacion | undefined): string | undefined {
  if (!c) return undefined;
  if (c.tipo === 'pagina' && mapeo.params.pagina === undefined) return 'la paginación por página necesita «params.pagina» en el mapeo';
  if (c.tipo === 'cursor' && mapeo.params.cursor === undefined) return 'la paginación por cursor necesita «params.cursor» en el mapeo';
  if (c.tipo === 'cursor' && c.ruta_siguiente.trim() === '') return 'la paginación por cursor necesita la ruta del cursor siguiente';
  if (c.tipo === 'offset' && c.param.trim() === '') return 'la paginación por offset necesita el nombre del parámetro';
  if ('tamano' in c && c.tamano !== undefined && (!Number.isInteger(c.tamano) || c.tamano < 1)) return 'el tamaño de página debe ser un entero positivo';
  return undefined;
}

/** Lee todas las páginas del recurso de `mapeo` en la ventana dada. Nunca lanza por datos malos del origen. */
export async function paginar<T = Record<string, unknown>>(
  sesion: SesionTms, mapeo: MapeoTms, ventana: VentanaPaginar, opciones: OpcionesPaginar = {},
): Promise<ResultadoPaginar<T>> {
  const filas: FilaMapeada<T>[] = [];
  const rechazadas: FilaRechazadaTms[] = [];
  const avisos: string[] = [];
  const claves = new Set<string>();
  let paginas = 0; let duplicadas = 0;
  const foto = (extra: Partial<LecturaPaginada<T>> = {}): LecturaPaginada<T> =>
    ({ filas, rechazadas, paginas, duplicadas, completa: false, backlog: false, avisos, ...extra });
  const fallo = (motivo: string, falla?: FallaLectura, backlog?: boolean, reanudar?: PuntoReanudo): ResultadoPaginar<T> =>
    ({ ok: false, motivo, falla, backlog, parcial: foto({ reanudar, backlog: backlog === true }) });

  const cfg = configDe(mapeo, opciones);
  const malo = problemaDeConfig(mapeo, cfg);
  if (malo) return fallo(malo, 'formato');
  const rean = ventana.reanudar;
  if (rean && (!cfg || rean.tipo !== cfg.tipo)) return fallo('el punto de reanudación no corresponde al tipo de paginación configurado', 'formato');

  const ahora = opciones.ahora ?? Date.now;
  const maxPaginas = Math.max(1, Math.min(opciones.maxPaginas ?? MAX_PAGINAS_DEFENSIVO, MAX_PAGINAS_DEFENSIVO));

  // Estado de avance (siempre apunta a la PRIMERA página aún no leída).
  let pagina = cfg?.tipo === 'pagina' ? (rean?.tipo === 'pagina' ? rean.pagina : (cfg.inicio ?? 1)) : 0;
  let offset = rean?.tipo === 'offset' ? rean.offset : 0;
  let cursor: string | undefined = rean?.tipo === 'cursor' ? rean.cursor : undefined;
  const cursoresVistos = new Set<string>(rean?.tipo === 'cursor' ? rean.vistos : []);
  const punto = (): PuntoReanudo | undefined => {
    if (!cfg) return undefined;
    if (cfg.tipo === 'pagina') return { tipo: 'pagina', pagina };
    if (cfg.tipo === 'offset') return { tipo: 'offset', offset };
    return cursor === undefined ? undefined : { tipo: 'cursor', cursor, vistos: [...cursoresVistos] };
  };

  for (;;) {
    if (opciones.venceEn !== undefined && ahora() >= opciones.venceEn) {
      avisos.push('Se agotó el presupuesto de la corrida; el resto se lee en el próximo ciclo.');
      return { ok: true, ...foto({ backlog: true, reanudar: punto() }) };
    }
    if (paginas >= maxPaginas) {
      avisos.push(`Se alcanzó el tope de ${maxPaginas} páginas por corrida; el resto se lee en el próximo ciclo.`);
      return { ok: true, ...foto({ backlog: true, reanudar: punto() }) };
    }

    const query: Record<string, string | number | undefined> = { [mapeo.params.desde]: ventana.desde, [mapeo.params.hasta]: ventana.hasta };
    if (cfg?.tipo === 'pagina') {
      query[mapeo.params.pagina as string] = pagina;
      if (mapeo.params.tam !== undefined) query[mapeo.params.tam] = cfg.tamano;
    } else if (cfg?.tipo === 'cursor') {
      if (cursor !== undefined) query[mapeo.params.cursor as string] = cursor;
      if (mapeo.params.tam !== undefined && cfg.tamano !== undefined) query[mapeo.params.tam] = cfg.tamano;
    } else if (cfg?.tipo === 'offset') {
      query[cfg.param] = offset;
      if (mapeo.params.tam !== undefined) query[mapeo.params.tam] = cfg.tamano;
    }

    const r = await sesion.peticion({ ruta: mapeo.ruta, metodo: mapeo.metodo, query: mapeo.metodo === 'GET' ? query : undefined, cuerpo: mapeo.metodo === 'POST' ? query : undefined });
    if (!r.ok) {
      return fallo(r.motivo, r.falla, r.backlog, punto());
    }
    paginas += 1;
    const malaRespuesta = comprobar(r.r);
    if (malaRespuesta) return fallo(malaRespuesta.motivo, malaRespuesta.falla, false, punto());
    const crudo = jsonCualquiera(r.r.cuerpo);
    if (crudo === undefined) return fallo('El sistema contestó 200 con un cuerpo que no es JSON.', 'formato', false, punto());

    const m = aplicarMapeo<T>(mapeo, crudo);
    if (m.error) return fallo(m.error, 'formato', false, punto());
    const recibidas = m.filas.length + m.rechazadas.length;
    for (const x of m.rechazadas) rechazadas.push({ indice: x.indice, motivo: `página ${paginas}: ${x.motivo}` });
    let nuevas = 0;
    for (const f of m.filas) {
      if (claves.has(f.clave)) { duplicadas += 1; continue; }
      claves.add(f.clave); nuevas += 1;
      filas.push(f);
    }

    // Sin paginación declarada: una sola petición.
    if (!cfg) return { ok: true, ...foto({ completa: true }) };

    // Lista vacía: fin natural en página y offset (en cursor, el fin lo marca la falta de cursor siguiente).
    if (recibidas === 0 && cfg.tipo !== 'cursor') {
      return { ok: true, ...foto({ completa: true }) };
    }
    // Página con filas pero ninguna nueva: el origen ignora el avance y repite lo mismo.
    if (m.filas.length > 0 && nuevas === 0 && cfg.tipo !== 'cursor') {
      avisos.push('El sistema devolvió una página sin filas nuevas (repite lo ya leído); se detiene la lectura: no se declara completa.');
      return { ok: true, ...foto({ completa: false }) };
    }

    if (cfg.tipo === 'pagina') pagina += 1;
    else if (cfg.tipo === 'offset') offset += recibidas;
    else {
      const sig = leerRuta(crudo, cfg.ruta_siguiente);
      if (sig === null || sig === undefined || sig === '' || sig === false) {
        cursor = undefined;
        return { ok: true, ...foto({ completa: true }) };
      }
      const s = String(sig);
      if (s === cursor || cursoresVistos.has(s)) {
        avisos.push('El sistema repitió un cursor; se detiene la lectura: no se declara completa.');
        return { ok: true, ...foto({ completa: false }) };
      }
      cursoresVistos.add(s); cursor = s;
      if (recibidas === 0) avisos.push('Una página con cursor siguiente vino vacía; se continúa con el cursor.');
    }
  }
}

function comprobar(r: RespuestaHttp): { motivo: string; falla: FallaLectura } | undefined {
  if (r.estado >= 200 && r.estado < 300) return undefined;
  if (r.estado === 403) return { motivo: 'El sistema negó el acceso a este recurso (403).', falla: 'credencial' };
  return { motivo: `El sistema contestó ${r.estado}, que no es lo esperado.`, falla: r.estado >= 500 ? 'proveedor' : 'formato' };
}
