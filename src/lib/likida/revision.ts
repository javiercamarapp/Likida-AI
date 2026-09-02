// ═══════════════════════════════════════════════════════════════════════════
// LA FIRMA HUMANA DE LA LIQUIDACIÓN (auditoría 24, bloqueante 6 — mig. 0299).
//
// «El agente cuadra, tú firmas lo que no.» Hasta la 0299 la segunda mitad no
// existía: ningún `.update` sobre `liquidacion` en `src/`, la cola «Esperan tu
// revisión» era un recorte de las 50 más recientes (FE-5) y una lectura nítida
// pero mal ($8,000 → $800, WA-3) no tenía por dónde corregirse.
//
// Este archivo es el ÚNICO lector/escritor de `liquidacion.revision` en la app:
//   · `colaRevision` — la cola por antigüedad, por llave `(created_at, id)`,
//     con `count` real y los filtros que un contralor usa (operador, unidad,
//     terminal, fecha, estado del cuadre);
//   · `revisarLiquidacion` — aprobar / ajustar / rechazar, SIEMPRE por la RPC
//     `revisar_liquidacion` (la tabla rebota cualquier otro camino, LR003);
//     al rechazar, avisa al chofer por WhatsApp (best-effort: el envío ya cae
//     al outbox si Meta no contesta).
//
// La escritura NO re-cuadra: un ajuste mueve `gasto.monto` y el total por la
// delta, y la RPC lo dice así. Un segundo motor de cuadre en SQL o aquí sería
// «dos cálculos» (CLAUDE.md).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { exigir } from '@/lib/likida/pg';
import { DatoInvalido } from '@/lib/likida/errores';
import { sendText } from '@/lib/meta/client';
import { logger } from '@/lib/logger';
import { inicioDiaMx, finDiaMx } from '@/lib/formato';

export type RevisionLiquidacion = 'pendiente' | 'aprobada' | 'ajustada' | 'rechazada';
export const REVISIONES: readonly RevisionLiquidacion[] = ['pendiente', 'aprobada', 'ajustada', 'rechazada'];

// ── QUIÉN FIRMA ─────────────────────────────────────────────────────────────
//
// Mismo criterio que `puedeTimbrar` en `auth/permisos.ts` y por la misma
// razón: firmar una liquidación autoriza un pago al chofer y cierra el
// expediente fiscal del viaje. El DUEÑO y el CONTADOR, sí; el ENCARGADO no —
// el jefe de tráfico no ve una sola cifra de dinero de la flota, así que mal
// puede aprobar una. `superadmin` entra por soporte, como en todas las
// puertas de ese archivo. Rol desconocido: NO (fallar cerrado).
//
// Vive aquí y no en `permisos.ts` porque es el permiso de ESTA función; el
// día que se consolide, se mueve con su prueba.
const FIRMA = new Set(['superadmin', 'flota_admin', 'contador']);

export function puedeFirmarLiquidacion(rol: string): boolean {
  return FIRMA.has(rol);
}

export type AccionRevision = 'aprobar' | 'ajustar' | 'rechazar';
export const ACCIONES_REVISION: readonly AccionRevision[] = ['aprobar', 'ajustar', 'rechazar'];

/** Los tres estados del CUADRE (del motor), que no son la revisión. */
export const ESTADOS_CUADRE = ['cuadrada', 'con_diferencias', 'revisar'] as const;
export type EstadoCuadre = (typeof ESTADOS_CUADRE)[number];

/** Cuántas filas trae una página de la cola. La cola se lee entera por
 *  páginas: a 500 cierres/día, 25 es lo que un contralor firma de una sentada. */
export const COLA_POR_PAGINA = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export interface FiltrosCola {
  /** Por omisión `pendiente`: la cola es lo que espera firma. */
  revision: RevisionLiquidacion;
  estado: EstadoCuadre | null;
  operadorId: string | null;
  unidadId: string | null;
  terminalId: string | null;
  /** Días de México, inclusivos (YYYY-MM-DD). */
  desde: string | null;
  hasta: string | null;
}

export const SIN_FILTROS: FiltrosCola = {
  revision: 'pendiente', estado: null, operadorId: null, unidadId: null, terminalId: null, desde: null, hasta: null,
};

