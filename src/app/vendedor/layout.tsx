import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requireVendedor } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { CLASES_V2 } from '../marco-v2';
import CabeceraVendedor from './cabecera-vendedor';
import SidebarVendedor from './sidebar-vendedor';
import { LogOut } from 'lucide-react';
import { getT } from '@/lib/i18n/servidor';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import { ROL_BADGE, type RolAppUser } from '@/lib/auth/provisionar';
import '../ui-v2/tokens.css';
import '../ui-v2/fonts.css';
import '../ui-v2/shell.css';
import '../ui-v2/pie-sidebar.css';
import '../ui-v2/componentes.css';
import '../ui-v2/overlay.css';
import '../ui-v2/piezas.css';
import '../ui-v2/graficas.css';
import '../ui-v2/datos.css';
import '../ui-v2/movimiento.css';
import '../ui-v2/paginas.css';

export const dynamic = 'force-dynamic';

// Plantilla del título de pestaña de /vendedor (cada page.tsx aporta su nombre).
export const metadata: Metadata = { title: { default: 'Vendedores · Likida', template: '%s · Vendedores · Likida' } };

/**
 * El chrome de /vendedor — sobre el MISMO caparazón de Rovaq que /dashboard y /admin (`data-ui="v2"`, hojas de ui-v2, `.rv-*`): sidebar de
 * 232 px, topbar de 44 y marco flotante (decisión 11 del dueño: todo rol trabaja dentro del mismo esqueleto). El sidebar trae UN ítem
 * porque el vendedor tiene una sola pantalla; bajo 768 px manda la cabecera móvil.
 *
 * `requireVendedor()` vive AQUÍ, como `requireSuperadmin()` en admin/layout.tsx: gatea el layout entero y ninguna página futura
 * bajo /vendedor puede olvidarlo. Es la SEGUNDA capa — la primera es el proxy (`RUTAS_CON_SESION` incluye /vendedor).
 */
export default async function VendedorLayout({ children }: { children: React.ReactNode }) {
  const { nombre, rol } = await requireVendedor();

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  const idioma = await datosParaProveedor(['shell']);
  // El superadmin entra por soporte y la cabecera lo dice: sin ella, esta pantalla se confundiría con la vista real de un vendedor.
  const esSoporte = rol === 'superadmin';
  const { t } = await getT('shell');
  const rolEtiqueta = ROL_BADGE[rol as RolAppUser] ?? rol;
  // El `<form>` de salir se arma aquí (servidor) y baja ya hecho al sidebar de cliente: una server action no cruza como prop de función.
  const salir = (
    <form action={cerrarSesion} className="rv-cuenta__salir">
      <button type="submit" aria-label={t('pie.cuenta.salir')} title={t('pie.cuenta.salir')} className="rv-icono-boton">
        <LogOut width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
      </button>
    </form>
  );

  return (
    <IdiomaProvider idioma={idioma.idioma} diccionarios={idioma.diccionarios}>
      <div className={CLASES_V2.raiz} data-ui="v2" style={{ fontFamily: 'var(--font-sans-ui), var(--font-sans)' }}>
        <CabeceraVendedor movil nombre={nombre ?? null} esSoporte={esSoporte} salir={cerrarSesion} />
        <div className={`${CLASES_V2.fila} vnd-fila`}>
          <SidebarVendedor nombre={nombre ?? null} rolEtiqueta={rolEtiqueta} salir={salir} />
          <div className={CLASES_V2.columna}>
            <CabeceraVendedor esSoporte={esSoporte} />
            <div id="contenido-principal" tabIndex={-1} className={CLASES_V2.contenido}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </IdiomaProvider>
  );
}
