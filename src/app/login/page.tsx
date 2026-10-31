import { appUrl } from '@/lib/env';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { guardarCorreoParaReenvio } from '@/lib/auth/reenvio_enlace';
import { respuestaOtp, conPisoDeTiempo } from './respuesta_otp';
import { VistaLogin } from './vista-login';
import './login.css';

export const dynamic = 'force-dynamic';

// ── LAS DOS VOCES QUE EL SOFTWARE NO TENÍA ────────────────────────────────
//
// `layout.tsx` carga Inter, Inter Tight e IBM Plex Mono para TODA la app. Son
// las voces de un panel de trabajo y están bien ahí. La landing de likida.ai
// habla otras dos —Fraunces para los titulares, Instrument Sans para el
// cuerpo— y el login es la bisagra entre las dos pantallas: se ve después de
// la landing y antes del panel.
//
// SE CARGAN AQUÍ Y NO EN `layout.tsx` a propósito. `next/font` emite el
// `<link rel=preload>` y el `@font-face` SOLO en las rutas que importan el
// módulo, así que estas dos familias viajan únicamente en `/login`: ni el
// dashboard ni el admin ni el PDF pagan dos tipografías que no pintan.
// Ponerlas en el layout raíz habría metido ~90 KB de fuentes en cada pantalla
// del panel.
//
// Y se aplican POR VARIABLE CSS (`--font-fraunces`, `--font-instrument`), no
// cambiando `--font-sans`: la clase que las declara vive en el `<main>` de
// esta página, así que ninguna regla global de `globals.css` se mueve. Quien
// quiera ver de dónde salen los valores, `login.css` los mapea a
// `--serif-marca`/`--sans-marca` y ahí se acaba su alcance.
//
// `<link>` suelto NO: sin `next/font` la fuente se pide después de que el CSS
// se descargó y se parseó (una cascada más), no hay `size-adjust` calculado
// contra el fallback —así que al cambiar Georgia por Fraunces el titular
// SALTA— y en producción el archivo sale de fonts.gstatic.com en vez del
// propio dominio.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
});
const instrument = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});

/**
 * Sobre esto se arman el `emailRedirectTo` del magic link y el `redirectTo` de
 * Google: es el dominio donde tiene que aterrizar `/auth/callback`.
 *
 * EL SUELO DEJÓ DE SER `likida.ai` el 17-ago-2026. Ese dominio ya no sirve esta
 * app — hoy es la landing de marketing, un proyecto de HTML estático aparte —,
 * así que sin `NEXT_PUBLIC_APP_URL` el correo llegaba, el link abría, y el
 * usuario caía en un sitio que NO TIENE `/auth/callback`: sesión nunca
 * completada, cero errores en ningún log, nadie entra. El suelo tiene que ser
 * el dominio del SOFTWARE (ver CLAUDE.md: la variable debe valer esto mismo).
 */
function siteUrl(): string {
  return appUrl();
}

async function ipDelCliente(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')) ?? 'desconocida';
}

/**
 * Mismo límite por IP que traía el passcode compartido que este login
 * reemplazó (10 / 5 min; la ruta `/acceso` y `auth/passcode.ts` se borraron
 * el 5-ago-2026, ver auditoría 10 seguridad — llevaban desde que este login
 * los reemplazó sin ningún llamador real): quitar el límite al cambiar de
 * mecanismo habría sido una regresión. Aquí pesa MÁS que allá — cada intento
 * del camino de email manda un correo real por el SMTP de Supabase, que
 * tiene cuota diaria: quemarla deja el panel sin la única vía de entrada que
 * hoy funciona.
 */
async function dentroDelLimite(llave: string): Promise<boolean> {
  const ip = await ipDelCliente();
  // AUDITORÍA 25, SEGURIDAD (ALTO, línea 181, REINCIDENTE). `rateLimit` falla
  // CERRADO por default ante un blip de Redis (SEG-4, auditoría 24) — la
  // decisión correcta para casi todo, pero /login es la ÚNICA vía de entrada
  // al panel: un blip de Upstash, sin esta válvula, negaba TODOS los
  // intentos —Google y correo, de cualquier IP— hasta que Redis volviera, no
  // solo los de quien de verdad se pasó del límite. `fallaCerrado: false`
  // degrada al Map local (por instancia, más débil pero NO cero) en vez de
  // negar de golpe: el mismo trade-off que ya elegía `RATELIMIT_REDIS_FALLA_
  // CERRADO=false` a nivel de despliegue, aquí anclado al único endpoint
  // donde un falso "no" cierra la entrada entera, no solo un intento.
  return await rateLimit(`${llave}:${ip}`, 10, 5 * 60_000, { fallaCerrado: false });
}

