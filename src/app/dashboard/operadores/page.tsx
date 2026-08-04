import { UserCog, Wallet, CheckCheck, Users } from 'lucide-react';
import { getOperadoresDetalle, type OperadorDetalle } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio, StatusPill } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** Barra de % comprobado — monocromo, con el número al lado: nunca color
 *  solo (regla del skill de dataviz). `null` (nunca recibió anticipo) se
 *  pinta como guion, no como 0%: son cosas distintas. */
function BarraComprobado({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="h-1.5 rounded-full overflow-hidden shrink-0" style={{ width: 64, background: 'var(--canvas)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: 'var(--marca)' }} />
      </div>
      <span className="tabular text-sm w-11 text-right">{pct}%</span>
    </div>
  );
}

/**
 * Operadores (PASO 14) — la tabla real de `operador`, cruzada con su
 * anticipo y lo que comprobaron (`getOperadoresDetalle`, escrita para esta
 * página: `getStatsPorOperador` solo sumaba diésel).
 *
 * Licencia y su vencimiento, y el scorecard de conducción (frenado,
 * velocidad, idle), no existen en el esquema ni hay telemática conectada —
 * se dice abajo en vez de enseñar columnas vacías.
 */
export default async function OperadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/operadores', sp);
  const ops = await safe<OperadorDetalle[]>(() => getOperadoresDetalle(tenantId));

  const activos = ops?.filter((o) => o.activo).length ?? 0;
  const anticipoTotal = ops?.reduce((s, o) => s + o.anticipoTotal, 0) ?? 0;
  const comprobadoTotal = ops?.reduce((s, o) => s + o.comprobadoTotal, 0) ?? 0;
  const pctGlobal = anticipoTotal > 0 ? Math.round((comprobadoTotal / anticipoTotal) * 100) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <UserCog width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Operadores</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Quién trae anticipo abierto y qué tanto ha comprobado
          </span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {ops === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado de operadores.</div>
        ) : (
          <>
            <section className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                La plantilla
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<Users width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Operadores activos" valor={activos} formato="entero" />
                <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Anticipo entregado" valor={anticipoTotal} formato="mxn" />
                <KpiTile icono={<CheckCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Comprobado contra ese anticipo" valor={comprobadoTotal} formato="mxn" />
                <KpiTile icono={<CheckCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="% comprobado de la flota" valor={pctGlobal ?? 0} formato="porcentaje"
                  vacio={pctGlobal === null ? 'Todavía no se ha entregado ningún anticipo' : undefined} />
              </div>
            </section>

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Operador por operador
              </h2>
            </div>
            {ops.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<UserCog width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no hay operadores dados de alta en esta flota.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Operador</th>
                      <th className="px-5 py-2.5 font-medium">Teléfono</th>
                      <th className="px-5 py-2.5 font-medium text-right">Viajes</th>
                      <th className="px-5 py-2.5 font-medium text-right">Anticipo</th>
                      <th className="px-5 py-2.5 font-medium text-right">Comprobado</th>
                      <th className="px-5 py-2.5 font-medium text-right">% comprobado</th>
                      <th className="px-5 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.map((o) => (
                      <tr key={o.operadorId} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-3 font-medium">
                          {o.nombre}
                          {o.numeroEmpleado && (
                            <span className="block text-xs font-normal" style={{ color: 'var(--muted)' }}>
                              #{o.numeroEmpleado}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{o.telefono ?? '—'}</td>
                        <td className="px-5 py-3 text-right tabular">{o.viajes}</td>
                        <td className="px-5 py-3 text-right tabular">{o.anticipoTotal > 0 ? mxn(o.anticipoTotal) : '—'}</td>
                        <td className="px-5 py-3 text-right tabular">{o.comprobadoTotal > 0 ? mxn(o.comprobadoTotal) : '—'}</td>
                        <td className="px-5 py-3"><BarraComprobado pct={o.pctComprobado} /></td>
                        <td className="px-5 py-3">
                          <StatusPill estado={o.activo ? 'ok' : 'neutral'}>{o.activo ? 'Activo' : 'Inactivo'}</StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <EstadoVacio>
                Licencia y su vencimiento no aparecen porque `operador` no los guarda. El scorecard de conducción
                (frenado brusco, velocidad, tiempo en ralentí) necesita telemática o GPS conectado, y no lo hay —
                lo mismo para el flujo de coaching que se construiría encima.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
