import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sufijoTenant } from '@/app/dashboard/sufijo';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { Boton } from '../ui-v2/componentes/boton';
import { Monograma } from '../ui-v2/componentes/monograma';
import { PreferenciasCuenta } from './preferencias';
import { getT } from '@/lib/i18n/servidor';
import '../ui-v2/piezas.css';
import '../legal/publico-r2.css';
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

  const { t, idioma } = await getT('publico');
  const nombre = s.nombre ?? (tenant?.nombre as string) ?? 'Likida';
  return (
    <MarcoPublico
      rotulo={t('cta.rotulo')}
      titulo={t('cta.titulo')}
      ancho="estrecho"
      centrado
    >
      <div className="rv-flujo" aria-hidden="true" />
      {/* Orden de Rovaq: tarjeta de cuenta (monograma de 28, nombre, rol y flota) → filas rótulo-control (idioma, tema) → Cerrar sesión al final. */}
      <div className="rv-pub__tarjeta rv-cuenta__tarjeta">
        <Monograma id={s.userId} nombre={nombre} tamano={28} />
        <div className="rv-cuenta__quien">
          <strong>{s.nombre ?? s.userId}</strong>
          <span>{nombreDeRol(s.rol)} · {(tenant?.nombre as string) ?? '—'}</span>
        </div>
      </div>
      <PreferenciasCuenta idiomaActivo={idioma} textos={{
        idioma: t('cta.idioma'), tema: t('cta.tema'), temaClaro: t('cta.tema.claro'), temaSistema: t('cta.tema.sistema'), temaOscuro: t('cta.tema.oscuro'),
        es: 'Español', en: 'English', enProximamente: t('cta.en_pronto'), fallo: t('cta.idioma.fallo'),
      }} />
      <div className="rv-cuenta__pie">
        <Link href={`/dashboard${sufijo}`} className="rv-pub__enlace">{t('cta.volver')}</Link>
        <form action={cerrarSesion}>
          <Boton type="submit" variante="secondary" tamano="sm">{t('cta.cerrar')}</Boton>
        </form>
      </div>
    </MarcoPublico>
  );
}
