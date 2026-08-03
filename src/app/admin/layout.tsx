import { requireSuperadmin } from '@/lib/auth/guard';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const AGENTES = [
  { fase: 'ocr', nombre: 'Agente OCR' },
  { fase: 'cuadre', nombre: 'Agente de Cuadre' },
  { fase: 'whatsapp', nombre: 'Agente de WhatsApp' },
];

/**
 * Sidebar persistente de /admin — la consola de negocio de Javier, clonada
 * en estructura de usehandle.ai (logo, sección AGENTES, sección NEGOCIO,
 * tarjeta de usuario abajo), no solo una página de tarjetas sueltas. El
 * `requireSuperadmin()` vive AQUÍ: gatea el layout entero, así que ninguna
 * página nueva bajo /admin puede olvidarlo.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { nombre } = await requireSuperadmin();

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      <aside className="w-[260px] shrink-0 border-r flex flex-col h-screen sticky top-0" style={{ borderColor: 'var(--line)' }}>
        <div className="px-5 py-5 flex items-center gap-2">
          <span className="font-semibold tracking-tight text-lg">Likida</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
            ADMIN
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 space-y-6 pb-4">
          <div>
            <Link href="/admin"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]">
              Inicio
            </Link>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
              Agentes
            </div>
            {AGENTES.map((a) => (
              <Link key={a.fase} href={`/admin#${a.fase}`}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]">
                {a.nombre}
              </Link>
            ))}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: 'var(--muted)' }}>
              Negocio
            </div>
            <Link href="/admin#flotas"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]">
              Flotas
            </Link>
            <Link href="/admin#conversaciones"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]">
              Conversaciones
            </Link>
            <Link href="/admin/chat"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]">
              Chatea con tus Datos
            </Link>
          </div>
        </nav>

        <div className="px-3 pb-3 space-y-1" style={{ borderTop: '1px solid var(--line)' }}>
          <Link href="/dashboard?vista=demo"
            className="flex items-center gap-2.5 px-2.5 py-2 mt-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]" style={{ color: 'var(--muted)' }}>
            Ver panel de flota (demo)
          </Link>
          <Link href="/cuenta"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]" style={{ color: 'var(--muted)' }}>
            Mi cuenta
          </Link>
          <div className="flex items-center gap-2.5 px-2.5 py-3 mt-1">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{ background: 'var(--ink)', color: 'white' }}>
              {(nombre ?? 'J').charAt(0).toUpperCase()}
            </div>
            <div className="text-sm">
              <div className="font-medium leading-tight">{nombre ?? 'Javier'}</div>
              <div className="text-xs leading-tight" style={{ color: 'var(--muted)' }}>Likida</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
