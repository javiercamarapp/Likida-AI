import Link from 'next/link';
import { ArrowLeft, Upload, Trash2, KeyRound, Inbox, RefreshCw } from 'lucide-react';
import { numero } from '@/lib/formato';

// SOLO tipos: los módulos importan supabaseAdmin y no deben entrar al bundle de la vista.
import type {
  TagVista, CasetaVista, GeocercaVista, MapeoVista, ArchivoIngestaVista, CursoVista,
} from '@/lib/likida/peajes/datos';
import { SeccionEntradas, type AccionesEntradas, type EntradasVista } from './entradas';
import { SeccionReglasCobro, type ReglasCobroVista } from './reglas-cobro';
import { SeccionTarifario, type TarifarioVista } from './tarifario';
import { SeccionUmbralesAvisos, type UmbralesAvisosVista } from './umbrales-avisos';
import { SeccionCorreoAvisos, type CorreoAvisosVista } from './correo-avisos';
import { SeccionCruceViajes, type CruceViajesVista } from './cruce-viajes';
import { SeccionInmovilizadas, type InmovilizadasConfigVista } from './inmovilizadas';
import { SeccionClasesCobro, type ClasesCobroVista } from './clases-cobro';
import { MarcoPagina, BotonEnlace, EstadoVacio, Icono, StatusChip, TituloRecuadro, Boton, Disclosure, Tooltip } from '@/app/ui-v2/componentes';
import { SeccionConfig } from './seccion';
import '../peajes.css';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesConfiguracion extends AccionesEntradas {
  activarBuzon: Accion; desactivarBuzon: Accion; rotarLlave: Accion; reintentarArchivo: Accion;
  altaTag: Accion; bajaTag: Accion; importarTags: Accion;
  importarCasetas: Accion; estadoCaseta: Accion;
  guardarGeocerca: Accion; estadoGeocerca: Accion;
  importarCursos: Accion; importarCursosDeTabla: Accion; estadoCurso: Accion;
  guardarMapeo: Accion; borrarMapeo: Accion;
}

export interface BuzonVista {
  estado: 'activo' | 'inactivo' | 'ilegible';
  rotacion: number | null;
  /** ¿Está configurado PEAJES_INGESTA_SECRETO en el servidor? Sin él el endpoint rechaza todo. */
  secretoConfigurado: boolean;
  puedeAdministrar: boolean;
  /** La llave de firma de la flota; solo para quien administra y con el buzón activo. */
  llave: string | null;
  url: string;
  flotaId: string;
}

const ejemploFirma = (tx: TAgentes = TR_ES.t) => (tx('rest.node_18_llave_es_el_texto'));


