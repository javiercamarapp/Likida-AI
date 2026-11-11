import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sufijoTenant } from '@/app/dashboard/sufijo';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { Boton } from '../ui-v2/componentes/boton';
import { Monograma } from '../ui-v2/componentes/monograma';
import './cuenta.css';
import { nombreDeRol } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tu cuenta — Likida' };

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
            <Boton type="submit" variante="secondary" tamano="sm">Cerrar sesión</Boton>
          </form>
          <Link href={`/dashboard${sufijo}`} className="rv-pub__enlace">← Volver al panel</Link>
        </>
      }
    >
      <div className="rv-pub__tarjeta">
        {/* Tarjeta de cuenta (Rovaq): monograma de la persona y, bajo él, flota, usuario y rol en filas rótulo-valor. */}
        <Monograma id={s.userId} nombre={s.nombre ?? (tenant?.nombre as string) ?? 'Likida'} tamano={40} />
        <dl className="rv-pub__dl rv-cuenta__dl">
          <div>
            <dt>Flota</dt>
            <dd>{(tenant?.nombre as string) ?? '—'}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{s.nombre ?? s.userId}</dd>
          </div>
          <div>
            <dt>Rol</dt>
            <dd>{nombreDeRol(s.rol)}</dd>
          </div>
        </dl>
      </div>
    </MarcoPublico>
  );
}
