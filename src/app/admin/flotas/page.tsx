import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { Truck, ExternalLink } from 'lucide-react';
import ContadorRetro from '../contador-retro';
import { HBars } from '../ui/graficas';
import { ChartCard, EstadoVacio } from '../ui/kit';

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
          <div className="px-5 pt-3 pb-5">
            <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Sin flotas dadas de alta todavía.
            </EstadoVacio>
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
                  <th className="px-5 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {flotasOrdenadas.map((f) => (
                  <tr key={f.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-5 py-3 font-medium">{f.nombre}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                    <td className="px-5 py-3 text-right tabular">{f.viajes}</td>
                    <td className="px-5 py-3 text-right tabular">{usd(f.costoIaUsd)}</td>
                    <td className="px-5 py-3 text-right">
                      {/* Ve el panel REAL que ve esa flota (mismo /dashboard del
                          cliente), no una copia — "Login as" honesto: sin
                          fingir ser un usuario de esa flota, el superadmin
                          entra con su propia sesión y `?tenant=` resuelve el
                          tenant, validado contra la tabla real (ver
                          dashboard/page.tsx). */}
                      {/* DOS PUERTAS, no una. El dueño y el jefe de tráfico
                          comparten la misma URL y ven cosas distintas
                          (visibilidad.ts): sin el segundo link no había forma
                          de comprobar qué ve cada quien sin la contraseña de
                          los dos. `?rol=` solo QUITA visibilidad y solo se
                          honra si la sesión real es superadmin. */}
                      <div className="inline-flex items-center gap-1.5">
                        <Link href={`/dashboard?tenant=${f.id}`} target="_blank"
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                          <ExternalLink width={12} height={12} strokeWidth={1.75} /> Panel de dueño
                        </Link>
                        <Link href={`/dashboard/despacho?tenant=${f.id}&rol=encargado`} target="_blank"
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                          <ExternalLink width={12} height={12} strokeWidth={1.75} /> Panel de jefe de flota
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Ranking real de las mismas flotas de la tabla, por costo de IA —
            HBars (design system v2) compara categorías de un vistazo; la
            tabla arriba se queda porque tiene columnas que una barra no
            puede mostrar (plan, viajes, el link "Ver dashboard"). Solo con
            2+ flotas: con 1 sola, "ranking" no dice nada que la tabla ya no
            diga. */}
        {flotasOrdenadas.length > 1 && (
          <div className="px-5 pt-2 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <ChartCard titulo="Top flotas por costo de IA" tamano="M">
              <HBars datos={flotasOrdenadas.map((f) => ({ etiqueta: f.nombre, valor: f.costoIaUsd }))} formato="usd" />
            </ChartCard>
          </div>
        )}

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            &quot;Ver dashboard&quot; ya existe (arriba) — entra al panel real de esa flota con tu propia sesión de superadmin, sin credenciales nuevas. Uso vs. límite, salud (activa/en riesgo/morosa), MRR por cliente y un audit log de qué flota viste y cuándo siguen en el roadmap.
            <br /><br />
            Retención por cohortes, distribución por plan — necesita más de 1 tenant para decir algo real.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
