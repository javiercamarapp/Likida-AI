import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { importarDesglose, conciliarDesglose } from '../intake/desglose_peaje';
import { registrarCorrida } from '../agentes/corridas';

// ═══════════════════════════════════════════════════════════════════════════
// LA INGESTA AUTOMÁTICA DEL DESGLOSE DE PEAJE (0376).
//
// Antes: alguien bajaba el archivo del proveedor y lo subía a mano. Ahora hay un
// buzón firmado (POST /api/peajes/ingesta) y un cron (/api/cron/peajes) que
// procesa la cola. Este módulo es el corazón de los dos:
//
//   · la FIRMA: HMAC-SHA256 sobre `${timestamp}.${flota}.${cuerpo crudo}` con una
//     llave POR FLOTA derivada del secreto maestro del servidor y de la rotación
//     de la flota. La llave no vive en la base; rotarla es subir un entero.
//   · la RECEPCIÓN: valida, calcula la huella (sha256 del contenido) y encola.
//     El mismo archivo dos veces es la MISMA fila (unique flota+huella): el
//     proveedor puede reintentar y alguien puede reenviar sin duplicar nada.
//   · el PROCESO: reclama con `peaje_archivo_reclamar` (claim con lease y token),
//     importa y cruza, y cierra SOLO si todavía tiene el token. Un archivo cuyo
//     formato no se entiende queda `fallida` CON el motivo exacto (reintentar no
//     lo arregla: hay que declarar el mapeo de columnas); un fallo de
//     infraestructura reintenta con backoff y se rinde a los 5 intentos.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_ARCHIVO_INGESTA_BYTES = 4 * 1024 * 1024;
/** El JSON trae el archivo en base64 (+33%) y un poco de envoltura. */
export const MAX_CUERPO_INGESTA_BYTES = Math.ceil(MAX_ARCHIVO_INGESTA_BYTES * 4 / 3) + 4096;
export const TOLERANCIA_FIRMA_MS = 5 * 60_000;
export const MAX_PENDIENTES_POR_FLOTA = 50;
export const MAX_INTENTOS = 5;
export const LEASE_SEGUNDOS = 300;
/** Backoff entre intentos de un fallo de infraestructura: 1, 5, 15, 30 min. */
export const BACKOFF_MIN = [1, 5, 15, 30] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (s: string | null | undefined): s is string => !!s && UUID.test(s);

// ── La firma ────────────────────────────────────────────────────────────────

/** El secreto maestro, o null si falta o es corto (< 32 caracteres: no es un secreto). */
export function secretoMaestro(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.PEAJES_INGESTA_SECRETO;
  return s && s.length >= 32 ? s : null;
}

/** La llave de UNA flota en UNA rotación. Distintas flotas o rotaciones → llaves sin relación. */
export function claveDeFlota(secreto: string, tenantId: string, rotacion: number): string {
  return createHmac('sha256', secreto).update(`peajes-ingesta:${tenantId.toLowerCase()}:${rotacion}`).digest('hex');
}

/** Lo que firma el cliente: `v1=<hex>` sobre `${timestamp}.${flota}.${cuerpo}`. */
export function firmarIngesta(clave: string, tenantId: string, timestampSeg: number | string, cuerpo: string): string {
  const h = createHmac('sha256', Buffer.from(clave, 'hex')).update(`${timestampSeg}.${tenantId.toLowerCase()}.${cuerpo}`, 'utf8').digest('hex');
  return `v1=${h}`;
}

export type ResultadoFirmaIngesta = { ok: true } | { ok: false; motivo: 'faltan_cabeceras' | 'fuera_de_tiempo' | 'firma_invalida' };

