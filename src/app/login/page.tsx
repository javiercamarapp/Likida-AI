import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { Logo } from '../logo';

export const dynamic = 'force-dynamic';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai';
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
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')) ?? 'desconocida';
  return await rateLimit(`${llave}:${ip}`, 10, 5 * 60_000);
}

/**
 * Correo que NO tiene cuenta, con `shouldCreateUser:false`.
 *
 * Supabase lo marca con el código `otp_disabled` (422, «Signups not allowed for
 * otp»); `signup_disabled` es el mismo caso con los registros apagados a nivel
 * proyecto. Se mira también el mensaje porque el `code` solo existe en las
 * versiones nuevas del SDK, y fallar a "error" aquí reabriría el oráculo de
 * enumeración que este manejo existe para cerrar.
 */
function esCorreoSinCuenta(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'otp_disabled' ||
    error.code === 'signup_disabled' ||
    /signups not allowed/i.test(error.message ?? '')
  );
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; enviado?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp?.next && sp.next.startsWith('/dashboard') ? sp.next : '/dashboard';

  async function entrarConGoogle(formData: FormData) {
    'use server';
    const rawNext = String(formData.get('next') ?? '/dashboard');
    const dest = rawNext.startsWith('/dashboard') ? rawNext : '/dashboard';
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
    const dest = rawNext.startsWith('/dashboard') ? rawNext : '/dashboard';
    // Al exceder el límite se responde el error GENÉRICO, no "vas muy rápido":
    // la diferencia le diría a quien prueba correos cuándo dejó de contar.
    if (!(await dentroDelLimite('login:email'))) {
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}`,
        // Nadie se da de alta solo (decisión 1 del spec): las cuentas las crea
        // `provisionarUsuario`. Sin esto, Supabase por default crea el
        // `auth.users` de CUALQUIER correo que alguien teclee aquí.
        shouldCreateUser: false,
      },
    });
    // Un correo sin cuenta se responde EXACTAMENTE igual que uno con cuenta: si
    // "no existe" se viera distinto de "te mandamos el link", esta pantalla
    // sería un oráculo para enumerar qué correos son contralores reales. Solo un
    // fallo de otra naturaleza (cuota de correo, correo malformado, config rota)
    // sale como error.
    if (error) {
      if (!esCorreoSinCuenta(error)) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
      // El usuario ve "enviado"; el motivo real solo queda aquí. Sin correo en el
      // log: el código y el status bastan para distinguirlo de una cuota agotada.
      logger.warn('login.otp_sin_cuenta', { code: error.code, status: error.status });
    }
    redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1`);
  }

  // ── EL LOGIN HABLA EL IDIOMA DEL PRODUCTO ─────────────────────────────────
  //
  // La estructura es de dos columnas con imagen
  // a la derecha, un layout que funciona bien y no hay por qué cambiar. Lo que se
  // fue el 14-ago-2026 fueron unos COLORES Y TIPOGRAFÍA que estaban
  // literales aquí (#0a0a0a, #e5e5e5, #6b6b6b) y no eran los de Likida.
  //
  // El problema de esa decisión: el login es la PRIMERA pantalla del producto
  // y era la única que no se parecía al producto. Un contralor entraba a una
  // pantalla con botón naranja y tipografía de sistema, y caía en una consola
  // negra con Inter Tight. La promesa visual se rompía en el primer clic.
  //
  // Ahora usa los tokens de la app bajo `.tema-neutro` —la misma clase que
  // ponen `admin/layout.tsx` y `dashboard/chrome.tsx`—, así que el negro de
  // aquí es EL MISMO negro de allá y cambia en un solo lugar. Los radios pasan
  // de pastilla (`rounded-full`) a `rounded-lg`, que es el de los botones del
  // panel, y los titulares a `font-display` (Inter Tight).
  //
  // NADA de la lógica de arriba se tocó: el límite por IP, la respuesta
  // idéntica para un correo sin cuenta (el oráculo de enumeración) y
  // `shouldCreateUser:false` siguen exactamente igual.
  //
  // La imagen de la derecha es propia, generada con Higgsfield (`nano_banana_2`)
  // — fotorrealista, no artwork ilustrado: Javier lo pidió explícito el
  // 8-ago-2026, "camión real no pixeles", para que se sienta de la misma
  // familia fotográfica que el banner de `/dashboard`.
  return (
    <main className="tema-neutro min-h-screen flex" style={{ background: 'var(--surface)' }}>
      <div className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center px-6 py-6 md:px-10 lg:px-12 lg:py-12">
          <Logo alto="h-6" />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16 md:px-10">
          <div className="w-full max-w-[340px]">
            <h1 className="font-display text-center text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]"
              style={{ color: 'var(--ink)' }}>
              Bienvenido a Likida
            </h1>
            <p className="mt-3 text-center text-[14px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              El panel de liquidación de tu flota.
            </p>

            {sp?.enviado ? (
              <div className="mt-8 rounded-xl p-4 text-center hairline" style={{ background: 'var(--g1)' }}>
                <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>
                  Te mandamos un enlace a tu correo.
                </p>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--muted)' }}>
                  Ábrelo desde este mismo dispositivo.
                </p>
              </div>
            ) : (
              <>
                <form action={entrarConGoogle} className="mt-8">
                  <input type="hidden" name="next" value={next} />
                  <button type="submit"
                    className="hairline flex w-full items-center justify-center gap-2.5 rounded-lg px-5 py-3 text-[14px] font-medium transition-colors hover:bg-[var(--canvas)]"
                    style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                    </svg>
                    Continuar con Google
                  </button>
                </form>

                <div className="my-6 flex items-center gap-4">
                  <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
                  {/* NI mono NI versalitas para esta palabra, aunque el resto
                      de los micro-rótulos de la app sí lo sean: en IBM Plex
                      Mono la «O» mayúscula es casi idéntica al cero, y en el
                      primer render este separador se leía «0». Un caracter
                      suelto no tiene contexto que lo desambigüe. */}
                  <span className="text-[13px] lowercase" style={{ color: 'var(--faint)', fontFamily: 'var(--font-sans-handle), var(--font-sans)' }}>o</span>
                  <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
                </div>

                <form action={entrarConEmail} className="flex flex-col gap-3.5">
                  <input type="hidden" name="next" value={next} />
                  <label htmlFor="login-email" className="sr-only">Tu correo</label>
                  <input id="login-email" name="email" type="email" required placeholder="tu@flota.com"
                    autoComplete="email"
                    className="hairline rounded-lg px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--marca)]"
                    style={{ background: 'var(--surface)', color: 'var(--ink)' }} />
                  <button type="submit"
                    className="mt-1 inline-flex w-full items-center justify-center rounded-lg px-5 py-3 text-[14px] font-medium transition-opacity hover:opacity-85"
                    style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                    Continuar con correo
                  </button>
                </form>

                <p className="mt-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
                  ¿Tu correo no tiene acceso?{' '}
                  <span className="font-medium" style={{ color: 'var(--ink)' }}>
                    Pídele a tu flota que te dé de alta.
                  </span>
                </p>
              </>
            )}

            {sp?.error && (
              <p className="mt-4 text-center text-[13px]" style={{ color: 'var(--color-bad)' }}>
                Algo falló. Intenta otra vez.
              </p>
            )}

            {/* Los DOS, no solo privacidad: aquí es donde se acepta el contrato,
                y hasta hoy la única liga era la del aviso — se aceptaban unos
                términos que no había forma de leer desde esta pantalla. */}
            <p className="mt-8 text-center text-[11px] leading-relaxed" style={{ color: 'var(--faint)' }}>
              Al continuar, aceptas los{' '}
              <a href="/terminos" className="underline underline-offset-2 transition-opacity hover:opacity-70"
                style={{ color: 'var(--ink)' }}>
                Términos de Servicio
              </a>{' '}
              y el{' '}
              <a href="/privacidad" className="underline underline-offset-2 transition-opacity hover:opacity-70"
                style={{ color: 'var(--ink)' }}>
                Aviso de Privacidad
              </a>{' '}
              de Likida.
            </p>
          </div>
        </div>
      </div>

      {/* Panel derecho — solo desktop, igual que el original (`hidden lg:flex`). */}
      <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:pb-12 lg:pl-3 lg:pr-12 lg:pt-12">
        <div className="relative mt-8 min-h-0 flex-1 overflow-hidden rounded-[28px]" style={{ background: 'var(--marca)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen estática de fondo, no contenido de producto */}
          <img src="/images/login-hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/25" />
        </div>
      </div>
    </main>
  );
}
