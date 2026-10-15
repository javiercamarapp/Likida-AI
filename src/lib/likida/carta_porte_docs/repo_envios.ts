// ═══════════════════════════════════════════════════════════════════════════
// REPOSITORIO DE ENVÍOS AL TMS (T-A3-27) — la cola `cp_envio_tms` (0790).
//
// Qué resuelve (33c4d51b 32:46 y 34:42): si el requerimiento todavía no existe, el
// envío NO se pierde: queda guardado AQUÍ (en el software, no en el correo ya
// recibido), se reclama con lease cada cierto tiempo, se avisa UNA sola vez y el
// encargado lo ve en la bandeja. Este archivo es solo el ACCESO A DATOS de esa
// cola; la decisión de qué estado sigue es `envio_estados.ts` (puro) y quien
// ejecuta es el worker de envíos (T-A3-28).
//
// Contrato único: la interfaz `RepoEnvios`. `repoEnvios` es la real (Supabase) y
// `repo_envios_falso.fixture.ts` es el doble en memoria con la MISMA semántica.
//
// Reglas (las de `repo.ts`):
//   · service_role salta RLS: CADA consulta lleva `.eq('tenant_id')` (la única
//     que cruza flotas a propósito es `cp_envio_reclamar`, la RPC del barrido
//     del cron; cada fila que devuelve trae su tenant y todo lo posterior va
//     anclado a ESE tenant);
//   · supabase-js reporta errores POR VALOR: se LANZAN. «No pude leer» jamás se
//     vuelve «no hay nada» y, como `registrarEvento`, sin rastro no hay operación;
//   · la ÚNICA excepción es «la función no existe» (migración 0790 sin aplicar):
//     `reclamar`/`marcarAlerta` contestan `sin_migracion` y la funcionalidad se
//     apaga sin romper el cron (mismo patrón de `funcionAusente`, repo.ts);
//   · escribir el estado es SIEMPRE condicional (`estado in (desde)` en el WHERE):
//     dos pasadas, o un reintento tardío, no se pisan;
//   · `errores`/`ultimo_error` guardan SOLO hoja/fila/campo/código — jamás el
//     valor de un campo (regla de retención de la 0420): `sanearErrores`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir } from '../pg';
import { funcionAusente, insertarEnvioTms, type EnvioTmsFila, type EstadoEnvioTms } from './repo';

type Fila = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const ESTADOS_ENVIO: ReadonlyArray<EstadoEnvioTms> = [
  'pendiente_prechequeo', 'pendiente_reque', 'listo', 'enviando', 'enviado',
  'rechazado_tms', 'error_transitorio', 'subido_a_mano', 'descartado',
];

/** Tope de envíos que toma una pasada (el RPC acepta 1–200). */
export const TOPE_RECLAMO = 200;
/** Lease por omisión: el RPC acepta 30–900 s. */
export const LEASE_SEGUNDOS = 120;
/** `errores` pesa ≤ 8 KB en la base; aquí se acota ANTES de que la base lo rechace. */
export const TOPE_ERRORES = 50;
const TOPE_TEXTO = 80;

/** Un error del TMS reducido a su UBICACIÓN: nunca el contenido del campo. */
export interface ErrorEnvio { codigo?: string; hoja?: string; fila?: number; campo?: string }