export function verificarFirmaIngesta(
  clave: string,
  tenantId: string,
  cab: { timestamp: string | null; firma: string | null },
  cuerpo: string,
  ahoraMs: number,
): ResultadoFirmaIngesta {
  if (!cab.timestamp || !cab.firma) return { ok: false, motivo: 'faltan_cabeceras' };
  if (!/^\d{9,12}$/.test(cab.timestamp)) return { ok: false, motivo: 'fuera_de_tiempo' };
  if (Math.abs(ahoraMs - Number(cab.timestamp) * 1000) > TOLERANCIA_FIRMA_MS) return { ok: false, motivo: 'fuera_de_tiempo' };
  const esperada = Buffer.from(firmarIngesta(clave, tenantId, cab.timestamp, cuerpo), 'utf8');
  const recibida = Buffer.from(cab.firma.trim(), 'utf8');
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return { ok: false, motivo: 'firma_invalida' };
  return { ok: true };
}

// ── El cuerpo ───────────────────────────────────────────────────────────────

export interface CuerpoIngesta { nombre: string; proveedor: string | null; contenido: Buffer }

export type ResultadoCuerpo = { ok: true; cuerpo: CuerpoIngesta } | { ok: false; motivo: string };

const EXT_ACEPTADAS = /\.(xlsx|xls|csv|tsv|ods|pdf)$/i;

/** `{ nombre, proveedor?, contenido_base64 }` → el archivo, o el motivo exacto. */
export function leerCuerpoIngesta(texto: string): ResultadoCuerpo {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: 'El cuerpo no es JSON válido.' };
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return { ok: false, motivo: 'El cuerpo debe ser un objeto JSON.' };
  const o = j as Record<string, unknown>;

  const nombre = typeof o.nombre === 'string' ? o.nombre.trim() : '';
  if (!nombre || nombre.length > 255) return { ok: false, motivo: '«nombre» es obligatorio (hasta 255 caracteres).' };
  // Solo el nombre del archivo: sin rutas ni caracteres de control.
  if (/[\\/\u0000-\u001f]/.test(nombre)) return { ok: false, motivo: '«nombre» no puede traer rutas ni caracteres de control.' };
  if (!EXT_ACEPTADAS.test(nombre)) return { ok: false, motivo: 'El archivo debe ser Excel (.xlsx/.xls/.ods), CSV/TSV o PDF.' };

  let proveedor: string | null = null;
  if (o.proveedor !== undefined && o.proveedor !== null) {
    if (typeof o.proveedor !== 'string' || o.proveedor.trim().length > 60) return { ok: false, motivo: '«proveedor» debe ser texto de hasta 60 caracteres.' };
    proveedor = o.proveedor.trim() || null;
  }

  const b64 = typeof o.contenido_base64 === 'string' ? o.contenido_base64.replace(/\s+/g, '') : '';
  if (!b64) return { ok: false, motivo: '«contenido_base64» es obligatorio.' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return { ok: false, motivo: '«contenido_base64» no es base64 válido.' };
  const contenido = Buffer.from(b64, 'base64');
  if (contenido.length === 0) return { ok: false, motivo: 'El archivo está vacío.' };
  if (contenido.length > MAX_ARCHIVO_INGESTA_BYTES) return { ok: false, motivo: `El archivo pasa de ${MAX_ARCHIVO_INGESTA_BYTES / 1024 / 1024} MB.` };
  return { ok: true, cuerpo: { nombre, proveedor, contenido } };
}

export const huellaDe = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** bytea de PostgREST (`\x0102…`) ↔ Buffer. */
export const bufferDeBytea = (v: unknown): Buffer | null => {
  if (typeof v !== 'string' || !v.startsWith('\\x')) return null;
  return Buffer.from(v.slice(2), 'hex');
};
export const byteaDeBuffer = (b: Buffer): string => `\\x${b.toString('hex')}`;

// ── La recepción ────────────────────────────────────────────────────────────

export type ResultadoRecepcion =
  | { ok: true; id: string; duplicado: boolean; estado: string }
  | { ok: false; codigo: 'cola_llena' | 'error'; motivo: string };

