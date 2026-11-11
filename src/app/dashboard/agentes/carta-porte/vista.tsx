import Link from 'next/link';
import { ScrollText, TriangleAlert, Mail, MessageCircle, LayoutDashboard, Inbox, CheckCircle2 } from 'lucide-react';
import './carta-porte.css';
import type { EstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import type { InsightsAgente, CalidadGrupo, TarjetaInsight } from '@/lib/likida/carta_porte_docs/metricas';
import { aCsvSinCcp, type ListadoSinCcp, type ColorAntiguedad } from '@/lib/likida/carta_porte_docs/viajes_sin_ccp';
import { estadoCatalogosSat, type ConteoCatalogosSat } from '@/lib/likida/carta_porte_docs/catalogos_sat';
import { DireccionBuzon } from '../proveedores/controles';
import { AVISO_SIN_REMITENTES } from '@/lib/correo/remitente';
import { BarList, Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import {
  Aviso, AvisoCompacto, clasesBoton, Disclosure, EstadoError, EstadoVacio, FilaTarjetas, Icono, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { VacioAgente } from '../vacio-agente';
import { TR_ES, rico, type TrAgentes, type TAgentes, selloHoyTr } from '../i18n-agentes';

/**
 * La ventana del Agente de Carta Porte (Fases B-C del blueprint): los conteos
 * del semáforo, la COLA de «falta declarar» (los viajes donde el agente está
 * esperando una respuesta del jefe), y la carta de lo que entiende — que es
 * la verdad del código, no marketing.
 *
 * Área `operacion` como su pantalla hermana /dashboard/carta-porte: cero
 * pesos, y su usuario diario es el jefe de tráfico. Pura props.
 */
/** El buzón de correo de la flota tal como lo pinta el bloque «Cómo mandarme documentos». */
export interface BuzonCartaPorteVista { direccion: string | null; activo: boolean; remitentes: string[]; dominioConfigurado: boolean }

/**
 * La frase que dice que los grupos NO son un canal. Exportada para que la prueba
 * la distinga de cualquier otra mención: «grupo» solo puede aparecer aquí.
 */
export const FRASE_SIN_GRUPOS = TR_ES.t('cartaporte.vista.los_grupos_de_whatsapp_no');

type ViajeEnCola = EstadoCartaPorte['viajes'][number];

const COLUMNAS_COLA = (tx: TAgentes): readonly ColumnaBase<ViajeEnCola>[] => [
  { id: 'folio', titulo: tx('cartaporte.vista.viaje'), principal: true, celda: (v) => <span className="rv-ag-num">{v.folio ?? v.viajeId.slice(0, 8)}</span> },
  { id: 'ruta', titulo: tx('cartaporte.vista.ruta'), celda: (v) => (v.origen && v.destino ? `${v.origen} → ${v.destino}` : tx('cartaporte.vista.sin_ruta_capturada')) },
  {
    id: 'falta', titulo: tx('cartaporte.vista.lo_que_falta_declarar'),
    celda: (v) => (
      <span className="rv-cp__pendientes">
        <Icono icono={TriangleAlert} tam={14} />
        {v.decision.pendientes.join(' · ')}
      </span>
    ),
  },
];

export function VistaAgenteCartaPorte({ datos, sufijo = '', notificaciones, buzon = null, insights, sinCcp, nombresCliente = {}, diasVentana = 30, catalogosSat, tr = TR_ES }: {
  datos: EstadoCartaPorte | null;
  sufijo?: string;
  notificaciones?: React.ReactNode;
  /** `null` = la flota aún no activa su buzón; `'no_leido'` = la lectura falló (no se finge «sin buzón»). */
  buzon?: BuzonCartaPorteVista | null | 'no_leido';
  /** T-A3-37. `undefined` = no se pide el bloque; `'no_leido'` = la lectura falló (no se finge «sin datos»). */
  insights?: InsightsAgente | 'no_leido';
  /** T-A3-66. `undefined` = no se pide el bloque; `'no_leido'` = la lectura falló (no se finge «sin pendientes»). */
  sinCcp?: ListadoSinCcp | 'no_leido';
  /** id de cliente → nombre, solo para rotular. */
  nombresCliente?: Record<string, string>;
  diasVentana?: number;
  /** CT-A345-04: filas cargadas por catálogo SAT. `undefined` = no se pide el aviso; `'no_leido'` = la lectura falló (no se finge «cargados»). */
  catalogosSat?: ConteoCatalogosSat | 'no_leido'; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const conteo = (n: 'si' | 'no' | 'falta_declarar') =>
    datos === null ? null : datos.viajes.filter((v) => v.decision.necesita === n).length;
  const armables = datos === null ? null : datos.viajes.filter((v) => v.borrador.borrador !== null && v.borrador.fallas.length === 0).length;
  const cola = datos === null ? [] : datos.viajes.filter((v) => v.decision.necesita === 'falta_declarar');
  const esperan = conteo('falta_declarar');

  const sinConteo = conteo('si');
  return (
    <EsqueletoTablaMaestra
      titulo={tx('cartaporte.vista.carta_porte_en_automatico')}
      apoyo={tx('cartaporte.vista.al_despachar_corre_el_arbol')}
      avisos={catalogosSat !== undefined ? <AvisoCatalogosSat tr={tr} catalogosSat={catalogosSat} /> : undefined}
      cifras={datos === null ? undefined : [
        { info: 'carta_porte_agente.en_curso', etiqueta: tx('cartaporte.vista.viajes_en_curso'), valor: numero(datos.total),
          // La barra solo se pinta si los tres veredictos salen de TODOS los viajes en curso: con la muestra recortada sería una proporción inventada.
          segmentos: datos.viajes.length === datos.total && datos.total > 0
            ? [{ etiqueta: tx('cartaporte.vista.necesitan_complemento'), valor: sinConteo }, { etiqueta: tx('cartaporte.vista.esperan_declaracion'), valor: esperan }, { etiqueta: tx('f26d2.cp.no_necesitan'), valor: conteo('no') }]
            : undefined },
        { info: 'carta_porte_agente.esperan', etiqueta: tx('cartaporte.vista.esperan_declaracion'), valor: esperan === null ? null : numero(esperan), tono: esperan !== null && esperan > 0 ? 'bad' : undefined },
        { info: 'carta_porte_agente.necesitan', etiqueta: tx('cartaporte.vista.necesitan_complemento'), valor: sinConteo === null ? null : numero(sinConteo), tono: (sinConteo ?? 0) > 0 ? 'warn' : undefined },
        { info: 'carta_porte_agente.borradores', etiqueta: tx('cartaporte.vista.borradores_sin_fallas'), valor: armables === null ? null : numero(armables),
          segmentos: (sinConteo ?? 0) > 0 && armables !== null && sinConteo !== null && datos.viajes.length === datos.total
            ? [{ etiqueta: tx('cartaporte.vista.borradores_sin_fallas'), valor: Math.min(armables, sinConteo) }, { etiqueta: tx('f26d2.cp.sin_armar'), valor: Math.max(0, sinConteo - armables) }]
            : undefined },
      ]}
      etiquetaCifras={tx('cartaporte.vista.carta_porte_en_automatico')}
      selloCifras={selloHoyTr(tr, tx('cartaporte.vista.sello_viajes_en_curso'))}
    >
      {datos === null ? (
        <EstadoError>{tx('cartaporte.vista.no_se_pudieron_leer_los')}</EstadoError>
      ) : (
        <>
          <Tarjeta titulo={tx('cartaporte.vista.esperando_al_jefe')} info="carta_porte_agente.cola"
            acciones={<Link href={`/dashboard/carta-porte${sufijo}`} className={clasesBoton('secondary', 'sm')}>{tx('cartaporte.vista.declarar_y_capturar')}</Link>}>
            {cola.length === 0 ? (
              <VacioAgente icono={ScrollText} titulo={tx('cartaporte.vista.nada_pendiente_de_declarar')}>{tx('cartaporte.vista.cada_viaje_en_curso_ya')}</VacioAgente>
            ) : (
              <TablaBase etiqueta={tx('cartaporte.vista.viajes_esperando_una_declaracion')} columnas={COLUMNAS_COLA(tx)} filas={cola} idFila={(v) => v.viajeId} densa tarjetaMovil />
            )}
            {datos.viajes.length < datos.total && (
              <p className="rv-cp__nota" data-tono="faint">
                {tx('cartaporte.vista.los_conteos_por_veredicto_salen', { length: numero(datos.viajes.length), total: numero(datos.total) })}
              </p>
            )}
          </Tarjeta>
        </>
      )}

      <ComoMandarDocumentos tr={tr} buzon={buzon} sufijo={sufijo} />

      {sinCcp !== undefined && <ViajesSinCcp tr={tr} listado={sinCcp} />}

      {insights !== undefined && <InsightsDelAgente tr={tr} insights={insights} nombresCliente={nombresCliente} diasVentana={diasVentana} />}

      <p className="rv-cp__nota">
        {rico(tx('cartaporte.vista.lo_que_el_agente_aprende'), { v0: ' ', Link: <Link href={`/dashboard/agentes/carta-porte/catalogo${sufijo}`} className="rv-cp__enlace">{tx('cartaporte.vista.catalogo_del_cliente')}</Link> })}
      </p>
      <p className="rv-cp__nota">
        {rico(tx('cartaporte.vista.los_clientes_que_necesitan_su'), { v0: ' ', Link: <Link href={`/dashboard/agentes/carta-porte/referencia${sufijo}`} className="rv-cp__enlace">{tx('cartaporte.vista.referencia_del_cliente')}</Link> })}
      </p>

      <Tarjeta titulo={tx('cartaporte.vista.lo_que_hace_y_lo')} info="carta_porte_agente.alcance">
        <Disclosure titulo={tx('cartaporte.vista.alcance_del_agente')} resumen={tx('cartaporte.vista.al_despachar_con_lo_capturado')} abierto variante="linea">
          <div className="rv-cp__tres">
            <div className="rv-cp__col">
              <p className="rv-cp__rotulo">{tx('cartaporte.vista.al_despachar')}</p>
              <p className="rv-cp__nota">
                {tx('cartaporte.vista.corre_el_arbol_legal_y')}
              </p>
            </div>
            <div className="rv-cp__col">
              <p className="rv-cp__rotulo">{tx('cartaporte.vista.con_lo_capturado')}</p>
              <p className="rv-cp__nota">
                {tx('cartaporte.vista.arma_el_borrador_del_complemento')}
              </p>
            </div>
            <div className="rv-cp__col">
              <p className="rv-cp__rotulo">{tx('cartaporte.vista.jamas')}</p>
              <p className="rv-cp__nota">
                {tx('cartaporte.vista.no_afirma_no_necesitas_carta')}
              </p>
            </div>
          </div>
        </Disclosure>
      </Tarjeta>

      {notificaciones}
    </EsqueletoTablaMaestra>
  );
}

/**
 * Los tres caminos por los que llega un documento (el correo oficial del cliente
 * es el principal; el WhatsApp es 1:1 con la oficina, nunca un grupo) y, con el
 * buzón sin activar, el estado vacío que dice cómo empezar.
 */
function ComoMandarDocumentos({ buzon, sufijo, tr = TR_ES }: { buzon: BuzonCartaPorteVista | null | 'no_leido'; sufijo: string; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  const panel = `/dashboard/carta-porte/documentos${sufijo}`;
  return (
    <Tarjeta titulo={tx('cartaporte.vista.como_mandarme_documentos')} info="carta_porte_agente.como_mandar">
      <div className="rv-cp__pila">
        <div className="rv-cp__tres">
          <div className="rv-cp__col">
            <p className="rv-cp__rotulo">{rico(tx('cartaporte.vista.1_correo_el_medio_oficial'), { el: <Icono icono={Mail} tam={14} /> })}</p>
            {buzon === 'no_leido' ? (
              <EstadoError compacto>{tx('cartaporte.vista.no_se_pudo_leer_el')}</EstadoError>
            ) : buzon === null ? (
              <EstadoVacio titulo={tx('cartaporte.vista.aun_no_tienes_buzon')} icono={Inbox} contenido>
                {tx('cartaporte.vista.activalo_en_el_panel_de')}
              </EstadoVacio>
            ) : buzon.direccion ? (
              <>
                <DireccionBuzon direccion={buzon.direccion} />
                {!buzon.activo && <p className="rv-cp__nota" data-tono="warn">{tx('cartaporte.vista.el_buzon_esta_apagado_lo')}</p>}
                <p className="rv-cp__nota">
                  {tx('cartaporte.vista.los_adjuntos_pdf_excel_xml')}
                </p>
                <p className="rv-cp__nota">
                  {buzon.remitentes.length > 0
                    ? tx('cartaporte.vista.remitentes_de_tus_clientes_reconocid', { v0: buzon.remitentes.join(', ') })
                    : AVISO_SIN_REMITENTES}
                </p>
              </>
            ) : (
              <p className="rv-cp__nota" data-tono="warn">
                {buzon.dominioConfigurado ? tx('cartaporte.vista.la_direccion_no_se_pudo') : tx('cartaporte.vista.el_dominio_de_correo_de')}
              </p>
            )}
          </div>
          <div className="rv-cp__col">
            <p className="rv-cp__rotulo">{rico(tx('cartaporte.vista.2_whatsapp_1_1_de'), { el: <Icono icono={MessageCircle} tam={14} /> })}</p>
            <p className="rv-cp__nota">
              {tx('cartaporte.vista.quien_despacha_reenvia_el_archivo')}
            </p>
          </div>
          <div className="rv-cp__col">
            <p className="rv-cp__rotulo">{rico(tx('cartaporte.vista.3_el_panel'), { el: <Icono icono={LayoutDashboard} tam={14} /> })}</p>
            <p className="rv-cp__nota">{tx('cartaporte.vista.sube_el_archivo_a_mano')}</p>
            <Link href={panel} className="rv-cp__enlace">{tx('cartaporte.vista.abrir_la_bandeja_de_documentos')}</Link>
          </div>
        </div>
        <p className="rv-cp__frase">{tx('cartaporte.vista.los_grupos_de_whatsapp_no')}</p>
      </div>
    </Tarjeta>
  );
}

const pctTxt = (p: number | null): string => (p === null ? '—' : `${p} %`);
const TONO_INSIGHT: Record<TarjetaInsight['tono'], string> = { bad: 'bad', warn: 'warn', info: 'info' };

function TarjetaQuePaso({ tarjeta: t, tr = TR_ES }: { tarjeta: TarjetaInsight; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <div className="rv-cp__quepaso" data-tono={TONO_INSIGHT[t.tono]}>
      <p><strong>{t.quePaso}</strong></p>
      <p className="rv-cp__nota"><b>{tx('cartaporte.vista.que_significa')} </b>{t.queSignifica}</p>
      <p><b>{tx('cartaporte.vista.que_hacer')} </b>{t.queHacer}</p>
    </div>
  );
}

/** Calidad por grupo: una lista de barras con el % sin tocar y el texto exacto («% (n)») — reemplaza la tabla a mano. */
function CalidadPorGrupo({ titulo, filas, rotular, tr = TR_ES }: { titulo: string; filas: CalidadGrupo[]; rotular: (clave: string) => string; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  const columnas: readonly ColumnaBase<CalidadGrupo>[] = [
    { id: 'grupo', titulo: tx('cartaporte.vista.grupo'), principal: true, celda: (g) => rotular(g.clave) },
    { id: 'aprobados', titulo: tx('cartaporte.vista.aprobados'), alinear: 'der', celda: (g) => numero(g.documentos) },
    { id: 'sintocar', titulo: tx('cartaporte.vista.sin_tocar'), alinear: 'der', celda: (g) => `${pctTxt(g.pctSinTocar)} (${numero(g.sinTocar)})` },
  ];
  return (
    <Tarjeta titulo={titulo} estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje={tx('cartaporte.vista.sin_documentos_aprobados_todavia')} detalle={tx('cartaporte.vista.cuando_se_aprueben_documentos_aqui')}>
      {filas.length > 0 && (
        <>
          <BarList etiqueta={tx('cartaporte.vista.porcentaje_sin_tocar', { titulo })} formato={(v) => `${v} %`}
            items={filas.slice(0, 5).map((g) => ({ clave: g.clave, etiqueta: rotular(g.clave), valor: g.pctSinTocar, texto: `${pctTxt(g.pctSinTocar)} (${numero(g.sinTocar)} de ${numero(g.documentos)})` }))} maximo={100} />
          <Disclosure titulo={tx('cartaporte.vista.ver_la_tabla')} variante="linea">
            <TablaBase etiqueta={titulo} columnas={columnas} filas={filas} idFila={(g) => g.clave} densa tarjetaMovil />
          </Disclosure>
        </>
      )}
    </Tarjeta>
  );
}

/**
 * Cómo le va al agente (T-A3-37): % sin tocar, causas de rechazo, calidad por formato y cliente y estado de los
 * envíos. Solo conteos: ningún valor de un documento. Sin base, dice «—», nunca un 0 % que parezca medición.
 */
function InsightsDelAgente({ insights, nombresCliente, diasVentana, tr = TR_ES }: { insights: InsightsAgente | 'no_leido'; nombresCliente: Record<string, string>; diasVentana: number; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  const titulo = tx('cartaporte.vista.como_le_va_al_agente', { diasVentana });
  if (insights === 'no_leido') {
    return <Tarjeta titulo={titulo} info="carta_porte_agente.resultados" estado="error" mensaje={tx('cartaporte.vista.no_se_pudieron_leer_los_2')} reintentar />;
  }
  const i = insights;
  const nombre = (c: string) => (c === 'sin_cliente' ? tx('cartaporte.vista.sin_cliente_asignado') : nombresCliente[c] ?? tx('cartaporte.vista.cliente_sin_nombre'));
  const e = i.envios;
  const hayAlgo = i.aprobados > 0 || e.enviados + e.rechazadosTms + e.pendientesReque + e.subidosAMano > 0 || (i.causasRechazo?.length ?? 0) > 0;
  return (
    <Tarjeta titulo={titulo} info="carta_porte_agente.resultados" estado={hayAlgo ? 'ok' : 'vacio'} mensaje={tx('cartaporte.vista.todavia_no_hay_resultados_que')}
      detalle={tx('cartaporte.vista.cuando_se_aprueben_documentos_y')}>
      <div className="rv-cp__pila">
        {i.parcial && (
          <p className="rv-cp__nota" data-tono="warn" role="note">
            {tx('cartaporte.vista.cifras_de_los_documentos_mas', { leidos: numero(i.parcial.leidos), total: numero(i.parcial.total), diasVentana })}
          </p>
        )}
        <TiraCifras sello={selloHoyTr(tr, tx('cartaporte.vista.sello_documentos_de_carta_porte'))}>
          <Cifra info="carta_porte_agente.sin_tocar" etiqueta={tx('cartaporte.vista.aprobados_sin_tocar')} valor={pctTxt(i.pctSinTocar)} nota={i.aprobados === 0 ? tx('cartaporte.vista.aun_no_hay_aprobados') : tx('cartaporte.vista.de_n_aprobados', { n: numero(i.aprobados) })} />
          <Cifra info="carta_porte_agente.enviados" etiqueta={tx('cartaporte.vista.enviados_al_sistema_del_cliente')} valor={numero(e.enviados)} />
          <Cifra info="carta_porte_agente.esperan_requerimiento" etiqueta={tx('cartaporte.vista.esperan_requerimiento')} valor={numero(e.pendientesReque)} tono={e.pendientesReque > 0 ? 'warn' : undefined} />
          <Cifra info="carta_porte_agente.rechazados_tms" etiqueta={tx('cartaporte.vista.rechazados_por_el_sistema_del')} valor={numero(e.rechazadosTms)} tono={e.rechazadosTms > 0 ? 'bad' : undefined} />
        </TiraCifras>
        <p className="rv-cp__nota">
          {tx('cartaporte.vista.tiempo_tipico_de_aprobado_a', { v0: e.medianaAprobadoAEnviadoMin === null ? tx('cartaporte.vista.aun_no_hay_envios_medibles') : tx('cartaporte.vista.mediana_min', { n: e.medianaAprobadoAEnviadoMin }), v1: e.pendienteMasViejoHoras !== null ? tx('cartaporte.vista.el_que_mas_espera_lleva', { pendienteMasViejoHoras: e.pendienteMasViejoHoras }) : '' })}
        </p>
        {i.tarjetas.length > 0 && <div className="rv-cp__dos">{i.tarjetas.map((t) => <TarjetaQuePaso tr={tr} key={t.id} tarjeta={t} />)}</div>}
        <FilaTarjetas variante="6-6">
          <CalidadPorGrupo tr={tr} titulo={tx('cartaporte.vista.calidad_por_formato')} filas={i.porFormato} rotular={(c) => c} />
          <CalidadPorGrupo tr={tr} titulo={tx('cartaporte.vista.calidad_por_cliente')} filas={i.porCliente} rotular={nombre} />
        </FilaTarjetas>
        <FilaTarjetas variante="6-6">
          <Tarjeta titulo={tx('cartaporte.vista.por_que_se_rechazan')}>
            {i.causasRechazo === null ? <p className="rv-cp__nota">{tx('cartaporte.vista.no_disponible_todavia_en_esta')}</p>
              : i.causasRechazo.length === 0 && i.rechazadosSinCausa === 0 ? <p className="rv-cp__nota">{tx('cartaporte.vista.no_hubo_rechazos')}</p>
              : <ul className="rv-cp__lista">
                  {i.causasRechazo.map((c) => <li key={c.causa}>{c.rotulo}: <span className="rv-ag-num">{numero(c.documentos)}</span></li>)}
                  {(i.rechazadosSinCausa ?? 0) > 0 && <li>{rico(tx('cartaporte.vista.sin_clasificar'), { span: <span className="rv-ag-num">{numero(i.rechazadosSinCausa ?? 0)}</span> })}</li>}
                </ul>}
          </Tarjeta>
          <Tarjeta titulo={tx('cartaporte.vista.lo_que_mas_se_corrige')}>
            {i.topCamposCorregidos.length === 0 ? <p className="rv-cp__nota">{tx('cartaporte.vista.nadie_ha_corregido_campos_en')}</p>
              : <ol className="rv-cp__lista rv-cp__lista--num">{i.topCamposCorregidos.map((c) => <li key={c.campo}>{c.campo}: <span className="rv-ag-num">{numero(c.correcciones)}</span> {c.correcciones === 1 ? 'vez' : 'veces'}</li>)}</ol>}
          </Tarjeta>
        </FilaTarjetas>
      </div>
    </Tarjeta>
  );
}

const TONO_ANTIGUEDAD: Record<ColorAntiguedad, TonoEstado> = { verde: 'ok', ambar: 'warn', rojo: 'bad' };
const ROTULO_ANTIGUEDAD = (tx: TAgentes): Record<ColorAntiguedad, string> => ({ verde: tx('cartaporte.vista.antig_reciente'), ambar: tx('cartaporte.vista.atencion'), rojo: tx('cartaporte.vista.antig_riesgo') });

interface FilaSinCcp { clave: string; cliente: string; folio: string; horas: number; dias: number; color: ColorAntiguedad }

const COLUMNAS_SIN_CCP = (tx: TAgentes): readonly ColumnaBase<FilaSinCcp>[] => [
  { id: 'cliente', titulo: tx('cartaporte.vista.cliente'), principal: true, celda: (f) => f.cliente },
  { id: 'folio', titulo: tx('cartaporte.vista.viaje'), celda: (f) => f.folio },
  { id: 'horas', titulo: tx('cartaporte.vista.sin_carta_porte'), alinear: 'der', celda: (f) => <span className="rv-ag-num">{numero(f.horas)} h ({numero(f.dias)} d)</span> },
  { id: 'estado', titulo: tx('cartaporte.vista.antiguedad'), celda: (f) => <StatusChip tono={TONO_ANTIGUEDAD[f.color]}>{ROTULO_ANTIGUEDAD(tx)[f.color]}</StatusChip> },
];

/**
 * T-A3-66 — viajes que ya salieron y siguen sin Carta Porte, por cliente y con su antigüedad. SOLO LECTURA: no envía
 * mensajes ni cierra viajes. El reporte semanal es un CSV que se baja desde aquí.
 */
function ViajesSinCcp({ listado, tr = TR_ES }: { listado: ListadoSinCcp | 'no_leido'; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  if (listado === 'no_leido') {
    return <Tarjeta titulo={tx('cartaporte.vista.viajes_salidos_sin_carta_porte')} info="carta_porte_agente.sin_ccp" estado="error" mensaje={tx('cartaporte.vista.no_se_pudo_leer_la')} reintentar />;
  }
  // A3-01 (cierre100): null no es 0. Sin ningún viaje importado del TMS no se puede decir que no haya viajes sin Carta Porte:
  // ni cifra ni estado vacío verde, ni descarga.
  if (listado.sinDatosTms?.motivo === 'sin_viajes') {
    return (
      <Tarjeta titulo={tx('cartaporte.vista.viajes_salidos_sin_carta_porte')} info="carta_porte_agente.sin_ccp">
        <Aviso tono="warn">
          {rico(tx('cartaporte.vista.no_se_puede_decir_si'), { strong: <strong>{tx('cartaporte.vista.sin_datos_del_tms')}</strong>, v1: listado.sinDatosTms.ultimoImportadoEn ? tx('cartaporte.vista.el_ultimo_que_entro_fue', { v0: numero(listado.sinDatosTms.horasDesdeImportacion ?? 0) }) : '' })}
        </Aviso>
      </Tarjeta>
    );
  }
  const ligados = listado.ligadosPorFolio;
  // A3-02: si casi nada liga por folio, el supuesto «folio del TMS = folio del cliente» probablemente es falso y TODO saldría «sin CCP».
  const pocoLigado = !!ligados && ligados.total >= 10 && ligados.ligados / ligados.total < 0.05;
  const filas: FilaSinCcp[] = listado.grupos.flatMap((g) =>
    g.viajes.map((v) => ({
      clave: `${g.clienteId ?? 'sin_cliente'}-${v.viajeId}`,
      cliente: g.clienteNombre,
      folio: `${v.folio ?? tx('cartaporte.vista.sin_folio')}${v.localAbierto ? ' · local abierto' : ''}`,
      horas: v.horas, dias: v.dias, color: v.color,
    })));
  const sinTabla = listado.vacio && (listado.truncado || !!listado.sinDatosTms);
  return (
    <Tarjeta titulo={tx('cartaporte.vista.viajes_salidos_sin_carta_porte_2', { total: numero(listado.total) })} info="carta_porte_agente.sin_ccp"
      estado={listado.vacio && !sinTabla ? 'vacio' : 'ok'} iconoVacio={CheckCircle2} mensaje={tx('cartaporte.vista.no_hay_viajes_salidos_sin')}
      detalle={tx('cartaporte.vista.cuando_salga_uno_sin_complemento')}
      acciones={!listado.vacio ? (
        <a download="viajes-sin-carta-porte.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(aCsvSinCcp(listado))}`} className={clasesBoton('secondary', 'sm')}>
          {tx('cartaporte.vista.descargar_reporte_csv')}
        </a>
      ) : undefined}>
      <div className="rv-cp__pila">
        {listado.sinDatosTms?.motivo === 'importacion_vieja' && (
          <Aviso tono="warn">
            {tx('cartaporte.vista.la_ultima_importacion_de_viajes', { v0: numero(listado.sinDatosTms.horasDesdeImportacion ?? 0) })}
          </Aviso>
        )}
        {ligados && (
          <p className="rv-cp__nota">
            {tx('cartaporte.vista.de_viajes_ligados_a_un', { ligados: numero(ligados.ligados), total: numero(ligados.total) })}
          </p>
        )}
        {pocoLigado && (
          <Aviso tono="warn">
            {tx('cartaporte.vista.casi_ningun_viaje_liga_con')}
          </Aviso>
        )}
        {listado.truncado && (
          <Aviso tono="warn">
            {tx('cartaporte.vista.la_lista_esta_incompleta_hay')}
          </Aviso>
        )}
        {!listado.vacio && <TablaBase etiqueta={tx('cartaporte.vista.viajes_salidos_sin_carta_porte')} columnas={COLUMNAS_SIN_CCP(tx)} filas={filas} idFila={(f) => f.clave} densa tarjetaMovil />}
      </div>
    </Tarjeta>
  );
}

/**
 * CT-A345-04: avisa cuando los catálogos del SAT no están cargados. Con un catálogo vacío la validación NO puede decir que
 * una clave existe ni que no: degrada a «no se pudo verificar» y el PAC es quien valida al timbrar. Sin este aviso,
 * un documento «sin fallas» se leería como «clave verificada».
 */
export const TEXTO_CATALOGOS_SAT_VACIOS = TR_ES.t('cartaporte.vista.los_catalogos_del_sat_todavia');
export const TEXTO_CATALOGOS_SAT_NO_LEIDOS = TR_ES.t('cartaporte.vista.no_pudimos_comprobar_si_los');

export function AvisoCatalogosSat({ catalogosSat, tr = TR_ES }: { catalogosSat: ConteoCatalogosSat | 'no_leido'; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  if (catalogosSat === 'no_leido') {
    return <div data-catalogos-sat="no_leido"><AvisoCompacto tono="warn" resumen={tx('cartaporte.vista.no_pudimos_comprobar_si_los')} /></div>;
  }
  const { filas, vacios } = estadoCatalogosSat(catalogosSat);
  if (vacios.length === 0) return null;
  // Rovaq `notice-bar`: UNA línea con la acción «Ver cuáles son»; la lista de catálogos va detrás, no a 7 líneas de alto antes de la tira.
  return (
    <div data-catalogos-sat={vacios.length === filas.length ? 'vacios' : 'parcial'}>
      <AvisoCompacto
        tono="warn"
        resumen={vacios.length === filas.length ? tx('cartaporte.vista.los_catalogos_del_sat_todavia') : tx('cartaporte.vista.faltan_por_cargar_algunos_catalogos')}
        etiquetaMas={tx('f26d2.cp.ver_cuales')}
        mas={(
          <ul className="rv-cp__lista">
            {filas.map((f) => <li key={f.catalogo}>{f.nombre}: {f.n === 0 ? tx('cartaporte.vista.sin_cargar') : tx('cartaporte.vista.n_claves', { n: numero(f.n) })}</li>)}
          </ul>
        )}
      />
    </div>
  );
}