export function VistaConfiguracionPeajes({
  sufijo, aviso, error, agenteApagado, tags, unidades, casetas, geocercas, cursos, convenios, mapeos, archivos, tiposGeocerca, buzon, entradas, acciones, reglasCobro, tarifario, umbralesAvisos, correoAvisos, cruceViajes, inmovilizadas, clasesCobro, superficie, tr = TR_ES,
}: {
  sufijo: string;
  aviso: string | null;
  error: string | null;
  agenteApagado: string | null;
  tags: TagVista[] | null;
  unidades: Array<{ id: string; numeroEconomico: string; placas: string | null }> | null;
  casetas: CasetaVista[] | null;
  geocercas: GeocercaVista[] | null;
  cursos: CursoVista[] | null;
  convenios: Array<{ id: string; nombre: string }> | null;
  mapeos: MapeoVista[] | null;
  archivos: ArchivoIngestaVista[] | null;
  tiposGeocerca: string[];
  buzon: BuzonVista;
  entradas: EntradasVista;
  acciones: AccionesConfiguracion;
  /** Las reglas de la revisión de cobros (clases por caseta, casetas prohibidas, TAGs de baja). Opcional. */
  reglasCobro?: ReglasCobroVista;
  /** El tarifario por caseta y clase (carga y confirmación). Opcional. */
  tarifario?: TarifarioVista;
  /** Umbrales de atípicos, plazo de reclamo, avisos e interruptores. Opcional. */
  umbralesAvisos?: UmbralesAvisosVista;
  /** Correo de los avisos: destinatarios, fecha de corte, interruptor y prueba. Opcional. */
  correoAvisos?: CorreoAvisosVista;
  /** Interruptor del cruce cobro ↔ viaje (por Icident). Opcional. */
  cruceViajes?: CruceViajesVista;
  /** Ventanas de unidades inmovilizadas (carga y borrado). Opcional. */
  inmovilizadas?: InmovilizadasConfigVista;
  /** Clases válidas del utilitario y regla de la clase 1. Opcional. */
  clasesCobro?: ClasesCobroVista;
  /** T-A2-31: con perfil `cinco_agentes` no se pintan geocercas ni cursos (stand-by). Sin la prop: todo, como siempre. */
  superficie?: { gps: boolean; cursos: boolean }; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('rest.configuracion_del_conciliador_de_peajes')} apoyo={tx('rest.buzon_entradas_y_mapeos_con_los')} acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/peajes${sufijo}`} icono={<Icono icono={ArrowLeft} />}>{tx('rest.volver_al_agente')}</BotonEnlace>}>
      {aviso && <p role="status" className="rv-pj-caja text-[12px] rv-pj-c-ink">{aviso}</p>}
      {error && <p role="alert" className="rv-pj-caja text-[12px] rv-pj-c-bad">{error}</p>}
      {agenteApagado && <p role="status" className="rv-pj-caja text-[12px] rv-pj-c-warn">{agenteApagado}</p>}

      <SeccionBuzon tr={tr} buzon={buzon} archivos={archivos} acciones={acciones} sufijo={sufijo} />
      <SeccionEntradas tr={tr} entradas={entradas} acciones={acciones} />
      <SeccionMapeo tr={tr} mapeos={mapeos} acciones={acciones} />
      {reglasCobro && <SeccionReglasCobro tr={tr} datos={reglasCobro} />}
      {clasesCobro && <SeccionClasesCobro tr={tr} datos={clasesCobro} />}
      {tarifario && <SeccionTarifario tr={tr} datos={tarifario} />}
      {umbralesAvisos && <SeccionUmbralesAvisos tr={tr} datos={umbralesAvisos} />}
      {correoAvisos && <SeccionCorreoAvisos tr={tr} datos={correoAvisos} />}
      {cruceViajes && <SeccionCruceViajes tr={tr} datos={cruceViajes} />}
      {inmovilizadas && <SeccionInmovilizadas tr={tr} datos={inmovilizadas} />}
      <SeccionTags tr={tr} tags={tags} unidades={unidades} acciones={acciones} />
      <SeccionCasetas tr={tr} casetas={casetas} acciones={acciones} />
      {(superficie?.gps ?? true) && <SeccionGeocercas tr={tr} geocercas={geocercas} tipos={tiposGeocerca} acciones={acciones} />}
      {(superficie?.cursos ?? true) && <SeccionCursos tr={tr} cursos={cursos} unidades={unidades} convenios={convenios} acciones={acciones} />}
    </MarcoPagina>
  );
}

function NoSePudoLeer({ que, tr = TR_ES }: { que: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.no_se_pudo_leer_ahora_mismo', { que })}</p>;
}

// ── Buzón firmado y archivos recibidos ──────────────────────────────────────
const etiquetaEstado = (tx: TAgentes = TR_ES.t): Record<string, string> => ({ pendiente: 'en cola', procesando: 'procesando', procesada: 'procesado', fallida: tx('rest.fallo_2') });

function SeccionBuzon({ buzon, archivos, acciones, sufijo, tr = TR_ES }: { buzon: BuzonVista; archivos: ArchivoIngestaVista[] | null; acciones: AccionesConfiguracion; sufijo: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <SeccionConfig id="buzon" titulo={tx('rest.buzon_automatico_del_proveedor')} info="peajes_config.buzon"
        nota={tx('rest.el_sistema_del_proveedor_o_un')}>
      {!buzon.secretoConfigurado && (
        <p className="text-[12px] mb-3 rv-pj-c-warn">{tx('rest.falta_configurar_la_llave_del_buzon')}</p>
      )}
      {buzon.estado === 'ilegible' ? (
        <NoSePudoLeer tr={tr} que={tx('rest.el_estado_del_buzon')} />
      ) : buzon.estado === 'inactivo' ? (
        <div className="flex items-center gap-2 flex-wrap">{ricoT(tx('rest.e0_buzon_desactivado_e0'), { e0: (c) => <span className="text-[12px] rv-pj-c-muted">{c}</span> })}{buzon.puedeAdministrar
            ? <form action={acciones.activarBuzon}><Boton type="submit" variante="primary" tamano="sm"><Icono icono={Inbox} />{' '}{tx('rest.activar_buzon')}</Boton></form>
            : <span className="text-[11px] rv-pj-c-faint">{tx('rest.solo_quien_administra_la_flota_lo_2')}</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-[12px]">{ricoT(tx('rest.e0_activo_e0_e1_llave_n', { rotacion: buzon.rotacion ?? '' }), { e0: (c) => <span className="cifra-mono rv-pj-pill" data-tono="ok">{c}</span>, e1: (c) => <span className="rv-pj-c-muted">{c}</span> })}{buzon.puedeAdministrar && (
              <>
                <form action={acciones.rotarLlave}>
                  <Tooltip texto={tx('rest.la_llave_anterior_deja_de_servir')}><Boton type="submit" variante="secondary" tamano="sm">
                    <Icono icono={KeyRound} />{tx('rest.rotar_llave')}</Boton></Tooltip>
                </form>
                <form action={acciones.desactivarBuzon}>
                  <Boton type="submit" variante="secondary" tamano="sm">{tx('rest.desactivar')}</Boton>
                </form>
              </>
            )}
          </div>
          <div className="grid gap-1.5 text-[12px]">
            <Campo etiqueta="URL" valor={buzon.url} />
            <Campo etiqueta={tx('rest.flota_cabecera_x_likida_flota')} valor={buzon.flotaId} />
            {buzon.puedeAdministrar && buzon.llave
              ? <Campo etiqueta={tx('rest.llave_de_firma_secreto_no_la')} valor={buzon.llave} />
              : <p className="rv-pj-c-faint">{tx('rest.la_llave_de_firma_solo_la')}</p>}
          </div>
          <Disclosure variante="linea" titulo={tx('rest.como_firmar_un_envio_ejemplo')}>
            <pre className="rv-pj-codigo">{ejemploFirma(tx)}</pre>
            <p className="mt-1.5 rv-pj-c-faint">{tx('rest.respuestas_202_aceptado_200_ya_lo')}</p>
          </Disclosure>
        </div>
      )}

      <TituloRecuadro nivel="h3" info="peajes_config.archivos_recibidos" className="mt-5 mb-2">{tx('rest.archivos_recibidos')}</TituloRecuadro>
      {archivos === null ? <NoSePudoLeer tr={tr} que="los archivos recibidos" /> : archivos.length === 0 ? (
        <EstadoVacio icono={Inbox} titulo={tx('rest.aun_sin_archivos')}>{tx('rest.aun_no_se_ha_recibido_ningun')}</EstadoVacio>
      ) : (
        <div className="space-y-1.5">
          {archivos.map((a) => (
            <div key={a.id} className="hairline rounded-lg px-2.5 py-2 text-[12px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate font-medium" title={a.nombre}>{a.nombre}</span>
                <span className={a.estado === 'fallida' ? 'rv-pj-c-bad' : a.estado === 'procesada' ? 'rv-pj-c-ok' : 'rv-pj-c-muted'}>{etiquetaEstado(tx)[a.estado] ?? a.estado}</span>
                <span className="text-[11px] rv-pj-c-faint">
                  {a.proveedor ? `${a.proveedor} · ` : ''}{numero(Math.round(a.bytes / 1024))}{' '}{tx('rest.kb_utc', { a: a.recibidaEn.slice(0, 16).replace('T', ' ') })}{a.intentos > 0 ? ` · ${a.intentos} intento${a.intentos === 1 ? '' : 's'}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {a.desgloseId && (
                    <Link href={`/dashboard/agentes/peajes${sufijo}${sufijo ? '&' : '?'}desglose=${a.desgloseId}`} className="text-[12px] rv-pj-c-marca">{tx('rest.ver_desglose')}</Link>
                  )}
                  {a.reintentable && (
                    <form action={acciones.reintentarArchivo}>
                      <input type="hidden" name="archivo" value={a.id} />
                      {/* A37-A2-01: los archivos de correo/SFTP llegan sin proveedor y su mapeo se busca por proveedor. */}
                      {!a.proveedor && (
                        <input name="proveedor" maxLength={60} placeholder={tx('rest.proveedor_p_ej_iave')} aria-label={tx('rest.proveedor_del_archivo')} className="hairline rounded px-1.5 py-0.5 text-[11px] w-36 mr-1" />
                      )}
                      <Boton type="submit" variante="secondary" tamano="sm">
                        <Icono icono={RefreshCw} />{tx('rest.reintentar')}</Boton>
                    </form>
                  )}
                </span>
              </div>
              {a.ultimoError && <p className="text-[11px] mt-1 rv-pj-c-bad">{a.ultimoError}</p>}
            </div>
          ))}
        </div>
      )}
    </SeccionConfig>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{etiqueta}</span>
      <input readOnly value={valor} className="w-full cifra-mono mt-0.5 rv-ctl" />
    </label>
  );
}