/** Encola el archivo. Idempotente por (flota, huella). */
export async function recibirArchivoPeaje(tenantId: string, c: CuerpoIngesta, origen: 'api' | 'panel' = 'api'): Promise<ResultadoRecepcion> {
  const huella = huellaDe(c.contenido);
  const admin = supabaseAdmin();

  const existente = await acotada(admin.from('peaje_ingesta_archivo').select('id, estado')
    .eq('tenant_id', tenantId).eq('huella', huella).maybeSingle(), 'peajes.ingesta.existente');
  if (existente.error) return { ok: false, codigo: 'error', motivo: existente.error.message };
  if (existente.data) return { ok: true, id: String(existente.data.id), duplicado: true, estado: String(existente.data.estado) };

  // Un tope de pendientes por flota: sin él, una llave filtrada llenaría la tabla.
  const pend = await acotada(admin.from('peaje_ingesta_archivo').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).in('estado', ['pendiente', 'procesando']), 'peajes.ingesta.pendientes');
  if (pend.error) return { ok: false, codigo: 'error', motivo: pend.error.message };
  if ((pend.count ?? 0) >= MAX_PENDIENTES_POR_FLOTA) {
    return { ok: false, codigo: 'cola_llena', motivo: `Hay ${pend.count} archivos pendientes de procesar; espera a que se vacíe la cola.` };
  }

  const ins = await acotada(admin.from('peaje_ingesta_archivo').insert({
    tenant_id: tenantId, huella, nombre: c.nombre, proveedor: c.proveedor, origen,
    bytes: c.contenido.length, contenido: byteaDeBuffer(c.contenido), estado: 'pendiente',
  }).select('id').single(), 'peajes.ingesta.insertar');
  if (ins.error || !ins.data) {
    // La carrera de dos envíos simultáneos del mismo archivo: el segundo choca con
    // el unique y se trata como duplicado, no como error.
    if (ins.error && /duplicate key|unique/i.test(ins.error.message)) {
      const otra = await acotada(admin.from('peaje_ingesta_archivo').select('id, estado')
        .eq('tenant_id', tenantId).eq('huella', huella).maybeSingle(), 'peajes.ingesta.carrera');
      if (otra.data) return { ok: true, id: String(otra.data.id), duplicado: true, estado: String(otra.data.estado) };
    }
    return { ok: false, codigo: 'error', motivo: ins.error?.message ?? 'sin id' };
  }
  return { ok: true, id: String(ins.data.id), duplicado: false, estado: 'pendiente' };
}

// ── El proceso (lo llama el cron) ───────────────────────────────────────────

export interface ResumenCola {
  tomados: number;
  procesados: number;
  /** Formato ilegible o error del archivo: quedan `fallida` con su motivo. */
  fallidos: number;
  /** Fallo de infraestructura: vuelven a la cola con backoff. */
  reintentar: number;
  /** El token del claim ya no era el nuestro al cerrar: lo cerró otro. */
  claimPerdido: number;
}

const minutos = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

