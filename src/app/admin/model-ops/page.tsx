import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/formato';
import { Settings2, ScanText, Calculator, MessagesSquare } from 'lucide-react';
import { Dona } from '../charts';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio } from '../ui/kit';
import { HBars } from '../ui/graficas';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = { ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', whatsapp: 'Agente de WhatsApp' };

/** Las TRES fases reales del pipeline — en ese orden, porque es el orden en
 *  el que de verdad corren para cada viaje. No hay una cuarta fase, ni un
 *  "crear agente nuevo": Likida no tiene tool-calling configurable, son
 *  pasos fijos en código. Los íconos son los mismos de `rutas.ts` para que
 *  cada fase se lea como la misma cosa que su página en el sidebar. */
const FASES = [
  { fase: 'ocr', nombre: 'Agente OCR', Icono: ScanText, queHace: 'Lee la foto de un comprobante (diésel, caseta, factura) y extrae monto, folio y CFDI.' },
  { fase: 'cuadre', nombre: 'Agente de Cuadre', Icono: Calculator, queHace: 'Compara los gastos ya capturados contra el anticipo y la política de la flota.' },
  { fase: 'whatsapp', nombre: 'Agente de WhatsApp', Icono: MessagesSquare, queHace: 'Lleva la conversación con el operador de principio a fin: recibe fotos, confirma y cierra la liquidación.' },
] as const;

/**
 * Model Ops — registro real de las 3 fases fijas del pipeline de Likida, no
 * un editor de agentes. No existe UI para crear/versionar/asignar modelo por
 * fase: eso sería funcionalidad decorativa que no hace nada, prohibido por
 * la regla del proyecto. Todo lo que se ve aquí sale de `llm_costo`
 * (`getResumenNegocio`/`getCostoPorFaseModelo`).
 *
 * Re-envuelta en la anatomía FlowAI (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts`; las fichas de fase son las fichas internas de
 * la consola (hairline sobre --surface). Cifras y fuente no cambian.
 */
export default async function ModelOpsPage() {
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  const porFaseMap = new Map(r.porFase.map((f) => [f.fase, f]));

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Settings2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Model Ops"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Registro de las 3 fases fijas del pipeline y su costo real</p>

          <div className="card p-3">
            <TituloSeccion>Registro de agentes</TituloSeccion>
            <div className="space-y-1.5 mt-2">
              {FASES.map(({ fase, nombre, Icono, queHace }) => {
                const datos = porFaseMap.get(fase);
                const modelos = porFaseModelo.filter((m) => m.fase === fase);
                return (
                  <div key={fase} className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
                    <div className="flex items-start gap-2.5">
                      <Icono width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="text-[13px] font-semibold">{nombre}</div>
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular">{datos ? usd(datos.costoUsd) : usd(0)}</div>
                            <div className="text-xs" style={{ color: 'var(--muted)' }}>{datos ? `${numero(datos.n)} llamadas` : 'sin llamadas'}</div>
                          </div>
                        </div>
                        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{queHace}</p>

                        {modelos.length > 0 ? (
                          <div className="mt-2 divide-y" style={{ borderColor: 'var(--line2)' }}>
                            {modelos.map((m) => (
                              <div key={m.modelo} className="py-2 flex items-center justify-between gap-3 text-xs">
                                <span className="font-mono truncate" style={{ color: 'var(--muted)' }}>{m.modelo}</span>
                                <span className="tabular shrink-0">{usd(m.costoUsd)} · {numero(m.n)} llamadas</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Sin llamadas registradas para esta fase todavía.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            <div className="card p-4">
              <TituloSeccion>Costo por fase</TituloSeccion>
              {r.porFase.length > 0 ? (
                <div className="mt-3">
                  <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
                </div>
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>Todavía no hay actividad de IA registrada.</div>
              )}
            </div>
            <div className="card p-4">
              <TituloSeccion>Costo por modelo — todas las fases</TituloSeccion>
              {r.porModelo.length === 0 ? (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>Sin llamadas registradas todavía.</div>
              ) : (
                <div className="mt-3">
                  <HBars datos={r.porModelo.map((m) => ({ etiqueta: m.modelo, valor: m.costoUsd }))} formato="usd" />
                </div>
              )}
            </div>
          </div>

          <div className="card p-3">
            <TituloSeccion>Roadmap</TituloSeccion>
            <div className="mt-2">
              <EstadoVacio>
                Versionado de prompts, rollback, guardrails configurables — Fase 2 del roadmap. Hoy los prompts viven en código
                (<code className="font-mono text-xs">src/lib/agents/prompts.ts</code>), sin historial de versiones ni UI de edición.
                No existe tampoco un selector de modelo por fase ni tenant: cambiar de modelo hoy es un cambio de código y un deploy.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