// ── Mapeo de columnas ───────────────────────────────────────────────────────
function SeccionMapeo({ mapeos, acciones, tr = TR_ES }: { mapeos: MapeoVista[] | null; acciones: AccionesConfiguracion; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <SeccionConfig id="mapeo" titulo={tx('rest.mapeo_de_columnas_por_proveedor')} info="peajes_config.mapeo"
        nota={<>{ricoT(tx('rest.el_lector_detecta_las_columnas_por'), { b: (c) => <b>{c}</b> })}</>}>
      {mapeos === null ? <NoSePudoLeer tr={tr} que="los mapeos" /> : mapeos.length === 0 ? (
        <p className="text-[12px] mb-3 rv-pj-c-muted">{tx('rest.ningun_proveedor_tiene_mapeo_todos_se')}</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {mapeos.map((m) => (
            <div key={m.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium">{m.proveedor}</span>
              <span className="text-[11px] cifra-mono rv-pj-c-muted">{tx('rest.fecha_caseta_importe', { fecha: m.columnas.fecha, caseta: m.columnas.caseta, monto: m.columnas.monto })}{m.columnas.hora ? ` · hora=«${m.columnas.hora}»` : ''}{m.columnas.tag ? ` · TAG=«${m.columnas.tag}»` : ''}{m.columnas.unidad ? ` · unidad=«${m.columnas.unidad}»` : ''}{m.columnas.clase ? ` · clase=«${m.columnas.clase}»` : ''}
              </span>
              <form action={acciones.borrarMapeo} className="ml-auto">
                <input type="hidden" name="mapeo" value={m.id} />
                <Boton type="submit" aria-label={tx('rest.eliminar_el_mapeo_de', { proveedor: m.proveedor })} variante="secondary" tamano="sm"><Icono icono={Trash2} /></Boton>
              </form>
            </div>
          ))}
        </div>
      )}
      <form action={acciones.guardarMapeo} className="flex items-end gap-2 flex-wrap">
        <Entrada nombre="proveedor" etiqueta={tx('rest.proveedor')} ph="PASE" requerido ancho="w-[110px]" />
        <Entrada nombre="fecha" etiqueta={tx('proveedores.vista.fecha')} ph={tx('rest.fecha_de_cobro')} requerido />
        <Entrada nombre="hora" etiqueta={tx('rest.hora_opc')} ph="Hora" ancho="w-[100px]" />
        <Entrada nombre="caseta" etiqueta={tx('rest.caseta')} ph="Plaza" requerido ancho="w-[120px]" />
        <Entrada nombre="monto" etiqueta={tx('rest.importe')} ph="Importe" requerido ancho="w-[110px]" />
        <Entrada nombre="tag" etiqueta={tx('rest.tag_opc')} ph={tx('rest.no_tag')} ancho="w-[110px]" />
        <Entrada nombre="unidad" etiqueta={tx('rest.unidad_opc')} ph={tx('rest.no_economico')} ancho="w-[120px]" />
        <Entrada nombre="clase" etiqueta={tx('rest.clase_opc')} ph="Clase" ancho="w-[90px]" />
        <Boton type="submit" variante="primary" tamano="sm">{tx('rest.guardar_mapeo')}</Boton>
      </form>
      <p className="text-[11px] mt-1.5 rv-pj-c-faint">{tx('rest.guardar_el_mismo_proveedor_de_nuevo')}</p>
    </SeccionConfig>
  );
}

function Entrada({ nombre, etiqueta, ph, requerido, ancho }: { nombre: string; etiqueta: string; ph: string; requerido?: boolean; ancho?: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{etiqueta}</span>
      <input name={nombre} placeholder={ph} required={requerido} maxLength={80} className={`${ancho ?? 'w-[140px]'} mt-0.5 rv-ctl`} />
    </label>
  );
}

function SubirCsv({ accion, etiqueta, extra, tr = TR_ES }: { accion: Accion; etiqueta: string; extra?: React.ReactNode; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <form action={accion} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
      <input type="file" name="archivo" accept=".csv,.tsv,.xlsx,.xls,.ods" required aria-label={etiqueta}
        className="text-[12px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:cursor-pointer rv-pj-c-muted" />
      {extra}
      <Boton type="submit" variante="primary" tamano="sm"><Icono icono={Upload} />{' '}{tx('rest.cargar')}</Boton>
    </form>
  );
}

// ── TAGs ────────────────────────────────────────────────────────────────────
function SeccionTags({ tags, unidades, acciones, tr = TR_ES }: { tags: TagVista[] | null; unidades: Array<{ id: string; numeroEconomico: string; placas: string | null }> | null; acciones: AccionesConfiguracion; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <SeccionConfig id="tags" titulo={tx('rest.tags_de_telepeaje_por_unidad')} info="peajes_config.tags"
        nota={<>{ricoT(tx('rest.que_tag_es_de_que_camion'), { b: (c) => <b>{c}</b>, e1: (c) => <span className="cifra-mono">{c}</span> })}</>}>
      <SubirCsv tr={tr} accion={acciones.importarTags} etiqueta={tx('rest.csv_de_tags')} />
      <form action={acciones.altaTag} className="flex items-end gap-2 flex-wrap mt-3">
        <Entrada nombre="tag" etiqueta="TAG" ph={tx('rest.imdm_12345678')} requerido />
        <label className="block">{ricoT(tx('rest.e0_unidad_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<select name="unidad" required className="w-[170px] mt-0.5 rv-ctl" defaultValue="">
            <option value="" disabled>{tx('rest.elige')}</option>
            {(unidades ?? []).map((u) => <option key={u.id} value={u.id}>{u.numeroEconomico}{u.placas ? ` · ${u.placas}` : ''}</option>)}
          </select>
        </label>
        <Entrada nombre="proveedor" etiqueta={tx('rest.proveedor_opc')} ph="PASE" ancho="w-[110px]" />
        <Boton type="submit" variante="primary" tamano="sm">{tx('rest.agregar_tag')}</Boton>
      </form>
      {tags === null ? <NoSePudoLeer tr={tr} que="los TAGs" /> : tags.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.aun_no_hay_tags_dados_de')}</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{numero(tags.length)} TAGs</p>
          {tags.slice(0, 300).map((t) => (
            <div key={t.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="cifra-mono">{t.tagOriginal ?? t.tag}</span>
              <span className="rv-pj-c-muted">→ {t.unidadEconomico ?? tx('rest.unidad_borrada')}</span>
              {t.proveedor && <span className="text-[11px] rv-pj-c-faint">{t.proveedor}</span>}
              {t.bajaEn ? (
                <span className="text-[11px] rv-pj-c-warn">{tx('rest.baja_desde_el')}{' '}{t.bajaEn}{t.bajaMotivo ? ` · ${t.bajaMotivo}` : ''}{tx('rest.un_cruce_posterior_a_esa_fecha')}</span>
              ) : (
                <form action={acciones.bajaTag} className="ml-auto flex items-end gap-1.5 flex-wrap">
                  <input type="hidden" name="tag" value={t.id} />
                  <label className="block">{ricoT(tx('rest.e0_ultimo_dia_en_uso_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input type="date" name="fecha" required className="mt-0.5 rv-ctl rv-ctl--fecha" />
                  </label>
                  <Entrada nombre="motivo" etiqueta={tx('rest.motivo')} ph={tx('rest.unidad_siniestrada')} ancho="w-[150px]" />
                  <Boton type="submit" aria-label={tx('rest.eliminar_el_tag_del_uso_se', { tag: t.tag })} variante="secondary" tamano="sm">
                    <Icono icono={Trash2} />{' '}{tx('rest.dar_de_baja')}</Boton>
                </form>
              )}
            </div>
          ))}
          {tags.length > 300 && <p className="text-[11px] rv-pj-c-faint">{tx('rest.se_muestran_los_primeros_300')}</p>}
        </div>
      )}
    </SeccionConfig>
  );
}

// ── Casetas ─────────────────────────────────────────────────────────────────
function SeccionCasetas({ casetas, acciones, tr = TR_ES }: { casetas: CasetaVista[] | null; acciones: AccionesConfiguracion; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <SeccionConfig id="casetas" titulo={tx('rest.catalogo_de_casetas')} info="peajes_config.casetas"
        nota={<>{ricoT(tx('rest.las_casetas_por_nombre_lo_unico'), { b: (c) => <b>{c}</b>, e2: (c) => <span className="cifra-mono">{c}</span> })}</>}>
      <SubirCsv tr={tr} accion={acciones.importarCasetas} etiqueta={tx('rest.csv_de_casetas')}
        extra={<input name="fuente" placeholder={tx('rest.fuente_de_las_coordenadas')} aria-label={tx('rest.fuente_de_las_coordenadas')} maxLength={200} className="w-[230px] rv-ctl" />} />
      {casetas === null ? <NoSePudoLeer tr={tr} que="las casetas" /> : casetas.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.catalogo_vacio_el_cruce_por_caseta')}</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{numero(casetas.filter((c) => c.activa).length)}{' '}{tx('rest.activas_de')}{' '}{numero(casetas.length)}</p>
          {casetas.slice(0, 300).map((c) => (
            <div key={c.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px] rv-pj-fila" data-apagada={c.activa ? undefined : ''}>
              <span className="font-medium">{c.nombre}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-muted">{c.lat !== null && c.lng !== null ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · ${c.radioM} m` : tx('rest.sin_coordenadas_solo_por_nombre')}</span>
              {c.carretera && <span className="text-[11px] rv-pj-c-muted">{c.carretera}</span>}
              {c.porPasada && <StatusChip tono="ok">{tx('rest.por_pasada')}</StatusChip>}
              {c.fuente && <span className="text-[11px] rv-pj-c-faint">{c.fuente}</span>}
              <form action={acciones.estadoCaseta} className="ml-auto">
                <input type="hidden" name="caseta" value={c.id} />
                <input type="hidden" name="activa" value={c.activa ? 'false' : 'true'} />
                <Boton type="submit" variante="secondary" tamano="sm">{c.activa ? tx('rest.desactivar') : tx('rest.activar')}</Boton>
              </form>
            </div>
          ))}
        </div>
      )}
    </SeccionConfig>
  );
}

// ── Geocercas ───────────────────────────────────────────────────────────────
function SeccionGeocercas({ geocercas, tipos, acciones, tr = TR_ES }: { geocercas: GeocercaVista[] | null; tipos: string[]; acciones: AccionesConfiguracion; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <SeccionConfig id="geocercas" titulo="Geocercas" info="peajes_config.geocercas"
        nota={tx('rest.circulos_centro_y_radio_para_patios')}>
      <form action={acciones.guardarGeocerca} className="flex items-end gap-2 flex-wrap">
        <Entrada nombre="nombre" etiqueta={tx('conductores.forma.nombre')} ph={tx('rest.patio_queretaro')} requerido />
        <label className="block">{ricoT(tx('rest.e0_tipo_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<select name="tipo" className="w-[130px] mt-0.5 rv-ctl" defaultValue="punto_interes">
            {tipos.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </label>
        <Entrada nombre="lat" etiqueta={tx('rest.latitud')} ph="20.5888" requerido ancho="w-[100px]" />
        <Entrada nombre="lng" etiqueta={tx('rest.longitud')} ph="-100.3899" requerido ancho="w-[100px]" />
        <Entrada nombre="radio_m" etiqueta={tx('rest.radio_m')} ph="300" requerido ancho="w-[80px]" />
        <Boton type="submit" variante="primary" tamano="sm">{tx('rest.guardar_geocerca')}</Boton>
      </form>
      {geocercas === null ? <NoSePudoLeer tr={tr} que="las geocercas" /> : geocercas.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.aun_no_hay_geocercas')}</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[280px] overflow-y-auto">
          {geocercas.map((g) => (
            <div key={g.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px] rv-pj-fila" data-apagada={g.activa ? undefined : ''}>
              <span className="font-medium">{g.nombre}</span>
              <span className="text-[11px] rv-pj-c-faint">{g.tipo.replace('_', ' ')}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-muted">{g.lat.toFixed(5)}, {g.lng.toFixed(5)} · {g.radioM} m</span>
              <form action={acciones.estadoGeocerca} className="ml-auto">
                <input type="hidden" name="geocerca" value={g.id} />
                <input type="hidden" name="activa" value={g.activa ? 'false' : 'true'} />
                <Boton type="submit" variante="secondary" tamano="sm">{g.activa ? tx('rest.desactivar') : tx('rest.activar')}</Boton>
              </form>
            </div>
          ))}
        </div>
      )}
    </SeccionConfig>
  );
}

// ── Cursos (rutas autorizadas) ──────────────────────────────────────────────
function SeccionCursos({ cursos, unidades, convenios, acciones, tr = TR_ES }: {
  cursos: CursoVista[] | null;
  unidades: Array<{ id: string; numeroEconomico: string }> | null;
  convenios: Array<{ id: string; nombre: string }> | null;
  acciones: AccionesConfiguracion; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const eco = new Map((unidades ?? []).map((u) => [u.id, u.numeroEconomico]));
  const conv = new Map((convenios ?? []).map((c) => [c.id, c.nombre]));
  return (
    <SeccionConfig id="cursos" titulo={tx('rest.cursos_rutas_autorizadas')} info="peajes_config.cursos"
        nota={<>{ricoT(tx('rest.las_casetas_que_cada_unidad_o'), { b: (c) => <b>{c}</b>, e1: (c) => <span className="cifra-mono">{c}</span>, e2: (c) => <span className="cifra-mono">{c}</span>, e3: (c) => <span className="cifra-mono">{c}</span> })}</>}>
      <SubirCsv tr={tr} accion={acciones.importarCursos} etiqueta={tx('rest.csv_de_cursos')} />
      <form action={acciones.importarCursosDeTabla} className="mt-2">
        <Boton type="submit" variante="secondary" tamano="sm">{tx('rest.leer_los_cursos_de_mi_tabla')}</Boton>
      </form>
      {cursos === null ? <NoSePudoLeer tr={tr} que="los cursos" /> : cursos.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.aun_no_hay_cursos_el_reporte')}</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{numero(cursos.filter((c) => c.activo).length)}{' '}{tx('rest.activos_de')}{' '}{numero(cursos.length)}</p>
          {cursos.slice(0, 300).map((c) => (
            <div key={c.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px] rv-pj-fila" data-apagada={c.activo ? undefined : ''}>
              <span className="font-medium">{c.nombre}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-faint">{c.codigo}</span>
              <span className="text-[11px] rv-pj-c-muted">
                {[c.unidadId ? `unidad ${eco.get(c.unidadId) ?? '—'}` : null, c.convenioId ? `convenio ${conv.get(c.convenioId) ?? '—'}` : null].filter(Boolean).join(' · ')}
              </span>
              <span className="text-[11px] rv-pj-c-muted">
                {c.tipo === 'casetas' ? c.casetas.map((k) => k.nombre || '—').join(' → ') : `corredor de ${numero(c.corredor?.length ?? 0)} puntos · ±${numero(c.bufferM ?? 0)} m`}
              </span>
              {(c.vigenteDesde || c.vigenteHasta) && <span className="text-[11px] rv-pj-c-faint">{c.vigenteDesde ?? '…'} a {c.vigenteHasta ?? '…'}</span>}
              <form action={acciones.estadoCurso} className="ml-auto">
                <input type="hidden" name="curso" value={c.id} />
                <input type="hidden" name="activo" value={c.activo ? 'false' : 'true'} />
                <Boton type="submit" variante="secondary" tamano="sm">{c.activo ? tx('rest.desactivar') : tx('rest.activar')}</Boton>
              </form>
            </div>
          ))}
        </div>
      )}
    </SeccionConfig>
  );
}
