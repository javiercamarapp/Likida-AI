import { Cpu, DollarSign, Bot, Activity } from 'lucide-react';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getConsumoPorAgente, getPresupuestoPorProposito, type Insight, type GastoProposito } from '@/lib/admin/consumo';
import { ahoraMs } from '@/lib/saludo';
import { usd } from '@/lib/utils';
import { numero } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, VerMas, EstadoError, type Estado } from '../ui/kit';
import { StatusPill } from '../ui/kit';
import { AreaChartSimple } from '../charts';
import { IconoProveedor } from '../proveedor-icono';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/consumo — A DÓNDE Y POR QUÉ SE VA EL DINERO DE IA (16-ago-2026).
// Por agente (agente_corrida.costo_usd, 0123), por modelo y por fase
// (llm_costo vía la agregación SQL), con la serie diaria y los INSIGHTS
// deterministas — cada uno una regla con su dato, jamás un LLM opinando.
// ═══════════════════════════════════════════════════════════════════════════

const PILL_TIPO: Record<Insight['tipo'], { estado: Estado; rotulo: string }> = {
  problema: { estado: 'bad', rotulo: 'Problema' },
  recomendacion: { estado: 'warn', rotulo: 'Recomendación' },
  insight: { estado: 'neutral', rotulo: 'Insight' },
};

