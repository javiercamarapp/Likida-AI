import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { generarToken, direccionDe } from './buzon';

// ═══════════════════════════════════════════════════════════════════════════
// EL BUZÓN DE LA FLOTA — la mitad que ESCRIBE.
//
// `buzon.ts` es la mitad pura (armar la dirección, sacar el token) y el
// webhook de `api/correo/entrante` es quien LEE `tenant.buzon_token`. Hasta
// este archivo (hallazgo C1, auditoría 4) nadie lo ESCRIBÍA: la columna
// existía desde la 0095, el webhook resolvía flotas contra ella, y en
// producción había 0 flotas con buzón — el intake por correo entero era
// inalcanzable porque ninguna flota tenía dirección que dar.
//
// Vive aparte de `buzon.ts` por la misma razón que `llave-api-escritura.ts`
// vive aparte de `llave-api.ts`: aquel se importa desde el webhook y desde
// pruebas sin base; este arrastra `supabaseAdmin` y corre unas cuantas veces
// en la vida de una flota, desde la pantalla del Agente de Proveedores.
// ═══════════════════════════════════════════════════════════════════════════

export interface BuzonDeFlota {
  /** El token vivo de la flota, o `null` si nunca se ha generado. */
  token: string | null;
  /** La dirección completa que se le enseña a la flota, o `null` si no hay
   *  token O si `RESEND_EMAIL_DOMAIN` no está configurado — la pantalla
   *  distingue los dos casos con `token`. */
  direccion: string | null;
}

/**
 * CUÁNTOS TOKENS SE INTENTAN ANTE UN CHOQUE DEL UNIQUE GLOBAL.
 *
 * El índice `tenant_buzon_token_unico` (0095) es global a propósito: el token
 * decide a qué flota entra un gasto, y dos flotas con el mismo token serían
 * un cruce de tenants. Un choque real es prácticamente imposible —24 chars
 * del alfabeto son ~118 bits— así que UN reintento ya es de sobra. El tope
 * existe por el otro caso: si choca dos o tres veces seguidas, el azar no es
 * el problema (un RNG roto, un mock mal armado), y un bucle sin tope
 * convertiría ese bug en un ciclo infinito contra la base que lo taparía.
 */
const MAX_INTENTOS = 3;

/**
 * El buzón actual de la flota. LEE, no genera: generar es una decisión del
 * dueño (invalida lo anterior si ya había), no un efecto de abrir la pantalla.
 */
export async function getBuzon(tenantId: string): Promise<BuzonDeFlota> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('tenant').select('buzon_token').eq('id', tenantId).maybeSingle(), 'getBuzon');

  if (error) throw new Error(`getBuzon: ${error.message}`);
  // Un tenant que no existe NO es "sin buzón": devolverlo así invitaría a la
  // pantalla a ofrecer "Generar" sobre una flota fantasma.
  if (!data) throw new Error('getBuzon: la flota no existe');

  const token = data.buzon_token == null ? null : String(data.buzon_token);
  return { token, direccion: token ? direccionDe(token) : null };
}

/** Bitácora best-effort — patrón `anotar` de `clientes.ts`: si falla, el buzón
 *  YA se escribió y tirar la operación dejaría el sistema peor que sin el
 *  registro. El TOKEN NO VA en el detalle: es la única credencial que separa
 *  las facturas de una flota de las de otra, y la bitácora se lee del panel. */
async function anotar(
  tenantId: string,
  accion: string,
  actor?: { id?: string; email?: string },
): Promise<void> {
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: tenantId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    accion,
    entidad: 'tenant',
    entidad_id: tenantId,
    detalle: {},
  });
  if (error) logger.warn('buzon.bitacora_no_escribio', { accion, err: error.message });
}

async function escribirToken(
  tenantId: string,
  accion: 'buzon.generado' | 'buzon.rotado',
  actor?: { id?: string; email?: string },
): Promise<BuzonDeFlota> {
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const token = generarToken();

    // UPDATE anclado al id: el tenant viene por argumento desde la sesión del
    // servidor, nunca del formulario. Y con `.select('id')` porque un UPDATE
    // de 0 filas no es un error para Postgres — sin mirarlo, la pantalla diría
    // "listo" sobre una flota que no existe (patrón `revocarLlaveApi`).
    const { data, error } = await acotada(supabaseAdmin()
      .from('tenant')
      .update({ buzon_token: token })
      .eq('id', tenantId)
      .select('id'), 'escribirToken');

    if (error) {
      // 23505 = choque del unique global `tenant_buzon_token_unico`: otro
      // tenant ya tiene ese token. Se regenera y se reintenta; el tope lo
      // pone el `for` (ver MAX_INTENTOS). Cualquier otro error —incluido el
      // CHECK de forma— es un fallo de verdad y se lanza tal cual, SIN el
      // token en el mensaje.
      if (error.code === '23505') continue;
      throw new Error(`escribirToken(${accion}): ${error.message}`);
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`escribirToken(${accion}): la flota no existe`);
    }

    await anotar(tenantId, accion, actor);
    // El logger tampoco recibe el token — solo que la operación ocurrió.
    logger.info(accion.replace('.', '_'), { tenantId });
    return { token, direccion: direccionDe(token) };
  }
  // Solo se llega aquí si TODOS los intentos chocaron con 23505 (los demás
  // errores ya lanzaron adentro): con ~118 bits de azar, tres choques seguidos
  // no son mala suerte — algo está roto, y se dice.
  throw new Error(`escribirToken(${accion}): ${MAX_INTENTOS} tokens seguidos chocaron con el unique global — eso no es azar, revisa el generador`);
}

/**
 * Genera el buzón de la flota (o lo reemplaza si ya había — para ESA
 * intención usa `rotarBuzon`, que existe para que el llamador diga lo que
 * está haciendo y la bitácora lo distinga).
 */
export async function generarBuzon(
  tenantId: string,
  actor?: { id?: string; email?: string },
): Promise<BuzonDeFlota> {
  return escribirToken(tenantId, 'buzon.generado', actor);
}

/**
 * Rota el buzón: token nuevo, misma mecánica que generar.
 *
 * ROTAR INVALIDA LA DIRECCIÓN ANTERIOR EN EL ACTO. El webhook resuelve la
 * flota por `buzon_token`, así que todo correo que llegue al buzón viejo cae
 * en `buzon_desconocido` y se ignora — los proveedores que tenían la
 * dirección anterior dejan de entrar hasta que alguien les dé la nueva. Por
 * eso la pantalla ADVIERTE antes de ofrecer este botón, y por eso rotar es
 * una acción del dueño (`puedeAdministrar`), no de cualquiera que vea la
 * bandeja.
 */
export async function rotarBuzon(
  tenantId: string,
  actor?: { id?: string; email?: string },
): Promise<BuzonDeFlota> {
  return escribirToken(tenantId, 'buzon.rotado', actor);
}
