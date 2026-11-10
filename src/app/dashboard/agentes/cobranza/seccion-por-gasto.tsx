import { FileWarning } from 'lucide-react';
import type { ConfigGasto, PlanCobroGasto, ItemCobro } from '@/lib/likida/agentes/cobranza_gasto_pura';
import { ROTULO_MOTIVO, ROTULO_CONCEPTO_COBRANZA } from '@/lib/likida/agentes/cobranza_gasto_pura';
import type { TableroGastos } from '@/lib/likida/agentes/cobranza_gasto';
import { numero, mxn, fechaCorta } from '@/lib/formato';
import { FormaPorGasto } from './forma-por-gasto';
import type { AccionSimple } from './controles';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { Disclosure, EstadoVacio, FilaTarjetas, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import '../agentes.css';
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

  const COLS: readonly ColumnaBase<ItemCobro>[] = [
    { id: 'viaje', titulo: 'Viaje', principal: true, celda: (i) => i.folioViaje ?? 'Sin folio' },
    {
      id: 'gasto', titulo: 'Gasto',
      celda: (i) => <>{ROTULO_CONCEPTO_COBRANZA[i.concepto] ?? i.concepto} <span className="cifra-mono">{mxn(i.monto)}</span>{i.fecha ? ` · ${fechaCorta(i.fecha)}` : ''}</>,
    },
    { id: 'falta', titulo: 'Qué falta', celda: (i) => <StatusChip tono="warn">{ROTULO_MOTIVO[i.motivo]}</StatusChip> },
    { id: 'chofer', titulo: 'Chofer', celda: (i) => i.operadorNombre ?? 'Sin nombre' },
    { id: 'dias', titulo: 'Días', alinear: 'der', celda: (i) => numero(i.dias) },
    { id: 'tier', titulo: 'Siguiente aviso', alinear: 'der', celda: (i) => (i.tier !== null ? `toca hoy (tier ${i.tier})` : 'esperando su tier') },
  ];

  return (
    <Tarjeta titulo="Cobranza por gasto" info="cobranza.gasto">
      <p className="rv-ag-notif__nota">
        Qué comprobante falta de qué gasto, con un solo mensaje por chofer y su tope diario.{' '}
        {config.porGasto
          ? 'Encendida: los viajes con gastos pendientes se cobran por gasto.'
          : 'Apagada: el agente cobra por viaje. Enciéndela abajo para cobrar gasto por gasto.'}
      </p>

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
      <Disclosure titulo="Qué falta, gasto por gasto" resumen={`${numero(plan.pendientes.length)} gastos`} abierto={plan.pendientes.length > 0}>
        {plan.pendientes.length === 0 ? (
          <EstadoVacio titulo="Nada por comprobar" icono={FileWarning} contenido>
            {config.porGasto
              ? 'Todos los gastos de los viajes abiertos tienen su comprobante.'
              : 'Ningún gasto de los viajes abiertos tiene un comprobante faltante a la vista. Cuando el cobro por gasto esté encendido, cada faltante aparece aquí.'}
          </EstadoVacio>
        ) : (
          <>
            <TablaBase etiqueta="Comprobantes faltantes por gasto" columnas={COLS} filas={plan.pendientes.slice(0, MAX_FILAS)} idFila={(i) => i.gastoId} densa tarjetaMovil />
            {plan.pendientes.length > MAX_FILAS && (
              <p className="rv-ag-notif__nota">…y {numero(plan.pendientes.length - MAX_FILAS)} gastos más (los más atrasados están arriba).</p>
            )}
          </>
        )}
      </Disclosure>

      <FilaTarjetas variante="6-6">
        {/* ── Efectividad ── */}
        <Tarjeta titulo="Efectividad por tier y por motivo" info="cobranza.gasto_efectividad_desglose"
          estado={ef === null ? 'error' : ef.avisos === 0 ? 'vacio' : 'ok'}
          mensaje={ef === null ? 'No se pudo leer la efectividad ahora mismo.' : 'Aún sin avisos por gasto'}
          detalle="Cada aviso que salga se mide aquí: cuántos produjeron el comprobante y en cuánto tiempo.">
          {ef !== null && ef.avisos > 0 && (
            <>
              <Mini titulo="Por tier (días)" filas={ef.porTier.map((t) => [`${t.tier} días`, t.avisos, t.resueltos])} />
              <Mini titulo="Por motivo" filas={ef.porMotivo.map((m) => [ROTULO_MOTIVO[m.motivo], m.avisos, m.resueltos])} />
              {ef.cerradosSinResolver > 0 && (
                <p className="rv-ag-notif__nota">
                  {numero(ef.cerradosSinResolver)} aviso{ef.cerradosSinResolver === 1 ? '' : 's'} terminaron con el viaje cerrado y el comprobante aún faltando.
                </p>
              )}
            </>
          )}
        </Tarjeta>

        {/* ── Bitácora por gasto ── */}
        <Tarjeta titulo="Últimos avisos por gasto" info="cobranza.gasto_bitacora"
          estado={tablero === null ? 'error' : tablero.bitacora.length === 0 ? 'vacio' : 'ok'}
          mensaje={tablero === null ? 'No se pudo leer la bitácora ahora mismo.' : 'Aún sin avisos por gasto'}
          detalle="Cada intento queda escrito aquí, salga o no.">
          {tablero !== null && tablero.bitacora.map((c) => (
            <p key={`${c.gastoId}-${c.tier}`} className="rv-ag-notif__nota">
              <strong>{c.operadorNombre ?? 'Chofer'}</strong>
              {' — '}
              {c.concepto ? (ROTULO_CONCEPTO_COBRANZA[c.concepto] ?? c.concepto) : 'gasto'}
              {c.monto !== null && <> <span className="cifra-mono">{mxn(c.monto)}</span></>}
              {c.folioViaje && <> (viaje {c.folioViaje})</>}
              : {ROTULO_MOTIVO[c.motivo]}, tier {c.tier}.{' '}
              {c.enviado
                ? <StatusChip tono="ok">Enviado{c.via === 'plantilla' ? ' por plantilla' : ''}</StatusChip>
                : <StatusChip tono="bad">No salió{c.detalle ? ` — ${c.detalle}` : ''}</StatusChip>}
              {c.resueltoPor === 'chofer' && <> <StatusChip tono="ok">Ya llegó el comprobante</StatusChip></>}
              {c.resueltoPor === 'cierre' && <> <StatusChip tono="warn">El viaje se cerró sin él</StatusChip></>}
              {' · '}{fechaCorta(c.cuando)}
            </p>
          ))}
        </Tarjeta>
      </FilaTarjetas>

      <Disclosure titulo="Configuración de la cobranza por gasto" resumen={config.porGasto ? 'Encendida' : 'Apagada'}>
        <FormaPorGasto config={config} ejemplo={ejemplo} firma={firma} instrucciones={instrucciones} guardar={guardar} />
      </Disclosure>
    </Tarjeta>
  );
}

function Mini({ titulo, filas }: { titulo: string; filas: Array<[string, number, number]> }) {
  return (
    <dl className="rv-ag-mini">
      <dt className="rv-ag-notif__rotulo">{titulo}</dt>
      {filas.map(([rotulo, avisos, resueltos]) => (
        <div key={rotulo} className="rv-ag-mini__fila">
          <dd>{rotulo}</dd>
          <dd className="cifra-mono">{numero(resueltos)} de {numero(avisos)} con comprobante</dd>
        </div>
      ))}
    </dl>
  );
}
