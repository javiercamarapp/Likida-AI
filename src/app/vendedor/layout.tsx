import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requireVendedor } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { CLASES_V2 } from '../marco-v2';
import CabeceraVendedor from './cabecera-vendedor';
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
 * El chrome de /vendedor — sobre el MISMO sistema que /dashboard y /admin (`data-ui="v2"`, hojas de ui-v2, `.rv-*`), pero sin
 * sidebar a propósito: el vendedor tiene UNA pantalla, y un menú anunciaría secciones que no existen.
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

  return (
    <IdiomaProvider idioma={idioma.idioma} diccionarios={idioma.diccionarios}>
      <div className={CLASES_V2.raiz} data-ui="v2" style={{ fontFamily: 'var(--font-sans-ui), var(--font-sans)' }}>
        <CabeceraVendedor movil nombre={nombre ?? null} esSoporte={esSoporte} salir={cerrarSesion} />
        <div className={`${CLASES_V2.fila} vnd-fila`}>
          <div className={CLASES_V2.columna}>
            <CabeceraVendedor nombre={nombre ?? null} esSoporte={esSoporte} salir={cerrarSesion} />
            <div id="contenido-principal" tabIndex={-1} className={CLASES_V2.contenido}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </IdiomaProvider>
  );
}