/** Todo lo de una fila de `cp_envio_tms`. */
export interface EnvioDetalle extends EnvioTmsFila {
  plantillaSha256: string | null;
  proximaRevision: string | null;
  procesandoHasta: string | null;
  referenciaTms: string | null;
  ultimoError: ErrorEnvio | null;
  errores: ErrorEnvio[];
  alertaEnviadaEn: string | null;
  enviadoEn: string | null;
  causaPendiente: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lo que devuelve `cp_envio_reclamar`: lo mínimo para decidir; el resto se relee con `leer`. */
export interface EnvioReclamado {
  id: string; tenantId: string; documentoId: string; estado: EstadoEnvioTms; intentos: number; idempotencyKey: string;
}

export type ResultadoReclamo = { ok: true; envios: EnvioReclamado[] } | { ok: false; motivo: 'sin_migracion' };

export interface CambiosEnvio {
  estado?: EstadoEnvioTms;
  intentos?: number;
  /** ISO; `null` = sin próxima revisión. */
  proximaRevision?: string | null;
  plantillaSha256?: string | null;
  referenciaTms?: string | null;
  ultimoError?: ErrorEnvio | null;
  errores?: ErrorEnvio[];
  /** Obligatorio al pasar a `enviado` (la base lo exige: `cp_envio_tms_enviado_coherente`). */
  enviadoEn?: string;
  causaPendiente?: string | null;
  /** Suelta el lease (`procesando_hasta = null`): el envío vuelve a ser reclamable cuando le toque. */
  soltarLease?: boolean;
}

export interface NuevoEnvio { documentoId: string; versionDoc: number; idempotencyKey: string; plantilla: 'normal' | 'nueva' }

export interface RepoEnvios {
  /** Idempotente por (flota, llave). `null` = el documento ya tiene OTRO envío activo. */
  insertar(tenantId: string, e: NuevoEnvio): Promise<{ envio: EnvioTmsFila; creado: boolean } | null>;
  leer(tenantId: string, id: string): Promise<EnvioDetalle | null>;
  /** UPDATE condicional: solo si el envío sigue en uno de `desde`. `false` = ya no estaba (otra pasada lo movió). */
  actualizar(tenantId: string, id: string, desde: EstadoEnvioTms[], cambios: CambiosEnvio): Promise<boolean>;
  /** Toma hasta `limite` envíos vencidos con lease (reloj de la BASE). Cruza flotas a propósito: es el barrido del cron. */
  reclamar(limite: number, leaseSegundos?: number): Promise<ResultadoReclamo>;
  /** El candado de «avisar UNA vez por envío». `sin_migracion` = no hay candado atómico: no se avisa. */
  marcarAlerta(tenantId: string, id: string): Promise<'ganado' | 'perdido' | 'sin_migracion'>;
  /** Suelta el candado cuando el aviso NO salió (rechazo definitivo). `true` = lo soltó. */
  liberarAlerta(tenantId: string, id: string): Promise<boolean>;
  /** Los envíos de un documento, el más nuevo primero. */
  listarPorDocumento(tenantId: string, documentoId: string): Promise<EnvioDetalle[]>;
  /** Cuántos envíos CREADOS desde `desde` hay en cada estado (para los insights). Todos los estados salen, con 0 si no hay. */
  contarPorEstado(tenantId: string, desde: Date): Promise<Record<EstadoEnvioTms, number>>;
}

/**
 * Reduce los errores del TMS a hoja/fila/campo/código con texto acotado. Lo demás (mensaje libre, valores) se descarta:
 * un mensaje del TMS puede traer el valor del campo rechazado, y ese valor no se guarda.
 */
export function sanearErrores(errores: ReadonlyArray<unknown>): ErrorEnvio[] {
  const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, TOPE_TEXTO) : undefined);
  return errores.slice(0, TOPE_ERRORES).flatMap((x): ErrorEnvio[] => {
    if (typeof x !== 'object' || x === null) return [];
    const e = x as Record<string, unknown>;
    const salida: ErrorEnvio = {};
    const codigo = texto(e.codigo); if (codigo) salida.codigo = codigo;
    const hoja = texto(e.hoja); if (hoja) salida.hoja = hoja;
    const campo = texto(e.campo); if (campo) salida.campo = campo;
    if (typeof e.fila === 'number' && Number.isInteger(e.fila) && e.fila >= 0) salida.fila = e.fila;
    return Object.keys(salida).length > 0 ? [salida] : [];
  });
}

/** Valida y traduce los cambios a columnas. Compartida con el doble para que ambos fallen igual. */
export function columnasDeCambios(c: CambiosEnvio): Record<string, unknown> {
  if (c.estado === 'enviado' && !c.enviadoEn) throw new Error('cartaporte_docs envio: pasar a «enviado» exige enviadoEn');
  if (c.intentos !== undefined && (!Number.isInteger(c.intentos) || c.intentos < 0)) throw new Error('cartaporte_docs envio: intentos inválido');
  const col: Record<string, unknown> = {};
  if (c.estado !== undefined) col.estado = c.estado;
  if (c.intentos !== undefined) col.intentos = c.intentos;
  if (c.proximaRevision !== undefined) col.proxima_revision = c.proximaRevision;
  if (c.plantillaSha256 !== undefined) col.plantilla_sha256 = c.plantillaSha256;
  if (c.referenciaTms !== undefined) col.referencia_tms = c.referenciaTms === null ? null : c.referenciaTms.slice(0, 200);
  if (c.ultimoError !== undefined) col.ultimo_error = c.ultimoError === null ? null : (sanearErrores([c.ultimoError])[0] ?? null);
  if (c.errores !== undefined) col.errores = sanearErrores(c.errores);
  if (c.enviadoEn !== undefined) col.enviado_en = c.enviadoEn;
  if (c.causaPendiente !== undefined) col.causa_pendiente = c.causaPendiente === null ? null : c.causaPendiente.slice(0, 200);
  if (c.soltarLease) col.procesando_hasta = null;
  return col;
}

const COLUMNAS_DETALLE = 'id, tenant_id, documento_id, version_doc, idempotency_key, estado, plantilla, intentos, plantilla_sha256, proxima_revision, procesando_hasta, referencia_tms, ultimo_error, errores, alerta_enviada_en, enviado_en, causa_pendiente, created_at, updated_at';

