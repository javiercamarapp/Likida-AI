import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// CLOUDFLARE TURNSTILE (S-03 / CT-SEG-27, parte de codigo). APAGADO por omision.
//
// QUE HAY QUE DECIDIR (y QUIEN): crear el widget en el panel de Cloudflare
// (Turnstile) y copiar dos llaves: la de SITIO (publica) y la SECRETA. Eso es de
// Javier; sin ellas esto no hace nada. Variables (todas documentadas en .env.example):
//
//   TURNSTILE_ACTIVO              '1' enciende la verificacion. Cualquier otra cosa = apagado.
//   TURNSTILE_SECRET_KEY          llave secreta del servidor (siteverify).
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY llave de sitio, la que carga el widget en /login.
//   TURNSTILE_FALLA_CERRADO       '1' (apagado por omision): ver abajo, "FALLO SEGURO".
//   TURNSTILE_SUPERFICIES         lista separada por comas de las superficies que BLOQUEAN.
//                                 Por omision solo 'login'. Las demas superficies, con
//                                 el interruptor encendido, corren en OBSERVACION: se
//                                 verifica y se registra, nunca se bloquea.
//
// SUPERFICIES:
//   · login         el formulario de correo de /login (el unico que manda un correo por
//                   cada envio). El widget vive en esta app. El reenvio automatico del enlace
//                   caducado hereda la proteccion: su cookie solo se emite DESPUES de pasar
//                   este control y va firmada (CT-SEG-14).
//   · lead          POST /api/lead. El formulario esta en la LANDING (otro dominio y otro
//                   proyecto estatico): hasta que la landing cargue el widget y mande
//                   `turnstile_token` en el JSON, agregarla a TURNSTILE_SUPERFICIES
//                   bloquearia a todos los prospectos. Por eso arranca en observacion.
//   · mcp_register  POST /api/mcp/oauth/registro (registro dinamico de clientes OAuth, RFC 7591).
//                   Lo llaman maquinas (Claude, ChatGPT) que NO pueden resolver un reto: se
//                   deja en observacion y NO se recomienda bloquearla; su defensa real es el
//                   limite de tasa.
//
// FALLO SEGURO (decision tomada y justificada, no por omision):
//   · apagado                          -> pasa.
//   · encendido y FALTA la llave       -> PASA y registra un error ruidoso. Bloquear
//     secreta o es invalida               seria dejar a TODOS fuera de la unica puerta de
//                                       entrada por un olvido de configuracion; el riesgo
//                                       de pasar es el de hoy (sin captcha), no uno nuevo.
//   · Cloudflare no contesta / 5xx     -> PASA (warn). Una caida ajena no cierra la
//     / timeout                         entrada; el limite de tasa sigue vigente.
//   · token ausente o rechazado        -> BLOQUEA en las superficies de la lista; en
//                                       observacion solo registra.
//
// El token NUNCA va al log. La IP del visitante tampoco se manda a Cloudflare (es opcional
// en siteverify y es un dato personal que no hace falta).
// ═══════════════════════════════════════════════════════════════════════════

export type SuperficieTurnstile = 'login' | 'lead' | 'mcp_register' | 'reenvio';
export type ModoTurnstile = 'apagado' | 'observar' | 'bloquear';
type Env = Record<string, string | undefined>;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 4_000;
const MAX_TOKEN = 2048;
/** Codigos de siteverify que son un problema NUESTRO de configuracion, no del visitante. */
const ERRORES_DE_CONFIG = new Set(['missing-input-secret', 'invalid-input-secret']);

/** Lecturas literales (el guardia de .env.example y el inlining de NEXT_PUBLIC_* las exigen asi). */
function envActual(): Env {
  return {
    TURNSTILE_ACTIVO: process.env.TURNSTILE_ACTIVO,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    TURNSTILE_SUPERFICIES: process.env.TURNSTILE_SUPERFICIES,
    TURNSTILE_FALLA_CERRADO: process.env.TURNSTILE_FALLA_CERRADO,
  };
}

/** F1B: '1', 'true', 'on', 'si' (sin importar mayusculas ni espacios) encienden; antes solo '1' exacto y el resto apagaba EN SILENCIO. */
function esVerdadero(v: string | undefined): boolean {
  return ['1', 'true', 'on', 'si', 'yes'].includes((v ?? '').trim().toLowerCase());
}

