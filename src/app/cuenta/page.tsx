import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { getSessionTenant } from '@/lib/auth/session';
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
import '../legal/flujo-publico.css';
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
  // El vendedor no tiene flota ni pantalla en /dashboard (su casa es /vendedor): el tarjeta de usuario de su sidebar apunta aquí, así que /cuenta
  // lo recibe en vez de rebotarlo a /vendedor (ese salto de ida y vuelta era también el recorrido donde la consola daba el error de hidratación #418).
  const previa = await getSessionTenant();
  const esVendedor = previa?.rol === 'vendedor';
  const s = esVendedor && previa ? previa : await requireSessionTenant('/cuenta', sp);
  const sufijo = sufijoTenant(sp);
  const { data: tenant } = s.tenantId
    ? await supabaseAdmin().from('tenant').select('nombre').eq('id', s.tenantId).maybeSingle()
    : { data: null };

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
    >
      <div className="rv-flujo" aria-hidden="true" />
      {/* Orden de Rovaq: tarjeta de cuenta (monograma de 28, nombre, rol y flota) → filas rótulo-control (idioma, tema) → Cerrar sesión al final. */}
      <div className="rv-pub__tarjeta rv-cuenta__tarjeta">
        <Monograma id={s.userId} nombre={nombre} tamano={28} />
        <div className="rv-cuenta__quien">
          <strong>{s.nombre ?? s.userId}</strong>
          <span>{esVendedor ? nombreDeRol(s.rol) : `${nombreDeRol(s.rol)} · ${(tenant?.nombre as string) ?? '—'}`}</span>
        </div>
      </div>
      <PreferenciasCuenta idiomaActivo={idioma} textos={{
        idioma: t('cta.idioma'), tema: t('cta.tema'), temaClaro: t('cta.tema.claro'), temaSistema: t('cta.tema.sistema'), temaOscuro: t('cta.tema.oscuro'),
        es: 'Español', en: 'English', fallo: t('cta.idioma.fallo'),
      }} />
      <div className="rv-cuenta__pie">
        <Link href={esVendedor ? '/vendedor' : `/dashboard${sufijo}`} className="rv-pub__enlace">{t('cta.volver')}</Link>
        <form action={cerrarSesion}>
          <Boton type="submit" variante="secondary" tamano="sm">{t('cta.cerrar')}</Boton>
        </form>
      </div>
    </MarcoPublico>
  );
}
