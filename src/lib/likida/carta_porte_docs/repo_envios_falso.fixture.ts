// ═══════════════════════════════════════════════════════════════════════════
// UN `repo_envios.ts` EN MEMORIA, SOLO PARA PRUEBAS (T-A3-27).
//
// Implementa la MISMA interfaz `RepoEnvios` con la semántica que importa de la 0790:
// aislamiento por tenant, llave de idempotencia única por flota, un solo envío ACTIVO
// por documento, UPDATE condicional por estado, y el reclamo con lease (reloj inyectado)
// que NUNCA entrega el mismo envío a dos pasadas. No es Postgres: lo que solo la base
// demuestra vive en supabase/tests/. Aquí se prueba la LÓGICA del worker y de los insights.
// ═══════════════════════════════════════════════════════════════════════════

import type { EnvioTmsFila, EstadoEnvioTms } from './repo';
import {
  ESTADOS_ENVIO, TOPE_RECLAMO, LEASE_SEGUNDOS, columnasDeCambios,
  type EnvioDetalle, type RepoEnvios,
} from './repo_envios';

interface FilaFalsa extends EnvioDetalle { _creadoMs: number }

const VIVOS: ReadonlyArray<EstadoEnvioTms> = ['pendiente_prechequeo', 'pendiente_reque', 'listo', 'error_transitorio', 'enviando'];
/** Los estados que NO cuentan para el índice parcial «un activo por documento» (0790). */
const NO_ACTIVOS: ReadonlyArray<EstadoEnvioTms> = ['descartado', 'rechazado_tms', 'subido_a_mano', 'enviado'];

export const estadoEnvios = {
  filas: [] as FilaFalsa[],
  /** documentos que existen, por tenant (FK compuesta de la 0790): `${tenantId}:${documentoId}`. Vacío = no se valida. */
  documentos: new Set<string>(),
  /** Simula una base SIN la 0790: las RPC dicen «no existe». */
  sinMigracion: false,
  /** Forzar fallos: `estadoEnvios.fallar.set('reclamar', new Error('x'))`. */
  fallar: new Map<string, Error>(),
  reloj: { ahora: () => new Date() },
  seq: 0,
};

export function resetEnvios(): void {
  estadoEnvios.filas.length = 0; estadoEnvios.documentos.clear(); estadoEnvios.sinMigracion = false;
  estadoEnvios.fallar.clear(); estadoEnvios.reloj.ahora = () => new Date(); estadoEnvios.seq = 0;
}

const falla = (op: string): void => { const e = estadoEnvios.fallar.get(op); if (e) throw e; };
const clon = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const detalle = (f: FilaFalsa): EnvioDetalle => { const { _creadoMs, ...resto } = f; void _creadoMs; return clon(resto); };
const ahoraMs = (): number => estadoEnvios.reloj.ahora().getTime();
const iso = (ms: number): string => new Date(ms).toISOString();

/** Atajo de pruebas: deja un envío en el estado que se pida (con los campos que se pasen). */
export function sembrarEnvio(tenantId: string, parcial: Partial<EnvioDetalle> & { documentoId: string }): EnvioDetalle {
  const n = ++estadoEnvios.seq;
  const ms = ahoraMs();
  const f: FilaFalsa = {
    id: parcial.id ?? `envio-${n}`, tenantId, documentoId: parcial.documentoId, versionDoc: parcial.versionDoc ?? 1,
    idempotencyKey: parcial.idempotencyKey ?? `llave-${n}-${parcial.documentoId}`, estado: parcial.estado ?? 'pendiente_prechequeo',
    plantilla: parcial.plantilla ?? 'normal', intentos: parcial.intentos ?? 0, plantillaSha256: parcial.plantillaSha256 ?? null,
    proximaRevision: parcial.proximaRevision ?? null, procesandoHasta: parcial.procesandoHasta ?? null, referenciaTms: parcial.referenciaTms ?? null,
    ultimoError: parcial.ultimoError ?? null, errores: parcial.errores ?? [], alertaEnviadaEn: parcial.alertaEnviadaEn ?? null,
    enviadoEn: parcial.enviadoEn ?? null, causaPendiente: parcial.causaPendiente ?? null,
    createdAt: parcial.createdAt ?? iso(ms), updatedAt: parcial.updatedAt ?? iso(ms),
    _creadoMs: Date.parse(parcial.createdAt ?? iso(ms)),
  };
  estadoEnvios.filas.push(f);
  return detalle(f);
}

const buscar = (tenantId: string, id: string): FilaFalsa | undefined => estadoEnvios.filas.find((x) => x.tenantId === tenantId && x.id === id);

