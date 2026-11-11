import { Inbox } from 'lucide-react';
import type { ColaCobranza, ContactoBitacora, FilaCola } from '@/lib/likida/agentes/cobranza';
import type { ConfigCobranza } from '@/lib/likida/agentes/cobranza_pura';
import { numero, fechaCorta } from '@/lib/formato';
import { BotonEjecutar, BotonPausa, type AccionSimple, type AccionEjecutar } from './controles';
import { FormaEstrategia } from './estrategia';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { Disclosure, EstadoVacio, FilaTarjetas, MarcoPagina, StatusChip, Tarjeta, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { TR_ES, rico, selloHoyTr, rotuloDiasTr, type TrAgentes, type TAgentes } from '../i18n-agentes';
import '../agentes.css';

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
  cola, config, bitacora, extra, acciones, notificaciones, porGasto, gastosParaContactar = 0, tr = TR_ES,
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
  /** Choferes con gastos en tier hoy: «Ejecutar ahora» también los cubre. */
  gastosParaContactar?: number;
  /** El traductor del namespace `agentes` (la página lo arma con `getT`). Sin él, español. */
  tr?: TrAgentes;
}) {
  const { t } = tr;
  const idioma = tr.idioma;
  const ventana = `${rotuloDiasTr(config.diasSemana, t)} · ${config.horaInicio}–${config.horaFin} ${t('comun.horas_sufijo')}`;

  return (
    <MarcoPagina titulo={t('cobranza.vista.seguimiento_de_comprobantes')} apoyo={t('cobranza.vista.a_quien_insistira_el_agente')}>

      <TiraCifras sello={selloHoyTr(tr, t('cobranza.vista.cola_de_seguimiento'))}>
        <Cifra info="cobranza.para_contactar" etiqueta={t('cobranza.vista.para_contactar')} valor={numero(cola.paraContactar.length)}
          nota={t('cobranza.vista.alcanzaron_un_tier_sin_contacto')} />
        <Cifra info="cobranza.no_puede_contactar" etiqueta={t('cobranza.vista.no_puede_contactar')} valor={numero(cola.sinTelefono.length)}
          nota={t('cobranza.vista.sin_telefono_capturado')} tono={cola.sinTelefono.length > 0 ? 'warn' : undefined} />
        <Cifra info="cobranza.viajes_vigilados" etiqueta={t('cobranza.vista.viajes_vigilados')} valor={numero(cola.vigilados)} nota={t('cobranza.vista.abiertos_o_en_cuadre')} />
        <Cifra info="cobranza.estado" etiqueta={t('cobranza.vista.estado')} valor={config.activo ? t('cobranza.vista.activo') : t('cobranza.vista.pausado')} nota={ventana}
          tono={config.activo ? undefined : 'warn'} />
      </TiraCifras>

      <FilaTarjetas variante="8-4">
        {/* ── La cola honesta ── */}
        <Tarjeta
          titulo={t('cobranza.vista.los_va_a_contactar')}
          info="cobranza.cola"
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
              ? t('cobranza.vista.el_agente_esta_pausado_no')
              : extra.enVentana
                ? t('cobranza.vista.dentro_de_la_ventana_la')
                : t('cobranza.vista.fuera_de_la_ventana_los', { ventana })}
          </p>
          {cola.paraContactar.length === 0 ? (
            <EstadoVacio titulo={t('cobranza.vista.nadie_con_comprobantes_atrasados')} icono={Inbox} contenido>
              {t('cobranza.vista.nadie_trae_comprobantes_atrasados_a', { dias: config.tiers[0] })}</EstadoVacio>
          ) : (
            <TablaBase etiqueta={t('cobranza.vista.viajes_en_cobranza_con_su')} columnas={columnasCola(t)} filas={cola.paraContactar} idFila={(f) => f.viajeId} densa tarjetaMovil />
          )}
        </Tarjeta>

        {/* A quién NO puede — la mitad honesta de la cola */}
        <Tarjeta
          titulo={t('cobranza.vista.a_quien_no_puede_escribirle')}
          info="cobranza.sin_telefono"
          estado={cola.sinTelefono.length === 0 ? 'vacio' : 'ok'}
          mensaje={t('cobranza.vista.todos_tienen_telefono')}
          detalle={t('cobranza.vista.todos_los_operadores_con_viajes')}
        >
          <p className="rv-ag-notif__nota">{t('cobranza.vista.alcanzaron_un_tier_pero_el')}</p>
          <ul className="rv-ag-notif__personas">
            {cola.sinTelefono.map((f) => (
              <li key={f.viajeId}>
                <StatusChip tono="warn">{t('cobranza.vista.sin_telefono')}</StatusChip>
                <strong>{f.folio ?? t('cobranza.vista.sin_folio')}</strong>
                <span>{f.operadorNombre ?? t('cobranza.vista.operador_sin_nombre')}</span>
                <em>{t('cobranza.vista.dias', { dias: numero(f.dias) })}</em>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </FilaTarjetas>

      {/* Bitácora — lo que ya hizo, con sus fallos a la vista */}
      <Tarjeta
        titulo={t('cobranza.vista.bitacora_de_contactos')}
        info="cobranza.bitacora"
        estado={bitacora === null ? 'error' : bitacora.length === 0 ? 'vacio' : 'ok'}
        mensaje={bitacora === null ? t('cobranza.vista.no_se_pudo_leer_la') : t('cobranza.vista.aun_sin_contactos')}
        detalle={t('cobranza.vista.cada_intento_del_agente_queda')}
      >
        <p className="rv-ag-notif__nota">{t('cobranza.vista.los_ultimos_intentos_salieran_o')}</p>
        <TablaBase
          etiqueta={t('cobranza.vista.bitacora_de_contactos')}
          columnas={columnasBitacora(t, idioma)}
          filas={bitacora ?? []}
          idFila={(c) => `${c.cuando}-${c.folio ?? ''}-${c.operadorNombre ?? ''}`}
          densa
          tarjetaMovil
        />
      </Tarjeta>

      {porGasto}

      {/* ── La estrategia del cliente, con vista previa (las "Pruebas") ── */}
      <Tarjeta titulo={t('cobranza.vista.su_estrategia')} info="cobranza.estrategia" acciones={<BotonPausa alternarPausa={acciones.alternarPausa} activo={config.activo} />}>
        <p className="rv-ag-notif__nota">{t('cobranza.vista.cuando_insiste_en_que_horario')}</p>
        <Disclosure titulo={t('cobranza.vista.editar_la_estrategia')} resumen={ventana} abierto>
          <FormaEstrategia
            config={config}
            ejemplo={extra.ejemplo}
            guardar={acciones.guardarEstrategia}
          />
        </Disclosure>
      </Tarjeta>

      {notificaciones}
    </MarcoPagina>
  );
}

const columnasCola = (t: TAgentes): readonly ColumnaBase<FilaCola>[] => [
  { id: 'viaje', titulo: t('cobranza.vista.viaje'), principal: true, celda: (f) => f.folio ?? t('cobranza.vista.sin_folio') },
  { id: 'operador', titulo: t('cobranza.vista.operador'), celda: (f) => f.operadorNombre ?? t('cobranza.vista.sin_nombre') },
  { id: 'dias', titulo: t('cobranza.vista.sin_comprobar'), alinear: 'der', celda: (f) => t('cobranza.vista.dias', { dias: numero(f.dias) }) },
  { id: 'tier', titulo: t('cobranza.vista.tier_que_toca'), alinear: 'der', celda: (f) => <StatusChip tono="warn">{t('cobranza.vista.dias_2', { tier: f.tier })}</StatusChip> },
  { id: 'previos', titulo: t('cobranza.vista.contactos_previos'), alinear: 'der', celda: (f) => numero(f.contactosPrevios) },
];

const columnasBitacora = (t: TAgentes, idioma: TrAgentes['idioma']): readonly ColumnaBase<ContactoBitacora>[] => [
  { id: 'cuando', titulo: t('cobranza.vista.fecha'), principal: true, celda: (c) => fechaCorta(c.cuando, idioma) },
  { id: 'estado', titulo: t('cobranza.vista.resultado'), celda: (c) => (c.enviado ? <StatusChip tono="ok">{t('cobranza.vista.enviado')}</StatusChip> : <StatusChip tono="bad">{t('cobranza.vista.no_salio')}</StatusChip>) },
  {
    id: 'detalle', titulo: t('cobranza.vista.que_paso'),
    celda: (c) => c.enviado
      ? <span>{rico(t('cobranza.vista.le_insistio_a_por_el'), { strong: <strong>{c.operadorNombre ?? t('cobranza.vista.el_operador')}</strong>, strong2: <strong>{c.folio ?? t('cobranza.vista.sin_folio_2')}</strong>, tier: c.tier })}</span>
      : <span>{rico(t('cobranza.vista.no_le_pudo_escribir_a'), { strong: <strong>{c.operadorNombre ?? t('cobranza.vista.el_operador')}</strong>, strong2: <strong>{c.folio ?? t('cobranza.vista.sin_folio_2')}</strong>, detalle: c.detalle ? ` — ${c.detalle}` : '' })}</span>,
  },
];
