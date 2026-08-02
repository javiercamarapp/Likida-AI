import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function Cuenta() {
  const s = await requireSessionTenant('/cuenta');
  const { data: tenant } = await supabaseAdmin()
    .from('tenant').select('nombre').eq('id', s.tenantId).maybeSingle();

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/');
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="text-lg font-semibold tracking-tight">Mi cuenta</div>
        <dl className="mt-6 text-sm space-y-3">
          <div>
            <dt style={{ color: 'var(--muted)' }}>Flota</dt>
            <dd>{(tenant?.nombre as string) ?? '—'}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--muted)' }}>Usuario</dt>
            <dd>{s.nombre ?? s.userId}</dd>
          </div>
        </dl>
        <form action={cerrarSesion} className="mt-6">
          <button type="submit"
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium hairline"
            style={{ color: 'var(--ink)' }}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
