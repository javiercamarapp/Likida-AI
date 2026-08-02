import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai';
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
    const dest = String(formData.get('next') ?? '/dashboard');
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
    const dest = String(formData.get('next') ?? '/dashboard');
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}` },
    });
    if (error) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
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
