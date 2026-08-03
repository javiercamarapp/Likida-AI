import { getResumenNegocio } from '@/lib/admin/negocio';
import { Settings, Info } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Configuración / Planes & Continuidad — lo real es la etiqueta de plan de
 * cada flota, que ya vive en `tenant.plan` (`getResumenNegocio().flotas`,
 * el mismo dato que enseña la tabla de Flotas en Inicio, aquí enfocado
 * solo en el plan). No hay lógica de límites detrás: es texto, no un
 * sistema de billing.
 */
export default async function ConfiguracionPage() {
  const r = await getResumenNegocio();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Settings width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Configuración</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Planes y continuidad</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Planes por flota
          </h2>
          {r.flotas.length === 0 ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin flotas dadas de alta todavía.</div>
          ) : (
            <div className="card divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
              {r.flotas.map((f) => (
                <div key={f.id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{f.nombre}</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                    {f.plan}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            Límites y precio por plan editables, upgrade/downgrade, pricing outcome-based — no existen controles de
            esto hoy, los planes son solo una etiqueta de texto en la base (<code className="font-mono">tenant.plan</code>),
            sin lógica de límites detrás.
          </p>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
              </div>
              <p className="text-sm">
                Backups, disaster recovery, residencia de datos — gestionados por Supabase/Vercel a nivel de
                infraestructura, sin panel propio aquí; si hace falta detalle, se consulta directo en sus dashboards.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
