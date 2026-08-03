import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { calcularAlertas } from '../notificaciones';
import { Bell, TriangleAlert, CircleCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Página real de notificaciones — la campana del sidebar ya no abre un
 * dropdown, lleva aquí. Mismas alertas de siempre (`calcularAlertas`,
 * compartida con admin/layout.tsx): tendencia de costo, conversaciones
 * activas, si Likida sigue solo con el tenant demo. Nada inventado — si
 * no hay ninguna condición real, la página dice "Sin novedades", no
 * rellena con contenido de adorno.
 */
export default async function NotificacionesPage() {
  const [r, conversaciones] = await Promise.all([getResumenNegocio(), getConversacionesActivas()]);
  const alertas = calcularAlertas(r, conversaciones);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center gap-2.5 px-5">
        <Bell width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Notificaciones</span>
      </header>

      <div className="glass-panel overflow-hidden">
        {alertas.length === 0 ? (
          <div className="p-10 text-sm text-center" style={{ color: 'var(--muted)' }}>
            Sin novedades — no hay ninguna condición real que requiera tu atención ahorita.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {alertas.map((a, i) => (
              <div key={i} className="px-5 py-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: a.tipo === 'atencion' ? 'color-mix(in srgb, var(--color-bad) 12%, transparent)' : 'color-mix(in srgb, var(--color-ok) 12%, transparent)',
                  }}>
                  {a.tipo === 'atencion'
                    ? <TriangleAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--color-bad)' }} />
                    : <CircleCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--color-ok)' }} />}
                </div>
                <p className="text-sm pt-1">{a.texto}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