export async function procesarColaPeajes(opciones: { limite?: number; leaseSegundos?: number; venceEn?: number } = {}): Promise<ResumenCola> {
  const limite = opciones.limite ?? 5;
  const lease = opciones.leaseSegundos ?? LEASE_SEGUNDOS;
  const admin = supabaseAdmin();
  const r: ResumenCola = { tomados: 0, procesados: 0, fallidos: 0, reintentar: 0, claimPerdido: 0 };

  const claim = await acotada(admin.rpc('peaje_archivo_reclamar', { p_limite: limite, p_lease_segundos: lease }), 'peajes.cola.reclamar');
  if (claim.error) throw new Error(`peajes.cola.reclamar: ${claim.error.message}`);
  const filas = (claim.data ?? []) as Array<{ id: string; tenant_id: string; nombre: string; proveedor: string | null; intentos: number; reclamo: string }>;
  r.tomados = filas.length;

  for (const a of filas) {
    // El reloj: lo que no alcanza se queda con su lease y el siguiente cron lo recupera.
    if (opciones.venceEn !== undefined && Date.now() > opciones.venceEn) break;
    const cerrar = async (cambios: Record<string, unknown>): Promise<boolean> => {
      const res = await acotada(admin.from('peaje_ingesta_archivo').update(cambios)
        .eq('id', a.id).eq('tenant_id', a.tenant_id).eq('reclamo', a.reclamo).eq('estado', 'procesando').select('id'), 'peajes.cola.cerrar');
      if (res.error) throw new Error(`peajes.cola.cerrar: ${res.error.message}`);
      const cerrado = (res.data ?? []).length > 0;
      if (!cerrado) {
        r.claimPerdido++;
        logger.warn('peajes.cola.claim_perdido', { archivo: a.id, tenant: a.tenant_id });
      }
      return cerrado;
    };

    const inicio = new Date();
    try {
      const cont = await acotada(admin.from('peaje_ingesta_archivo').select('contenido')
        .eq('id', a.id).eq('tenant_id', a.tenant_id).maybeSingle(), 'peajes.cola.contenido');
      if (cont.error) throw new Error(cont.error.message);
      const buffer = bufferDeBytea(cont.data?.contenido);
      if (!buffer) throw new Error('el archivo en cola no tiene contenido legible');

      const imp = await importarDesglose(a.tenant_id, { nombre: a.nombre, buffer, proveedor: a.proveedor ?? undefined, ingestaArchivoId: a.id });
      // La base no dejó guardar: es de infraestructura, NO del archivo. Va por el
      // camino del reintento con backoff, no a «fallida» por formato.
      if (!imp.ok && imp.causa === 'infraestructura') throw new Error(imp.motivo);
      if (!imp.ok) {
        // El formato no se entendió: reintentar no lo arregla. Queda fallida CON el
        // motivo (nombra los encabezados leídos) y conserva el contenido para
        // reprocesarlo desde el panel cuando se declare el mapeo.
        if (await cerrar({ estado: 'fallida', ultimo_error: imp.motivo.slice(0, 1000), reclamado_hasta: null })) {
          r.fallidos++;
          await registrarCorrida(a.tenant_id, 'peajes', {
            inicio, fin: new Date(), estado: 'fallo', disparo: 'cron',
            error: `No se pudo leer «${a.nombre}»: ${imp.motivo}`.slice(0, 500),
          });
        }
        continue;
      }
      await conciliarDesglose(a.tenant_id, imp.desgloseId, 'cron');
      if (await cerrar({
        estado: 'procesada', contenido: null, desglose_id: imp.desgloseId, procesada_en: new Date().toISOString(),
        ultimo_error: null, reclamo: null, reclamado_hasta: null,
      })) r.procesados++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('peajes.cola.fallo', { archivo: a.id, tenant: a.tenant_id, intentos: a.intentos, err: msg });
      const agotado = a.intentos >= MAX_INTENTOS;
      const cambios = agotado
        ? { estado: 'fallida', ultimo_error: `Se agotaron ${MAX_INTENTOS} intentos: ${msg}`.slice(0, 1000), reclamado_hasta: null }
        : {
          estado: 'pendiente', ultimo_error: msg.slice(0, 1000), reclamo: null, reclamado_hasta: null,
          proximo_intento_en: minutos(BACKOFF_MIN[Math.min(a.intentos - 1, BACKOFF_MIN.length - 1)] ?? 30),
        };
      try {
        if (await cerrar(cambios)) {
          if (agotado) r.fallidos++;
          else r.reintentar++;
        }
      } catch (e2) {
        // Ni siquiera se pudo anotar: el lease vence solo y el siguiente cron lo recupera.
        logger.error('peajes.cola.fallo_al_cerrar', { archivo: a.id, err: e2 instanceof Error ? e2.message : String(e2) });
        r.reintentar++;
      }
    }
  }
  return r;
}

/** Devuelve a la cola un archivo fallido (p. ej. tras declarar el mapeo de columnas). */
export async function reintentarArchivoPeaje(tenantId: string, archivoId: string): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('peaje_ingesta_archivo')
    .update({ estado: 'pendiente', intentos: 0, proximo_intento_en: new Date().toISOString(), ultimo_error: null, reclamo: null, reclamado_hasta: null })
    .eq('tenant_id', tenantId).eq('id', archivoId).eq('estado', 'fallida').not('contenido', 'is', null).select('id'), 'peajes.cola.reintentar');
  if (res.error) {
    logger.error('peajes.cola.reintentar', { tenant: tenantId, err: res.error.message });
    return false;
  }
  return (res.data ?? []).length > 0;
}