/**
 * Lee los filtros de la query de la pantalla. Lo que no es válido NO se
 * aplica a medias: un uuid mal formado o una fecha imposible se descartan (la
 * URL la puede armar cualquiera) y la pantalla enseña los filtros que sí
 * están mandando.
 */
export function leerFiltrosCola(sp: Record<string, string | undefined>): FiltrosCola {
  const dia = (v: string | undefined): string | null => {
    if (!v || !DIA.test(v)) return null;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
  };
  const id = (v: string | undefined): string | null => (v && UUID.test(v) ? v : null);
  const revision = (REVISIONES as readonly string[]).includes(sp.rev ?? '') ? (sp.rev as RevisionLiquidacion) : 'pendiente';
  const estado = (ESTADOS_CUADRE as readonly string[]).includes(sp.estado ?? '') ? (sp.estado as EstadoCuadre) : null;
  let desde = dia(sp.desde);
  let hasta = dia(sp.hasta);
  if (desde && hasta && hasta < desde) { desde = null; hasta = null; }
  return { revision, estado, operadorId: id(sp.operador), unidadId: id(sp.unidad), terminalId: id(sp.terminal), desde, hasta };
}

export function hayFiltrosCola(f: FiltrosCola): boolean {
  return f.revision !== 'pendiente' || f.estado !== null || f.operadorId !== null || f.unidadId !== null
    || f.terminalId !== null || f.desde !== null || f.hasta !== null;
}

// ── Cursor de la cola: `(created_at, id)` de la última fila vista ───────────

export interface CursorCola { creadoEn: string; id: string }

export function codificarCursorCola(c: CursorCola): string {
  return Buffer.from(`${c.creadoEn}|${c.id}`, 'utf8').toString('base64url');
}

