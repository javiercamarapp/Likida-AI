import { ReceiptText, CheckCircle2 } from 'lucide-react';
import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { BarraPagina } from '../../resumen-visual';

/** Tope de la tabla — declarado en pantalla cuando recorta, nunca en
 *  silencio (la lista completa sí se consulta: los KPIs de arriba la suman
 *  toda). */
const MAX_FILAS = 30;

/**
 * El render del Agente de Facturas, separado de su puerta (page.tsx trae
 * sesión) — patrón page/vista del repo, para poder verificarlo mirando.
 */
export function VistaAgenteFacturas({ tickets }: { tickets: TicketPorFacturar[] }) {
  // getPorFacturar ordena por fecha del TICKET; el rótulo de la tabla promete
  // orden por VENCIMIENTO, y no son lo mismo (cada comercio tiene su plazo).
  // Vencidos arriba, luego por fecha límite, y al final los de plazo
  // desconocido — de ellos no se afirma nada, así que no compiten.
  // Cotas FINITAS: dos desconocidos con Infinity restan NaN y el sort queda
  // indefinido justo en el caso más común (varios tickets sin fecha).
  const orden = (t: TicketPorFacturar) =>
    t.caducidad.desconocido ? 1e9 : t.caducidad.vencido ? -1e9 : t.caducidad.diasRestantes;
  const ordenados = [...tickets].sort((a, b) => orden(a) - orden(b));

  const vencidos = ordenados.filter((t) => t.caducidad.vencido);
  const urgentes = ordenados.filter((t) => t.caducidad.urgente && !t.caducidad.vencido);
  const montoSinFactura = ordenados.reduce((s, t) => s + t.monto, 0);
  const visibles = ordenados.slice(0, MAX_FILAS);

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Facturas"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <p className="text-[13px] max-w-2xl" style={{ color: 'var(--muted)' }}>
            Cada gasto sin CFDI, con los datos que su portal va a pedir y el plazo que le queda.
            Lo que vence primero va arriba.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Por facturar" valor={numero(ordenados.length)} />
            <Kpi titulo="Monto sin factura" valor={mxn(montoSinFactura)} />
            <Kpi titulo="Urgentes (≤2 días)" valor={numero(urgentes.length)} tono={urgentes.length > 0 ? 'warn' : undefined} />
            <Kpi titulo="Vencidos" valor={numero(vencidos.length)} tono={vencidos.length > 0 ? 'bad' : undefined} />
          </div>

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-3">Cola de facturación</h2>
            {ordenados.length === 0 ? (
              <div className="min-h-[140px] flex items-center justify-center">
                <div className="text-center max-w-[32ch]">
                  <CheckCircle2 width={18} height={18} strokeWidth={1.75} className="mx-auto mb-2" style={{ color: 'var(--ok)' }} />
                  <p className="text-[13px]" style={{ color: 'var(--muted)' }}>
                    Ningún gasto registrado está sin factura. Cuando entre un comprobante sin
                    CFDI, aparece aquí con su plazo.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left" style={{ color: 'var(--faint)' }}>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Concepto</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Comercio</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Monto</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Folio</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Plazo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((t) => (
                        <tr key={t.gastoId} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaCorta(t.fecha)}</td>
                          <td className="py-2 font-medium">{etiquetaConcepto(t.concepto)}</td>
                          <td className="py-2">
                            {t.comercio ? (
                              <span>
                                {t.comercio.nombre}{' '}
                                <span className="text-[11px]" style={{ color: 'var(--faint)' }}>· {t.comercio.portal}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--faint)' }}>Sin identificar</span>
                            )}
                          </td>
                          <td className="py-2 pr-6 text-right cifra-mono">{mxn(t.monto)}</td>
                          <td className="py-2 cifra-mono text-[12px]" style={{ color: 'var(--muted)' }}>{t.folio ?? '—'}</td>
                          <td className="py-2"><PillPlazo c={t.caducidad} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ordenados.length > MAX_FILAS && (
                  <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
                    Se muestran los {MAX_FILAS} que vencen primero — hay {numero(ordenados.length - MAX_FILAS)} más
                    en la cola (los KPIs de arriba los cuentan todos).
                  </p>
                )}
              </>
            )}
          </section>

          <p className="text-[12px] max-w-2xl" style={{ color: 'var(--faint)' }}>
            La emisión automática hoy cubre CAPUFE. El resto de los comercios se factura en su
            portal — esta lista te deja cada campo que el portal va a pedir ya leído del ticket,
            para capturar en segundos en vez de perseguir el papel.
          </p>
        </div>
      </div>
    </main>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}

function PillPlazo({ c }: { c: TicketPorFacturar['caducidad'] }) {
  const estilo = (fg: string, bg: string) => ({ color: fg, background: bg });
  if (c.vencido) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--bad)', 'var(--badbg)')}>Vencido</span>;
  }
  if (c.desconocido) {
    // Sin fecha de ticket confiable no se afirma un plazo — se dice.
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--muted)', 'var(--canvas)')}>Plazo sin verificar</span>;
  }
  if (c.urgente) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--warn)', 'var(--warnbg)')}>{c.diasRestantes} d</span>;
  }
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--ok)', 'var(--okbg)')}>{c.diasRestantes} d</span>;
}
