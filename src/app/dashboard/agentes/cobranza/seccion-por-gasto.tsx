import { FileWarning, Gauge } from 'lucide-react';
import type { ConfigGasto, PlanCobroGasto, ItemCobro } from '@/lib/likida/agentes/cobranza_gasto_pura';
import { ROTULO_MOTIVO, ROTULO_CONCEPTO_COBRANZA } from '@/lib/likida/agentes/cobranza_gasto_pura';
import type { TableroGastos } from '@/lib/likida/agentes/cobranza_gasto';
import { numero, mxn, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '../../estados';
import { FormaPorGasto } from './forma-por-gasto';
import type { AccionSimple } from './controles';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { TituloRecuadro } from '@/app/ui-v2/componentes';
import { selloHoy } from '@/app/dashboard/sello-hoy';

const MAX_FILAS = 40;

/**
 * LA COBRANZA POR GASTO (0525) — el tablero del Agente 7: qué comprobante falta de qué gasto, a quién le toca
 * hoy, y qué tan efectivo es el aviso. Presentacional y en el servidor: recibe todo resuelto.
 *
 * Una cifra de efectividad es una medición o no se muestra: con menos de 5 avisos enviados dice «aún pocos
 * datos» en vez de un porcentaje de 2 casos, y la mediana sin ninguna resolución es «—», no «0 h».
 */
export function SeccionPorGasto({ config, plan, tablero, firma, instrucciones, guardar }: {
  config: ConfigGasto;
  plan: PlanCobroGasto;
  /** null = no se pudo leer: se DICE, no se pinta «sin avisos». */
  tablero: TableroGastos | null;
  firma: string;
  instrucciones: string;
  guardar: AccionSimple;
}) {
  const hoy = plan.paraContactar.reduce((n, g) => n + g.items.length, 0);
  const ef = tablero?.efectividad ?? null;
  const ejemplo: ItemCobro[] = plan.paraContactar[0]?.items.slice(0, 2) ?? [];

  return (
    <section className="card p-4 space-y-4" aria-labelledby="cobranza-por-gasto">
      <div>
        <TituloRecuadro id="cobranza-por-gasto" info="cobranza.gasto">Cobranza por gasto</TituloRecuadro>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>
          Qué comprobante falta de qué gasto, con un solo mensaje por chofer y su tope diario.{' '}
          {config.porGasto
            ? 'Encendida: los viajes con gastos pendientes se cobran por gasto.'
            : 'Apagada: el agente cobra por viaje. Enciéndela abajo para cobrar gasto por gasto.'}
        </p>
      </div>

      <TiraCifras sello={selloHoy('Gastos de los viajes')}>
        <Cifra info="cobranza.gasto_sin_comprobante" etiqueta="Gastos sin comprobante" valor={numero(plan.pendientes.length)} nota="en viajes abiertos o en cuadre" />
        <Cifra info="cobranza.gasto_les_toca_hoy" etiqueta="Les toca hoy" valor={numero(hoy)} nota={`${numero(plan.paraContactar.length)} choferes, un mensaje cada uno`} />
        <Cifra info="cobranza.gasto_sin_telefono" etiqueta="Sin teléfono" valor={numero(plan.sinTelefono.reduce((n, g) => n + g.items.length, 0))}
          nota="gastos de choferes sin teléfono" tono={plan.sinTelefono.length > 0 ? 'warn' : undefined} />
        <Cifra info="cobranza.gasto_avisos" etiqueta="Avisos (30 días)" valor={ef ? numero(ef.avisos) : null} estado={ef ? 'ok' : 'error'} reintentar
          nota={ef ? `${numero(ef.abiertos)} aún abiertos` : undefined} />
        <Cifra info="cobranza.gasto_efectividad" etiqueta="Efectividad"
          valor={ef === null || ef.tasa === null ? null : `${numero(Math.round(ef.tasa * 100))} %`}
          estado={ef === null ? 'error' : 'ok'} reintentar
          mensaje={ef !== null && ef.tasa === null ? 'Aún hay pocos datos' : undefined}
          nota={ef === null ? undefined
            : ef.medianaHoras === null ? 'avisos que produjeron el comprobante'
              : `mediana ${numero(ef.medianaHoras)} h hasta el comprobante`} />
      </TiraCifras>

      {/* ── Qué comprobante falta de qué gasto ── */}
      <div>
        <TituloRecuadro nivel="h3" info="cobranza.gasto_faltantes" className="mb-2">Qué falta, gasto por gasto</TituloRecuadro>
        {plan.pendientes.length === 0 ? (
          <EstadoVacio icono={<FileWarning width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            {config.porGasto
              ? 'Todos los gastos de los viajes abiertos tienen su comprobante.'
              : 'Ningún gasto de los viajes abiertos tiene un comprobante faltante a la vista. Cuando el cobro por gasto esté encendido, cada faltante aparece aquí.'}
          </EstadoVacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--faint)' }}>
                  {['Viaje', 'Gasto', 'Qué falta', 'Chofer', 'Días', 'Siguiente aviso'].map((t, i) => (
                    <th key={t} className={`etiqueta-mono text-[11px] uppercase font-normal pb-2 ${i >= 4 ? 'text-right' : ''}`}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.pendientes.slice(0, MAX_FILAS).map((i) => (
                  <tr key={i.gastoId} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                    <td className="py-2 font-medium">{i.folioViaje ?? 'Sin folio'}</td>
                    <td className="py-2">
                      {ROTULO_CONCEPTO_COBRANZA[i.concepto] ?? i.concepto} <span className="cifra-mono">{mxn(i.monto)}</span>
                      {i.fecha && <span style={{ color: 'var(--faint)' }}> · {fechaCorta(i.fecha)}</span>}
                    </td>
                    <td className="py-2">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ color: 'var(--warn)', background: 'var(--warnbg)' }}>{ROTULO_MOTIVO[i.motivo]}</span>
                    </td>
                    <td className="py-2" style={{ color: 'var(--muted)' }}>{i.operadorNombre ?? 'Sin nombre'}</td>
                    <td className="py-2 text-right cifra-mono">{numero(i.dias)}</td>
                    <td className="py-2 text-right cifra-mono" style={{ color: 'var(--muted)' }}>
                      {i.tier !== null ? `toca hoy (tier ${i.tier})` : 'esperando su tier'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.pendientes.length > MAX_FILAS && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
                …y {numero(plan.pendientes.length - MAX_FILAS)} gastos más (los más atrasados están arriba).
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Efectividad ── */}
        <div>
          <TituloRecuadro nivel="h3" info="cobranza.gasto_efectividad_desglose" className="mb-2">
            <span className="inline-flex items-center gap-1.5">
              <Gauge width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} /> Efectividad por tier y por motivo
            </span>
          </TituloRecuadro>
          {ef === null ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer la efectividad ahora mismo.</p>
          ) : ef.avisos === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Aún sin avisos por gasto: cada aviso que salga se mide aquí — cuántos produjeron el comprobante y en cuánto tiempo.
            </p>
          ) : (
            <div className="space-y-3 text-[12px]">
              <Mini titulo="Por tier (días)" filas={ef.porTier.map((t) => [`${t.tier} días`, t.avisos, t.resueltos])} />
              <Mini titulo="Por motivo" filas={ef.porMotivo.map((m) => [ROTULO_MOTIVO[m.motivo], m.avisos, m.resueltos])} />
              {ef.cerradosSinResolver > 0 && (
                <p style={{ color: 'var(--muted)' }}>
                  {numero(ef.cerradosSinResolver)} aviso{ef.cerradosSinResolver === 1 ? '' : 's'} terminaron con el viaje cerrado y el comprobante aún faltando.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Bitácora por gasto ── */}
        <div>
          <TituloRecuadro nivel="h3" info="cobranza.gasto_bitacora" className="mb-2">Últimos avisos por gasto</TituloRecuadro>
          {tablero === null ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer la bitácora ahora mismo.</p>
          ) : tablero.bitacora.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Aún sin avisos por gasto — cada intento queda escrito aquí, salga o no.</p>
          ) : (
            <div className="space-y-2 text-[12px]">
              {tablero.bitacora.map((c) => (
                <div key={`${c.gastoId}-${c.tier}`}>
                  <span className="font-medium">{c.operadorNombre ?? 'Chofer'}</span>
                  {' — '}
                  {c.concepto ? (ROTULO_CONCEPTO_COBRANZA[c.concepto] ?? c.concepto) : 'gasto'}
                  {c.monto !== null && <> <span className="cifra-mono">{mxn(c.monto)}</span></>}
                  {c.folioViaje && <> (viaje {c.folioViaje})</>}
                  : {ROTULO_MOTIVO[c.motivo]}, tier {c.tier}.{' '}
                  {c.enviado
                    ? <span style={{ color: 'var(--ok)' }}>Enviado{c.via === 'plantilla' ? ' por plantilla' : ''}.</span>
                    : <span style={{ color: 'var(--bad)' }}>No salió{c.detalle ? ` — ${c.detalle}` : ''}.</span>}
                  {c.resueltoPor === 'chofer' && <span style={{ color: 'var(--ok)' }}> Ya llegó el comprobante.</span>}
                  {c.resueltoPor === 'cierre' && <span style={{ color: 'var(--warn)' }}> El viaje se cerró sin él.</span>}
                  <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{fechaCorta(c.cuando)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <TituloRecuadro nivel="h3" info="cobranza.gasto_config" className="mb-2">Configuración de la cobranza por gasto</TituloRecuadro>
        <FormaPorGasto config={config} ejemplo={ejemplo} firma={firma} instrucciones={instrucciones} guardar={guardar} />
      </div>
    </section>
  );
}


function Mini({ titulo, filas }: { titulo: string; filas: Array<[string, number, number]> }) {
  return (
    <div>
      <div className="etiqueta-mono text-[11px] uppercase mb-1" style={{ color: 'var(--faint)' }}>{titulo}</div>
      {filas.map(([rotulo, avisos, resueltos]) => (
        <div key={rotulo} className="flex items-center justify-between gap-3 py-0.5">
          <span>{rotulo}</span>
          <span className="cifra-mono" style={{ color: 'var(--muted)' }}>
            {numero(resueltos)} de {numero(avisos)} con comprobante
          </span>
        </div>
      ))}
    </div>
  );
}
