import { Calculator, CheckCircle2, Send } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getCotizaciones, type CotizacionRow } from '@/lib/likida/comercial';
import { EstadoVacio, KpiTile, StatusPill } from '../../admin/ui/kit';
import { mxn } from '@/lib/formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * COTIZADOR — `cotizacion` y `tarifa` existen desde la 0051/0048.
 *
 * EL MARGEN DE UNA COTIZACIÓN SOLO SE PINTA CUANDO ESTÁN LAS DOS CIFRAS. Si
 * falta el precio o el costo estimado, la columna dice "a medias" en vez de
 * derivar una del otro con un margen supuesto: un margen inventado es
 * exactamente el número con el que se acepta carga que cuesta dinero.
 *
 * `estado = 'ganada'` exige precio Y viaje por constraint (0051): una
 * cotización no se vuelve operación sin que alguien la apruebe.
 */
export default async function CotizadorPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  await exigirVerRuta('/dashboard/cotizador');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/cotizador', sp);
  const cots = await safe<CotizacionRow[]>(() => getCotizaciones(tenantId));

  const ganadas = cots?.filter((c) => c.estado === 'ganada').length ?? 0;
  const enviadas = cots?.filter((c) => c.estado === 'enviada').length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Calculator width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Cotizador</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Cotizar un viaje con su margen esperado
          </span>
        </div>
      </header>

      {!cots ? (
        <div className="glass-panel p-5">
          <EstadoVacio>
            No se pudieron leer las cotizaciones. La consulta falló — no es que no haya ninguna.
          </EstadoVacio>
        </div>
      ) : cots.length === 0 ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<Calculator width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">Todavía no hay cotizaciones.</span> Las tablas de
            cotización y de tarifas ya existen —por viaje, por kilómetro o por tonelada—. Captura
            tus tarifas y el cotizador puede proponer precio y comparar contra el costo estimado
            de esa ruta.
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile
                icono={<Calculator width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Cotizaciones"
                valor={cots.length}
              />
              <KpiTile
                icono={<Send width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Enviadas"
                valor={enviadas}
              />
              <KpiTile
                icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Ganadas"
                valor={ganadas}
                destacar={ganadas > 0}
              />
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    <th className="text-left font-medium px-5 py-3">Ruta</th>
                    <th className="text-left font-medium px-5 py-3">Cliente</th>
                    <th className="text-right font-medium px-5 py-3">Km</th>
                    <th className="text-right font-medium px-5 py-3">Costo est.</th>
                    <th className="text-right font-medium px-5 py-3">Precio</th>
                    <th className="text-right font-medium px-5 py-3">Margen</th>
                    <th className="text-left font-medium px-5 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cots.map((c) => {
                    // Las DOS cifras o ninguna. Derivar una de la otra con un
                    // margen supuesto produce justo el número con el que se
                    // acepta carga que cuesta dinero.
                    const completo = c.precio != null && c.costoEstimado != null && c.precio > 0;
                    const margen = completo ? ((c.precio! - c.costoEstimado!) / c.precio!) * 100 : null;
                    return (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
                        <td className="px-5 py-3 font-medium">{c.origen} → {c.destino}</td>
                        <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{c.cliente ?? '—'}</td>
                        <td className="px-5 py-3 text-right tabular">{c.km ?? '—'}</td>
                        <td className="px-5 py-3 text-right tabular">{c.costoEstimado != null ? mxn(c.costoEstimado) : '—'}</td>
                        <td className="px-5 py-3 text-right tabular">{c.precio != null ? mxn(c.precio) : '—'}</td>
                        <td className="px-5 py-3 text-right tabular text-xs"
                          style={{ color: margen == null ? 'var(--muted)' : margen < 0 ? 'var(--bad)' : 'var(--ink)' }}>
                          {margen == null ? 'a medias' : `${margen.toFixed(1)}%`}
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill estado={c.estado === 'ganada' ? 'ok' : c.estado === 'perdida' || c.estado === 'vencida' ? 'bad' : 'neutral'}>
                            {c.estado}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
