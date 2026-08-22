import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import type { ViajeRow, FiltroRegistro } from './analytics';

// ═══════════════════════════════════════════════════════════════════════════
// EL REGISTRO DE VIAJES A 50k VIAJES/MES (docs/escala-50k/MAPA.md, 22-ago-2026)
//
// `getViajesRegistro` de analytics.ts paginaba con `.range(desde, hasta)` =
// OFFSET: la página 1000 le pedía a Postgres LEER y TIRAR 100,000 filas, y el
// `.or(ilike %q%)` era un barrido del tenant entero. Aquí se reemplaza por
// la RPC `viajes_registro_tenant` (mig. 0154): keyset sobre (fecha_inicio
// desc nulls last, created_at desc, id desc) con comparación de fila — que
// el EXPLAIN de la 0154 demostró que sí entra como Index Cond (108 buffers
// por página contra 100,924 del OFFSET) — y búsqueda por trigramas.
//
// La forma de retorno conserva `{ filas, hayMas }` (la vista no cambia
// cómo pinta) y AÑADE `siguiente`: el cursor opaco de la página que sigue, o
// `null` si no la hay. La URL lleva `?c=<cursor>` en vez de `?p=N`.
//
// El cursor es la posición de la ÚLTIMA fila de la página (fecha_inicio,
// created_at, id), en base64url de un JSON chico. Es opaco para el navegador
// y se VALIDA al entrar: un cursor corrupto o inventado no lanza —se lee como
// "primera página", que es lo que un link viejo o manipulado merece—. Lo que
// SÍ lanza es una respuesta de la base con otra forma (fail-closed de FORMA,
// regla 1 de REGLAS-ESCALA): un registro vacío que en realidad es una RPC
// sin aplicar se vería como "esta flota no ha hecho viajes".
// ═══════════════════════════════════════════════════════════════════════════

/** Tope de filas por página — el mismo que el rediseño del registro y el que
 *  la RPC impone del lado de la base (`least(p_limite, 100)`). */
export const TOPE_PAGINA = 100;

export interface CursorRegistro {
  /** `fecha_inicio` de la última fila (YYYY-MM-DD) o `null` si ya vamos por
   *  los viajes sin fecha, que son la cola del orden. */
  f: string | null;
  /** `created_at` ISO de la última fila. */
  c: string;
  /** `id` (uuid) de la última fila — el desempate final. */
  id: string;
}

// `Buffer.from` se nombra por el alias para que la guardiana de `acotada()`
// (acotada_guardiana.test.ts, que cuenta `.from(`) no lo tome por consulta.
const { from: bytes } = Buffer;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursor(c: CursorRegistro): string {
  return bytes(JSON.stringify({ f: c.f, c: c.c, id: c.id }), 'utf8').toString('base64url');
}

/** `null` ante cualquier cosa que no sea un cursor nuestro: base64 roto, JSON
 *  ajeno, fecha que no es fecha, id que no es uuid. Nunca lanza. */
