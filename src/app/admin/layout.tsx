import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { LayoutGrid, ScanText, Calculator, MessagesSquare, Building2, Sparkles, UserPlus, ArrowLeftRight, UserCircle2 } from 'lucide-react';
import Notificaciones, { calcularAlertas } from './notificaciones';
import PerfilMenu from './perfil';

export const dynamic = 'force-dynamic';

const AGENTES = [
  { fase: 'ocr', nombre: 'Agente OCR', Icono: ScanText },
  { fase: 'cuadre', nombre: 'Agente de Cuadre', Icono: Calculator },
  { fase: 'whatsapp', nombre: 'Agente de WhatsApp', Icono: MessagesSquare },
];

const ITEM = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)] transition-colors';
const ICONO = { width: 16, height: 16, strokeWidth: 1.75, color: 'var(--muted)' } as const;

/**
 * Sidebar persistente de /admin — la consola de negocio de Javier. El
 * `requireSuperadmin()` vive AQUÍ: gatea el layout entero, así que ninguna
 * página nueva bajo /admin puede olvidarlo.
 *
 * El fondo de TODA la consola es la imagen difuminada negra generada en
 * Higgsfield (public/images/bg-admin.jpg) — sidebar, header y tarjetas son
 * paneles "glass" SOBREPUESTOS con espacio real entre sí (el `p-4 gap-4` de
 * abajo), no regiones pegadas con hairline como antes.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { nombre } = await requireSuperadmin();

  // Las alertas viven aquí (no en admin/page.tsx) para que la campana esté
  // en el sidebar — visible en TODO /admin, no solo en Inicio — junto al
  // perfil, como pidió el usuario. Sí duplica el fetch de getResumenNegocio
  // con el de page.tsx; aceptable hoy (pocas filas, un solo tenant real).
  const [r, conversaciones] = await Promise.all([getResumenNegocio(), getConversacionesActivas()]);
  const alertas = calcularAlertas(r, conversaciones);

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <div
      className="min-h-dvh"
      style={{
        backgroundImage: 'url(/images/bg-admin.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        fontFamily: 'var(--font-sans-handle), var(--font-sans)',
      }}
    >
      {/* `dvh` en vez de `vh` a propósito: en iOS Safari, `100vh` cuenta el
          espacio DETRÁS de la barra de direcciones colapsable, así que la
          altura calculada no es la que realmente se ve — eso rompe el
          `sticky` del header cuando el navegador recalcula al hacer scroll.
          `dvh` (dynamic viewport height) sigue el viewport visual real. */}
      <div className="min-h-dvh flex items-start gap-4 p-4">
        <aside className="glass-panel w-[232px] shrink-0 flex flex-col h-[calc(100dvh-2rem)] sticky top-4 self-start overflow-hidden">
          <div className="px-4 py-4 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
            <img src="/images/logo.png" alt="Likida" className="h-5 w-auto" />
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
              ADMIN
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 space-y-5 pb-4">
            <div>
              <Link href="/admin" className={`${ITEM} font-medium`}>
                <LayoutGrid {...ICONO} /> Inicio
              </Link>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
                Agentes
              </div>
              {AGENTES.map(({ fase, nombre: n, Icono: I }) => (
                <Link key={fase} href={`/admin#${fase}`} className={ITEM}>
                  <I {...ICONO} /> {n}
                </Link>
              ))}
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
                Negocio
              </div>
              <Link href="/admin#flotas" className={ITEM}><Building2 {...ICONO} /> Flotas</Link>
              <Link href="/admin#conversaciones" className={ITEM}><MessagesSquare {...ICONO} /> Conversaciones</Link>
              <Link href="/admin/chat" className={ITEM}><Sparkles {...ICONO} /> Chatea con tus Datos</Link>
              <Link href="/admin/usuarios/nuevo" className={ITEM}><UserPlus {...ICONO} /> Nuevo usuario</Link>
            </div>
          </nav>

          <div className="px-2.5 pb-2.5 pt-2.5" style={{ borderTop: '1px solid var(--line)' }}>
            <Link href="/dashboard?vista=demo" className={ITEM} style={{ color: 'var(--muted)' }}>
              <ArrowLeftRight {...ICONO} /> Ver panel de flota (demo)
            </Link>
            <Link href="/cuenta" className={ITEM} style={{ color: 'var(--muted)' }}>
              <UserCircle2 {...ICONO} /> Mi cuenta
            </Link>
            {/* Campana + perfil viven aquí — ya no hay header arriba.
                `ml-auto` en la campana para que no quede pegada al perfil. */}
            <div className="flex items-center px-2.5 py-2.5 mt-1">
              <PerfilMenu nombre={nombre ?? 'Javier'} cerrarSesion={cerrarSesion} />
              <div className="ml-auto"><Notificaciones alertas={alertas} /></div>
            </div>
          </div>
        </aside>

        {/* Columna de contenido: SU PROPIO scroll (`overflow-y-auto`), no el
            de la página — así el `sticky` del header y del panel derecho de
            admin/page.tsx tienen un solo ancestro de scroll inequívoco, en
            vez de depender del scroll del documento a través de varios
            niveles de flexbox anidados (el patrón anterior fallaba en
            Safari/iOS incluso con `items-start` + `dvh`). */}
        <div className="flex-1 min-w-0 h-[calc(100dvh-2rem)] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
