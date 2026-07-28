import { exigirAcceso } from '@/lib/auth/guard';
import Link from 'next/link';
import { LEYENDA_CORTA } from '@/lib/cuadra/cuadre/leyendas';
import { notFound } from 'next/navigation';
import { getLiquidacionDetalle } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

// Mantener en sintonía con CONCEPTO_LABEL de liquidacion/pdf.ts y label() de
// cuadre/engine.ts. Se desincronizó una vez al partir 'viaticos' en tres: el
// contralor veía "hospedaje" en minúscula cruda en su tabla.
const CONCEPTO: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura',
  alimentacion: 'Alimentación', hospedaje: 'Hospedaje', transporte: 'Transporte', flete: 'Flete',
  viaticos: 'Viáticos', otro: 'Otro',
};
const ESTATUS: Record<string, { label: string; color: string }> = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
};

export default async function Detalle({ params }: { params: Promise<{ id: string }> }) {
  // Segunda capa (ver dashboard/page.tsx). El id va en la ruta de vuelta para
  // que tras el passcode aterrice en la liquidación que pidió.
  const { id: idParaVolver } = await params;
  await exigirAcceso(`/dashboard/${idParaVolver}`);
  const { id } = await params;
  const d = await getLiquidacionDetalle(id, TENANT());
  if (!d) notFound();
  const e = ESTATUS[d.estatus] ?? { label: d.estatus, color: 'var(--muted)' };
  const hayAcred = d.litrosDiesel > 0 || d.ieps > 0 || d.iva > 0 || d.peaje > 0;

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-4xl mx-auto px-8 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="text-base hover:opacity-70" style={{ color: 'var(--muted)' }}>← Panel</Link>
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ color: 'var(--muted)', background: 'color-mix(in srgb, var(--muted) 10%, transparent)' }}>datos de demostración</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-10 space-y-9">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Liquidación · {d.fecha}</div>
            <h1 className="text-3xl font-semibold tracking-tight mt-1">{d.folio}</h1>
          </div>
          <span className="text-base flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: e.color }} />{e.label}
          </span>
        </div>

        {/* Totales grandes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Tot label="Comprobado" value={mxn(d.totalComprobado)} />
          <Tot label="Anticipo" value={mxn(d.totalAnticipo)} />
          <Tot
            label={d.diferencia > 0 ? 'A favor de la empresa' : d.diferencia < 0 ? 'A favor del operador' : 'Diferencia'}
            value={d.diferencia === 0 ? 'Cuadra exacto' : mxn(Math.abs(d.diferencia))}
            accent={d.diferencia !== 0}
          />
        </div>

        {/* Acreditables */}
        {hayAcred && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Acreditable / recuperable</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Litros, no pesos: el estímulo del LIF 20-A es cuota semanal del DOF
                  × litros y esa cuota no la tenemos. `ieps` solo puede venir de filas
                  viejas escritas antes del cambio; se conserva para no ocultarlas. */}
              {d.litrosDiesel > 0 && <Tot label="Diésel elegible para el estímulo" value={`${d.litrosDiesel} L`} ok />}
              {d.ieps > 0 && <Tot label="IEPS de diésel (vs ISR)" value={mxn(d.ieps)} ok />}
              {d.iva > 0 && <Tot label="IVA acreditable" value={mxn(d.iva)} ok />}
              {d.peaje > 0 && <Tot label="Peaje 50%" value={mxn(d.peaje)} ok />}
            </div>
          </section>
        )}

        {/* Diferencias en lenguaje humano */}
        {d.diferencias.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Diferencias detectadas</h2>
            <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
              {d.diferencias.map((df, i) => (
                <div key={i} className="px-6 py-4 flex items-start justify-between gap-4" style={{ borderColor: 'var(--line)' }}>
                  <span className="text-base">{df.nota}</span>
                  {df.monto > 0 && <span className="tabular font-medium whitespace-nowrap">{mxn(df.monto)}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Comprobantes */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Comprobantes</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-base">
              <tbody>
                {d.gastos.map((g, i) => (
                  <tr key={i} className="border-t first:border-t-0" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-6 py-3.5 font-medium">{CONCEPTO[g.concepto] ?? g.concepto}</td>
                    <td className="px-6 py-3.5" style={{ color: 'var(--muted)' }}>{g.folio ?? '—'}</td>
                    <td className="px-6 py-3.5 text-right tabular">{mxn(g.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="text-xs mt-10 pt-6 border-t" style={{ color: 'var(--muted)', borderColor: 'var(--line)' }}>
          {LEYENDA_CORTA}
        </p>
      </main>
    </div>
  );
}

function Tot({ label, value, accent, ok }: { label: string; value: string; accent?: boolean; ok?: boolean }) {
  const color = ok ? 'var(--color-ok)' : accent ? 'var(--accent)' : 'var(--ink)';
  return (
    <div className="card p-6">
      <div className="text-3xl font-semibold tracking-tight tabular" style={{ color }}>{value}</div>
      <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