/**
 * FASE 1 · SEG-LIMITE-CUENTA (checklist 31 v2 #13): el límite de arriba es
 * POR IP — alguien con IPs rotadas puede seguir pidiendo magic links a la
 * MISMA cuenta sin tocar ese techo nunca, quemando la cuota de SMTP y
 * martillando el inbox de un tercero. Supabase Auth YA espacia una petición
 * a la vez al MISMO correo (`[auth.email].max_frequency`) — esto es
 * COMPLEMENTARIO, no un reemplazo: una ventana con techo de intentos que
 * EXPIRA, no un espaciador de una sola petición.
 *
 * La VENTANA ES CORTA a propósito (5 min, el mismo número que el límite por
 * IP): un techo largo volvería esto un candado que cualquiera pone sobre la
 * cuenta de OTRO con solo teclear su correo repetidas veces. El peor caso
 * tiene que ser "espera 5 minutos", nunca "bloqueado hasta que alguien de
 * Likida lo revise" — por eso tampoco hay ban ni fila en una tabla: es el
 * mismo contador de `ratelimit.ts` que ya expira solo.
 */
async function dentroDelLimitePorCuenta(email: string): Promise<boolean> {
  // A37-S21-04: el contador por cuenta ya NO es uno solo y global. Con uno solo,
  // un atacante desde UNA IP llenaba el cupo del correo del dueño de una flota
  // (10 solicitudes) y lo dejaba sin su enlace mágico, sin saber por qué, cada
  // 5 min. Ahora:
  //  · por cuenta Y por IP: lo que una IP gasta con un correo ajeno solo cierra
  //    ESA IP para ese correo (y el límite por IP de arriba ya la frena);
  //  · por cuenta global, con techo más alto que el de una IP (30 > 10): una IP
  //    sola no puede llenarlo; solo lo hace tráfico de varias IPs, que es el
  //    abuso para el que existe (martillar el inbox de un tercero).
  const ip = await ipDelCliente();
  const porIp = await rateLimit(`login:cuenta-ip:${email}:${ip}`, 10, 5 * 60_000, { fallaCerrado: false });
  const global = await rateLimit(`login:cuenta:${email}`, 30, 5 * 60_000, { fallaCerrado: false });
  return porIp && global;
}

/**
 * La allowlist de PREFIJOS DE RUTA PROPIOS a la que este login honra `next`
 * — mismo criterio, y las mismas dos rutas, que `destinoExplicito` en
 * `auth/callback/route.ts`. Antes de esto SOLO admitía `/dashboard`: quien
 * llegaba a `/mcp/autorizar` sin sesión (el consentimiento OAuth del
 * servidor MCP) rebotaba aquí con `next=/mcp/autorizar?...`, este gate lo
 * recortaba a `/dashboard`, y `/auth/callback` — que SÍ sabe volver a
 * `/mcp/autorizar` — nunca llegaba a intentarlo: el `next` que le tocaba ya
 * había muerto tres pasos antes. Claude/ChatGPT se quedaban esperando el
 * `code` que jamás llegaba (auditoría E.28, F-1).
 */
function destinoPermitido(n: string): boolean {
  return n.startsWith('/dashboard') || n.startsWith('/mcp/autorizar');
}

