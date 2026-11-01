import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sufijoTenant } from '@/app/dashboard/sufijo';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { Boton } from '../ui-v2/componentes/boton';

export const dynamic = 'force-dynamic';

export default async function Cuenta({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string; vista?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const s = await requireSessionTenant('/cuenta', sp);
  const sufijo = sufijoTenant(sp);
  const { data: tenant } = await supabaseAdmin()
    .from('tenant').select('nombre').eq('id', s.tenantId).maybeSingle();

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/');
  }

  return (
    <MarcoPublico
      rotulo="Cuenta"
      titulo="Mi cuenta"
      ancho="estrecho"
      centrado
      acciones={
        <>
          <form action={cerrarSesion}>
            <Boton type="submit" variante="primary">Cerrar sesión</Boton>
          </form>
          <Link href={`/dashboard${sufijo}`} className="rv-pub__enlace">← Volver al panel</Link>
        </>
      }
    >
      <div className="rv-pub__tarjeta">
        <dl className="rv-pub__dl">
          <div>
            <dt>Flota</dt>
            <dd>{(tenant?.nombre as string) ?? '—'}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{s.nombre ?? s.userId}</dd>
          </div>
        </dl>
      </div>
    </MarcoPublico>
  );
}
