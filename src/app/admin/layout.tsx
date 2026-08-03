import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutGrid, ScanText, Calculator, MessagesSquare, MessageCircle, Sparkles, UserPlus, ArrowLeftRight, UserCircle2,
  Settings2, FlaskConical, Truck, LineChart, DollarSign, Receipt, TrendingUp, Presentation,
  Server, Blocks, BookOpen, Megaphone, ShieldAlert, ShieldCheck, Users, Settings,
  Activity, ClipboardCheck, Code2, HeartPulse, LifeBuoy, Gauge,
} from 'lucide-react';
import Notificaciones, { calcularAlertas } from './notificaciones';
import PerfilMenu from './perfil';

export const dynamic = 'force-dynamic';

/** Las 6 secciones del roadmap (INICIO/AGENTES/NEGOCIO/PLATAFORMA/CONTROL/
 *  SISTEMA) — cada link apunta a una página real ya construida, ninguno es
 *  un anchor (`#seccion`) a una sección dentro de Inicio: cada feature
 *  tiene su propia ruta ahora. */
const AGENTES = [
  { href: '/admin/agente-ocr', nombre: 'Agente OCR', Icono: ScanText },
  { href: '/admin/agente-cuadre', nombre: 'Agente de Cuadre', Icono: Calculator },
  { href: '/admin/agente-whatsapp', nombre: 'Agente de WhatsApp', Icono: MessagesSquare },
  { href: '/admin/model-ops', nombre: 'Model Ops', Icono: Settings2 },
  { href: '/admin/playground', nombre: 'Playground', Icono: FlaskConical },
];

const NEGOCIO = [
  { href: '/admin/flotas', nombre: 'Flotas / Clientes', Icono: Truck },
  { href: '/admin/conversaciones', nombre: 'Conversaciones', Icono: MessageCircle },
  { href: '/admin/analitica', nombre: 'Analítica & Stats', Icono: LineChart },
  { href: '/admin/costos-facturacion', nombre: 'Costos & Facturación', Icono: DollarSign },
  { href: '/admin/cobranza', nombre: 'Cobranza', Icono: Receipt },
  { href: '/admin/crecimiento', nombre: 'Crecimiento', Icono: TrendingUp },
  { href: '/admin/ejecutivo', nombre: 'Ejecutivo / Board', Icono: Presentation },
];

const PLATAFORMA = [
  { href: '/admin/whatsapp-infra', nombre: 'WhatsApp Infra', Icono: Server },
  { href: '/admin/integraciones', nombre: 'Integraciones', Icono: Blocks },
  { href: '/admin/conocimiento-rag', nombre: 'Conocimiento / RAG', Icono: BookOpen },
  { href: '/admin/comunicacion', nombre: 'Comunicación', Icono: Megaphone },
];

const CONTROL = [
  { href: '/admin/trust-safety', nombre: 'Trust & Safety', Icono: ShieldAlert },
  { href: '/admin/compliance', nombre: 'Compliance & Datos', Icono: ShieldCheck },
  { href: '/admin/equipo', nombre: 'Equipo', Icono: Users },
  { href: '/admin/configuracion', nombre: 'Configuración', Icono: Settings },
];

const SISTEMA = [
  { href: '/admin/observabilidad', nombre: 'Observabilidad', Icono: Activity },
  { href: '/admin/calidad-evals', nombre: 'Calidad & Evals', Icono: ClipboardCheck },
  { href: '/admin/dev', nombre: 'Dev', Icono: Code2 },
  { href: '/admin/salud-sistema', nombre: 'Salud del sistema', Icono: HeartPulse },
  { href: '/admin/soporte', nombre: 'Soporte', Icono: LifeBuoy },
  { href: '/admin/capacidad-forecast', nombre: 'Capacidad & Forecast', Icono: Gauge },
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
              {AGENTES.map(({ href, nombre: n, Icono: I }) => (
                <Link key={href} href={href} className={ITEM}>
                  <I {...ICONO} /> {n}
                </Link>
              ))}
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
                Negocio
              </div>
              {NEGOCIO.map(({ href, nombre: n, Icono: I }) => (
                <Link key={href} href={href} className={ITEM}>
                  <I {...ICONO} /> {n}
                </Link>
              ))}
              <Link href="/admin/chat" className={ITEM}><Sparkles {...ICONO} /> Chatea con tus Datos</Link>
              <Link href="/admin/usuarios/nuevo" className={ITEM}><UserPlus {...ICONO} /> Nuevo usuario</Link>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
                Plataforma
              </div>
              {PLATAFORMA.map(({ href, nombre: n, Icono: I }) => (
                <Link key={href} href={href} className={ITEM}>
                  <I {...ICONO} /> {n}
                </Link>
              ))}
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
                Control
              </div>
              {CONTROL.map(({ href, nombre: n, Icono: I }) => (
                <Link key={href} href={href} className={ITEM}>
                  <I {...ICONO} /> {n}
                </Link>
              ))}
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
                Sistema
              </div>
              {SISTEMA.map(({ href, nombre: n, Icono: I }) => (
                <Link key={href} href={href} className={ITEM}>
                  <I {...ICONO} /> {n}
                </Link>
              ))}
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