export function decodificarCursorCola(crudo: string | undefined): CursorCola | null {
  if (!crudo || !/^[A-Za-z0-9_-]{16,}$/.test(crudo)) return null;
  const texto = Buffer.from(crudo, 'base64url').toString('utf8');
  const sep = texto.lastIndexOf('|');
  if (sep < 1) return null;
  const creadoEn = texto.slice(0, sep);
  const id = texto.slice(sep + 1);
  if (!UUID.test(id) || Number.isNaN(Date.parse(creadoEn)) || /["(),]/.test(creadoEn)) return null;
  return { creadoEn, id };
}

export interface FilaCola {
  id: string;
  viajeId: string;
  folio: string;
  creadoEn: string;
  comprobado: number;
  anticipo: number;
  diferencia: number;
  estatus: string;
  revision: RevisionLiquidacion;
  operadorNombre: string | null;
  unidadEco: string | null;
  terminalNombre: string | null;
}

export interface PaginaCola {
  filas: FilaCola[];
  /** Cuántas hay DEL OTRO LADO del filtro, contadas por la base. */
  total: number;
  hayMas: boolean;
  siguiente: string | null;
}

const COLUMNAS_COLA =
  'id, viaje_id, created_at, total_comprobado, total_anticipo, diferencia, estatus, revision, '
  + 'viaje:viaje_id!inner(folio, operador_id, unidad_id, terminal_id, operador:operador_id(nombre), '
  + 'unidad:unidad_id(numero_economico), terminal:terminal_id(nombre))';

type FilaCruda = Record<string, unknown> & {
  viaje?: {
    folio?: string | null;
    operador?: { nombre?: string | null } | null;
    unidad?: { numero_economico?: string | null } | null;
    terminal?: { nombre?: string | null } | null;
  } | null;
};

function aFilaCola(r: FilaCruda): FilaCola {
  return {
    id: r.id as string,
    viajeId: r.viaje_id as string,
    folio: r.viaje?.folio || (r.id as string).slice(0, 8),
    creadoEn: r.created_at as string,
    comprobado: Number(r.total_comprobado ?? 0),
    anticipo: Number(r.total_anticipo ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus as string,
    revision: r.revision as RevisionLiquidacion,
    operadorNombre: r.viaje?.operador?.nombre ?? null,
    unidadEco: r.viaje?.unidad?.numero_economico ?? null,
    terminalNombre: r.viaje?.terminal?.nombre ?? null,
  };
}

/**
 * La cola de revisión, por ANTIGÜEDAD (la que más lleva esperando, primero) y
 * por llave: `(created_at, id) > (cursor)`. Nunca `range` por posición — una
 * liquidación nueva a media lectura desplazaría la página (pg.ts).
 *
 * Pide UNA fila de más para saber si hay página siguiente sin derivarlo del
 * total, y el `count: exact` en cada llamada: la cola son las PENDIENTES, no
 * el histórico, y «N de M» es el rótulo que hace verdadera a la tabla.
 *
 * Falla CERRADO: una lectura caída lanza — la pantalla enseña su error, no
 * una cola vacía que se lea como «no hay nada que firmar».
 */
export async function colaRevision(
  tenantId: string,
  filtros: FiltrosCola = SIN_FILTROS,
  cursor: CursorCola | null = null,
  porPagina: number = COLA_POR_PAGINA,
): Promise<PaginaCola> {
  let q = supabaseAdmin()
    .from('liquidacion')
    .select(COLUMNAS_COLA, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('revision', filtros.revision);
  if (filtros.estado) q = q.eq('estatus', filtros.estado);
  if (filtros.operadorId) q = q.eq('viaje.operador_id', filtros.operadorId);
  if (filtros.unidadId) q = q.eq('viaje.unidad_id', filtros.unidadId);
  if (filtros.terminalId) q = q.eq('viaje.terminal_id', filtros.terminalId);
  if (filtros.desde) q = q.gte('created_at', inicioDiaMx(filtros.desde));
  if (filtros.hasta) q = q.lte('created_at', finDiaMx(filtros.hasta));
  if (cursor) {
    // `(created_at, id) > (c, i)`: más nueva, o del mismo instante con id después.
    q = q.or(`created_at.gt.${cursor.creadoEn},and(created_at.eq.${cursor.creadoEn},id.gt.${cursor.id})`);
  }
  q = q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, porPagina);

  const res = await acotada(q, 'revision.cola');
  const crudas = (exigir(res, 'revision.cola') ?? []) as unknown as FilaCruda[];
  if (typeof res.count !== 'number') throw new Error('revision.cola: la base no devolvió el conteo');
  const hayMas = crudas.length > porPagina;
  const pagina = crudas.slice(0, porPagina);
  const ultima = pagina.at(-1);
  return {
    filas: pagina.map(aFilaCola),
    total: res.count,
    hayMas,
    siguiente: hayMas && ultima ? codificarCursorCola({ creadoEn: String(ultima.created_at), id: String(ultima.id) }) : null,
  };
}

/** Cuántas esperan firma en la flota. Lanza si no se pudo contar. */
export async function contarPendientes(tenantId: string): Promise<number> {
  const res = await acotada(
    supabaseAdmin().from('liquidacion').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('revision', 'pendiente'),
    'revision.pendientes',
  );
  exigir(res, 'revision.pendientes');
  if (typeof res.count !== 'number') throw new Error('revision.pendientes: la base no devolvió el conteo');
  return res.count;
}

/** Tope declarado del selector de terminales. La tabla es chica (una flota
 *  tiene decenas de sucursales, no miles); si alguna vez pasa, se dice. */
export const TERMINALES_TOPE = 200;

export async function listarTerminales(tenantId: string): Promise<{ opciones: Array<{ id: string; nombre: string }>; recortadas: boolean }> {
  const res = await acotada(
    supabaseAdmin().from('terminal').select('id, nombre', { count: 'exact' })
      .eq('tenant_id', tenantId).order('nombre').order('id').range(0, TERMINALES_TOPE - 1),
    'revision.terminales',
  );
  const filas = (exigir(res, 'revision.terminales') ?? []) as Array<{ id: string; nombre: string }>;
  return { opciones: filas.map((t) => ({ id: t.id, nombre: t.nombre })), recortadas: typeof res.count === 'number' && res.count > filas.length };
}

// ── La revisión de UNA liquidación (para el detalle) ────────────────────────

export interface AjusteAplicado { gastoId: string; concepto: string; montoAnterior: number; montoNuevo: number }

export interface RevisionDetalle {
  revision: RevisionLiquidacion;
  /** Quién firmó: nombre o correo. `null` con revisión ≠ pendiente = la firmó
   *  el motor (cuadró sola). */
  revisadaPor: string | null;
  revisadaEn: string | null;
  motivo: string | null;
  ajustes: AjusteAplicado[];
  /** `viaje.estatus` de HOY — la RPC exige `liquidado` para firmar. */
  viajeEstatus: string;
  /** ¿Puede recibir firma humana? Pendiente, o firme por el motor (la persona
   *  puede corregir lo que cuadró solo: el $800 que era $8,000). */
  firmable: boolean;
}

export async function leerRevision(tenantId: string, liquidacionId: string): Promise<RevisionDetalle | null> {
  const res = await acotada(
    supabaseAdmin().from('liquidacion')
      .select('revision, revisada_por, revisada_por_email, revisada_en, motivo, ajustes, viaje:viaje_id(estatus), revisor:revisada_por(nombre, email)')
      .eq('tenant_id', tenantId).eq('id', liquidacionId).maybeSingle(),
    'revision.leer',
  );
  const r = exigir(res, 'revision.leer') as Record<string, unknown> | null;
  if (!r) return null;
  const revision = r.revision as RevisionLiquidacion;
  const revisor = r.revisor as { nombre?: string | null; email?: string | null } | null;
  const humano = r.revisada_por !== null || r.revisada_por_email !== null;
  const crudos = Array.isArray(r.ajustes) ? (r.ajustes as Array<Record<string, unknown>>) : [];
  return {
    revision,
    revisadaPor: humano ? (revisor?.nombre || revisor?.email || (r.revisada_por_email as string | null) || null) : null,
    revisadaEn: (r.revisada_en as string | null) ?? null,
    motivo: (r.motivo as string | null) ?? null,
    ajustes: crudos.map((a) => ({
      gastoId: String(a.gasto_id ?? ''), concepto: String(a.concepto ?? ''),
      montoAnterior: Number(a.monto_anterior ?? 0), montoNuevo: Number(a.monto_nuevo ?? 0),
    })),
    viajeEstatus: String((r.viaje as { estatus?: string } | null)?.estatus ?? ''),
    firmable: revision === 'pendiente' || (revision !== 'rechazada' && !humano),
  };
}

// ── La escritura ────────────────────────────────────────────────────────────

export interface AjustePedido { gastoId: string; montoNuevo: number }

export interface PeticionRevision {
  tenantId: string;
  liquidacionId: string;
  accion: AccionRevision;
  motivo?: string | null;
  ajustes?: AjustePedido[] | null;
  actor: { id: string; email?: string | null };
}

export interface ResultadoRevision {
  revision: RevisionLiquidacion;
  viajeId: string;
  folio: string;
  totalComprobado: number;
  diferencia: number;
  ajustes: AjusteAplicado[];
  /** Solo al rechazar: si el aviso al chofer salió (o quedó en el outbox). */
  choferAvisado: boolean | null;
}

/** Los SQLSTATE propios de la RPC cuyo mensaje está escrito para la persona. */
const CODIGOS_PARA_PANTALLA = new Set(['LR001', 'LR010', 'LR011', 'LR012', 'LR013', 'LR014', 'LR015', 'LR016', 'LR017', 'LR018', 'LR019']);

/**
 * Lo que se le dice al chofer cuando su liquidación se regresa. Tono llano,
 * sin cifras: las cifras las calculará el motor cuando vuelva a cuadrar.
 * Exportado para probarlo.
 */
export function textoRechazoChofer(folio: string, motivo: string): string {
  return `Tu liquidación del viaje ${folio} se regresó a revisión.\n\nMotivo: ${motivo.trim()}\n\nManda por aquí los comprobantes que falten o los que haya que corregir. Cuando termines, escribe "ya" y vuelvo a cuadrar el viaje.`;
}

/** Valida y normaliza los ajustes que vienen de un formulario. Lanza `DatoInvalido`. */
export function normalizarAjustes(crudos: Array<{ gastoId: string; montoNuevo: unknown }>): AjustePedido[] {
  const salida: AjustePedido[] = [];
  for (const a of crudos) {
    if (!UUID.test(a.gastoId)) throw new DatoInvalido('Uno de los comprobantes a ajustar no se reconoce.');
    const texto = String(a.montoNuevo ?? '').trim().replace(/[$,\s]/g, '');
    if (texto === '') continue;
    const n = Number(texto);
    if (!Number.isFinite(n)) throw new DatoInvalido(`«${String(a.montoNuevo)}» no es un monto.`);
    if (n <= 0) throw new DatoInvalido('El monto ajustado tiene que ser mayor a cero. Si el comprobante no vale, rechaza la liquidación.');
    if (n > 1_000_000) throw new DatoInvalido('El monto ajustado no puede pasar de un millón de pesos: revisa el cero de más.');
    salida.push({ gastoId: a.gastoId, montoNuevo: Math.round(n * 100) / 100 });
  }
  return salida;
}

export async function revisarLiquidacion(p: PeticionRevision): Promise<ResultadoRevision> {
  if (!(ACCIONES_REVISION as readonly string[]).includes(p.accion)) {
    throw new DatoInvalido('Acción desconocida.');
  }
  const motivo = (p.motivo ?? '').trim();
  if ((p.accion === 'ajustar' || p.accion === 'rechazar') && motivo === '') {
    throw new DatoInvalido(p.accion === 'rechazar'
      ? 'Para rechazar hay que escribir el motivo: es lo que va a leer el chofer.'
      : 'Para ajustar hay que escribir el motivo: queda en la bitácora junto al ajuste.');
  }
  if (p.accion === 'ajustar' && (!p.ajustes || p.ajustes.length === 0)) {
    throw new DatoInvalido('Para ajustar, captura el monto correcto de al menos un comprobante.');
  }

  const { data, error } = await acotada(
    supabaseAdmin().rpc('revisar_liquidacion', {
      p_tenant: p.tenantId,
      p_liquidacion: p.liquidacionId,
      p_accion: p.accion,
      p_motivo: motivo || null,
      p_ajustes: p.accion === 'ajustar' ? (p.ajustes ?? []) : null,
      p_actor: p.actor.id,
      p_actor_email: p.actor.email ?? null,
    }),
    'revision.rpc',
  );
  if (error) {
    const codigo = (error as { code?: string }).code ?? '';
    if (codigo === '23505') {
      throw new DatoInvalido('No se puede rechazar: el operador ya trae otro viaje abierto y un operador solo puede tener uno. Cierra ese viaje primero; esta liquidación no se tocó.');
    }
    if (codigo === 'LR002') throw new DatoInvalido('Esa liquidación no existe en esta flota.');
    if (CODIGOS_PARA_PANTALLA.has(codigo)) throw new DatoInvalido(error.message);
    throw new Error(`revisarLiquidacion: ${error.message}`);
  }

  const r = (data ?? {}) as Record<string, unknown>;
  const crudos = Array.isArray(r.ajustes) ? (r.ajustes as Array<Record<string, unknown>>) : [];
  const resultado: ResultadoRevision = {
    revision: r.revision as RevisionLiquidacion,
    viajeId: String(r.viaje_id ?? ''),
    folio: String(r.folio || String(r.viaje_id ?? '').slice(0, 8)),
    totalComprobado: Number(r.total_comprobado ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    ajustes: crudos.map((a) => ({
      gastoId: String(a.gasto_id ?? ''), concepto: String(a.concepto ?? ''),
      montoAnterior: Number(a.monto_anterior ?? 0), montoNuevo: Number(a.monto_nuevo ?? 0),
    })),
    choferAvisado: null,
  };

  if (p.accion === 'rechazar') {
    // Best-effort y DESPUÉS de que la base confirmó: la liquidación ya está
    // rechazada aunque el aviso no salga. `sendText` encola al outbox lo que
    // Meta no aceptó por un error transitorio; fuera de 24 h (WA-4) no hay
    // plantilla y el aviso se pierde — se dice en pantalla con `choferAvisado`.
    const telefono = typeof r.operador_telefono === 'string' ? r.operador_telefono : '';
    if (telefono) {
      try {
        const id = await sendText(telefono, textoRechazoChofer(resultado.folio, motivo));
        resultado.choferAvisado = id !== null;
      } catch (e) {
        logger.warn('revision.aviso_chofer', { liquidacion: p.liquidacionId, err: e instanceof Error ? e.message : String(e) });
        resultado.choferAvisado = false;
      }
    } else {
      resultado.choferAvisado = false;
    }
  }

  return resultado;
}