export function turnstileActivo(env: Env = envActual()): boolean {
  return esVerdadero(env.TURNSTILE_ACTIVO);
}

/**
 * TURNSTILE_FALLA_CERRADO (apagado por omision): con el, una superficie que BLOQUEA tambien niega cuando falta la llave
 * secreta, la llave es invalida o Cloudflare no contesta. Sin el, esos tres casos pasan (decision de arriba: no dejar a
 * todos fuera por un olvido de configuracion). Se enciende cuando el widget ya se verifico en produccion.
 */
function fallaCerrado(env: Env): boolean {
  return esVerdadero(env.TURNSTILE_FALLA_CERRADO);
}

/** La llave de sitio, solo si el interruptor esta encendido. */
export function turnstileSiteKey(env: Env = envActual()): string | null {
  const k = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return turnstileActivo(env) && k ? k : null;
}

export function modoDeSuperficie(superficie: SuperficieTurnstile, env: Env = envActual()): ModoTurnstile {
  if (!turnstileActivo(env)) return 'apagado';
  // F1B: '' (variable definida pero vacia) y las mayusculas ya no anulan el valor por omision ni la superficie.
  const lista = (env.TURNSTILE_SUPERFICIES?.trim() ? env.TURNSTILE_SUPERFICIES : 'login')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return lista.includes(superficie) ? 'bloquear' : 'observar';
}

export interface VeredictoTurnstile {
  /** true = la peticion puede continuar. */
  ok: boolean;
  modo: ModoTurnstile;
  motivo: 'apagado' | 'verificado' | 'sin_llave' | 'llave_invalida' | 'proveedor_caido' | 'sin_token' | 'rechazado';
}

export async function verificarTurnstile(
  p: { token: string | null | undefined; superficie: SuperficieTurnstile },
  deps: { env?: Env; fetch?: typeof fetch } = {},
): Promise<VeredictoTurnstile> {
  const env = deps.env ?? envActual();
  const f = deps.fetch ?? fetch;
  const modo = modoDeSuperficie(p.superficie, env);
  if (modo === 'apagado') return { ok: true, modo, motivo: 'apagado' };

  const secreto = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secreto) {
    logger.error('turnstile.sin_llave', { superficie: p.superficie, codigo: 'turnstile_sin_llave' });
    return { ok: !(modo === 'bloquear' && fallaCerrado(env)), modo, motivo: 'sin_llave' };
  }

  const token = typeof p.token === 'string' ? p.token.trim() : '';
  // Rechazar sin llamar a Cloudflare lo que ni siquiera tiene forma de token: ahorra la ida y vuelta.
  if (!token || token.length > MAX_TOKEN) {
    logger.warn('turnstile.sin_token', { superficie: p.superficie, modo });
    return { ok: modo === 'observar', modo, motivo: 'sin_token' };
  }

  type CuerpoSiteverify = { success?: boolean; 'error-codes'?: string[] };
  let cuerpo: CuerpoSiteverify | null = null;
  try {
    const r = await f(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secreto, response: token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (r.ok) cuerpo = (await r.json()) as CuerpoSiteverify;
  } catch {
    cuerpo = null;
  }
  if (!cuerpo || typeof cuerpo.success !== 'boolean') {
    logger.warn('turnstile.proveedor_caido', { superficie: p.superficie });
    return { ok: !(modo === 'bloquear' && fallaCerrado(env)), modo, motivo: 'proveedor_caido' };
  }
  if (cuerpo.success) return { ok: true, modo, motivo: 'verificado' };

  const codigos = Array.isArray(cuerpo['error-codes']) ? cuerpo['error-codes'].map(String).slice(0, 5) : [];
  if (codigos.some((c) => ERRORES_DE_CONFIG.has(c))) {
    logger.error('turnstile.llave_invalida', { superficie: p.superficie, codigos, codigo: 'turnstile_llave_invalida' });
    return { ok: !(modo === 'bloquear' && fallaCerrado(env)), modo, motivo: 'llave_invalida' };
  }
  logger.warn('turnstile.rechazado', { superficie: p.superficie, modo, codigos });
  return { ok: modo === 'observar', modo, motivo: 'rechazado' };
}
