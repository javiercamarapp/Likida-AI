import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTEXTO DEL SUPERADMIN — a qué flota apunta, dicho EXPLÍCITAMENTE.
//
// El hallazgo #1 de la auditoría externa: un superadmin sin tenant que entraba
// a /dashboard caía a `tenantDemo()` EN SILENCIO — miraba cifras de una flota
// que nunca eligió, bajo un encabezado que no decía cuál era. El diseño
// pedido: "nunca debería existir un tenant implícito".
//
// El modelo de este módulo: el superadmin opera en DOS modos —
//   · GLOBAL: su casa es /admin. No hay tenant. Es el modo por default.
//   · TENANT: eligió una flota EXPLÍCITAMENTE en /admin/elegir-flota (la demo
//     incluida — sigue existiendo, pero ELEGIDA, jamás implícita).
//
// La selección viaja en una cookie httpOnly FIRMADA (HMAC-SHA256, patrón de
// `firma_entrante.ts`), nunca en el query string: un query param no es fuente
// de autorización — se comparte en un link, se guarda en un bookmark, y nadie
// audita cuándo cambió. El `?tenant=` del "ver como" (tenant-efectivo.ts)
// SIGUE existiendo para la previsualización ya auditada y firmada; lo que
// murió es el FALLBACK silencioso.
//
// POR QUÉ FIRMADA si solo la lee un superadmin: la firma garantiza que toda
// selección pasó por el endpoint que la deja en `bitacora_auditoria`. Una
// cookie editable a mano sería un camino a "mirar la flota X" sin rastro —
// exactamente lo que la auditoría de impersonación (0110) cerró para el
// query string.
// ═══════════════════════════════════════════════════════════════════════════

/** El nombre de la cookie. Prefijo propio para no chocar con las de Supabase. */
export const COOKIE_FLOTA_ACTIVA = 'likida_flota_activa';

/** Cuánto vive una selección: una jornada de trabajo. Al expirar, el
 *  superadmin vuelve a elegir — el costo es un clic; el beneficio es que
 *  "qué flota estoy mirando" nunca sea un residuo de la semana pasada. */
export const TTL_SELECCION_MS = 12 * 60 * 60 * 1000;

/**
 * La llave del HMAC: `LIKIDA_FLOTA_COOKIE_LLAVE`, y SOLO ella. Sin ella no se
 * firma ni se valida — fallar cerrado (ninguna selección se lee), jamás una
 * cookie sin firma; el arranque la grita como SILENCIOSA (arranque.ts).
 *
 * AUDITORÍA 18, B13: hasta hoy caía a `SUPABASE_SERVICE_ROLE_KEY` «para que la
 * firma nunca se quede sin llave». Eso era un mismo material de llave
 * sirviendo para dos propósitos (acceso total a la base y firma de una cookie
 * de sesión), y rotar la service role key —lo primero que se hace cuando se
 * filtra— tiraba todas las cookies vivas. La ausencia de la llave es ahora un
 * estado declarado, no uno que otro secreto tapa.
 */
function llaveFirma(): string | null {
  const llave = process.env.LIKIDA_FLOTA_COOKIE_LLAVE;
  return llave && llave.trim() ? llave : null;
}

function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Arma el valor firmado de la cookie: `v1.<tenantId>.<expiraMs>.<hmac>`.
 * `ahoraMs` se inyecta para probar los bordes sin depender del reloj
 * (mismo criterio que `verificarFirma` en firma_entrante.ts).
 * `null` si no hay llave con qué firmar — el llamador lo dice, no lo esconde.
 */
export function firmarSeleccion(tenantId: string, ahoraMs: number = Date.now()): string | null {
  const llave = llaveFirma();
  if (!llave || !tenantId) return null;
  const expira = ahoraMs + TTL_SELECCION_MS;
  const firma = createHmac('sha256', llave).update(`${tenantId}.${expira}`, 'utf8').digest('base64url');
  return `v1.${tenantId}.${expira}.${firma}`;
}

