import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { cifrar, descifrar, cofreConfigurado } from '../conectores/cofre';

// ═══════════════════════════════════════════════════════════════════════════
// LA SESIÓN YA INICIADA DE UN PORTAL — para que el CAPTCHA sea UNA vez, no cada
// factura.
//
// El problema que resuelve, y su único límite honesto:
//
//   Un portal como G500/Megasur pone reCAPTCHA en el LOGIN, no en cada ticket
//   (verificado contra el portal el 20-ago-2026: el captcha vive en
//   /Account/Login). reCAPTCHA existe para detectar al servidor que intenta
//   entrar solo, así que CREAR la sesión pasa obligatoriamente por un humano.
//   Pero una vez creada, DENTRO de esa sesión se factura sin captcha. Guardar
//   esa sesión ya iniciada convierte "un captcha por ticket" en "un toque
//   humano cuando la sesión caduca" — que es el modelo de Handle con portales
//   con login: la persona abre la puerta una vez, el agente hace lo repetitivo.
//
//   Lo que esto NO hace, y no se puede sin evasión: vencer el captcha solo. Al
//   caducar la sesión, `sesionFresca` devuelve false y el llamador le pide a un
//   humano que reabra (un toque en WhatsApp). No se reintenta contra el muro.
//
// ── DÓNDE VIVE ────────────────────────────────────────────────────────────
//
// En `conector_credencial` (el mismo cofre AES-256-GCM que las contraseñas),
// bajo un `conector_id` propio con sufijo `#sesion`. Va aparte de la credencial
// —usuario/contraseña— a propósito: una contraseña la teclea la persona y no
// caduca sola; una sesión la produce un login y caduca. Mezclarlas obligaría a
// reescribir la contraseña cada vez que se refresca la sesión, y a que un
// borrado de sesión (caducó) se lleve por delante la credencial (sigue buena).
//
// El `storageState` es el JSON que Playwright produce con `context.storageState()`
// —cookies y almacenamiento por origen—. Se guarda como TEXTO cifrado: para el
// cofre es un valor más, y un volcado de la base sigue siendo ruido.
//
// ── POR QUÉ LA FRESCURA POR EDAD NO ALCANZA, Y AUN ASÍ SE USA ─────────────
//
// La única prueba REAL de que una sesión sigue viva es intentar usarla y ver si
// el portal sigue adentro o te mandó al login. Eso lo hace el piloto. Pero
// abrir un navegador cuesta segundos y una llamada; la edad es un filtro GRATIS
// que descarta lo obviamente vencido antes de gastar. Se usa como PRE-cheque,
// no como veredicto: `sesionFresca` con edad joven dice "vale la pena
// intentar", nunca "está viva". El `maxEdadMs` sale de medir el portal, no de
// adivinarlo — hasta medir G500 se deja conservador.
// ═══════════════════════════════════════════════════════════════════════════

/** El sufijo que separa la fila de sesión de la fila de credencial de un portal. */
const SUFIJO_SESION = '#sesion';

/** Edad máxima por defecto ANTES de medir un portal: 30 min. Conservador a
 *  propósito — es el TTL típico de una sesión ASP.NET deslizante, que es lo que
 *  el pre-vuelo vio en Megasur. Cada portal medido sobreescribe esto con su
 *  número real. */
export const MAX_EDAD_SESION_MS_DEFECTO = 30 * 60 * 1000;

export interface SesionPortal {
  /** El `storageState` de Playwright, tal cual (JSON en string). */
  storageState: string;
  /** ISO 8601 de cuándo se capturó — el reloj de la frescura. */
  capturadaEn: string;
}

/** El `conector_id` de la fila de sesión de un portal. Determinista: una sesión
 *  por (flota, portal). */
export function idSesion(portalConectorId: string): string {
  return `${portalConectorId}${SUFIJO_SESION}`;
}

/**
 * Guarda (o reemplaza) la sesión ya iniciada de un portal para una flota.
 *
 * `capturadaEn` lo pone el llamador y NO este módulo: la hora de captura es la
 * del navegador que hizo el login, no la del guardado, y pueden diferir si la
 * subida se difiere. Además `Date.now()` no está disponible en algunos entornos
 * de este repo (rompe el resume de workflows), así que el reloj entra como dato.
 */
export async function guardarSesionPortal(
  tenantId: string,
  portalConectorId: string,
  sesion: SesionPortal,
): Promise<void> {
  if (!cofreConfigurado()) {
    // Misma regla que el cofre: sin llave no se guarda a medias ni en claro.
    // Una sesión es un token de acceso vivo; en claro es peor que una contraseña.
    throw new Error(
      'El cofre no está configurado (falta LIKIDA_COFRE_LLAVE). Sin él no se guarda la sesión del portal — guardarla sin cifrar no es una opción.',
    );
  }

  const { error } = await acotada(supabaseAdmin().from('conector_credencial').upsert({
    tenant_id: tenantId,
    conector_id: idSesion(portalConectorId),
    valores_cifrados: cifrar(sesion as unknown as Record<string, string>),
    // La sesión NO deja pistas: no hay nada no-secreto que enseñar de una cookie,
    // y sus últimos 4 caracteres no ayudan a nadie a reconocerla.
    pistas: {},
    activo: true,
    probada_en: null,
    ultimo_error: null,
  }, { onConflict: 'tenant_id,conector_id' }), 'guardarSesionPortal');

  if (error) throw new Error(`guardarSesionPortal: ${error.message}`);
  logger.info('sesion_portal.guardada', { tenant: tenantId, portal: portalConectorId });
}

