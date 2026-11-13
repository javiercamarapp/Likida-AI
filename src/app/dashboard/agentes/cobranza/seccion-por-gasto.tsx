import { FileWarning } from 'lucide-react';
import type { ConfigGasto, PlanCobroGasto, ItemCobro } from '@/lib/likida/agentes/cobranza_gasto_pura';
import { ROTULO_MOTIVO, ROTULO_CONCEPTO_COBRANZA } from '@/lib/likida/agentes/cobranza_gasto_pura';
import type { TableroGastos } from '@/lib/likida/agentes/cobranza_gasto';
import { numero, mxn, fechaCorta } from '@/lib/formato';
import { FormaPorGasto } from './forma-por-gasto';
import type { AccionSimple } from './controles';
import { EstadoVacio, FilaTarjetas, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { TR_ES, selloHoyTr, type TrAgentes, type TAgentes } from '../i18n-agentes';
import '../agentes.css';
import '../../estados.css';
import './cobranza.css';

const MAX_FILAS = 40;

/**
 * LA COBRANZA POR GASTO (0525) — el tablero del Agente 7: qué comprobante falta de qué gasto, a quién le toca
 * hoy, y qué tan efectivo es el aviso. Presentacional y en el servidor: recibe todo resuelto.
 *
 * Una cifra de efectividad es una medición o no se muestra: con menos de 5 avisos enviados dice «aún pocos
 * datos» en vez de un porcentaje de 2 casos, y la mediana sin ninguna resolución es «—», no «0 h».
 */
export function SeccionPorGasto({ config, plan, tablero, tr = TR_ES }: {
  config: ConfigGasto;
  plan: PlanCobroGasto;
  /** null = no se pudo leer: se DICE, no se pinta «sin avisos». */
  tablero: TableroGastos | null;
  /** El traductor del namespace `agentes` (la página lo arma con `getT`). Sin él, español. */
  tr?: TrAgentes;
}) {
  const { t } = tr;
  const idioma = tr.idioma;
  const hoy = plan.paraContactar.reduce((n, g) => n + g.items.length, 0);
  const ef = tablero?.efectividad ?? null;

  const COLS: readonly ColumnaBase<ItemCobro>[] = [
    { id: 'viaje', titulo: t('cobranza.gasto.viaje'), principal: true, celda: (i) => i.folioViaje ?? t('cobranza.gasto.sin_folio') },
    {
      id: 'gasto', titulo: t('cobranza.gasto.gasto'),
      celda: (i) => <>{ROTULO_CONCEPTO_COBRANZA[i.concepto] ?? i.concepto} <span className="rv-cifra">{mxn(i.monto, idioma)}</span>{i.fecha ? ` · ${fechaCorta(i.fecha, idioma)}` : ''}</>,
    },
    { id: 'falta', titulo: t('cobranza.gasto.que_falta'), celda: (i) => <StatusChip tono="warn">{ROTULO_MOTIVO[i.motivo]}</StatusChip> },
    { id: 'chofer', titulo: t('cobranza.gasto.chofer'), celda: (i) => i.operadorNombre ?? t('cobranza.gasto.sin_nombre') },
    { id: 'dias', titulo: t('cobranza.gasto.dias'), alinear: 'der', celda: (i) => numero(i.dias) },
    { id: 'tier', titulo: t('cobranza.gasto.siguiente_aviso'), alinear: 'der', celda: (i) => (i.tier !== null ? t('cobranza.gasto.toca_hoy', { tier: i.tier }) : t('cobranza.gasto.esperando_tier')) },
  ];

  return (
    <>
      {/* Rovaq HB: UNA sola tira de cifras por página (la de arriba); el resumen por gasto va en una tarjeta con filas rótulo-valor. */}
      <Tarjeta titulo={t('cobranza.gasto.cobranza_por_gasto')} acciones={<span className="rv-ag-notif__nota">{selloHoyTr(tr, t('cobranza.gasto.gastos_de_los_viajes'))}</span>}>
        <p className="rv-ag-notif__nota">
          {t('cobranza.gasto.que_comprobante_falta_de_que', { estado: config.porGasto
            ? t('cobranza.gasto.encendida_los_viajes_con_gastos')
            : t('cobranza.gasto.apagada_el_agente_cobra_por') })}
        </p>
        <dl className="rv-cob__resumen">
          {([
            [t('cobranza.gasto.gastos_sin_comprobante'), numero(plan.pendientes.length), t('cobranza.gasto.en_viajes_abiertos_o_en')],
            [t('cobranza.gasto.les_toca_hoy'), numero(hoy), t('cobranza.gasto.choferes_un_mensaje', { n: numero(plan.paraContactar.length) })],
            [t('cobranza.gasto.sin_telefono'), numero(plan.sinTelefono.reduce((n, g) => n + g.items.length, 0)), t('cobranza.gasto.gastos_de_choferes_sin_telefono')],
            [t('cobranza.gasto.avisos_30_dias'), ef ? numero(ef.avisos) : '—', ef ? t('cobranza.gasto.aun_abiertos', { abiertos: numero(ef.abiertos) }) : ''],
            [t('cobranza.gasto.efectividad'), ef === null ? '—' : ef.tasa === null ? '—' : `${numero(Math.round(ef.tasa * 100))} %`,
              ef === null ? '' : ef.tasa === null ? t('cobranza.gasto.aun_hay_pocos_datos')
                : ef.medianaHoras === null ? t('cobranza.gasto.avisos_que_produjeron_el_comprobante') : t('cobranza.gasto.mediana_horas', { n: numero(ef.medianaHoras) })],
          ] as const).map(([rotulo, valor, nota]) => (
            <div key={rotulo} className="rv-cob__resumen-fila">
              <dt>{rotulo}</dt>
              <dd className="rv-cifra">{valor}</dd>
              {nota ? <dd className="rv-cob__resumen-nota">{nota}</dd> : null}
            </div>
          ))}
        </dl>
      </Tarjeta>

      {/* ── Qué comprobante falta de qué gasto ── */}
      <Tarjeta className="rv-tarjeta--tabla" titulo={t('cobranza.gasto.que_falta_gasto_por_gasto')} acciones={<span className="rv-ag-notif__nota">{t('cobranza.gasto.n_gastos', { n: numero(plan.pendientes.length) })}</span>}>
        {plan.pendientes.length === 0 ? (
          <EstadoVacio titulo={t('cobranza.gasto.nada_por_comprobar')} icono={FileWarning} contenido>
            {config.porGasto
              ? t('cobranza.gasto.todos_los_gastos_de_los')
              : t('cobranza.gasto.ningun_gasto_de_los_viajes')}
          </EstadoVacio>
        ) : (
          <>
            <TablaBase etiqueta={t('cobranza.gasto.comprobantes_faltantes_por_gasto')} columnas={COLS} filas={plan.pendientes.slice(0, MAX_FILAS)} idFila={(i) => i.gastoId} densa tarjetaMovil />
            {plan.pendientes.length > MAX_FILAS && (
              <p className="rv-ag-notif__nota">{t('cobranza.gasto.y_gastos_mas_los_mas', { n: numero(plan.pendientes.length - MAX_FILAS) })}</p>
            )}
          </>
        )}
      </Tarjeta>

      <FilaTarjetas variante="6-6">
        {/* ── Efectividad ── */}
        <Tarjeta titulo={t('cobranza.gasto.efectividad_por_tier_y_por')} info="cobranza.gasto_efectividad_desglose"
          estado={ef === null ? 'error' : ef.avisos === 0 ? 'vacio' : 'ok'}
          mensaje={ef === null ? t('cobranza.gasto.no_se_pudo_leer_la') : t('cobranza.gasto.aun_sin_avisos_por_gasto')}
          detalle={t('cobranza.gasto.cada_aviso_que_salga_se')}>
          {ef !== null && ef.avisos > 0 && (
            <>
              <Mini t={t} titulo={t('cobranza.gasto.por_tier_dias')} filas={ef.porTier.map((x) => [t('cobranza.gasto.dias_2', { tier: x.tier }), x.avisos, x.resueltos])} />
              <Mini t={t} titulo={t('cobranza.gasto.por_motivo')} filas={ef.porMotivo.map((m) => [ROTULO_MOTIVO[m.motivo], m.avisos, m.resueltos])} />
              {ef.cerradosSinResolver > 0 && (
                <p className="rv-ag-notif__nota">
                  {tr.tp('cobranza.gasto.cerrados', ef.cerradosSinResolver, { n: numero(ef.cerradosSinResolver) })}</p>
              )}
            </>
          )}
        </Tarjeta>

        {/* ── Bitácora por gasto ── */}
        <Tarjeta titulo={t('cobranza.gasto.ultimos_avisos_por_gasto')} info="cobranza.gasto_bitacora"
          estado={tablero === null ? 'error' : tablero.bitacora.length === 0 ? 'vacio' : 'ok'}
          mensaje={tablero === null ? t('cobranza.gasto.no_se_pudo_leer_la_2') : t('cobranza.gasto.aun_sin_avisos_por_gasto')}
          detalle={t('cobranza.gasto.cada_intento_queda_escrito_aqui')}>
          {tablero !== null && tablero.bitacora.map((c) => (
            <p key={`${c.gastoId}-${c.tier}`} className="rv-ag-notif__nota">
              <strong>{c.operadorNombre ?? t('cobranza.gasto.chofer')}</strong>
              {' — '}
              {c.concepto ? (ROTULO_CONCEPTO_COBRANZA[c.concepto] ?? c.concepto) : t('cobranza.gasto.gasto_generico')}
              {c.monto !== null && <> <span className="rv-cifra">{mxn(c.monto, idioma)}</span></>}
              {c.folioViaje && <> {t('cobranza.gasto.viaje_folio', { folio: c.folioViaje })}</>}
              : {ROTULO_MOTIVO[c.motivo]}, {t('cobranza.gasto.tier_n', { tier: c.tier })}.{' '}
              {c.enviado
                ? <StatusChip tono="ok">{c.via === 'plantilla' ? t('cobranza.gasto.enviado_plantilla') : t('cobranza.gasto.enviado')}</StatusChip>
                : <StatusChip tono="bad">{t('cobranza.gasto.no_salio', { detalle: c.detalle ? ` — ${c.detalle}` : '' })}</StatusChip>}
              {c.resueltoPor === 'chofer' && <> <StatusChip tono="ok">{t('cobranza.gasto.ya_llego_el_comprobante')}</StatusChip></>}
              {c.resueltoPor === 'cierre' && <> <StatusChip tono="warn">{t('cobranza.gasto.el_viaje_se_cerro_sin')}</StatusChip></>}
              {' · '}{fechaCorta(c.cuando, idioma)}
            </p>
          ))}
        </Tarjeta>
      </FilaTarjetas>
    </>
  );
}

/** El formulario de la cobranza por gasto: va en el cajón de configuración del agente, no en la pantalla. */
export function ConfigPorGasto({ config, plan, firma, instrucciones, guardar, tr = TR_ES }: {
  config: ConfigGasto;
  plan: PlanCobroGasto;
  firma: string;
  instrucciones: string;
  guardar: AccionSimple;
  tr?: TrAgentes;
}) {
  const { t } = tr;
  const ejemplo: ItemCobro[] = plan.paraContactar[0]?.items.slice(0, 2) ?? [];
  return (
    <section aria-label={t('cobranza.gasto.configuracion_de_la_cobranza_por')}>
      {/* sin-info: rótulo de sección de configuración, no un recuadro con cifra */}
      <h3>{t('cobranza.gasto.configuracion_de_la_cobranza_por')}</h3>
      <p className="rv-ag-notif__nota">{config.porGasto ? t('cobranza.gasto.encendida') : t('cobranza.gasto.apagada')}</p>
      <FormaPorGasto config={config} ejemplo={ejemplo} firma={firma} instrucciones={instrucciones} guardar={guardar} />
    </section>
  );
}

function Mini({ t, titulo, filas }: { t: TAgentes; titulo: string; filas: Array<[string, number, number]> }) {
  return (
    <dl className="rv-ag-mini">
      <dt className="rv-ag-notif__rotulo">{titulo}</dt>
      {filas.map(([rotulo, avisos, resueltos]) => (
        <div key={rotulo} className="rv-ag-mini__fila">
          <dd>{rotulo}</dd>
          <dd className="rv-cifra">{t('cobranza.gasto.de_con_comprobante', { resueltos: numero(resueltos), avisos: numero(avisos) })}</dd>
        </div>
      ))}
    </dl>
  );
}
