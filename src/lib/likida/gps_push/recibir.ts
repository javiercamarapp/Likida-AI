import { z } from 'zod';
import { leerTextoAcotado } from '@/lib/http/cuerpo_acotado';
import { logger } from '@/lib/logger';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { isoConZona } from '../conectores/posiciones_comun';
import { asentarLecturas, type Lectura, type ResultadoSync } from '../conectores/sincronizar_gps';
import { firmaCoincide, firmarPush, leerTimestamp, TOLERANCIA_RELOJ_S } from './firma';
import { leerSecretosPush, registrarUsoPush, type SecretosPush } from './datos';

// ═══════════════════════════════════════════════════════════════════════════
// EL PUSH ENTRANTE DE POSICIONES — el GPS propio (p. ej. el del cliente de demo)
// manda POST firmado a /api/gps/push/<flota>. Misma ruta de escritura que el
// poll de proveedores (`asentarLecturas`): mismo aislamiento por flota, misma
// compuerta de privacidad, misma idempotencia.
//
// QUÉ GARANTIZA, EN ORDEN:
//   1. Límite de tasa ANTES de leer el cuerpo (por IP y por flota).
//   2. Cuerpo acotado (256 KiB, 500 lecturas): una ráfaga no llena memoria.
//   3. Firma HMAC válida (secreto de LA flota del path). Flota inexistente,
//      push apagado, firma mala o cabeceras ausentes responden IGUAL (401): la
//      respuesta no dice si la flota existe.
//   4. Reloj: el timestamp firmado debe estar a ±5 min del servidor. Se informa
//      SOLO tras validar la firma (no es un oráculo para quien no tiene el secreto).
//   5. Cada lectura se valida sola: una mala no tumba el lote; se cuenta y se dice.
//   6. Idempotente: reenviar el mismo lote (reintento tras un 503, o repetición
//      en la ventana) no duplica nada.
//   7. Una lectura fechada en el futuro (+1 h) o a más de 48 h de antigüedad se
//      descarta: reloj de dispositivo mal puesto, no una posición.
// ═══════════════════════════════════════════════════════════════════════════

export const PROVEEDOR_PUSH = 'gps_push';
export const MAX_BYTES_PUSH = 256 * 1024;
export const MAX_LECTURAS_PUSH = 500;
export const MAX_ANTIGUEDAD_PUSH_MS = 48 * 3_600_000;
export const TASA_IP_PUSH = 120;
export const TASA_FLOTA_PUSH = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const Sobre = z.object({ posiciones: z.array(z.unknown()).min(1).max(MAX_LECTURAS_PUSH) }).strict();
const Item = z.object({
  dispositivo: z.string().trim().min(1).max(200),
  lat: z.number().finite(), lng: z.number().finite(),
  fecha: z.string().max(40),
  velocidad_kmh: z.number().finite().nullable().optional(),
  rumbo: z.number().finite().nullable().optional(),
  ignicion: z.boolean().nullable().optional(),
}).strict();

export interface RespuestaPush { estado: number; cuerpo: Record<string, unknown> }
const r = (estado: number, cuerpo: Record<string, unknown>): RespuestaPush => ({ estado, cuerpo });
const NO_AUTORIZADO = r(401, { error: 'no_autorizado' });

export interface DepsPush {
  rate: (llave: string, limite: number, ventanaMs: number) => Promise<boolean>;
  secretos: (tenantId: string) => Promise<SecretosPush | null>;
  asentar: (tenantId: string, lecturas: Lectura[], ahora: () => number) => Promise<ResultadoSync>;
  uso: (tenantId: string, ok: boolean, motivo: string | null, guardadas: number) => Promise<void>;
  ahora: () => number;
}

export const depsReales: DepsPush = {
  rate: (k, l, v) => rateLimit(k, l, v),
  secretos: leerSecretosPush,
  asentar: (t, lecturas, ahora) => asentarLecturas(t, PROVEEDOR_PUSH, lecturas, {
    ahora, maxAntiguedadMs: MAX_ANTIGUEDAD_PUSH_MS, descartadasNoSonError: true,
  }),
  uso: registrarUsoPush,
  ahora: Date.now,
};