const aDetalle = (f: Fila): EnvioDetalle => ({
  id: String(f.id), tenantId: String(f.tenant_id), documentoId: String(f.documento_id), versionDoc: Number(f.version_doc),
  idempotencyKey: String(f.idempotency_key), estado: f.estado as EstadoEnvioTms, plantilla: f.plantilla as EnvioDetalle['plantilla'], intentos: Number(f.intentos ?? 0),
  plantillaSha256: s(f.plantilla_sha256), proximaRevision: s(f.proxima_revision), procesandoHasta: s(f.procesando_hasta), referenciaTms: s(f.referencia_tms),
  ultimoError: (f.ultimo_error as ErrorEnvio | null) ?? null, errores: Array.isArray(f.errores) ? (f.errores as ErrorEnvio[]) : [],
  alertaEnviadaEn: s(f.alerta_enviada_en), enviadoEn: s(f.enviado_en), causaPendiente: s(f.causa_pendiente),
  createdAt: String(f.created_at), updatedAt: String(f.updated_at),
});

export const repoEnvios: RepoEnvios = {
  // La inserción idempotente (llave única + índice de «un activo por documento») ya vive en repo.ts desde T-A3-04: una sola.
  insertar: insertarEnvioTms,

  async leer(tenantId, id) {
    const r = await acotada(supabaseAdmin().from('cp_envio_tms').select(COLUMNAS_DETALLE).eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'cpdocs.envio_leer');
    const f = exigir(r, 'cpdocs.envio_leer') as unknown as Fila | null;
    return f ? aDetalle(f) : null;
  },

  async actualizar(tenantId, id, desde, cambios) {
    if (desde.length === 0) throw new Error('cartaporte_docs envio: actualizar exige al menos un estado de origen');
    const columnas = { ...columnasDeCambios(cambios), updated_at: new Date().toISOString() };
    const r = await acotada(supabaseAdmin().from('cp_envio_tms').update(columnas)
      .eq('tenant_id', tenantId).eq('id', id).in('estado', desde).select('id'), 'cpdocs.envio_actualizar');
    return ((exigir(r, 'cpdocs.envio_actualizar') ?? []) as unknown[]).length > 0;
  },

  async reclamar(limite, leaseSegundos = LEASE_SEGUNDOS) {
    const r = await acotada(supabaseAdmin().rpc('cp_envio_reclamar', { p_limite: limite, p_lease_segundos: leaseSegundos }), 'cpdocs.envio_reclamar');
    if (r.error) {
      if (funcionAusente(r.error)) return { ok: false, motivo: 'sin_migracion' };
      throw new Error(`cpdocs.envio_reclamar: ${r.error.message}`);
    }
    const envios = ((r.data ?? []) as unknown as Fila[]).map((f): EnvioReclamado => ({
      id: String(f.id), tenantId: String(f.tenant_id), documentoId: String(f.documento_id), estado: f.estado as EstadoEnvioTms,
      intentos: Number(f.intentos ?? 0), idempotencyKey: String(f.idempotency_key),
    }));
    return { ok: true, envios };
  },

  async marcarAlerta(tenantId, id) {
    const r = await acotada(supabaseAdmin().rpc('cp_envio_marcar_alerta', { p_tenant: tenantId, p_id: id }), 'cpdocs.envio_marcar_alerta');
    if (r.error) {
      if (funcionAusente(r.error)) return 'sin_migracion';
      throw new Error(`cpdocs.envio_marcar_alerta: ${r.error.message}`);
    }
    return r.data === true ? 'ganado' : 'perdido';
  },

  async liberarAlerta(tenantId, id) {
    const r = await acotada(supabaseAdmin().rpc('cp_envio_liberar_alerta', { p_tenant: tenantId, p_id: id }), 'cpdocs.envio_liberar_alerta');
    if (r.error) throw new Error(`cpdocs.envio_liberar_alerta: ${r.error.message}`);
    return r.data === true;
  },

  async listarPorDocumento(tenantId, documentoId) {
    const r = await acotada(supabaseAdmin().from('cp_envio_tms').select(COLUMNAS_DETALLE)
      .eq('tenant_id', tenantId).eq('documento_id', documentoId).order('created_at', { ascending: false }).limit(50), 'cpdocs.envios_doc_detalle');
    return ((exigir(r, 'cpdocs.envios_doc_detalle') ?? []) as unknown as Fila[]).map(aDetalle);
  },

  async contarPorEstado(tenantId, desde) {
    // Un conteo exacto por estado (head: sin filas): no hay recorte silencioso a 1,000 como en un select.
    const conteos = await Promise.all(ESTADOS_ENVIO.map(async (estado) => {
      const r = await acotada(supabaseAdmin().from('cp_envio_tms').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('estado', estado).gte('created_at', desde.toISOString()), 'cpdocs.envios_contar');
      exigir(r, 'cpdocs.envios_contar');
      if (typeof r.count !== 'number') throw new Error('cpdocs.envios_contar: la base no devolvió el conteo');
      return [estado, r.count] as const;
    }));
    return Object.fromEntries(conteos) as Record<EstadoEnvioTms, number>;
  },
};