export default async function ConsumoPage() {
  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;
  // Resiliencia POR SECCIÓN: el gasto del producto (llm_costo) y el del back
  // office (agente_corrida.costo_usd, 0123) caen por su lado — con la 0123
  // sin aplicar, la mitad de producto sigue viva y la de agentes LO DICE.
  const [r, consumo, proposito] = await Promise.all([
    getResumenNegocio().catch(() => null),
    getConsumoPorAgente(ahoraMs()).catch(() => null),
    // D.23: el presupuesto por propósito cae por su lado; sin la 0244 la
    // sección LO DICE en vez de pintar ceros.
    getPresupuestoPorProposito().catch(() => null),
  ]);
  if (r === null && consumo === null) {
    return (
      <main className="p-5">
        <EstadoError mensaje="No se pudo leer el consumo — la base no respondió. Esto NO significa que la IA salga gratis." />
      </main>
    );
  }
  const datosCosto = (r?.porDia ?? []).map((d) => ({ dia: d.dia, valor: d.costoUsd }));
  const problemas = (consumo?.insights ?? []).filter((i) => i.tipo === 'problema');
  const resto = (consumo?.insights ?? []).filter((i) => i.tipo !== 'problema');

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Cpu {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Consumo de IA — por agente y modelo"
        />

        <div className="px-5 py-4 flex-1 space-y-2.5">
          {/* ── KPIs del gasto, con su tendencia real ─────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {r ? (
              <>
                <StatCard icono={<DollarSign {...ICONO} />} etiqueta="Gastado en IA — histórico" valor={r.costoIaUsd} formato="usd"
                  delta={r.tendenciaCosto === null ? null : { pct: r.tendenciaCosto, bueno: r.tendenciaCosto < 0 }}
                  deltaNota="últimos 7 días vs los 7 anteriores" />
                <StatCard icono={<Cpu {...ICONO} />} etiqueta="Tokens usados — histórico" valor={r.tokensIn + r.tokensOut} formato="numero"
                  delta={r.tendenciaTokens === null ? null : { pct: r.tendenciaTokens, bueno: r.tendenciaTokens < 0 }}
                  deltaNota="últimos 7 días vs los 7 anteriores" />
              </>
            ) : (
              <div className="card p-3.5 col-span-2"><p className="text-[12.5px] m-0" style={{ color: 'var(--muted)' }}>El gasto del producto (llm_costo) no se pudo leer ahora mismo.</p></div>
            )}
            {consumo ? (
              <>
                <StatCard icono={<Bot {...ICONO} />} etiqueta="Corridas de agentes — 30 días"
                  valor={consumo.agentes.reduce((s, a) => s + a.corridas30d, 0)} formato="entero"
                  nota={`${numero(consumo.agentes.reduce((s, a) => s + a.fallos30d, 0))} en fallo`} />
                <StatCard icono={<Activity {...ICONO} />} etiqueta="Back office — 30 días (medido 0123)"
                  valor={consumo.agentes.reduce((s, a) => s + a.gastado30dUsd, 0)} formato="usd"
                  nota="agente_corrida.costo_usd; el copiloto va al log" />
              </>
            ) : (
              <div className="card p-3.5 col-span-2"><p className="text-[12.5px] m-0" style={{ color: 'var(--muted)' }}>La medición por agente no se pudo leer — con la migración 0123 sin aplicar, es lo esperado.</p></div>
            )}
          </div>

          {/* ── Problemas ARRIBA: si algo está mal hoy, abre la página ────── */}
          {problemas.length > 0 && (
            <div className="space-y-1.5">
              {problemas.map((i) => (
                <div key={i.titulo} className="card p-3 flex items-start gap-2.5" style={{ borderColor: 'var(--bad)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--bad)' }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium m-0">{i.titulo}</p>
                    <p className="text-[12px] m-0 mt-0.5" style={{ color: 'var(--muted)' }}>{i.detalle}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Por AGENTE — el gasto del back office con su techo ────────── */}
          <div className="card p-4">
            <TituloSeccion>Por agente — gasto medido vs techo declarado</TituloSeccion>
            {consumo === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>
                No se pudo leer la medición por agente. Con la migración 0123 sin aplicar a esta base,
                es lo esperado — la columna del costo por corrida nace ahí.
              </p>
            ) : (
            // FE-19: la tabla scrollea DENTRO de su tarjeta. Sin esto, una
            // fila ancha estira el layout y el scroll horizontal aparece en
            // toda la página — la regla de "wide content" del repo.
            <div className="overflow-x-auto mt-2">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: 'var(--line)' }}>
                  <th className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Agente</th>
                  <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Corridas 30d</th>
                  <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Fallos</th>
                  <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Gasto 30d</th>
                  <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Hoy vs techo</th>
                </tr>
              </thead>
              <tbody>
                {consumo!.agentes.map((a) => (
                  <tr key={a.agente} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                    <td className="py-2">
                      <span className="cifra-mono">{a.agente}</span>
                      <span className="ml-1.5"><StatusPill estado={a.estado === 'vivo' ? 'ok' : 'neutral'}>{a.estado}{a.runnerHabilitado ? ' · runner' : ''}</StatusPill></span>
                    </td>
                    <td className="py-2 text-right tabular">{numero(a.corridas30d)}</td>
                    <td className="py-2 text-right tabular" style={a.fallos30d > 0 ? { color: 'var(--bad)' } : undefined}>{numero(a.fallos30d)}</td>
                    <td className="py-2 text-right tabular">{usd(a.gastado30dUsd)}</td>
                    <td className="py-2 text-right">
                      {a.techoDiaUsd === null ? (
                        <span style={{ color: 'var(--muted)' }}>sin techo declarado</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block w-16 h-1 rounded-full overflow-hidden align-middle" style={{ background: 'var(--line2)' }}>
                            <span className="block h-full rounded-full" style={{ width: `${a.pctTechoHoy ?? 0}%`, background: (a.pctTechoHoy ?? 0) >= 80 ? 'var(--bad)' : 'var(--marca)' }} />
                          </span>
                          <span className="tabular text-[11.5px]">{a.pctTechoHoy}% de {usd(a.techoDiaUsd)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            )}
          </div>

          {/* ── D.23 · Por PROPÓSITO — la reserva del camino interactivo ──── */}
          <div className="card p-4">
            <TituloSeccion>Presupuesto de IA por propósito — hoy, con su techo</TituloSeccion>
            {proposito === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>
                No se pudo leer el gasto por propósito. Con la migración 0244 sin aplicar a esta base,
                es lo esperado — la dimensión de propósito nace ahí.
              </p>
            ) : (
              <>
                <p className="text-[12px] mt-1 m-0" style={{ color: 'var(--muted)' }}>
                  Techo diario por flota: <span className="tabular">{usd(proposito.topeTenantDiaUsd)}</span> ·
                  reserva del camino interactivo (chofer y chats): <span className="tabular">{usd(proposito.reservaInteractivoUsd)}</span>
                  {' '}({Math.round(proposito.fraccionReserva * 100)}%) — el fondo (OCR de lote y agentes) solo llega a
                  {' '}<span className="tabular">{usd(proposito.topeTenantDiaUsd - proposito.reservaInteractivoUsd)}</span>.
                </p>
                {proposito.filas.length === 0 ? (
                  <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>Hoy nadie ha gastado todavía (día de México).</p>
                ) : (
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left border-b" style={{ borderColor: 'var(--line)' }}>
                          <th className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Flota</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Propósito</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Llamadas</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Liquidado hoy</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Reservado vivo</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>vs su techo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proposito.filas.map((f: GastoProposito) => {
                          // El techo del propósito: el fondo tiene (tope − reserva); el interactivo, el tope completo.
                          const techo = f.proposito === 'interactivo'
                            ? proposito.topeTenantDiaUsd
                            : proposito.topeTenantDiaUsd - proposito.reservaInteractivoUsd;
                          const usado = f.liquidadoUsd + f.reservadoVivoUsd;
                          const pct = techo > 0 ? Math.min(100, Math.round((usado / techo) * 100)) : 100;
                          return (
                            <tr key={`${f.tenantId}-${f.proposito}`} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                              <td className="py-2">{f.tenantNombre}</td>
                              <td className="py-2"><span className="cifra-mono">{f.proposito}</span></td>
                              <td className="py-2 text-right tabular">{numero(f.n)}</td>
                              <td className="py-2 text-right tabular">{usd(f.liquidadoUsd)}</td>
                              <td className="py-2 text-right tabular">{usd(f.reservadoVivoUsd)}</td>
                              <td className="py-2 text-right">
                                <span className="inline-flex items-center gap-2">
                                  <span className="inline-block w-16 h-1 rounded-full overflow-hidden align-middle" style={{ background: 'var(--line2)' }}>
                                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 80 ? 'var(--bad)' : 'var(--marca)' }} />
                                  </span>
                                  <span className="tabular text-[11.5px]">{pct}% de {usd(techo)}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {/* ── Por MODELO (producto, llm_costo) ─────────────────────────── */}
            <div className="card p-4">
              <TituloSeccion>Por modelo — el gasto del producto</TituloSeccion>
              <div className="mt-2 space-y-1.5">
                {!r || r.porModelo.length === 0 ? (
                  <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>Cero llamadas registradas en llm_costo.</p>
                ) : r.porModelo.slice(0, 8).map((m) => (
                  <div key={m.modelo} className="flex items-center gap-2.5 text-[12.5px]">
                    <IconoProveedor modelo={m.modelo} />
                    <span className="cifra-mono truncate flex-1 min-w-0">{m.modelo}</span>
                    <span style={{ color: 'var(--muted)' }}>{numero(m.n)} llamadas</span>
                    <span className="tabular font-medium">{usd(m.costoUsd)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-end"><VerMas href="/admin/costos-facturacion">Ver costos completos</VerMas></div>
            </div>

            {/* ── Por FASE ─────────────────────────────────────────────────── */}
            <div className="card p-4">
              <TituloSeccion>Por fase — en qué trabajo se gasta</TituloSeccion>
              <div className="mt-2 space-y-1.5">
                {!r || r.porFase.length === 0 ? (
                  <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>Cero llamadas registradas.</p>
                ) : r.porFase.slice(0, 8).map((f) => (
                  <div key={f.fase} className="flex items-center gap-2.5 text-[12.5px]">
                    <span className="cifra-mono truncate flex-1 min-w-0">{f.fase}</span>
                    <span style={{ color: 'var(--muted)' }}>{numero(f.n)} llamadas</span>
                    <span className="tabular font-medium">{usd(f.costoUsd)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── La serie diaria ───────────────────────────────────────────── */}
          <div className="card p-4">
            <TituloSeccion>Gasto de IA por día</TituloSeccion>
            <div className="mt-2">
              {datosCosto.length > 1 ? (
                <AreaChartSimple datos={datosCosto} etiquetaValor={usd} />
              ) : (
                <p className="text-sm py-8 text-center m-0" style={{ color: 'var(--muted)' }}>Sin historial suficiente todavía.</p>
              )}
            </div>
          </div>

          {/* ── Insights y recomendaciones (reglas con dato, no opiniones) ── */}
          {resto.length > 0 && (
            <div className="card p-4">
              <TituloSeccion>Insights y recomendaciones — reglas deterministas</TituloSeccion>
              <div className="mt-2 space-y-2">
                {resto.map((i) => (
                  <div key={i.titulo} className="flex items-start gap-2.5 text-[12.5px]">
                    <StatusPill estado={PILL_TIPO[i.tipo].estado}>{PILL_TIPO[i.tipo].rotulo}</StatusPill>
                    <div className="min-w-0">
                      <p className="m-0 font-medium">{i.titulo}</p>
                      <p className="m-0 mt-0.5" style={{ color: 'var(--muted)' }}>{i.detalle}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
