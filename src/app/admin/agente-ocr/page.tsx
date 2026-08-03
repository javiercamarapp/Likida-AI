import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { usd } from '@/lib/formato';
import { ScanText, DollarSign, Repeat } from 'lucide-react';
import { BarChartSimple } from '../charts';
import ContadorRetro from '../contador-retro';
import { IconoProveedor } from '../proveedor-icono';
import { KpiTile, ChartCard } from '../ui/kit';

export const dynamic = 'force-dynamic';

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/**
 * Agente OCR — la fase que lee la foto de un comprobante (diésel, caseta,
 * factura) y extrae monto/folio/CFDI, antes de que cualquier "agente" de
 * chat intervenga. Todo real: `llm_costo` filtrado por `fase === 'ocr'`
 * (`getResumenNegocio`/`getCostoPorFaseModelo`) y `gasto` para el histórico
 * de facturas.
 */
export default async function AgenteOcrPage() {
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  const ocr = r.porFase.find((f) => f.fase === 'ocr');
  const modelosOcr = porFaseModelo.filter((m) => m.fase === 'ocr');
  // La tabla `llm_costo` sí trae `fase` y `modelo` juntos, pero cuando esa
  // combinación no tiene ninguna fila para OCR (o `llm_costo` no distingue
  // bien la fase en cada llamada), no hay forma honesta de aislar "solo
  // OCR" del desglose por modelo — se enseña el general, rotulado como tal,
  // en vez de fingir un corte que la base no sostiene.
  const desgloseSeparable = modelosOcr.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ScanText width={16} height={16} strokeWidth={1.75} />
          <div>
            <span className="text-sm font-medium block">Agente OCR</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Lectura de comprobantes — monto, folio y CFDI</span>
          </div>
        </div>
        <ContadorRetro valor={r.facturasTotal} etiqueta="Facturas procesadas — histórico" tamaño="md" />
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Costo real</TituloSeccion>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <KpiTile
              icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
              etiqueta="Gastado en OCR" valor={ocr ? ocr.costoUsd : 0} formato="usd"
            />
            <KpiTile
              icono={<Repeat width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
              etiqueta="Llamadas de OCR" valor={ocr ? ocr.n : 0} formato="entero"
            />
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>{desgloseSeparable ? 'Costo por modelo — OCR' : 'Costo por modelo'}</TituloSeccion>
          {!desgloseSeparable && (
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Todos los modelos, todas las fases — el desglose no se puede aislar de forma limpia solo para OCR con los datos de hoy.
            </p>
          )}
          {(desgloseSeparable ? modelosOcr : r.porModelo).length === 0 ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
          ) : (
            <div className="card divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
              {(desgloseSeparable ? modelosOcr : r.porModelo).map((m) => (
                <div key={m.modelo} className="px-5 py-3 flex items-center gap-3">
                  <IconoProveedor modelo={m.modelo} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-mono truncate">{m.modelo}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                  </div>
                  <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <ChartCard titulo="Facturas procesadas — últimos 7 días" tamano="L">
            {r.facturasPorDia.some((d) => d.n > 0) ? (
              <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={220} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Aún sin datos suficientes.
              </div>
            )}
          </ChartCard>
        </section>
      </div>
    </div>
  );
}
