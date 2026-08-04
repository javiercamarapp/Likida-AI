import { Landmark, AlertTriangle, Clock } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getCobranza, type Cobranza } from '@/lib/cuadra/comercial';
import { EstadoVacio, KpiTile } from '../../admin/ui/kit';
import { mxn, fechaMx } from '@/lib/formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * COBRANZA — lo que la flota EMITE y le deben. No confundir con Facturación,
 * que son los CFDI que la flota RECIBE de sus proveedores: es lo contrario, y
 * mezclarlas haría que "total facturado" sumara dos cosas distintas.
 *
 * EL SALDO VIENE DE LA VISTA `factura_saldo`, derivado de los pagos. No hay
 * columna `saldo`: una guardada se desincroniza al cancelar un pago y entonces
 * la pantalla y la suma de abonos dicen cosas distintas del mismo dinero.
 *
 * UNA FACTURA SIN `vence_en` NO ESTÁ VENCIDA, está sin condiciones pactadas.
 * Pintarla de rojo acusaría de moroso a un cliente al que nadie le puso plazo.
 */
export default async function CobranzaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  await exigirVerRuta('/dashboard/cobranza');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/cobranza', sp);
  const c = await safe<Cobranza>(() => getCobranza(tenantId));

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Landmark width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Cobranza</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Lo que te deben y qué tanto tardan en pagarte
          </span>
        </div>
      </header>

      {!c ? (
        <div className="glass-panel p-5">
          <EstadoVacio>
            No se pudo leer la cartera por cobrar. La consulta falló — no es que no te deban nada.
          </EstadoVacio>
        </div>
      ) : c.facturas.length === 0 ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<Landmark width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">Todavía no hay facturas emitidas.</span> Las tablas ya
            existen. Ojo con la diferencia: los CFDI que Likida lee hoy son los que{' '}
            <strong>recibes</strong> de tus proveedores (diésel, casetas) y viven en Facturación.
            Esto es lo contrario — lo que tú le facturas a tu cliente.
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile
                icono={<Landmark width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Por cobrar"
                valor={c.porCobrar}
                formato="mxn"
              />
              <KpiTile
                icono={<AlertTriangle width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Vencido"
                valor={c.vencido}
                formato="mxn"
                destacar={c.vencido > 0}
              />
              <KpiTile
                icono={<Clock width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Sin plazo pactado"
                valor={c.sinCondiciones}
                nota="No están vencidas: nadie les puso fecha"
              />
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    <th className="text-left font-medium px-5 py-3">Folio</th>
                    <th className="text-left font-medium px-5 py-3">Cliente</th>
                    <th className="text-left font-medium px-5 py-3">Fecha</th>
                    <th className="text-right font-medium px-5 py-3">Total</th>
                    <th className="text-right font-medium px-5 py-3">Saldo</th>
                    <th className="text-left font-medium px-5 py-3">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {c.facturas.map((f) => (
                    <tr key={f.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="px-5 py-3 font-medium">{f.folio ?? '—'}</td>
                      <td className="px-5 py-3">{f.cliente}</td>
                      <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(f.fecha)}</td>
                      <td className="px-5 py-3 text-right tabular">{mxn(f.total)}</td>
                      <td className="px-5 py-3 text-right tabular">{mxn(f.saldo)}</td>
                      <td className="px-5 py-3 text-xs" style={{ color: f.vencida ? 'var(--bad)' : 'var(--muted)' }}>
                        {f.venceEn ? `${fechaMx(f.venceEn)}${f.vencida ? ' · vencida' : ''}` : 'sin plazo pactado'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
