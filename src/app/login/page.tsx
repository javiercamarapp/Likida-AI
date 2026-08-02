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

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="text-lg font-semibold tracking-tight">Likida · Panel</div>
        <p className="text-sm mt-1 mb-6" style={{ color: 'var(--muted)' }}>
          Entra con la cuenta que te dio tu flota.
        </p>

        {sp?.enviado ? (
          <p className="text-sm p-3 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
            Te mandamos un link a tu correo. Ábrelo desde este mismo dispositivo.
          </p>
        ) : (
          <>
            <form action={entrarConGoogle}>
              <input type="hidden" name="next" value={next} />
              <button type="submit"
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium hairline mb-3"
                style={{ color: 'var(--ink)' }}>
                Continuar con Google
              </button>
            </form>

            <div className="text-xs text-center mb-3" style={{ color: 'var(--muted)' }}>o</div>

            <form action={entrarConEmail}>
              <input type="hidden" name="next" value={next} />
              <input name="email" type="email" required placeholder="tu@flota.com"
                className="w-full px-3 py-2.5 rounded-lg hairline text-sm mb-3"
                style={{ background: 'var(--surface)' }} />
              <button type="submit"
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                Continuar con email
              </button>
            </form>
          </>
        )}

        {sp?.error && (
          <p className="text-xs mt-3" style={{ color: 'var(--color-bad)' }}>
            Algo falló. Intenta otra vez.
          </p>
        )}

        <p className="text-xs mt-6" style={{ color: 'var(--muted)' }}>
          ¿Tu correo no tiene acceso? Pídele a tu flota que te dé de alta en Likida.
        </p>
      </div>
    </main>
  );
}
