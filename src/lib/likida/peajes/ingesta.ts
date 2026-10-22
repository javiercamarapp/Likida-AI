import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { acotada } from '../presupuesto';
import { importarDesglose, conciliarDesglose } from '../intake/desglose_peaje';
import { registrarCorrida } from '../agentes/corridas';
import { avisarDesgloseConciliado } from './aviso_oficina';
import { revisarAtipicosDeDesglose } from './revision_atipicos';
import { vincularDesglose } from './vinculos_conciliacion';
import { avisarDiscrepanciasDesglose } from './aviso_discrepancia';

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
export function secretoMaestro(env?: Record<string, string | undefined>): string | null {
  const s = env ? env.PEAJES_INGESTA_SECRETO : process.env.PEAJES_INGESTA_SECRETO;
  return s && s.length >= 32 ? s : null;
}

/** La llave de UNA flota en UNA rotación. Distintas flotas o rotaciones → llaves sin relación. */
export function claveDeFlota(secreto: string, tenantId: string, rotacion: number): string {
  return createHmac('sha256', secreto).update(`peajes-ingesta:${tenantId.toLowerCase()}:${rotacion}`).digest('hex');
}

/** Lo que firma el cliente: `v1=<hex>` sobre `${timestamp}.${flota}.${cuerpo}`. */
export function firmarIngesta(clave: string, tenantId: string, timestampSeg: number | string, cuerpo: string): string {
  const h = createHmac('sha256', clave).update(`${timestampSeg}.${tenantId.toLowerCase()}.${cuerpo}`, 'utf8').digest('hex');
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
export type OrigenArchivoPeaje = 'api' | 'panel' | 'correo' | 'pull' | 'sftp';

interface FilaEncolar { id: string; estado: string; duplicado: boolean }

export async function recibirArchivoPeaje(tenantId: string, c: CuerpoIngesta, origen: OrigenArchivoPeaje = 'api'): Promise<ResultadoRecepcion> {
  const huella = huellaDe(c.contenido);
  const admin = supabaseAdmin();

  // El dedup por huella y el tope de pendientes por flota (MAX_PENDIENTES_POR_FLOTA) viven en UNA
  // sola función de base (`peaje_archivo_encolar`, 0850), con un candado de transacción por flota —
  // mismo molde que 0693 (`vigia_respuesta_rapida_aprobar`). Antes esto era un SELECT count y un
  // INSERT por separado SIN candado: dos envíos concurrentes podían leer el mismo count por debajo
  // del tope y los dos insertar, rebasándolo (TOCTOU real, auditoría adversarial 21-oct-2026,
  // reproducido por `_race_toctou.test.ts`). Con el candado, el segundo espera al primero y ya ve el
  // tope — así que el camino de «choca con el unique, se trata como duplicado» que antes cubría la
  // carrera a nivel aplicación deja de hacer falta: el candado la cierra antes de que el INSERT
  // pueda chocar.
  const r = await acotada(admin.rpc('peaje_archivo_encolar', {
    p_tenant: tenantId, p_huella: huella, p_nombre: c.nombre, p_proveedor: c.proveedor,
    p_origen: origen, p_bytes: c.contenido.length, p_contenido: byteaDeBuffer(c.contenido),
  }), 'peajes.ingesta.encolar');
  if (r.error) {
    if (r.error.code === '54000') {
      return { ok: false, codigo: 'cola_llena', motivo: `Hay ${MAX_PENDIENTES_POR_FLOTA} archivos pendientes de procesar; espera a que se vacíe la cola.` };
    }
    return { ok: false, codigo: 'error', motivo: r.error.message };
  }
  const filas = (r.data ?? []) as FilaEncolar[];
  const fila = filas[0];
  if (!fila) return { ok: false, codigo: 'error', motivo: 'peaje_archivo_encolar no devolvió fila' };
  return { ok: true, id: String(fila.id), duplicado: Boolean(fila.duplicado), estado: String(fila.estado) };
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
  /** Los cruces atípicos (T-A2-13) de los archivos procesados: solo conteos, nunca tags ni importes. `fallidos` vuelve «parcial» al latido. */
  atipicos?: { revisados: number; hallazgos: number; fallidos: number };
  /** El vínculo cruce→viaje (T-A2-21): solo existe si la flota lo activó. Conteos, nunca unidades ni importes. */
  vinculos?: { calculados: number; fallidos: number };
  /** El protocolo de discrepancia geográfica (T-A2-37): candidatos críticos de `unidad_inmovilizada` avisados. */
  discrepancia?: { evaluados: number; enviados: number; sinDestinatario: number; pendientes: number };
}

const minutos = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

export async function procesarColaPeajes(
  opciones: {
    limite?: number; leaseSegundos?: number; venceEn?: number;
    avisar?: (tenantId: string, desgloseId: string) => Promise<unknown>;
    avisarDiscrepancias?: typeof avisarDiscrepanciasDesglose;
  } = {},
): Promise<ResumenCola> {
  const avisar = opciones.avisar ?? avisarDesgloseConciliado;
  const avisarDiscrepancias = opciones.avisarDiscrepancias ?? avisarDiscrepanciasDesglose;
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
            error: `${`No se pudo leer «${a.nombre}»: ${imp.motivo}`.slice(0, 420)} Corrige el archivo y vuelve a subirlo.`,
          });
        }
        continue;
      }
      await conciliarDesglose(a.tenant_id, imp.desgloseId, 'cron');
      if (await cerrar({
        estado: 'procesada', contenido: null, desglose_id: imp.desgloseId, procesada_en: new Date().toISOString(),
        ultimo_error: null, reclamo: null, reclamado_hasta: null,
      })) {
        r.procesados++;
        // Los cruces atípicos (T-A2-13): solo si la flota los activó, sobre este desglose + las decenas previas del
        // mes. Va DESPUÉS de cerrar: su fallo nunca reabre ni tumba un archivo ya procesado (queda `parcial` en el latido).
        // `revisarAtipicosDeDesglose` no lanza: devuelve `fallo` y ya dejó el log `cron.peajes.atipicos_fallo`; aquí solo se cuenta.
        try {
          const rev = await revisarAtipicosDeDesglose(a.tenant_id, imp.desgloseId, 'cron');
          // Solo existe cuando el detector corrió (activado por la flota): apagado no ensucia el resumen.
          if (rev.estado === 'ok') { r.atipicos ??= { revisados: 0, hallazgos: 0, fallidos: 0 }; r.atipicos.revisados++; r.atipicos.hallazgos += rev.hallazgos; }
          else if (rev.estado === 'fallo') { r.atipicos ??= { revisados: 0, hallazgos: 0, fallidos: 0 }; r.atipicos.fallidos++; }
        } catch (e) {
          r.atipicos ??= { revisados: 0, hallazgos: 0, fallidos: 0 };
          r.atipicos.fallidos++;
          logger.error('cron.peajes.atipicos_fallo', { archivo: a.id, codigo: codigoDeError(e) });
        }
        // El vínculo cruce→viaje (T-A2-21): solo si la flota lo activó; recalculable y aparte de `desglose_peaje_linea.viaje_id`.
        // Va DESPUÉS de cerrar y no lanza (devuelve `fallo` y deja el log); aquí solo se cuenta.
        try {
          const vin = await vincularDesglose(a.tenant_id, imp.desgloseId);
          if (vin.estado === 'ok') { r.vinculos ??= { calculados: 0, fallidos: 0 }; r.vinculos.calculados++; }
          else if (vin.estado === 'fallo') { r.vinculos ??= { calculados: 0, fallidos: 0 }; r.vinculos.fallidos++; }
        } catch (e) {
          r.vinculos ??= { calculados: 0, fallidos: 0 };
          r.vinculos.fallidos++;
          logger.error('cron.peajes.vinculos_fallo', { archivo: a.id, codigo: codigoDeError(e) });
        }
        // El aviso a la oficina (0563) va DESPUÉS de cerrar: su fallo nunca reabre ni tumba un archivo ya
        // procesado (el barrido del cron lo reintenta). Nunca lanza, pero se blinda de todos modos.
        try { await avisar(a.tenant_id, imp.desgloseId); } catch (e) {
          logger.error('peajes.cola.aviso', { archivo: a.id, err: e instanceof Error ? e.message : String(e) });
        }
        // El protocolo de discrepancia geográfica (T-A2-37): candidatos críticos de `unidad_inmovilizada`
        // de ESTE desglose. Va DESPUÉS de cerrar, igual que `atipicos`/`vinculos`: un fallo aquí no reabre
        // ni tumba el archivo, y el candidato sigue visible en la pantalla de revisión aunque el aviso falle.
        try {
          const disc = await avisarDiscrepancias(a.tenant_id, imp.desgloseId);
          if (disc.evaluados > 0) {
            r.discrepancia ??= { evaluados: 0, enviados: 0, sinDestinatario: 0, pendientes: 0 };
            r.discrepancia.evaluados += disc.evaluados;
            r.discrepancia.enviados += disc.enviados;
            r.discrepancia.sinDestinatario += disc.sinDestinatario;
            r.discrepancia.pendientes += disc.pendientes;
          }
        } catch (e) {
          r.discrepancia ??= { evaluados: 0, enviados: 0, sinDestinatario: 0, pendientes: 0 };
          r.discrepancia.pendientes += 1;
          logger.error('cron.peajes.discrepancia_fallo', { archivo: a.id, codigo: codigoDeError(e) });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('peajes.cola.fallo', { archivo: a.id, tenant: a.tenant_id, intentos: a.intentos, codigo: codigoDeError(e) });
      const agotado = a.intentos >= MAX_INTENTOS;
      const cambios = agotado
        ? { estado: 'fallida', ultimo_error: `Se agotaron ${MAX_INTENTOS} intentos: ${msg}`.slice(0, 1000), reclamado_hasta: null }
        : {
          estado: 'pendiente', ultimo_error: msg.slice(0, 1000), reclamo: null, reclamado_hasta: null,
          proximo_intento_en: minutos(BACKOFF_MIN[Math.min(a.intentos - 1, BACKOFF_MIN.length - 1)] ?? 30),
        };
      try {
        if (await cerrar(cambios)) {
          if (agotado) {
            r.fallidos++;
            // Quien ve la bitácora no lee el error de la base: causa + qué hacer, sin el mensaje técnico.
            await registrarCorrida(a.tenant_id, 'peajes', {
              inicio, fin: new Date(), estado: 'fallo', disparo: 'cron',
              error: `No se pudo procesar «${a.nombre}» después de ${MAX_INTENTOS} intentos por un problema temporal del sistema. Vuelve a subirlo; si se repite, avisa a soporte.`.slice(0, 500),
            });
          } else r.reintentar++;
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
