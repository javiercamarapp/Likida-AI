import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, accessToken } from '@/lib/auth/passcode';

export const dynamic = 'force-dynamic';

export default async function Acceso({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const err = sp?.error;
  const next = sp?.next && sp.next.startsWith('/dashboard') ? sp.next : '/dashboard';

  async function entrar(formData: FormData) {
    'use server';
    const code = String(formData.get('code') ?? '').trim();
    const dest = String(formData.get('next') ?? '/dashboard');
    const expected = process.env.DASHBOARD_PASSCODE ?? '';
    if (expected && code === expected) {
      (await cookies()).set(ACCESS_COOKIE, accessToken(expected), {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 8,
      });
      redirect(dest.startsWith('/dashboard') ? dest : '/dashboard');
    }
    redirect(`/acceso?error=1&next=${encodeURIComponent(dest)}`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form action={entrar} className="card p-8 w-full max-w-sm">
        <div className="text-lg font-semibold tracking-tight">Likida · Panel</div>
        <p className="text-sm mt-1 mb-5" style={{ color: 'var(--muted)' }}>Ingresa el código de acceso.</p>
        <input type="hidden" name="next" value={next} />
        <input name="code" type="password" autoFocus placeholder="Código" aria-label="Código de acceso"
          className="w-full px-3 py-2.5 rounded-lg hairline text-sm" style={{ background: 'var(--surface)' }} />
        {err && <p className="text-xs mt-2" style={{ color: 'var(--color-bad)' }}>Código incorrecto.</p>}
        <button type="submit" className="mt-4 w-full px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Entrar</button>
      </form>
    </main>
  );
}
