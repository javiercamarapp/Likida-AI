import {
  ChartNoAxesCombined, Banknote, ReceiptText, TrendingUp, Wallet, CalendarClock,
} from 'lucide-react';
import type { Rentabilidad, Cobranza } from '@/lib/likida/comercial';
import { StatCard, EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import { mxn, fechaCorta } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';

/**
 * La vista de Rentabilidad y cobranza — pura props para poder verificarla
 * mirando con fixtures. Tres estados por bloque: datos reales, vacío que
 * explica qué lo enciende, o el error dicho (nunca un vacío fingido sobre
 * una tabla ilegible).
 */
export function VistaRentabilidad({
  rentabilidad, cobranza,
}: {
  rentabilidad: Rentabilidad | null;
  cobranza: Cobranza | null;
}) {
  const sinNada = rentabilidad !== null && cobranza !== null
    && rentabilidad.viajesConIngreso === 0 && cobranza.facturas.length === 0;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ChartNoAxesCombined width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Rentabilidad y cobranza"
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          {sinNada ? (
            <EstadoVacio>
              Esta pantalla trabaja con dos datos que tu cuenta todavía no tiene: el{' '}
              <strong>ingreso de cada flete</strong> y las <strong>facturas que le emites a tus
              clientes</strong>. En cuanto existan, aquí se mide — margen real contra lo comprobado
              (no contra el anticipo), cartera por cobrar y lo vencido por cliente. Nada de esta
              pantalla se estima: si el dato no está, se dice.
            </EstadoVacio>
          ) : (
            <>
              {/* ── Rentabilidad ─────────────────────────────────────── */}
              {rentabilidad === null ? (
                <EstadoError mensaje="No pude leer los viajes y liquidaciones para medir la rentabilidad." />
              ) : rentabilidad.viajesConIngreso === 0 ? (
                <EstadoVacio>
                  Ningún viaje trae ingreso de flete capturado todavía — sin ese dato el margen
                  no se calcula (y no se estima con el anticipo: eso es lo que la empresa le
                  adelanta al operador, no lo que cobra).
                </EstadoVacio>
              ) : (
                <section className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard
                      icono={<Banknote width={14} height={14} strokeWidth={1.75} />}
                      etiqueta="Ingreso de fletes capturado" valor={rentabilidad.ingreso} formato="mxn"
                    />
                    <StatCard
                      icono={<ReceiptText width={14} height={14} strokeWidth={1.75} />}
                      etiqueta="Costo comprobado por operadores" valor={rentabilidad.costoComprobado} formato="mxn"
                    />
                    <StatCard
                      icono={<TrendingUp width={14} height={14} strokeWidth={1.75} />}
                      etiqueta="Utilidad (ingreso − comprobado)" valor={rentabilidad.utilidad} formato="mxn"
                    />
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    {rentabilidad.margenPct !== null
                      ? `Margen: ${rentabilidad.margenPct}% — medido solo sobre los ${rentabilidad.viajesConIngreso} viajes con ingreso capturado.`
                      : 'Sin ingreso capturado, el margen no se calcula.'}
                    {rentabilidad.viajesSinIngreso > 0
                      && ` ${rentabilidad.viajesSinIngreso} viajes sin ingreso quedan fuera de esta medición.`}
                  </p>
                </section>
              )}

              {/* ── Cobranza a clientes ──────────────────────────────── */}
              {cobranza === null ? (
                <EstadoError mensaje="No pude leer las facturas emitidas para armar la cartera." />
              ) : cobranza.facturas.length === 0 ? (
                <EstadoVacio>
                  Aún no hay facturas emitidas registradas — al registrar la primera, aquí
                  aparece la cartera: cuánto te deben, qué ya venció y qué factura no tiene
                  condiciones de crédito pactadas.
                </EstadoVacio>
              ) : (
                <section className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <StatCard
                      icono={<Wallet width={14} height={14} strokeWidth={1.75} />}
                      etiqueta="Por cobrar (facturas vivas)" valor={cobranza.porCobrar} formato="mxn"
                    />
                    <StatCard
                      icono={<CalendarClock width={14} height={14} strokeWidth={1.75} />}
                      etiqueta="Vencido" valor={cobranza.vencido} formato="mxn"
                    />
                  </div>
                  {cobranza.sinCondiciones > 0 && (
                    <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
                      {cobranza.sinCondiciones === 1
                        ? '1 factura no tiene fecha de vencimiento porque su cliente no tiene crédito pactado — no entra al conteo de vencidas.'
                        : `${cobranza.sinCondiciones} facturas no tienen fecha de vencimiento porque su cliente no tiene crédito pactado — no entran al conteo de vencidas.`}
                    </p>
                  )}
                  <div className="card overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left" style={{ color: 'var(--muted)' }}>
                          <th className="px-3 py-2 font-medium">Folio</th>
                          <th className="px-3 py-2 font-medium">Cliente</th>
                          <th className="px-3 py-2 font-medium">Fecha</th>
                          <th className="px-3 py-2 font-medium text-right">Total</th>
                          <th className="px-3 py-2 font-medium text-right">Pagado</th>
                          <th className="px-3 py-2 font-medium text-right">Saldo</th>
                          <th className="px-3 py-2 font-medium">Vence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cobranza.facturas.map((f) => (
                          <tr key={f.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                            <td className="px-3 py-2">{f.folio ?? '—'}</td>
                            <td className="px-3 py-2">{f.cliente}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{fechaCorta(f.fecha)}</td>
                            <td className="px-3 py-2 text-right tabular">{mxn(f.total)}</td>
                            <td className="px-3 py-2 text-right tabular">{mxn(f.pagado)}</td>
                            <td className="px-3 py-2 text-right tabular font-medium">{mxn(f.saldo)}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {f.vencida
                                ? <span style={{ color: 'var(--bad)' }}>venció {fechaCorta(f.venceEn)}</span>
                                : (f.venceEn ? fechaCorta(f.venceEn) : 'sin condiciones')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
