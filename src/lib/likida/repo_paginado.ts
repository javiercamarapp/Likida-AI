// ═══════════════════════════════════════════════════════════════════════════
// LECTORES PAGINADOS DEL FRONTEND (auditoría 24, FE-2/FE-3/FE-6…) — el patrón
// de `sat_descarga/bandeja.ts` (`.order()` con desempate + `.range()` +
// `count: 'exact'` en la MISMA petición) para pantallas que hasta ahora
// filtraban en memoria sobre "los N más recientes" (`getViajes(tenantId,
// 100)` u otro tope fijo) y por eso, a escala de piloto (500 viajes/día),
// dejaban fuera precisamente lo que la oficina necesita actuar: el viaje de
// ayer que nadie aceptó, el operador que lleva 6 horas esperando aviso.
//
// Las paginadas (`viajesEnCursoPaginados`, `viajesEsperandoAceptarPaginados`)
// NUNCA LANZAN por un fallo de lectura: como en `sat_descarga/bandeja.ts`, el
// fallo se atrapa en `leerPagina` y viaja en `Pagina.error` — el llamador
// decide cómo pintarlo (nunca como lista vacía, que es una afirmación
// distinta de "no se pudo leer").
//
// `buscarViajesVivos` (el combo del huérfano) es la excepción DECLARADA: no
// devuelve una `Pagina`, devuelve `OpcionViaje[]` sin dónde colgar un
// `error`, así que un fallo de lectura —de cualquiera de sus DOS
// consultas— LANZA. Un fallo a medias (la primera consulta bien, la segunda
// callada) sería peor que lanzar: se leería como "no hay resultados" cuando
// lo que pasó fue un timeout del pooler (ARQUITECTURA 25, BAJO).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
import { logger } from '@/lib/logger';

/** Una página ordenada y contada de verdad. */
export interface Pagina<T> {
  filas: T[];
  pagina: number;
  porPagina: number;
  /** El total REAL de filas que cumplen el filtro (`count: 'exact'`), no
   *  `filas.length`. `null` = no se pudo medir (la lectura falló). */
  total: number | null;
  paginaMax: number;
  /** `true` cuando `total` rebasa `paginaMax * porPagina`: hay más de lo que
   *  esta paginación alcanza a recorrer. Se declara, no se esconde. */
  truncada: boolean;
  /** El mensaje de la falla, si la hubo. `filas` viene vacío junto con esto
   *  — nunca se pinta como "no hay nada". */
  error: string | null;
}

type RespuestaSupabase<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

/**
 * El núcleo: pide UNA página con `.range()`, mide el total con
 * `count: 'exact'` en la misma petición y traduce cualquier fallo a
 * `error` en vez de lanzar — para que un jefe de tráfico con la base caída
 * un instante siga viendo el resto de Despacho en vez de perder la pantalla
 * entera (`error.tsx`) por una sola sección.
 */
