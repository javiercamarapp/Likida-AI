import { rateLimit, clientIp } from '@/lib/ratelimit';
import { leerTextoAcotado } from '@/lib/http/cuerpo_acotado';
import { logger } from '@/lib/logger';
import {
  reclamarVinculacion, completarVinculacion, fallarVinculacion, MAX_ESTADO_BYTES, type DepsVinculacion,
} from './vinculacion_remota';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA HTTP DE LA MÁQUINA CON PANTALLA (0540).
//
// Estas rutas NO llevan sesión de Likida a propósito: quien las llama es un script en la
// máquina del contralor que no tiene cookie del panel. Su ÚNICA credencial es el código
// de un solo uso que el dueño generó en el panel (80 bits, caduca en 15 min, se consume al
// reclamarlo; en la base solo vive su hash). Defensas, en el orden en que se aplican:
//   1. límite de ritmo por IP — antes de leer nada;
//   2. cuerpo acotado en streaming (un storageState pesa < 50 KB);
//   3. el código decide TODO: el tenant y el portal salen de la solicitud, jamás del cuerpo
//      (un `tenant_id` o `comercio` en el cuerpo se ignora);
//   4. la respuesta de «código desconocido» y «código vencido» no distingue qué existió.
// ═══════════════════════════════════════════════════════════════════════════

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function leerJson(req: Request, max: number): Promise<Record<string, unknown> | null> {
  const r = await leerTextoAcotado(req, max);
  if (!r.ok) return null;
  try {
    const v = JSON.parse(r.texto) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

export async function manejarReclamo(req: Request, deps: DepsVinculacion): Promise<Response> {
  if (!(await rateLimit(`vinculacion-reclamar:${clientIp(req)}`, 20, 10 * 60_000))) return json({ ok: false, motivo: 'Demasiados intentos. Espera unos minutos.' }, 429);
  const cuerpo = await leerJson(req, 2_000);
  if (cuerpo === null || typeof cuerpo.codigo !== 'string') return json({ ok: false, motivo: 'Falta el código.' }, 400);
  try {
    const r = await reclamarVinculacion(cuerpo.codigo, deps);
    if (!r.ok) return json({ ok: false, motivo: r.motivo }, 400);
    // El script solo necesita QUÉ abrir: nunca el tenant ni el id interno.
    return json({ ok: true, comercio: r.comercio, nombre: r.nombre, portal: r.portal, expiraEn: r.expiraEn });
  } catch (e) {
    logger.error('vinculacion.reclamo_fallo', { err: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, motivo: 'El servidor no pudo procesar el código.' }, 503);
  }
}

export async function manejarCompletar(req: Request, deps: DepsVinculacion): Promise<Response> {
  if (!(await rateLimit(`vinculacion-completar:${clientIp(req)}`, 20, 10 * 60_000))) return json({ ok: false, motivo: 'Demasiados intentos. Espera unos minutos.' }, 429);
  const cuerpo = await leerJson(req, MAX_ESTADO_BYTES + 5_000);
  if (cuerpo === null || typeof cuerpo.codigo !== 'string') return json({ ok: false, motivo: 'Cuerpo inválido o demasiado grande.' }, 400);
  try {
    if (typeof cuerpo.fallo === 'string') {
      const r = await fallarVinculacion({ codigo: cuerpo.codigo, motivo: cuerpo.fallo }, deps);
      return json({ ok: r.ok }, r.ok ? 200 : 400);
    }
    if (typeof cuerpo.storageState !== 'string') return json({ ok: false, motivo: 'Falta la sesión.' }, 400);
    const r = await completarVinculacion({ codigo: cuerpo.codigo, storageState: cuerpo.storageState }, deps);
    return r.ok ? json({ ok: true, comercio: r.comercio, cookies: r.cookies }) : json({ ok: false, motivo: r.motivo }, 400);
  } catch (e) {
    logger.error('vinculacion.completar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, motivo: 'El servidor no pudo guardar la sesión.' }, 503);
  }
}