/**
 * Valida un valor de cookie y devuelve el tenantId, o `null` si la firma no
 * cuadra, expiró, o el formato no es el esperado. Todo camino dudoso es
 * `null`: una selección ilegible es una NO-selección (fallar cerrado), nunca
 * un tenant adivinado.
 */
export function validarSeleccion(valor: string | undefined, ahoraMs: number = Date.now()): string | null {
  if (!valor) return null;
  const llave = llaveFirma();
  if (!llave) return null;
  const partes = valor.split('.');
  if (partes.length !== 4 || partes[0] !== 'v1') return null;
  const [, tenantId, expiraCrudo, firma] = partes;
  const expira = Number(expiraCrudo);
  if (!tenantId || !Number.isFinite(expira)) return null;
  if (ahoraMs > expira) return null;
  const esperada = createHmac('sha256', llave).update(`${tenantId}.${expira}`, 'utf8').digest('base64url');
  return igualEnTiempoConstante(firma, esperada) ? tenantId : null;
}

/** Lee la selección de flota de la cookie de la petición actual (RSC/route
 *  handler). `null` = no hay selección válida — el superadmin está en modo
 *  global o su selección expiró. */
export async function leerSeleccionFlota(): Promise<string | null> {
  const jar = await cookies();
  return validarSeleccion(jar.get(COOKIE_FLOTA_ACTIVA)?.value);
}

/**
 * Escribe la selección (solo desde un server action / route handler — en un
 * Server Component `set()` truena por diseño de Next). Devuelve `false` si no
 * había llave con qué firmar, para que el llamador lo DIGA en pantalla en vez
 * de redirigir a un panel que va a rebotar de vuelta al selector.
 */
export async function guardarSeleccionFlota(tenantId: string): Promise<boolean> {
  const valor = firmarSeleccion(tenantId);
  if (!valor) return false;
  const jar = await cookies();
  jar.set(COOKIE_FLOTA_ACTIVA, valor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(TTL_SELECCION_MS / 1000),
  });
  return true;
}

/** Borra la selección — el superadmin vuelve al modo global (/admin). */
export async function limpiarSeleccionFlota(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_FLOTA_ACTIVA);
}

/**
 * La selección queda en `bitacora_auditoria` — el mismo criterio que
 * `firmarImpersonacion` (tenant-efectivo.ts): BEST-EFFORT a propósito. La
 * selección ya ocurrió y es legítima; dejar al superadmin fuera del panel
 * porque la bitácora no pudo escribir sería bloquear la operación por su
 * propia auditoría. El fallo se loguea para que no muera en silencio.
 *
 * Sin dedup por día (a diferencia de la impersonación): elegir flota es un
 * acto puntual y raro — cada selección ES el evento que se audita.
 */
export async function anotarSeleccionEnBitacora(
  actorId: string,
  tenantId: string,
  esDemo: boolean,
): Promise<void> {
  try {
    await anotarBitacora(
      { tenantId, actor: { id: actorId }, accion: 'flota.seleccionada', entidad: 'tenant', entidadId: tenantId,
        detalle: { desde: 'elegir-flota', demo: esDemo } },
      { evento: 'seleccion_flota.bitacora_no_escribio', contexto: { tenant: tenantId } },
    );
  } catch (e) {
    logger.warn('seleccion_flota.bitacora_no_escribio', {
      tenant: tenantId, err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * El `next` al que se vuelve después de elegir. Solo rutas internas del
 * panel: un valor abierto sería un open redirect servido desde una pantalla
 * autenticada. Cualquier cosa rara cae al default.
 */
export function destinoSeguro(next: unknown): string {
  if (typeof next !== 'string') return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  // Sin esquemas disfrazados (`/\evil.com`) ni saltos fuera del panel.
  if (next.includes('\\') || next.includes('..')) return '/dashboard';
  return next;
}
