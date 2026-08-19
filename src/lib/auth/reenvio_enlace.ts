// ═══════════════════════════════════════════════════════════════════════════
// REENVÍO AUTOMÁTICO DEL MAGIC LINK CADUCADO — decisión de Javier, 19-ago-2026.
//
// Cuando alguien abre un enlace que ya se usó (o que venció a los 60 min), la
// pantalla ya dice el motivo (motivo_login.ts). Pero decirlo no resuelve: la
// persona tiene que volver a teclear su correo y volver a esperar. Este módulo
// cierra ese lazo — el callback reenvía UN enlace nuevo al mismo correo, solo,
// y la pantalla anuncia que ya va en camino.
//
// ── CÓMO SABE A QUIÉN, si el enlace fallido no trae el correo ────────────
//
// No lo trae: ni el redirect de error de Supabase ni el code llevan la
// dirección. La única fuente honesta es el propio navegador: al pedir el
// enlace en /login se guarda el correo en una cookie httpOnly de UNA hora —
// la misma vida del enlace. Sin esa cookie (otro navegador, otra máquina, ya
// venció) NO se reenvía nada y la pantalla vuelve al consejo de siempre:
// pide uno nuevo con tu correo.
//
// ── LOS DOS FRENOS, y por qué los dos ────────────────────────────────────
//
//  1. **Uno cada 5 minutos** (cookie de espera con TTL de 300 s — el TTL ES
//     el candado: sin timestamps que comparar). Sin esto, cada visita a un
//     enlace muerto dispararía un correo: un enlace viejo en el historial se
//     vuelve una máquina de spam contra tu propia bandeja. La cookie se pone
//     aunque el envío falle: un intento por ventana, pase lo que pase.
//  2. **El MISMO límite por IP del formulario** (misma llave `login:email`,
//     mismo 10 / 5 min): este camino manda un correo real igual que el botón,
//     así que gasta del mismo presupuesto. Un límite aparte sería duplicar el
//     techo que la auditoría del 15-ago vino a cerrar.
//
// Y el mismo `shouldCreateUser: false` del formulario: este camino tampoco da
// de alta a nadie (decisión 1 del spec). Si el correo de la cookie no tiene
// cuenta, Supabase lo rechaza, aquí se degrada a "no se reenvió" y la pantalla
// no distingue el caso — el oráculo de enumeración sigue cerrado.
// ═══════════════════════════════════════════════════════════════════════════
import { cookies, headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

/** El correo al que se pidió el último enlace. httpOnly: lo lee el servidor
 *  para reenviar, nunca un script. Una hora: la vida del enlace mismo. */
const COOKIE_CORREO = 'likida_correo_enlace';
/** Presente = ya se reenvió hace menos de 5 minutos. El TTL es el candado. */
const COOKIE_ESPERA = 'likida_reenvio_espera';

const ESPERA_SEGUNDOS = 5 * 60;
const VIDA_CORREO_SEGUNDOS = 60 * 60;

const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const;

/** La llama `entrarConEmail` al pedir un enlace: deja dicho a quién reenviar
 *  si ese enlace muere. Se guarda ANTES de saber si el correo tiene cuenta —
 *  distinguirlo aquí reabriría el oráculo que /login cierra. */
export async function guardarCorreoParaReenvio(email: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_CORREO, encodeURIComponent(email), {
    ...OPCIONES_COOKIE,
    maxAge: VIDA_CORREO_SEGUNDOS,
  });
}

export type ResultadoReenvio =
  /** Salió un enlace nuevo: la pantalla lo anuncia (`enviado=1&reenviado=1`). */
  | 'reenviado'
  /** Ya salió uno hace <5 min: la pantalla manda al correo más reciente. */
  | 'reciente'
  /** No se pudo (sin cookie, sin cuota, envío rechazado): consejo de siempre. */
  | 'no';

/**
 * Reenvía un enlace nuevo al correo recordado, con los dos frenos de arriba.
 * `dest` es el `next` del enlace original: el nuevo aterriza donde iba el viejo.
 */
export async function reenviarEnlaceCaducado(dest: string): Promise<ResultadoReenvio> {
  const jar = await cookies();
  const crudo = jar.get(COOKIE_CORREO)?.value;
  const email = crudo ? decodeURIComponent(crudo) : '';
  if (!email) return 'no';
  if (jar.get(COOKIE_ESPERA)) return 'reciente';

  // El mismo límite por IP que el formulario de /login — misma llave a
  // propósito: los dos caminos gastan del mismo presupuesto de correo.
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')) ?? 'desconocida';
  if (!(await rateLimit(`login:email:${ip}`, 10, 5 * 60_000))) return 'no';

  // Un intento por ventana de 5 minutos, salga o no el correo: la cookie va
  // antes de conocer el resultado para que un fallo repetido no reintente en
  // cada visita al enlace muerto.
  jar.set(COOKIE_ESPERA, '1', { ...OPCIONES_COOKIE, maxAge: ESPERA_SEGUNDOS });

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai';
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(dest)}`,
      // Nadie se da de alta solo — la misma decisión 1 del spec que en /login.
      shouldCreateUser: false,
    },
  });
  if (error) {
    // Sin el correo en el log, como en login.otp_sin_cuenta: código y status
    // bastan para distinguir una cuota agotada de un correo sin cuenta.
    logger.warn('login.reenvio_no_salio', { code: error.code, status: error.status });
    return 'no';
  }
  logger.info('login.reenvio_por_caducado', {});
  return 'reenviado';
}
