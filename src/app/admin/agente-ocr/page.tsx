import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/formato';
import { ScanText, DollarSign, Repeat, ReceiptText } from 'lucide-react';
import { BarChartSimple } from '../charts';
import { IconoProveedor } from '../proveedor-icono';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ICONO_KPI = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/**
 * Agente OCR — la fase que lee la foto de un comprobante (diésel, caseta,
 * factura) y extrae monto/folio/CFDI, antes de que cualquier "agente" de
 * chat intervenga. Todo real: `llm_costo` filtrado por `fase === 'ocr'`
 * (`getResumenNegocio`/`getCostoPorFaseModelo`) y `gasto` para el histórico
 * de facturas.
 *
 * Re-envuelta en la anatomía de página (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts` + `StatCard` del kit (el histórico de facturas
 * que vivía en el `ContadorRetro` del header viejo es ahora el tercer KPI —
 * misma cifra, misma fuente). Un cero aquí es MEDIDO: cero filas en
 * `llm_costo` para la fase es cero gasto real, no un relleno.
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
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ScanText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente OCR"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Lectura de comprobantes — monto, folio y CFDI. Costo real, histórico</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatCard icono={<DollarSign {...ICONO_KPI} />}
              etiqueta="Gastado en OCR" valor={ocr ? ocr.costoUsd : 0} formato="usd"
            />
            <StatCard icono={<Repeat {...ICONO_KPI} />}
              etiqueta="Llamadas de OCR" valor={ocr ? ocr.n : 0} formato="entero"
            />
            <StatCard icono={<ReceiptText {...ICONO_KPI} />}
              etiqueta="Facturas procesadas — histórico" valor={r.facturasTotal} formato="entero"
            />
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <TituloSeccion>{desgloseSeparable ? 'Costo por modelo — OCR' : 'Costo por modelo'}</TituloSeccion>
              {!desgloseSeparable && (
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Todos los modelos, todas las fases — el desglose no se puede aislar de forma limpia solo para OCR con los datos de hoy.
                </p>
              )}
            </div>
            {(desgloseSeparable ? modelosOcr : r.porModelo).length === 0 ? (
              <div className="px-4 pb-3 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                {(desgloseSeparable ? modelosOcr : r.porModelo).map((m) => (
                  <div key={m.modelo} className="px-4 py-2.5 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{numero(m.n)} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <TituloSeccion>Facturas procesadas — últimos 7 días</TituloSeccion>
            <div className="mt-3">
              {r.facturasPorDia.some((d) => d.n > 0) ? (
                <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={220} />
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                  Aún sin datos suficientes.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