/** La salud nunca tumba la respuesta: un fallo al anotar el uso se loguea y ya. */
async function anotar(d: DepsPush, tenantId: string, ok: boolean, motivo: string | null, guardadas = 0) {
  try { await d.uso(tenantId, ok, motivo, guardadas); } catch (e) {
    logger.warn('gps_push.uso_no_anotado', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }
}

export async function procesarPush(req: Request, flota: string, d: DepsPush = depsReales): Promise<RespuestaPush> {
  // 1. Tasa por IP, antes de tocar el cuerpo.
  if (!(await d.rate(`gpspush:ip:${clientIp(req)}`, TASA_IP_PUSH, 60_000))) return r(429, { error: 'demasiadas_peticiones' });
  const esUuid = UUID.test(flota);
  if (esUuid && !(await d.rate(`gpspush:flota:${flota.toLowerCase()}`, TASA_FLOTA_PUSH, 60_000))) return r(429, { error: 'demasiadas_peticiones' });

  // 2. Cuerpo acotado.
  const leido = await leerTextoAcotado(req, MAX_BYTES_PUSH);
  if (!leido.ok) return leido.motivo === 'demasiado_grande' ? r(413, { error: 'cuerpo_demasiado_grande', max_bytes: MAX_BYTES_PUSH }) : r(400, { error: 'cuerpo_ilegible' });
  const tenantId = flota.toLowerCase();

  // 3. Autenticación — todo fallo es el mismo 401.
  const ts = leerTimestamp(req.headers.get('x-likida-timestamp'));
  const firma = req.headers.get('x-likida-signature');
  if (!esUuid || ts === null || !firma) return NO_AUTORIZADO;
  let secretos: SecretosPush | null;
  try { secretos = await d.secretos(tenantId); } catch (e) {
    logger.error('gps_push.secretos_ilegibles', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return r(503, { error: 'temporalmente_no_disponible' });
  }
  if (!secretos || !secretos.activo) return NO_AUTORIZADO;
  const ahoraMs = d.ahora();
  const candidatos = [secretos.actual];
  if (secretos.previo && secretos.previoVenceEn !== null && secretos.previoVenceEn > ahoraMs) candidatos.push(secretos.previo);
  const valida = candidatos.map((s) => firmaCoincide(firmarPush(s, ts, leido.texto), firma)).some(Boolean);
  if (!valida) {
    await anotar(d, tenantId, false, 'firma_invalida');
    return NO_AUTORIZADO;
  }

  // 4. Reloj (ya autenticado: informarlo no regala nada a un tercero).
  if (Math.abs(ahoraMs / 1000 - ts) > TOLERANCIA_RELOJ_S) {
    await anotar(d, tenantId, false, 'reloj_desfasado');
    return r(401, { error: 'reloj_desfasado', tolerancia_s: TOLERANCIA_RELOJ_S, servidor_utc: new Date(ahoraMs).toISOString() });
  }

  // 5. Forma.
  let crudo: unknown;
  try { crudo = JSON.parse(leido.texto); } catch { await anotar(d, tenantId, false, 'json_invalido'); return r(400, { error: 'json_invalido' }); }
  const sobre = Sobre.safeParse(crudo);
  if (!sobre.success) {
    await anotar(d, tenantId, false, 'sobre_invalido');
    return r(400, { error: 'cuerpo_invalido', detalle: sobre.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'raíz'}: ${i.message}`) });
  }
  const lecturas: Lectura[] = [];
  let malformadas = 0;
  for (const it of sobre.data.posiciones) {
    const p = Item.safeParse(it);
    const medidaEn = p.success ? isoConZona(p.data.fecha) : null;
    if (!p.success || !medidaEn) { malformadas += 1; continue; }
    lecturas.push({
      deviceId: p.data.dispositivo, lat: p.data.lat, lng: p.data.lng, medidaEn,
      velocidad: p.data.velocidad_kmh ?? null, rumbo: p.data.rumbo ?? null, ignicion: p.data.ignicion ?? null,
    });
  }

  // 6. Asentar por la ruta común.
  let res: ResultadoSync;
  try { res = await d.asentar(tenantId, lecturas, d.ahora); } catch (e) {
    logger.error('gps_push.asentar_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return r(503, { error: 'temporalmente_no_disponible' });
  }
  if (res.error) {
    // Falla de base: 503 para que el dispositivo conserve su buffer y reintente
    // (es seguro: reenviar es idempotente).
    await anotar(d, tenantId, false, 'fallo_interno');
    return r(503, { error: 'temporalmente_no_disponible' });
  }
  const recibidas = sobre.data.posiciones.length;
  const descartadas = malformadas + (res.descartadas ?? 0);
  const sinAviso = res.sinAvisoPrevio ?? 0;
  // Exacto: lo que pasó la validación, menos huérfanas, menos las que frenó la privacidad, menos las guardadas.
  const duplicadas = Math.max(0, res.leidas - res.huerfanas - (res.lecturasSinAviso ?? 0) - res.guardadas);
  await anotar(d, tenantId, true, null, res.guardadas);
  return r(200, {
    recibidas, guardadas: res.guardadas, duplicadas, descartadas,
    huerfanas: res.huerfanas, unidades_sin_aviso_de_privacidad: sinAviso,
  });
}
