import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { leerSeleccionFlota } from '@/lib/auth/admin-context';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import AdminChrome from './chrome';
import { ProveedorRequiereAccion } from './cabecera-admin';
import { obtenerPanoramaAccion } from './requiere-accion';
import { conteosDePestanas } from './conteos-pestanas';
import { ProveedorConteosPestanas } from './conteos-pestanas-contexto';
import '../ui-v2/tokens.css';
// Fuente unificada con el dashboard (Hanken Grotesk, decisión de 7-nov-2026; antes D3 la dejaba en Inter).
import '../ui-v2/fonts.css';
import '../ui-v2/shell.css';
import './admin-shell.css';
import '../ui-v2/pie-sidebar.css';
import '../ui-v2/componentes.css';
import '../ui-v2/overlay.css';
import '../ui-v2/piezas.css';
import '../ui-v2/barra-periodo.css';
import '../ui-v2/graficas.css';
import '../ui-v2/datos.css';
import '../ui-v2/movimiento.css';
import '../ui-v2/paginas.css';
import '../ui-v2/paginas-dominio.css';
import '../ui-v2/carga.css';

export const dynamic = 'force-dynamic';

// Plantilla del título de pestaña de /admin (cada page.tsx aporta su nombre).
export const metadata: Metadata = { title: { default: 'Admin · Likida', template: '%s · Admin · Likida' } };

/**
 * La puerta de /admin — el `requireSuperadmin()` vive AQUÍ y gatea el layout
 * entero: ninguna página nueva bajo /admin puede olvidarlo. El marco visual
 * vive en `chrome.tsx` (mismo reparto que /dashboard: layout = puerta,
 * chrome = dibujo verificable sin sesión).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { nombre, avatarUrl } = await requireSuperadmin();
  // UNA lectura (caché de 45 s; nunca lanza, lectura caída = «sin dato») alimenta la campana de la cabecera (cuántas cosas esperan a un
  // humano) y los números de las pestañas (hoy Escalaciones): así campana y pestaña no pueden discrepar ni leer la base dos veces.
  const { resumen: requiereAccion, bandeja, cola } = await obtenerPanoramaAccion();
  const conteosPestanas = conteosDePestanas(bandeja, cola);

  // Flotas para el selector del pie. Fallar cerrado y decirlo: si la lectura cae, el pie dice «Sin dato» (no una lista vacía).
  let flotas: Array<{ id: string; nombre: string }> | null = null;
  try {
    const { data, error } = await supabaseAdmin().from('tenant').select('id, nombre').order('nombre');
    if (!error && data) flotas = data.map((t) => ({ id: t.id as string, nombre: (t.nombre as string) ?? (t.id as string) }));
  } catch { flotas = null; }
  const flotaActual = await leerSeleccionFlota().catch(() => null);

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <ProveedorRequiereAccion valor={requiereAccion}>
      <ProveedorConteosPestanas valor={conteosPestanas}>
        <AdminChrome nombre={nombre ?? null} avatarUrl={avatarUrl ?? null} cerrarSesion={cerrarSesion} flotas={flotas} flotaActual={flotaActual}>
          {children}
        </AdminChrome>
      </ProveedorConteosPestanas>
    </ProveedorRequiereAccion>
  );
}
