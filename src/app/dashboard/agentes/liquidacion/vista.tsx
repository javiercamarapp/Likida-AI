import Link from 'next/link';
import { Bot, Route, ArrowRight, Inbox } from 'lucide-react';
import type { LiqRow, DashboardKpis } from '@/lib/likida/analytics';
import type { ResumenCostoIaTenant } from '@/lib/likida/costos';
import { mxn, usd, numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';

/**
 * El render del Agente de Liquidación de Ruta, separado de su puerta (page.tsx trae
 * sesión y no se puede mirar sin ella) — el patrón page/vista del repo,
 * que existe justo para poder verificar ESTE archivo con un screenshot.
 */
export function VistaAgenteLiquidacion({
  kpis, cola, cierres, costo, sufijo,
}: {
  kpis: DashboardKpis;
  cola: LiqRow[];
  cierres: LiqRow[];
  costo: { ok: ResumenCostoIaTenant } | { err: string };
  sufijo: string;
}) {
  // El costo del CHAT es de la otra página ("Chatea con tus datos") — aquí
  // se suma solo lo que gasta este agente, y se declara.
  const fasesAgente = 'ok' in costo ? costo.ok.porFase.filter((f) => f.fase !== 'chat') : [];
  const costoAgenteUsd = fasesAgente.reduce((s, f) => s + f.costoUsd, 0);
  const eventosAgente = fasesAgente.reduce((s, f) => s + f.n, 0);

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Route width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Liquidación de Ruta"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <p className="text-[13px] max-w-2xl" style={{ color: 'var(--muted)' }}>
            Recibe los comprobantes del operador por WhatsApp, los lee y los cuadra contra el
            anticipo y la política de la flota. Lo que no cuadra solo, cae aquí abajo para tu revisión.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Monto comprobado" valor={mxn(kpis.montoComprobado)} />
            <Kpi titulo="Tasa de cuadre" valor={`${numero(kpis.tasaCuadre)}%`} nota={`${numero(kpis.viajesLiquidados)} liquidaciones`} />
            <Kpi titulo="Por revisar" valor={numero(kpis.porRevisar)} tono={kpis.porRevisar > 0 ? 'warn' : undefined} />
            <Kpi titulo="Con diferencias" valor={numero(kpis.conDiferencias)} tono={kpis.conDiferencias > 0 ? 'bad' : undefined} />
          </div>

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-3">Esperan tu revisión</h2>
            {cola.length === 0 ? (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                No hay liquidaciones esperando a un humano — cuando el agente no pueda cuadrar
                una solo, la vas a ver aquí.
              </EstadoVacio>
            ) : (
              <TablaLiqs filas={cola} sufijo={sufijo} conVer />
            )}
          </section>

          <div className="grid lg:grid-cols-3 gap-4">
            <section className="card p-4 lg:col-span-2">
              <h2 className="font-display text-[15px] font-semibold mb-3">Últimos cierres</h2>
              {cierres.length === 0 ? (
                <EstadoVacio icono={<Bot width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  El agente todavía no cierra ninguna liquidación en esta flota.
                </EstadoVacio>
              ) : (
                <TablaLiqs filas={cierres} sufijo={sufijo} />
              )}
            </section>

            <section className="card p-4">
              <h2 className="font-display text-[15px] font-semibold mb-1">Costo del agente</h2>
              {'ok' in costo ? (
                <>
                  <div className="cifra-mono text-[22px] font-medium mt-2">{usd(costoAgenteUsd)}</div>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--faint)' }}>
                    {numero(eventosAgente)} lecturas de IA en total, histórico. No incluye el chat
                    de datos: ese se mide en su propia página.
                  </p>
                </>
              ) : (
                <p className="text-[12px] mt-2" style={{ color: 'var(--faint)' }}>
                  El costo de IA no se pudo leer ahora mismo — antes que enseñarte un cero que
                  nadie midió, se queda pendiente. ({costo.err})
                </p>
              )}
            </section>
          </div>
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

const ESTATUS: Record<string, { rotulo: string; fg: string; bg: string }> = {
  cuadrada: { rotulo: 'Cuadrada', fg: 'var(--ok)', bg: 'var(--okbg)' },
  con_diferencias: { rotulo: 'Con diferencias', fg: 'var(--bad)', bg: 'var(--badbg)' },
  revisar: { rotulo: 'Por revisar', fg: 'var(--warn)', bg: 'var(--warnbg)' },
};

function TablaLiqs({ filas, sufijo, conVer }: { filas: LiqRow[]; sufijo: string; conVer?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left" style={{ color: 'var(--faint)' }}>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Viaje</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Comprobado</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Diferencia</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estatus</th>
            {conVer && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {filas.map((l) => {
            const e = ESTATUS[l.estatus] ?? { rotulo: l.estatus, fg: 'var(--muted)', bg: 'var(--canvas)' };
            return (
              <tr key={l.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                <td className="py-2 font-medium">{l.folio}</td>
                <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaCorta(l.creadoEn)}</td>
                <td className="py-2 text-right cifra-mono">{mxn(l.comprobado)}</td>
                <td className="py-2 pr-6 text-right cifra-mono" style={l.diferencia !== 0 ? { color: 'var(--bad)' } : undefined}>
                  {mxn(l.diferencia)}
                </td>
                <td className="py-2">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ color: e.fg, background: e.bg }}>{e.rotulo}</span>
                </td>
                {conVer && (
                  <td className="py-2 text-right">
                    <Link href={`/dashboard/${l.id}${sufijo}`}
                      className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--marca)' }}>
                      Ver <ArrowRight width={12} height={12} strokeWidth={2} />
                    </Link>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
