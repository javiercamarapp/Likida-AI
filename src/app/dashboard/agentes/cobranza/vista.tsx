import { Inbox } from 'lucide-react';
import type { ColaCobranza, ContactoBitacora, FilaCola } from '@/lib/likida/agentes/cobranza';
import type { ConfigCobranza } from '@/lib/likida/agentes/cobranza_pura';
import { numero, fechaCorta } from '@/lib/formato';
import { BotonEjecutar, BotonPausa, type AccionSimple, type AccionEjecutar } from './controles';
import { FormaEstrategia } from './estrategia';
import { CajonEstrategia } from './cajon-estrategia';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { BarraPeriodo, EstadoVacio, FilaTarjetas, StatusChip, Tarjeta, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { TR_ES, rico, selloHoyTr, rotuloDiasTr, type TrAgentes, type TAgentes } from '../i18n-agentes';
import '../agentes.css';
import './cobranza.css';

export interface ExtraAgenteCobranza {
  /** ¿AHORA MISMO está dentro de su ventana de contacto? (calculado en el
   *  servidor con la hora de México, no la del navegador). */
  enVentana: boolean;
  /** El siguiente REAL de la cola (folio + días JUNTOS: un folio verdadero
   *  con días que no son los suyos contradiría la tabla de arriba). null =
   *  cola vacía; la vista previa se declara plantilla. */
  ejemplo: { folio: string | null; dias: number } | null;
}

/**
 * El render del Agente de Cobranza (Fase 1 del plan). Tres zonas: la
 * cola honesta (a quién va a insistir Y a quién no puede,
 * con el porqué), la bitácora de lo que ya hizo, y la estrategia que el
 * cliente edita con la vista previa del mensaje real.
 *
 * AQUÍ NO HAY PESOS A PROPÓSITO: este agente cobra COMPROBANTES, no dinero.
 * Sus cifras son días y contactos, todas medidas.
 */
export function VistaAgenteCobranza({
  cola, config, bitacora, extra, acciones, notificaciones, porGasto, configPorGasto, gastosParaContactar = 0, tr = TR_ES,
}: {
  cola: ColaCobranza;
  config: ConfigCobranza;
  bitacora: ContactoBitacora[] | null;
  extra: ExtraAgenteCobranza;
  acciones: { guardarEstrategia: AccionSimple; alternarPausa: AccionSimple; ejecutarAhora: AccionEjecutar };
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
  /** La sección de cobranza POR GASTO (0525), ya renderizada en el servidor. */
  porGasto?: React.ReactNode;
  /** El formulario de la cobranza por gasto, ya renderizado: va en el cajón de configuración, no en la pantalla. */
  configPorGasto?: React.ReactNode;
  /** Choferes con gastos en tier hoy: «Ejecutar ahora» también los cubre. */
  gastosParaContactar?: number;
  /** El traductor del namespace `agentes` (la página lo arma con `getT`). Sin él, español. */
  tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const idioma = tr.idioma;
  const ventana = `${rotuloDiasTr(config.diasSemana, tx)} · ${config.horaInicio}–${config.horaFin} ${tx('comun.horas_sufijo')}`;

  const cifras: PropsCifra[] = ([
    { info: 'cobranza.para_contactar', etiqueta: tx('cobranza.vista.para_contactar'), valor: numero(cola.paraContactar.length), nota: tx('cobranza.vista.alcanzaron_un_tier_sin_contacto'), tono: cola.paraContactar.length > 0 ? 'warn' : undefined },
    { info: 'cobranza.no_puede_contactar', etiqueta: tx('cobranza.vista.no_puede_contactar'), valor: numero(cola.sinTelefono.length), nota: tx('cobranza.vista.sin_telefono_capturado'), tono: cola.sinTelefono.length > 0 ? 'warn' : undefined },
    { info: 'cobranza.viajes_vigilados', etiqueta: tx('cobranza.vista.viajes_vigilados'), valor: numero(cola.vigilados), nota: tx('cobranza.vista.abiertos_o_en_cuadre'), segmentos: segmentosVigilados(cola, tx) },
    { info: 'cobranza.estado', etiqueta: tx('cobranza.vista.estado'), valor: config.activo ? tx('cobranza.vista.activo') : tx('cobranza.vista.pausado'), nota: ventana, tono: config.activo ? undefined : 'warn' },
  ] as PropsCifra[]).map((c) => ({ ...c, matiz: c.matiz ?? 8 }));

  return (
    <EsqueletoTablaMaestra
      titulo={tx('cobranza.vista.seguimiento_de_comprobantes')}
      apoyo={tx('cobranza.vista.a_quien_insistira_el_agente')}
      // Barra de alcance (Rovaq BF): dice la ventana de contacto y si el agente corre; son datos de su configuración, no filtros inventados.
      filtros={<BarraPeriodo etiqueta={tx('cobranza.vista.cola_de_seguimiento')} chips={[{ id: 'ventana', etiqueta: ventana }, { id: 'estado', etiqueta: config.activo ? tx('cobranza.vista.activo') : tx('cobranza.vista.pausado') }]} />}
      cifras={cifras}
      etiquetaCifras={tx('cobranza.vista.cola_de_seguimiento')}
      selloCifras={selloHoyTr(tr, tx('cobranza.vista.cola_de_seguimiento'))}
      acciones={(
        <>
          <BotonPausa alternarPausa={acciones.alternarPausa} activo={config.activo} />
          <CajonEstrategia id="estrategia" titulo={tx('cobranza.vista.su_estrategia')} descripcion={tx('cobranza.vista.cuando_insiste_en_que_horario')} disparador={tx('cobranza.vista.editar_la_estrategia')}>
            <section aria-label={tx('cobranza.vista.su_estrategia')}>
              <FormaEstrategia config={config} ejemplo={extra.ejemplo} guardar={acciones.guardarEstrategia} />
            </section>
            {configPorGasto}
          </CajonEstrategia>
        </>
      )}
    >
      <div className="rv-ag-pila">
      <FilaTarjetas variante="8-4">
        {/* ── La cola honesta ── */}
        <Tarjeta
          titulo={tx('cobranza.vista.los_va_a_contactar')}
          info="cobranza.cola"
          contenida
          acciones={
            <BotonEjecutar
              ejecutarAhora={acciones.ejecutarAhora}
              enCola={cola.paraContactar.length + gastosParaContactar}
              activo={config.activo}
            />
          }
        >
          <p className="rv-ag-notif__nota">
            {!config.activo
              ? tx('cobranza.vista.el_agente_esta_pausado_no')
              : extra.enVentana
                ? tx('cobranza.vista.dentro_de_la_ventana_la')
                : tx('cobranza.vista.fuera_de_la_ventana_los', { ventana })}
          </p>
          {cola.paraContactar.length === 0 ? (
            <EstadoVacio titulo={tx('cobranza.vista.nadie_con_comprobantes_atrasados')} icono={Inbox} contenido>
              {tx('cobranza.vista.nadie_trae_comprobantes_atrasados_a', { dias: config.tiers[0] })}</EstadoVacio>
          ) : (
            <TablaBase etiqueta={tx('cobranza.vista.viajes_en_cobranza_con_su')} columnas={columnasCola(tx)} filas={cola.paraContactar} idFila={(f) => f.viajeId} densa tarjetaMovil />
          )}
        </Tarjeta>

        {/* A quién NO puede — la mitad honesta de la cola */}
        <Tarjeta
          titulo={tx('cobranza.vista.a_quien_no_puede_escribirle')}
          info="cobranza.sin_telefono"
          contenida
          estado={cola.sinTelefono.length === 0 ? 'vacio' : 'ok'}
          mensaje={tx('cobranza.vista.todos_tienen_telefono')}
          detalle={tx('cobranza.vista.todos_los_operadores_con_viajes')}
        >
          <p className="rv-ag-notif__nota">{tx('cobranza.vista.alcanzaron_un_tier_pero_el')}</p>
          <ul className="rv-ag-notif__personas">
            {cola.sinTelefono.map((f) => (
              <li key={f.viajeId}>
                <StatusChip tono="warn">{tx('cobranza.vista.sin_telefono')}</StatusChip>
                <strong>{f.folio ?? tx('cobranza.vista.sin_folio')}</strong>
                <span>{f.operadorNombre ?? tx('cobranza.vista.operador_sin_nombre')}</span>
                <em>{tx('cobranza.vista.dias', { dias: numero(f.dias) })}</em>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </FilaTarjetas>

      {/* Bitácora — lo que ya hizo, con sus fallos a la vista */}
      <Tarjeta
        titulo={tx('cobranza.vista.bitacora_de_contactos')}
        info="cobranza.bitacora"
        estado={bitacora === null ? 'error' : bitacora.length === 0 ? 'vacio' : 'ok'}
        mensaje={bitacora === null ? tx('cobranza.vista.no_se_pudo_leer_la') : tx('cobranza.vista.aun_sin_contactos')}
        detalle={tx('cobranza.vista.cada_intento_del_agente_queda')}
      >
        <p className="rv-ag-notif__nota">{tx('cobranza.vista.los_ultimos_intentos_salieran_o')}</p>
        <TablaBase
          etiqueta={tx('cobranza.vista.bitacora_de_contactos')}
          columnas={columnasBitacora(tx, idioma)}
          filas={bitacora ?? []}
          idFila={(c) => `${c.cuando}-${c.folio ?? ''}-${c.operadorNombre ?? ''}`}
          densa
          tarjetaMovil
        />
      </Tarjeta>

      {porGasto}

      {notificaciones}
      </div>
    </EsqueletoTablaMaestra>
  );
}

/** La barra de 6 px de «viajes vigilados»: cuántos tocan contacto, cuántos no tienen teléfono y el resto. Solo si las partes caben en el total
 *  (un conteo que no cuadra no se dibuja como proporción). */
function segmentosVigilados(cola: ColaCobranza, tx: TAgentes) {
  const a = cola.paraContactar.length;
  const b = cola.sinTelefono.length;
  if (cola.vigilados <= 0 || a + b > cola.vigilados) return undefined;
  return [
    { etiqueta: tx('cobranza.vista.para_contactar'), valor: a },
    { etiqueta: tx('cobranza.vista.no_puede_contactar'), valor: b },
    { etiqueta: tx('cobranza.vista.viajes_vigilados'), valor: cola.vigilados - a - b },
  ];
}

const columnasCola = (tx: TAgentes): readonly ColumnaBase<FilaCola>[] => [
  { id: 'viaje', titulo: tx('cobranza.vista.viaje'), principal: true, celda: (f) => f.folio ?? tx('cobranza.vista.sin_folio') },
  { id: 'operador', titulo: tx('cobranza.vista.operador'), celda: (f) => f.operadorNombre ?? tx('cobranza.vista.sin_nombre') },
  { id: 'dias', titulo: tx('cobranza.vista.sin_comprobar'), alinear: 'der', celda: (f) => tx('cobranza.vista.dias', { dias: numero(f.dias) }) },
  { id: 'tier', titulo: tx('cobranza.vista.tier_que_toca'), alinear: 'der', celda: (f) => <StatusChip tono="warn">{tx('cobranza.vista.dias_2', { tier: f.tier })}</StatusChip> },
  { id: 'previos', titulo: tx('cobranza.vista.contactos_previos'), alinear: 'der', celda: (f) => numero(f.contactosPrevios) },
];

const columnasBitacora = (tx: TAgentes, idioma: TrAgentes['idioma']): readonly ColumnaBase<ContactoBitacora>[] => [
  { id: 'cuando', titulo: tx('cobranza.vista.fecha'), principal: true, celda: (c) => fechaCorta(c.cuando, idioma) },
  { id: 'estado', titulo: tx('cobranza.vista.resultado'), celda: (c) => (c.enviado ? <StatusChip tono="ok">{tx('cobranza.vista.enviado')}</StatusChip> : <StatusChip tono="bad">{tx('cobranza.vista.no_salio')}</StatusChip>) },
  {
    id: 'detalle', titulo: tx('cobranza.vista.que_paso'),
    celda: (c) => c.enviado
      ? <span>{rico(tx('cobranza.vista.le_insistio_a_por_el'), { strong: <strong>{c.operadorNombre ?? tx('cobranza.vista.el_operador')}</strong>, strong2: <strong>{c.folio ?? tx('cobranza.vista.sin_folio_2')}</strong>, tier: c.tier })}</span>
      : <span>{rico(tx('cobranza.vista.no_le_pudo_escribir_a'), { strong: <strong>{c.operadorNombre ?? tx('cobranza.vista.el_operador')}</strong>, strong2: <strong>{c.folio ?? tx('cobranza.vista.sin_folio_2')}</strong>, detalle: c.detalle ? ` — ${c.detalle}` : '' })}</span>,
  },
];
