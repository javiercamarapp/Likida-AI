import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { Truck } from 'lucide-react';
import ContadorRetro from '../contador-retro';

export const dynamic = 'force-dynamic';

/**
 * Flotas / Clientes — versión dedicada y con más aire de la sección
 * "Flotas" de Inicio. Misma tabla real (`resumen.flotas`: nombre, plan,
 * viajes, costoIaUsd) de `getResumenNegocio()`, aquí ordenada por costo de
 * IA de mayor a menor (el único "sort" que aplica sin over-engineering).
 * El contador retro junto al título es el mismo componente Solari que usa
 * Inicio para el MRR, mostrando aquí `resumen.tenants` — el único número
 * de cabecera de esta página con un dato real y singular detrás.
 */
export default async function FlotasPage() {
  const r = await getResumenNegocio();
  const flotasOrdenadas = [...r.flotas].sort((a, b) => b.costoIaUsd - a.costoIaUsd);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Truck width={16} height={16} strokeWidth={1.75} />
          <span className="text-sm font-medium">Flotas / Clientes</span>
        </div>
        <ContadorRetro valor={r.tenants} digitos={3} etiqueta="Flotas dadas de alta" tamaño="lg" />
      </header>

      <div className="glass-panel overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Tabla maestra
          </h2>
          {r.flotas.length > 1 && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Ordenada por costo de IA, de mayor a menor
            </span>
          )}
        </div>
        {flotasOrdenadas.length === 0 ? (
          <div className="px-5 py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>
            Sin flotas dadas de alta todavía.
          </div>
        ) : (
          <div className="overflow-x-auto mt-1">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--muted)' }} className="text-left">
                  <th className="px-5 py-2.5 font-medium">Flota</th>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-5 py-2.5 font-medium text-right">Viajes</th>
                  <th className="px-5 py-2.5 font-medium text-right">Costo de IA</th>
                </tr>
              </thead>
              <tbody>
                {flotasOrdenadas.map((f) => (
                  <tr key={f.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-5 py-3 font-medium">{f.nombre}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                    <td className="px-5 py-3 text-right tabular">{f.viajes}</td>
                    <td className="px-5 py-3 text-right tabular">{usd(f.costoIaUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 pt-4 pb-5 border-t space-y-2" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Uso vs. límite, salud (activa/en riesgo/morosa), MRR por cliente, &quot;Login as&quot; con audit log — Fase 3 del roadmap, depende de tener clientes reales pagando.
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Retención por cohortes, distribución por plan — necesita más de 1 tenant para decir algo real.
          </p>
        </div>
      </div>
    </div>
  );
}