async function leerPagina<Cruda, T>(
  construir: (desde: number, hasta: number) => PromiseLike<RespuestaSupabase<Cruda>>,
  mapear: (fila: Cruda) => T,
  consulta: string,
  pagina: number,
  porPagina: number,
  paginaMax: number,
): Promise<Pagina<T>> {
  const pag = Math.max(1, Math.min(Math.trunc(pagina) || 1, paginaMax));
  const desde = (pag - 1) * porPagina;
  const vacia: Pagina<T> = {
    filas: [], pagina: pag, porPagina, total: null, paginaMax, truncada: false, error: null,
  };
  try {
    const { data, error, count } = await construir(desde, desde + porPagina - 1);
    if (error) throw new Error(error.message);
    const filas = (data ?? []).map(mapear);
    // `count` en null NO es cero: es "la base no lo dijo" (sin `count: 'exact'`
    // en el `.select()`, o un fallo parcial que PostgREST no reportó como error).
    const total = typeof count === 'number' ? count : null;
    const truncada = total !== null && total > paginaMax * porPagina;
    return { ...vacia, filas, total, truncada };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    logger.warn('repo_paginado.fallo', { consulta, err: detalle });
    return { ...vacia, error: detalle };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VIAJES — dos ventanas ordenadas por URGENCIA, no por antigüedad de alta.
// ═══════════════════════════════════════════════════════════════════════════

/** `viaje.estatus` "vivo" (constraint `viaje_estatus_dominio`). */
const VIVOS = ['abierto', 'en_cuadre'] as const;

export interface ViajeEnCursoRow {
  id: string; folio: string; origen: string | null; destino: string | null; estatus: string;
  operadorNombre: string | null;
  unidadId: string | null; unidadEco: string | null;
  fechaInicio: string | null;
  avisadoEn: string | null; aceptadoEn: string | null; escaladoEn: string | null;
  avisosEnviados: number;
}

// UN SOLO LITERAL (sin concatenar con `+`): supabase-js necesita el TIPO
// LITERAL del string para inferir la forma del embed (`operador:…(nombre)`)
// en tiempo de compilación — un `+` lo ensancha a `string` y la respuesta cae
// a `GenericStringError[]`, exactamente el bug que este archivo evita en
// runtime (ver `pg.ts`) pero casi reproduce en tipos.
const COLUMNAS_VIAJE_EN_CURSO = 'id, folio, origen, destino, estatus, unidad_id, fecha_inicio, avisado_en, aceptado_en, escalado_en, avisos_enviados, operador:operador_id(nombre), unidad:unidad_id(numero_economico)';

function filaViajeEnCurso(v: Record<string, unknown>): ViajeEnCursoRow {
  return {
    id: v.id as string,
    folio: (v.folio as string) || (v.id as string).slice(0, 8),
    origen: (v.origen as string) || null,
    destino: (v.destino as string) || null,
    estatus: v.estatus as string,
    operadorNombre: ((v.operador as { nombre?: string } | null)?.nombre) ?? null,
    unidadId: (v.unidad_id as string) || null,
    unidadEco: ((v.unidad as { numero_economico?: string } | null)?.numero_economico) ?? null,
    fechaInicio: (v.fecha_inicio as string) || null,
    avisadoEn: (v.avisado_en as string) || null,
    aceptadoEn: (v.aceptado_en as string) || null,
    escaladoEn: (v.escalado_en as string) || null,
    avisosEnviados: Number(v.avisos_enviados ?? 0),
  };
}

export const PAGINA_MAX_VIAJES_EN_CURSO = 200;
export const POR_PAGINA_VIAJES_EN_CURSO = 25;

/**
 * FE-2 · Despacho: viajes vivos ordenados por qué tan urgente es actuar
 * sobre ellos — primero los que nadie ha aceptado (`aceptado_en is null`),
 * y entre ésos primero los avisados hace más tiempo (`avisado_en asc`, con
 * los nunca avisados —`avisado_en is null`— al frente del todo). Antes se
 * leían "los últimos 100 viajes creados" y se recortaba a 12: a 500
 * viajes/día eso son ~30 minutos de operación, así que el viaje de ayer sin
 * aceptar ya no estaba ni en la lectura.
 *
 * `q` filtra por folio (`ilike`) para el buscador que la pantalla no tenía.
 */
export async function viajesEnCursoPaginados(
  tenantId: string,
  opts: { pagina?: number; porPagina?: number; folio?: string } = {},
): Promise<Pagina<ViajeEnCursoRow>> {
  const porPagina = Math.max(1, Math.min(Math.trunc(opts.porPagina ?? POR_PAGINA_VIAJES_EN_CURSO) || POR_PAGINA_VIAJES_EN_CURSO, 100));
  const folio = (opts.folio ?? '').trim().slice(0, 60);
  return leerPagina<Record<string, unknown>, ViajeEnCursoRow>(
    (desde, hasta) => {
      let q = supabaseAdmin()
        .from('viaje')
        .select(COLUMNAS_VIAJE_EN_CURSO, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .in('estatus', VIVOS);
      if (folio) q = q.ilike('folio', `%${folio}%`);
      return acotada(
        q
          .order('aceptado_en', { ascending: true, nullsFirst: true })
          .order('avisado_en', { ascending: true, nullsFirst: true })
          .order('id', { ascending: true })
          .range(desde, hasta),
        'repo_paginado.viajes_en_curso',
      );
    },
    filaViajeEnCurso,
    'repo_paginado.viajes_en_curso',
    opts.pagina ?? 1, porPagina, PAGINA_MAX_VIAJES_EN_CURSO,
  );
}

export interface ViajeEsperaAceptarRow extends ViajeEnCursoRow {
  /** Horas transcurridas desde el aviso — se calcula al leer, con el reloj
   *  del servidor (`ahoraMs`), nunca en el cliente. */
  horasDesdeAviso: number;
}

/**
 * FE-6 · Conductores: viajes avisados que NADIE ha aceptado ni se
 * escalaron, ordenados por antigüedad del aviso (el más urgente primero).
 * Antes salían de `getViajes(tenantId, 100)` filtrado en memoria: a 500
 * viajes/día, 100 filas son ~4.8 h, así que el viaje avisado hace 6 h —el
 * que el agente escala— ya no estaba en la ventana que la pantalla leía.
 */
export async function viajesEsperandoAceptarPaginados(
  tenantId: string,
  ahoraMs: number,
  opts: { pagina?: number; porPagina?: number } = {},
): Promise<Pagina<ViajeEsperaAceptarRow>> {
  const porPagina = Math.max(1, Math.min(Math.trunc(opts.porPagina ?? POR_PAGINA_VIAJES_EN_CURSO) || POR_PAGINA_VIAJES_EN_CURSO, 100));
  return leerPagina<Record<string, unknown>, ViajeEsperaAceptarRow>(
    (desde, hasta) => acotada(
      supabaseAdmin()
        .from('viaje')
        .select(COLUMNAS_VIAJE_EN_CURSO, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .in('estatus', VIVOS)
        .not('avisado_en', 'is', null)
        .is('aceptado_en', null)
        .is('escalado_en', null)
        .order('avisado_en', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, hasta),
      'repo_paginado.viajes_esperando_aceptar',
    ),
    (v) => {
      const base = filaViajeEnCurso(v);
      const avisado = base.avisadoEn ? Date.parse(base.avisadoEn) : null;
      return { ...base, horasDesdeAviso: avisado !== null ? Math.floor((ahoraMs - avisado) / 3_600_000) : 0 };
    },
    'repo_paginado.viajes_esperando_aceptar',
    opts.pagina ?? 1, porPagina, PAGINA_MAX_VIAJES_EN_CURSO,
  );
}

/** Una opción del buscador de viajes — mismo espíritu que `OpcionCatalogo`
 *  de `lib/likida/repo.ts`, pero SIN tocar ese archivo (es de otro agente
 *  de esta auditoría): éste vive junto a los demás lectores paginados. */
export interface OpcionViaje {
  id: string;
  /** "F-1041 · León → CDMX · J. Pérez" — folio, ruta y operador en una
   *  línea, para que el `<datalist>` no necesite columnas aparte. */
  etiqueta: string;
}

const TOPE_BUSCADOR_VIAJES = 20;

/**
 * FE-3 · Huérfanos: busca viajes VIVOS por folio o nombre de operador, para
 * el combo "Adjuntar a…". Antes el `<select>` ofrecía los vivos entre los
 * 100 viajes más recientes: el huérfano típico es de un viaje de 1-3 días
 * atrás, que a 500 viajes/día ya no está ahí. Aquí se pregunta al servidor,
 * como en Despacho — nunca se manda el catálogo completo al cliente.
 */
export async function buscarViajesVivos(tenantId: string, q: string): Promise<OpcionViaje[]> {
  const texto = q.trim().slice(0, 80);
  let consulta = supabaseAdmin()
    .from('viaje')
    .select('id, folio, origen, destino, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId)
    .in('estatus', VIVOS);
  if (texto) {
    // `folio` O el nombre del operador — `or()` con `ilike` en la columna
    // embebida no lo soporta PostgREST, así que se pide por folio y se
    // completa por operador en una segunda vuelta solo si la primera no
    // llenó el tope (evita dos viajes de red cuando el folio ya basta).
    consulta = consulta.ilike('folio', `%${texto}%`);
  }
  const { data, error } = await acotada(
    // Desempate por `id`: sin él, un top-20 sobre un empate en `created_at`
    // (viajes creados en el mismo import por lote) no es determinista entre
    // dos corridas — el mismo bug de fondo que `pg.ts`/`traerTodo` evita.
    consulta.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(TOPE_BUSCADOR_VIAJES),
    'repo_paginado.buscar_viajes_folio',
  );
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as Array<{ id: string; folio: string | null; origen: string | null; destino: string | null; operador: { nombre?: string } | null }>;

  if (texto && filas.length < TOPE_BUSCADOR_VIAJES) {
    // Completa por nombre de operador — el caso "el huérfano trae el
    // teléfono, no el folio" (el chofer manda la foto sin decir el viaje).
    const { data: porOperador, error: errOp } = await acotada(
      supabaseAdmin()
        .from('viaje')
        .select('id, folio, origen, destino, operador:operador_id!inner(nombre)')
        .eq('tenant_id', tenantId)
        .in('estatus', VIVOS)
        .ilike('operador.nombre', `%${texto}%`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(TOPE_BUSCADOR_VIAJES - filas.length),
      'repo_paginado.buscar_viajes_operador',
    );
    // ARQUITECTURA 25 (BAJO, REINCIDENTE). Un `errOp` truthy se descartaba en
    // silencio y la función devolvía la lista corta de la primera consulta
    // (por folio) como si fuera completa: el operario que buscó por nombre
    // ("Ramírez") se llevaba "sin resultados" cuando lo que pasó fue un
    // timeout del pooler, no que el viaje no existiera. Esta función YA lanza
    // sobre el fallo de la primera consulta (arriba); la segunda tiene que
    // fallar cerrado igual — no a medias.
    if (errOp) throw new Error(errOp.message);
    const vistos = new Set(filas.map((f) => f.id));
    for (const f of (porOperador ?? []) as typeof filas) {
      if (!vistos.has(f.id)) filas.push(f);
    }
  }

  return filas.slice(0, TOPE_BUSCADOR_VIAJES).map((v) => {
    const folio = v.folio || v.id.slice(0, 8);
    const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? 'sin ruta');
    const operador = v.operador?.nombre ? ` · ${v.operador.nombre}` : '';
    return { id: v.id, etiqueta: `${folio} · ${ruta}${operador}` };
  });
}