/**
 * La sesión guardada de un portal, o `null` si no hay.
 *
 * LANZA si la base no contesta: "no hay sesión" y "no pude preguntar" son cosas
 * distintas —la primera manda a pedirle al humano que reabra, la segunda es un
 * bache— y confundirlas mandaría un WhatsApp de "reabre tu portal" por un
 * timeout de Supabase.
 */
export async function cargarSesionPortal(
  tenantId: string,
  portalConectorId: string,
): Promise<SesionPortal | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('conector_credencial')
    .select('valores_cifrados, activo')
    .eq('tenant_id', tenantId)
    .eq('conector_id', idSesion(portalConectorId))
    .maybeSingle(), 'cargarSesionPortal');

  if (error) throw new Error(`cargarSesionPortal: ${error.message}`);
  if (!data || data.activo === false) return null;

  return interpretar((data as { valores_cifrados?: unknown }).valores_cifrados, tenantId, portalConectorId);
}

/**
 * Una fila cifrada a `SesionPortal`, o `null`. NUNCA lanza y NUNCA imprime un
 * byte del cifrado.
 *
 * Una fila con forma rota (llave rotada, dato viejo) se trata como "no hay
 * sesión" en vez de tumbar la facturación: el peor caso es pedir un login que
 * ya existía, no perder el ticket.
 */
function interpretar(cifrado: unknown, tenantId: string, portal: string): SesionPortal | null {
  if (typeof cifrado !== 'string' || cifrado === '') return null;
  try {
    const v = descifrar(cifrado) as unknown as SesionPortal;
    if (!v || typeof v.storageState !== 'string' || typeof v.capturadaEn !== 'string') {
      logger.warn('sesion_portal.forma_rota', { tenant: tenantId, portal });
      return null;
    }
    return v;
  } catch (e) {
    logger.warn('sesion_portal.descifrado_fallo', {
      tenant: tenantId, portal,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * TODAS las sesiones vivas de los portales de una flota, por `conector_id` del
 * portal (sin el sufijo `#sesion`).
 *
 * UNA consulta y no una por portal: el cron necesita esto ANTES de arrancar
 * Chromium para poder pasarle el `storageState` al contexto, y trece consultas
 * en serie ahí dentro se comen el presupuesto de tiempo del lote.
 *
 * DEVUELVE `null` SI LA BASE NO CONTESTÓ, y la distinción importa igual que en
 * `cargarSesionPortal`: un mapa vacío significaría "ninguna sesión guardada" y
 * el llamador invalidaría vínculos que están perfectamente vivos.
 */
export async function sesionesDePortales(
  tenantId: string,
): Promise<Map<string, SesionPortal> | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('conector_credencial')
    .select('conector_id, valores_cifrados')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .like('conector_id', `%${SUFIJO_SESION}`), 'sesionesDePortales');

  if (error) {
    logger.warn('sesion_portal.lote_sin_leer', { tenant: tenantId, err: error.message });
    return null;
  }

  const mapa = new Map<string, SesionPortal>();
  for (const f of (data ?? []) as Array<{ conector_id: unknown; valores_cifrados: unknown }>) {
    const id = String(f.conector_id ?? '');
    if (!id.endsWith(SUFIJO_SESION)) continue;
    const portal = id.slice(0, -SUFIJO_SESION.length);
    const s = interpretar(f.valores_cifrados, tenantId, portal);
    if (s) mapa.set(portal, s);
  }
  return mapa;
}

/**
 * PRE-cheque gratis de frescura por edad. `true` = vale la pena intentar usarla;
 * NUNCA significa "está viva" — eso solo lo prueba usarla contra el portal.
 *
 * `ahoraMs` entra como dato (no `Date.now()` interno) por lo mismo que
 * `capturadaEn`: el reloj es del llamador, y así la función es pura y testeable.
 */
export function sesionFresca(
  sesion: SesionPortal,
  ahoraMs: number,
  maxEdadMs: number = MAX_EDAD_SESION_MS_DEFECTO,
): boolean {
  const capturada = Date.parse(sesion.capturadaEn);
  if (Number.isNaN(capturada)) return false; // fecha ilegible → trátala como vencida
  const edad = ahoraMs - capturada;
  // Una `capturadaEn` en el futuro (reloj desalineado) NO se toma como fresca:
  // es un dato en el que no se puede confiar, y confiar de más aquí gasta una
  // sesión de navegador contra una cookie que quizá ya no sirve.
  if (edad < 0) return false;
  return edad <= maxEdadMs;
}

/**
 * Marca la sesión como inservible (caducó, o el portal la rechazó). No borra la
 * fila —conserva la evidencia de cuándo fue el último login— sino que la apaga,
 * y `cargarSesionPortal` ya trata `activo=false` como "no hay".
 *
 * Best-effort: si esto falla, el peor caso es que el próximo intento vuelva a
 * descubrir que la sesión no sirve y la apague otra vez. No se tumba nada por
 * no poder anotar la baja.
 */
export async function invalidarSesionPortal(
  tenantId: string,
  portalConectorId: string,
): Promise<void> {
  try {
    const { error } = await acotada(supabaseAdmin()
      .from('conector_credencial')
      .update({ activo: false, ultimo_error: 'sesión caducada o rechazada por el portal' })
      .eq('tenant_id', tenantId)
      .eq('conector_id', idSesion(portalConectorId)), 'invalidarSesionPortal');
    if (error) throw new Error(error.message);
    logger.info('sesion_portal.invalidada', { tenant: tenantId, portal: portalConectorId });
  } catch (e) {
    logger.warn('sesion_portal.invalidar_fallo', {
      tenant: tenantId, portal: portalConectorId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