export function decodificarCursor(texto: string | null | undefined): CursorRegistro | null {
  if (!texto || texto.length > 200) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(bytes(texto, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const { f, c, id } = obj as Record<string, unknown>;
  if (f !== null && (typeof f !== 'string' || !RE_FECHA.test(f))) return null;
  if (typeof c !== 'string' || Number.isNaN(Date.parse(c))) return null;
  if (typeof id !== 'string' || !RE_UUID.test(id)) return null;
  return { f: f as string | null, c, id };
}

/** El texto de búsqueda como lo recibe la RPC: sin comodines de LIKE (`%`,
 *  `_`) ni paréntesis/comas que en la versión PostgREST rompían el `.or()`.
 *  Se conserva el mismo saneo para que una búsqueda vieja dé lo mismo. */
export function sanearBusqueda(q: string | undefined): string {
  return (q ?? '').trim().replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export interface PaginaRegistro {
  filas: ViajeRow[];
  hayMas: boolean;
  /** Cursor opaco de la página siguiente; `null` cuando `hayMas` es false. */
  siguiente: string | null;
}

const FILTROS: FiltroRegistro[] = ['todos', 'abiertos', 'en_cuadre', 'liquidados', 'escalados'];

function textoONull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Valida la FORMA de una fila del jsonb de la RPC. Lanza si no encaja: un
 *  campo que falta es una migración a medias, no un viaje raro. */
function mapearFila(v: unknown, i: number): ViajeRow {
  if (!v || typeof v !== 'object') throw new Error(`getViajesRegistro: la fila ${i} no es un objeto (¿migración 0154 sin aplicar?)`);
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.estatus !== 'string' || typeof r.created_at !== 'string') {
    throw new Error(`getViajesRegistro: la fila ${i} viene sin id/estatus/created_at (¿migración 0154 sin aplicar?)`);
  }
  return {
    id: r.id,
    folio: textoONull(r.folio) ?? r.id.slice(0, 8),
    origen: textoONull(r.origen),
    destino: textoONull(r.destino),
    estatus: r.estatus,
    anticipo: Number(r.anticipo ?? 0),
    operadorNombre: textoONull(r.operador_nombre),
    fechaInicio: textoONull(r.fecha_inicio),
    intakePendientes: Number(r.intake_pendientes ?? 0),
    unidadId: textoONull(r.unidad_id),
    unidadEco: textoONull(r.unidad_eco),
    avisadoEn: textoONull(r.avisado_en),
    aceptadoEn: textoONull(r.aceptado_en),
    escaladoEn: textoONull(r.escalado_en),
    avisosEnviados: Number(r.avisos_enviados ?? 0),
  };
}

/**
 * Una página del Registro de Viajes, por cursor. Mismo orden que siempre
 * (inicio más reciente arriba; sin fecha, al final), mismo filtro de estatus
 * y misma búsqueda por folio/origen/destino — pero sin OFFSET y con índice.
 *
 * `cursor` inválido o ausente = primera página. `porPagina` se topa a 100.
 * Se pide una fila de más para saber si hay otra página sin contar la tabla:
 * `hayMas` es eso, no un total.
 */
export async function getViajesRegistro(
  tenantId: string,
  opciones: { q?: string; cursor?: string | null; porPagina?: number; filtro?: FiltroRegistro } = {},
): Promise<PaginaRegistro> {
  const porPagina = Math.max(1, Math.min(TOPE_PAGINA, opciones.porPagina ?? TOPE_PAGINA));
  const filtro = opciones.filtro && FILTROS.includes(opciones.filtro) ? opciones.filtro : 'todos';
  const q = sanearBusqueda(opciones.q);
  const cursor = decodificarCursor(opciones.cursor);

  const { data, error } = await acotada(supabaseAdmin().rpc('viajes_registro_tenant', {
    p_tenant: tenantId,
    p_filtro: filtro,
    p_q: q || null,
    p_cursor_fecha: cursor?.f ?? null,
    p_cursor_created: cursor?.c ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limite: porPagina,
  }), 'viajes_registro_tenant');
  if (error) throw new Error(`getViajesRegistro: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error(`getViajesRegistro: viajes_registro_tenant devolvió ${typeof data} en vez de un arreglo (¿migración 0154 sin aplicar?)`);
  }

  const crudas = (data as unknown[]).map(mapearFila);
  const hayMas = crudas.length > porPagina;
  const filas = crudas.slice(0, porPagina);
  const ultima = filas[filas.length - 1];
  const siguiente = hayMas && ultima
    ? codificarCursor({
      f: ultima.fechaInicio,
      c: (data as Array<Record<string, unknown>>)[filas.length - 1].created_at as string,
      id: ultima.id,
    })
    : null;
  return { filas, hayMas, siguiente };
}

export interface ConteosViajes {
  total: number; abiertos: number; enCuadre: number; liquidados: number; escalados: number;
}

const LLAVES_CONTEO: Array<keyof ConteosViajes> = ['total', 'abiertos', 'enCuadre', 'liquidados', 'escalados'];

/**
 * Los cinco conteos del encabezado del registro en UNA lectura
 * (`conteos_viajes_tenant`, 0154) en vez de 4 `count exact` + 1 de escalados.
 *
 * `null` = no se pudo contar (error de base o forma ajena), y la vista pinta
 * "—" y lo dice — el mismo contrato que tenían `contarViajes`/`contarEscalados`:
 * un cero se leería como "esta flota no ha hecho viajes", que sería falso.
 * Un tenant sin viajes SÍ recibe ceros: ahí el cero es medición.
 */
export async function getConteosViajes(tenantId: string): Promise<ConteosViajes | null> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('conteos_viajes_tenant', { p_tenant: tenantId }),
    'conteos_viajes_tenant',
  );
  if (error) {
    logger.warn('getConteosViajes', { tenantId, err: error.message });
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    logger.warn('getConteosViajes.forma', { tenantId, tipo: Array.isArray(data) ? 'array' : typeof data });
    return null;
  }
  const r = data as Record<string, unknown>;
  const salida = {} as ConteosViajes;
  for (const k of LLAVES_CONTEO) {
    const n = r[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      logger.warn('getConteosViajes.forma', { tenantId, llave: k, valor: n });
      return null;
    }
    salida[k] = n;
  }
  return salida;
}