// El anti-oráculo de la auditoría 10 vivía aquí y enumeraba el caso "la cuenta
// no existe"; AUDITORÍA 18 (M24) invirtió la regla en `respuesta_otp.ts`: solo
// un conjunto cerrado de fallos que NO dependen de la cuenta sale como error.

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; enviado?: string; reenviado?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp?.next && destinoPermitido(sp.next) ? sp.next : '/dashboard';

  async function entrarConGoogle(formData: FormData) {
    'use server';
    const rawNext = String(formData.get('next') ?? '/dashboard');
    const dest = destinoPermitido(rawNext) ? rawNext : '/dashboard';
    if (!(await dentroDelLimite('login:google'))) {
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}` },
    });
    if (error || !data.url) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    redirect(data.url);
  }

  async function entrarConEmail(formData: FormData) {
    'use server';
    const rawNext = String(formData.get('next') ?? '/dashboard');
    const dest = destinoPermitido(rawNext) ? rawNext : '/dashboard';
    // AUDITORÍA 31 v2 · SEG-LOGIN-MAYUSCULAS: `.toLowerCase()` además de
    // `.trim()`, igual que `invitar.ts:81` al crear la cuenta — sin esto,
    // ENTRAR y DAR DE ALTA normalizaban el correo de forma distinta. Se lee
    // ANTES de los límites porque el de abajo (SEG-LIMITE-CUENTA) necesita
    // la versión normalizada: MAYUSCULA@x y minuscula@x tienen que gastar
    // EL MISMO contador, no dos separados que duplicarían el techo real.
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    // Al exceder cualquiera de los dos límites se responde el error
    // GENÉRICO, no "vas muy rápido": la diferencia le diría a quien prueba
    // correos cuándo dejó de contar. SEG-LIMITE-CUENTA (checklist 31 v2
    // #13): por IP (de siempre) Y por CUENTA (ventana corta, ver
    // `dentroDelLimitePorCuenta`) — rotar de IP no sirve si la cuenta es la
    // misma.
    if (!(await dentroDelLimite('login:email')) || !(await dentroDelLimitePorCuenta(email))) {
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    // Deja dicho a quién reenviar si este enlace muere (reenvio_enlace.ts).
    // ANTES de saber si el correo tiene cuenta, a propósito: guardarlo solo
    // para los que existen reabriría el oráculo de enumeración por cookie.
    await guardarCorreoParaReenvio(email);
    const sb = await supabaseServer();
    // AUDITORÍA 18 (M24): la respuesta tiene que ser idéntica en TEXTO y en
    // TIEMPO para un correo con cuenta y uno sin ella. Mandar el correo tarda
    // más que rechazar una cuenta inexistente; el piso iguala la duración mínima.
    const { error } = await conPisoDeTiempo(() => sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}`,
        // Nadie se da de alta solo (decisión 1 del spec): las cuentas las crea
        // `provisionarUsuario`. Sin esto, Supabase por default crea el
        // `auth.users` de CUALQUIER correo que alguien teclee aquí.
        shouldCreateUser: false,
      },
    }));
    // Un correo sin cuenta, uno con cuota de envío agotada (`over_email_send_
    // rate_limit`, que SOLO ocurre si la cuenta existe) y un SMTP caído se
    // responden EXACTAMENTE igual que "te mandamos el link": si cualquiera se
    // viera distinto, esta pantalla sería un oráculo para enumerar qué correos
    // son contralores reales. Solo el correo malformado —que GoTrue rechaza
    // antes de buscar la cuenta— sale como error (`respuesta_otp.ts`).
    if (respuestaOtp(error) === 'error') redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    if (error) {
      // El usuario ve "enviado"; el motivo real solo queda aquí. Sin correo en el
      // log: el código y el status bastan para distinguir cuenta inexistente
      // de cuota agotada o infraestructura.
      logger.warn('login.otp_no_enviado', { code: error.code, status: error.status });
    }
    redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1`);
  }

  // TEMA: esta pantalla es SIEMPRE clara (como la de Vexa: `color-scheme: light` en `login.css`); el script de
  // `layout.tsx` solo aplica el tema guardado bajo /dashboard. La presentación vive en `vista-login.tsx`; aquí
  // solo queda la lógica de arriba, que no se tocó.
  // Se llama como función (es solo marcado, sin hooks) para que las pruebas recorran el árbol de formularios.
  return VistaLogin(
    {
      next,
      enviado: !!sp?.enviado,
      reenviado: !!sp?.reenviado,
      error: sp?.error,
      entrarConGoogle,
      entrarConEmail,
      claseFuentes: `${fraunces.variable} ${instrument.variable}`,
    },
  );
}
