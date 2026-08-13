import { ReceiptText, CheckCircle2, UserRound, Cog, CircleAlert, ShieldAlert } from 'lucide-react';
import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { enrutar, type Ruta } from '@/lib/likida/facturacion/enrutar';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { Dona } from '@/app/admin/charts';
import { BarraPagina } from '../../resumen-visual';

/** Topes de las listas — declarados en pantalla cuando recortan, nunca en
 *  silencio (los encabezados suman la lista COMPLETA). */
const MAX_TE_TOCA = 12;
const MAX_MINI = 5;

export interface ExtraAgenteFacturas {
  /** Gastos con CFDI ya amarrado (histórico). null = no se pudo contar. */
  conCfdi: number | null;
  /** ¿La emisión automática de verdad emite hoy (modo + mandato)? */
  emite: boolean;
}

/**
 * El render del Agente de Facturas (v2, 13-ago-2026: "que se entienda TODO
 * lo que hace el agente" + "¿qué tiene que hacer el jefe de flota?"). La
 * página se organiza con la MISMA regla que el código (`enrutar.ts`):
 *
 *   · TE TOCA A TI — cuenta del portal o bloqueo (CAPTCHA…): tu cola.
 *   · LA MÁQUINA SE ENCARGA — sin cuenta y con todo leído: monitoreo.
 *   · INCOMPLETOS — falta un dato o ya venció: se dice QUÉ falta.
 *
 * Nada se pinta que no salga de un ticket real; el modo de emisión se
 * declara (en ensayo no se promete emisión).
 */