export const repoEnviosFalso: RepoEnvios = {
  async insertar(tenantId, e) {
    falla('insertar');
    const previo = estadoEnvios.filas.find((x) => x.tenantId === tenantId && x.idempotencyKey === e.idempotencyKey);
    if (previo) return { envio: clon(basico(previo)), creado: false };
    if (estadoEnvios.documentos.size > 0 && !estadoEnvios.documentos.has(`${tenantId}:${e.documentoId}`)) {
      throw new Error('repo envios falso: FK compuesta (envío de otra flota o de un documento inexistente)');
    }
    // Índice parcial único de la 0790: un solo envío ACTIVO por documento.
    if (estadoEnvios.filas.some((x) => x.tenantId === tenantId && x.documentoId === e.documentoId && !NO_ACTIVOS.includes(x.estado))) return null;
    const creado = sembrarEnvio(tenantId, { documentoId: e.documentoId, versionDoc: e.versionDoc, idempotencyKey: e.idempotencyKey, plantilla: e.plantilla });
    return { envio: basico(creado), creado: true };
  },

  async leer(tenantId, id) { falla('leer'); const f = buscar(tenantId, id); return f ? detalle(f) : null; },

  async actualizar(tenantId, id, desde, cambios) {
    falla('actualizar');
    if (desde.length === 0) throw new Error('cartaporte_docs envio: actualizar exige al menos un estado de origen');
    const col = columnasDeCambios(cambios); // mismas validaciones y el mismo saneo que la real
    const f = buscar(tenantId, id);
    if (!f || !desde.includes(f.estado)) return false;
    if (col.estado !== undefined) f.estado = col.estado as EstadoEnvioTms;
    if (col.intentos !== undefined) f.intentos = col.intentos as number;
    if ('proxima_revision' in col) f.proximaRevision = col.proxima_revision as string | null;
    if ('plantilla_sha256' in col) f.plantillaSha256 = col.plantilla_sha256 as string | null;
    if ('referencia_tms' in col) f.referenciaTms = col.referencia_tms as string | null;
    if ('ultimo_error' in col) f.ultimoError = col.ultimo_error as EnvioDetalle['ultimoError'];
    if ('errores' in col) f.errores = col.errores as EnvioDetalle['errores'];
    if ('enviado_en' in col) f.enviadoEn = col.enviado_en as string | null;
    if ('causa_pendiente' in col) f.causaPendiente = col.causa_pendiente as string | null;
    if ('procesando_hasta' in col) f.procesandoHasta = null;
    f.updatedAt = iso(ahoraMs());
    return true;
  },

  async reclamar(limite, leaseSegundos = LEASE_SEGUNDOS) {
    falla('reclamar');
    if (estadoEnvios.sinMigracion) return { ok: false, motivo: 'sin_migracion' };
    if (!Number.isInteger(limite) || limite < 1 || limite > TOPE_RECLAMO) throw new Error('cp_envio_reclamar: p_limite fuera de rango (1-200)');
    if (leaseSegundos < 30 || leaseSegundos > 900) throw new Error('cp_envio_reclamar: p_lease_segundos fuera de rango (30-900)');
    const ahora = ahoraMs();
    // Elegible: estado vivo, ya le toca y sin lease vigente (mismo WHERE y mismo orden que la RPC).
    const elegibles = estadoEnvios.filas
      .filter((f) => VIVOS.includes(f.estado)
        && (f.proximaRevision === null || Date.parse(f.proximaRevision) <= ahora)
        && (f.procesandoHasta === null || Date.parse(f.procesandoHasta) < ahora))
      .sort((a, b) => (Date.parse(a.proximaRevision ?? a.createdAt) - Date.parse(b.proximaRevision ?? b.createdAt)) || a.id.localeCompare(b.id))
      .slice(0, limite);
    for (const f of elegibles) { f.procesandoHasta = iso(ahora + leaseSegundos * 1000); f.intentos += 1; f.updatedAt = iso(ahora); }
    return {
      ok: true,
      envios: elegibles.map((f) => ({ id: f.id, tenantId: f.tenantId, documentoId: f.documentoId, estado: f.estado, intentos: f.intentos, idempotencyKey: f.idempotencyKey })),
    };
  },

  async marcarAlerta(tenantId, id) {
    falla('marcarAlerta');
    if (estadoEnvios.sinMigracion) return 'sin_migracion';
    const f = buscar(tenantId, id);
    if (!f || f.alertaEnviadaEn !== null) return 'perdido';
    f.alertaEnviadaEn = iso(ahoraMs());
    return 'ganado';
  },

  async liberarAlerta(tenantId, id) {
    falla('liberarAlerta');
    const f = buscar(tenantId, id);
    if (!f || f.alertaEnviadaEn === null) return false;
    f.alertaEnviadaEn = null;
    return true;
  },

  async listarPorDocumento(tenantId, documentoId) {
    falla('listarPorDocumento');
    // El más nuevo primero; a igual instante, el último insertado (orden estable de inserción inverso).
    return estadoEnvios.filas.filter((x) => x.tenantId === tenantId && x.documentoId === documentoId)
      .map((f, i) => ({ f, i })).sort((a, b) => (b.f._creadoMs - a.f._creadoMs) || (b.i - a.i)).slice(0, 50).map(({ f }) => detalle(f));
  },

  async contarPorEstado(tenantId, desde) {
    falla('contarPorEstado');
    const salida = Object.fromEntries(ESTADOS_ENVIO.map((e) => [e, 0])) as Record<EstadoEnvioTms, number>;
    for (const f of estadoEnvios.filas) if (f.tenantId === tenantId && f._creadoMs >= desde.getTime()) salida[f.estado] += 1;
    return salida;
  },
};

function basico(d: EnvioDetalle): EnvioTmsFila {
  return { id: d.id, tenantId: d.tenantId, documentoId: d.documentoId, versionDoc: d.versionDoc, idempotencyKey: d.idempotencyKey, estado: d.estado, plantilla: d.plantilla, intentos: d.intentos };
}
