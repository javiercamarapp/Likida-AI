import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai';
}

/**
 * Mismo límite por IP que el passcode que este login reemplaza (10 / 5 min,
 * `app/acceso/page.tsx`): quitarlo al cambiar de mecanismo habría sido una
 * regresión. Aquí pesa MÁS que allá — cada intento del camino de email manda
 * un correo real por el SMTP de Supabase, que tiene cuota diaria: quemarla
 * deja el panel sin la única vía de entrada que hoy funciona.
 */
async function dentroDelLimite(llave: string): Promise<boolean> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')) ?? 'desconocida';
  return rateLimit(`${llave}:${ip}`, 10, 5 * 60_000);
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

  // Estética clonada de usehandle.ai/login (branding.colors + CSS computado,
  // capturado 2-ago-2026): fondo blanco liso sin card ni sombra, botones
  // `rounded-full`, tipografía Inter apretada, acento monocromo (negro/blanco,
  // no el verde de marca) — el mecanismo de auth no cambió, solo el envoltorio.
  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[330px]">
        <div className="text-center text-[15px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Likida
        </div>
        <h1 className="mt-6 text-center text-[28px] font-bold leading-[1.05] tracking-[-0.03em]" style={{ color: 'var(--ink)' }}>
          Entra a tu panel
        </h1>
        <p className="mt-3 text-center text-[14px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          Con la cuenta que te dio tu flota.
        </p>

        {sp?.enviado ? (
          <p className="mt-8 text-[14px] p-4 rounded-lg text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Te mandamos un link a tu correo. Ábrelo desde este mismo dispositivo.
          </p>
        ) : (
          <>
            <form action={entrarConGoogle} className="mt-8">
              <input type="hidden" name="next" value={next} />
              <button type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-full px-5 py-3 text-[14px] font-medium transition-colors hover:bg-[var(--line)]"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}>
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
              <span className="text-[11px] font-medium uppercase tracking-[0.1em]"
                style={{ color: 'var(--muted)', fontFamily: 'ui-monospace, "JetBrains Mono", monospace' }}>
                o
              </span>
              <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
            </div>

            <form action={entrarConEmail} className="flex flex-col gap-4">
              <input type="hidden" name="next" value={next} />
              <input name="email" type="email" required placeholder="tu@flota.com"
                className="rounded-lg px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--ink)]"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }} />
              <button type="submit"
                className="mt-1 inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-[14px] font-medium text-white transition-colors hover:opacity-85"
                style={{ background: 'var(--ink)' }}>
                Continuar con email
              </button>
            </form>
          </>
        )}

        {sp?.error && (
          <p className="text-[13px] mt-4 text-center" style={{ color: 'var(--color-bad)' }}>
            Algo falló. Intenta otra vez.
          </p>
        )}

        <p className="mt-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
          ¿Tu correo no tiene acceso? Pídele a tu flota que te dé de alta en Likida.
        </p>
      </div>
    </main>
  );
}