export function VistaAgenteFacturas({ tickets, extra }: { tickets: TicketPorFacturar[]; extra: ExtraAgenteFacturas }) {
  // Orden por VENCIMIENTO real (no por fecha del ticket): vencidos arriba,
  // desconocidos al final. Cotas finitas — Infinity-Infinity da NaN.
  const orden = (t: TicketPorFacturar) =>
    t.caducidad.desconocido ? 1e9 : t.caducidad.vencido ? -1e9 : t.caducidad.diasRestantes;
  const ordenados = [...tickets].sort((a, b) => orden(a) - orden(b));

  // El reparto del código, tal cual: quién factura cada ticket.
  const rutas = ordenados.map((t) => ({ t, r: enrutar(t) }));
  const teToca = rutas.filter((x) => x.r.via === 'mensaje');
  const maquina = rutas.filter((x) => x.r.via === 'automatico');
  const incompletos = rutas.filter((x) => x.r.via === 'incompleto');
  const monto = (xs: typeof rutas) => xs.reduce((s, x) => s + x.t.monto, 0);

  const vencidos = ordenados.filter((t) => t.caducidad.vencido);
  const urgentes = ordenados.filter((t) => t.caducidad.urgente && !t.caducidad.vencido);
  const montoSinFactura = ordenados.reduce((s, t) => s + t.monto, 0);

  // Dónde se concentra el dinero sin factura (top 4 comercios + el resto).
  const porComercio = new Map<string, number>();
  for (const t of ordenados) {
    const k = t.comercio?.nombre ?? 'Sin identificar';
    porComercio.set(k, (porComercio.get(k) ?? 0) + t.monto);
  }
  const comerciosTop = [...porComercio.entries()].sort((a, b) => b[1] - a[1]);
  const donaComercios = comerciosTop.slice(0, 4).map(([etiqueta, valor]) => ({ etiqueta, valor }));
  const restoComercios = comerciosTop.slice(4).reduce((s, [, v]) => s + v, 0);
  if (restoComercios > 0) donaComercios.push({ etiqueta: 'Otros', valor: restoComercios });

  // Qué les falta a los incompletos, agregado (la primera falta de cada uno).
  const faltas = new Map<string, number>();
  for (const x of incompletos) {
    const f = (x.r as Extract<Ruta, { via: 'incompleto' }>).falta[0] ?? 'dato ilegible';
    faltas.set(f, (faltas.get(f) ?? 0) + 1);
  }
  const faltasTop = [...faltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Los bloqueos son la parte de "lo que hizo solo" que habla: la máquina se
  // rindió A PROPÓSITO (captcha, emisión sin confirmar) y dejó el porqué.
  const bloqueados = teToca.filter((x) => (x.r as Extract<Ruta, { via: 'mensaje' }>).motivo === 'bloqueado');

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Facturas"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Por facturar" valor={numero(ordenados.length)} nota="tickets sin CFDI, hoy" />
            <Kpi titulo="Monto sin factura" valor={mxn(montoSinFactura)} />
            <Kpi titulo="Urgentes (≤2 días)" valor={numero(urgentes.length)} tono={urgentes.length > 0 ? 'warn' : undefined} />
            <Kpi titulo="Vencidos" valor={numero(vencidos.length)} tono={vencidos.length > 0 ? 'bad' : undefined} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {/* ── TU COLA: lo único de esta página que espera una acción tuya ── */}
            <section className="card p-4 lg:col-span-2 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold">Te toca a ti</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Portales que piden TU cuenta, o donde la máquina se topó con un muro — con los datos ya leídos
                {monto(teToca) > 0 && <> · <span className="cifra-mono">{mxn(monto(teToca))}</span></>}
              </p>
              {teToca.length === 0 ? (
                <Leyenda icono={<CheckCircle2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ok)' }} />}>
                  Hoy no te toca capturar nada — lo demás lo trae la máquina o le falta un dato.
                </Leyenda>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left" style={{ color: 'var(--faint)' }}>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Comercio</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Concepto</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Monto</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Plazo</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Por qué tú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teToca.slice(0, MAX_TE_TOCA).map(({ t, r }) => {
                          const m = r as Extract<Ruta, { via: 'mensaje' }>;
                          return (
                            <tr key={t.gastoId} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                              <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaCorta(t.fecha)}</td>
                              <td className="py-2 font-medium">
                                {t.comercio?.nombre}
                                <span className="block text-[11px] font-normal" style={{ color: 'var(--faint)' }}>{m.portal}</span>
                              </td>
                              <td className="py-2">{etiquetaConcepto(t.concepto)}</td>
                              <td className="py-2 pr-6 text-right cifra-mono">{mxn(t.monto)}</td>
                              <td className="py-2"><PillPlazo c={t.caducidad} /></td>
                              <td className="py-2">
                                {m.motivo === 'requiere_cuenta' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                                    style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
                                    <UserRound width={11} height={11} strokeWidth={2} /> Tu cuenta
                                  </span>
                                ) : (
                                  <span title={m.detalle} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                                    style={{ color: 'var(--warn)', background: 'var(--warnbg)' }}>
                                    <ShieldAlert width={11} height={11} strokeWidth={2} /> Bloqueado
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {teToca.length > MAX_TE_TOCA && (
                    <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
                      Se muestran los {MAX_TE_TOCA} que vencen primero — hay {numero(teToca.length - MAX_TE_TOCA)} más
                      (el encabezado los suma todos).
                    </p>
                  )}
                </>
              )}
            </section>

            {/* ── Lo que hizo solo ── */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold mb-3">Lo que hizo solo</h2>
              {extra.conCfdi !== null && (
                <p className="text-[12.5px] mb-2">
                  <span className="cifra-mono text-[20px] font-medium block">{numero(extra.conCfdi)}</span>
                  <span style={{ color: 'var(--faint)' }}>tickets con factura ya amarrada — emitida sola o pescada
                    del XML que mandaron, histórico.</span>
                </p>
              )}
              {bloqueados.length > 0 && (
                <div className="space-y-2 text-[12.5px] pt-2 border-t" style={{ borderColor: 'var(--line2)' }}>
                  {bloqueados.slice(0, MAX_MINI).map(({ t, r }) => (
                    <div key={t.gastoId} className="flex items-start gap-2">
                      <ShieldAlert width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
                      <span>
                        Se rindió a propósito con <span className="font-medium">{t.comercio?.nombre}</span>{' '}
                        ({(r as Extract<Ruta, { via: 'mensaje' }>).detalle ?? 'muro del portal'}) y te lo dejó listo
                        {t.bloqueo && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{fechaCorta(t.bloqueo.desde)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {extra.conCfdi === null && bloqueados.length === 0 && (
                <Leyenda>No se pudo leer el acumulado ahora mismo.</Leyenda>
              )}
              {extra.conCfdi === 0 && bloqueados.length === 0 && (
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Aún no amarra su primera factura en esta flota — en cuanto emita una o pesque un
                  XML, aquí se cuenta.
                </p>
              )}
            </section>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {/* ── Monitoreo: lo que NO tienes que hacer ── */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold">La máquina se encarga</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                {extra.emite
                  ? 'Sin cuenta y con todo leído: los factura sola en la próxima corrida'
                  : 'La emisión hoy está en ensayo (llena el portal sin emitir) — puedes capturarlos tú con los datos ya listos'}
              </p>
              {maquina.length === 0 ? (
                <Leyenda>Nada en la cola automática ahora mismo.</Leyenda>
              ) : (
                <>
                  <div className="cifra-mono text-[20px] font-medium mb-2">{numero(maquina.length)} · {mxn(monto(maquina))}</div>
                  <div className="space-y-1.5">
                    {maquina.slice(0, MAX_MINI).map(({ t }) => (
                      <div key={t.gastoId} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate" style={{ color: 'var(--muted)' }}>
                          <Cog width={11} height={11} strokeWidth={2} className="inline mr-1 -mt-0.5" />
                          {t.comercio?.nombre} · {etiquetaConcepto(t.concepto)}
                        </span>
                        <span className="cifra-mono shrink-0">{mxn(t.monto)}</span>
                      </div>
                    ))}
                    {maquina.length > MAX_MINI && (
                      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>y {numero(maquina.length - MAX_MINI)} más — el total de arriba los suma todos.</p>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* ── Incompletos: se dice QUÉ falta ── */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold">Incompletos</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>Ni tú ni la máquina pueden con lo que hay — esto es lo que falta</p>
              {incompletos.length === 0 ? (
                <Leyenda>Ninguno — todo ticket sin factura tiene con qué facturarse.</Leyenda>
              ) : (
                <>
                  <div className="cifra-mono text-[20px] font-medium mb-2">{numero(incompletos.length)} · {mxn(monto(incompletos))}</div>
                  <div className="space-y-1.5">
                    {faltasTop.map(([f, n]) => (
                      <div key={f} className="flex items-start justify-between gap-2 text-[12px]">
                        <span style={{ color: 'var(--muted)' }}>
                          <CircleAlert width={11} height={11} strokeWidth={2} className="inline mr-1 -mt-0.5" />
                          {f}
                        </span>
                        <span className="cifra-mono shrink-0">{numero(n)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* ── Dónde está el dinero sin factura ── */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold">Sin factura, por comercio</h2>
              <p className="text-[11px] mb-2" style={{ color: 'var(--faint)' }}>Dónde se concentra el monto pendiente</p>
              {donaComercios.length === 0 ? (
                <Leyenda>Ningún gasto sin factura — cuando entre un comprobante sin CFDI, aquí se reparte.</Leyenda>
              ) : (
                <>
                  <Dona segmentos={donaComercios} />
                  <div className="mt-2 space-y-1">
                    {donaComercios.map((c) => (
                      <div key={c.etiqueta} className="flex items-center justify-between text-[12px]">
                        <span style={{ color: 'var(--muted)' }}>{c.etiqueta}</span>
                        <span className="cifra-mono">{mxn(c.valor)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Leyenda de vacío/pendiente — centrada por alto y ancho, como TODAS las
 *  leyendas del panel. */
function Leyenda({ children, icono }: { children: React.ReactNode; icono?: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-[110px] flex items-center justify-center">
      <div className="text-center max-w-[32ch]">
        {icono && <div className="flex justify-center mb-2">{icono}</div>}
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{children}</p>
      </div>
    </div>
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
