import { cifrasUniformes } from '../../formato';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { TriangleAlert, Upload, Download, RotateCcw, Layers, Inbox } from 'lucide-react';
import { fechaHoraMx, numero, pesoArchivo, porcentaje, usd4 } from '@/lib/formato';
import { AVISO_SIN_REMITENTES } from '@/lib/correo/remitente';
import { soloMisCasos } from '@/lib/likida/carta_porte_docs/revisor';
import { prioridadEstado, ROTULO_CANAL, ROTULO_ESTADO, ROTULO_FORMATO } from '@/lib/likida/carta_porte_docs/presentacion';
import { MINUTOS_CAPTURA_MANUAL_EMBARQUE, type MetricasAgente } from '@/lib/likida/carta_porte_docs/metricas';
import type { DocumentoFila, EstadoEnvioTms } from '@/lib/likida/carta_porte_docs/repo';
import { BotonEnvio, FormaAccion, type AccionDoc } from './forma_accion';
import {
  AvisoCompacto, Aviso, BarraFiltros, BotonEnlace, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, CamposSistema, Disclosure, EstadoError, EstadoVacio,
  FiltroOpciones, Icono, StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import './documentos.css';

/**
 * LOS DOCUMENTOS DE TUS CLIENTES — la bandeja del Agente de Carta Porte multi-formato.
 *
 * Cada cliente grande manda la carga en SU formato (PDF, foto, Excel, XML, correo). Aquí entran por
 * tres canales —carga manual, el correo de la flota y WhatsApp—, el agente los lee, y una PERSONA
 * revisa lado a lado y aprueba. Aprobar produce un BORRADOR (viaje + mercancías) y, si lo pides, la
 * exportación al formato que tu cliente espera. Likida NO timbra: lo aprobado sigue el camino de
 * siempre hacia el PAC.
 *
 * Pura props, para poder mirarla con fixtures sin sesión.
 */

export interface PerfilVista {
  id: string; nombre: string; formato: string; versionActiva: number; mapeos: number;
  versiones: Array<{ version: number; nota: string | null; mapeos: number }>;
}
export interface BuzonVista { direccion: string | null; activo: boolean; remitentes: string[]; dominioConfigurado: boolean }
export interface ConfigVista { id: string; nombre: string; formato: 'csv' | 'json'; config: unknown }

/** De dónde viene un documento que nació de partir un archivo con varios embarques (0670), o cuántos hijos tiene el que se partió. */
export interface LinajeVista { rol: 'hijo' | 'padre'; indice: number | null; total: number; clave: string | null }

/** Los grupos del filtro «estado de envío» de la bandeja. `sin_envio` = aprobado que todavía no tiene envío al TMS. */
export type FiltroEnvio = 'todos' | 'sin_envio' | 'en_curso' | 'enviado' | 'rechazado_tms' | 'subido_a_mano';
const filtrosEnvioBase = (tr: Tr): ReadonlyArray<{ clave: FiltroEnvio; rotulo: string }> => [
  { clave: 'todos', rotulo: tr('cartaPorte.documentos.vista.filtroTodos') }, { clave: 'sin_envio', rotulo: tr('cartaPorte.documentos.vista.filtroSinEnvio') },
  { clave: 'en_curso', rotulo: tr('cartaPorte.documentos.vista.filtroEnCurso') }, { clave: 'enviado', rotulo: tr('cartaPorte.documentos.vista.filtroEnviados') },
  { clave: 'rechazado_tms', rotulo: tr('cartaPorte.documentos.vista.filtroRechazadosTms') }, { clave: 'subido_a_mano', rotulo: tr('cartaPorte.documentos.vista.filtroSubidosAMano') },
];
export const FILTROS_ENVIO: ReadonlyArray<{ clave: FiltroEnvio; rotulo: string }> = filtrosEnvioBase(trEs);
/** Con la flota sin conector, «en curso» sería falso: nada sale solo. La bandeja lo rotula «Por conectar». */
const rotuloPorConectar = (tr: Tr): string => tr('cartaPorte.documentos.vista.porConectar');
export const ROTULO_POR_CONECTAR = rotuloPorConectar(trEs);
export function filtrosEnvio(sinConexion: boolean | undefined, tr: Tr = trEs): ReadonlyArray<{ clave: FiltroEnvio; rotulo: string }> {
  const filtros = filtrosEnvioBase(tr);
  return sinConexion ? filtros.map((f) => (f.clave === 'en_curso' ? { ...f, rotulo: rotuloPorConectar(tr) } : f)) : filtros;
}
const EN_CURSO: ReadonlySet<EstadoEnvioTms> = new Set<EstadoEnvioTms>(['pendiente_prechequeo', 'pendiente_reque', 'listo', 'enviando', 'error_transitorio']);
const rotuloEnvioBase = (tr: Tr): Record<EstadoEnvioTms, string> => ({
  pendiente_prechequeo: tr('cartaPorte.documentos.vista.filtroEnCurso'), pendiente_reque: tr('cartaPorte.documentos.vista.filtroEnCurso'), listo: tr('cartaPorte.documentos.vista.filtroEnCurso'),
  enviando: tr('cartaPorte.documentos.vista.filtroEnCurso'), error_transitorio: tr('cartaPorte.documentos.vista.filtroEnCurso'),
  enviado: tr('cartaPorte.documentos.vista.envioEnviado'), rechazado_tms: tr('cartaPorte.documentos.vista.envioRechazadoTms'), subido_a_mano: tr('cartaPorte.documentos.vista.envioSubidoAMano'),
  descartado: tr('cartaPorte.documentos.vista.filtroSinEnvio'),
});
export function rotuloEnvio(e: EstadoEnvioTms, sinConexion: boolean | undefined, tr: Tr = trEs): string {
  return sinConexion && EN_CURSO.has(e) ? rotuloPorConectar(tr) : rotuloEnvioBase(tr)[e];
}
export function filtroEnvioDe(crudo: string | undefined): FiltroEnvio {
  return FILTROS_ENVIO.some((f) => f.clave === crudo) ? (crudo as FiltroEnvio) : 'todos';
}
/** ¿La fila entra en el filtro? Solo los aprobados tienen envío: con un filtro activo, el resto no se muestra. */
export function pasaFiltroEnvio(d: Pick<DocumentoFila, 'id' | 'estado'>, envios: Record<string, EstadoEnvioTms> | undefined, f: FiltroEnvio): boolean {
  if (f === 'todos') return true;
  if (d.estado !== 'aprobado') return false;
  const e = envios?.[d.id];
  if (f === 'sin_envio') return !e;
  if (!e) return false;
  return f === 'en_curso' ? EN_CURSO.has(e) : e === f;
}

export interface DatosDocumentos {
  filas: DocumentoFila[];
  /** Estado del envío al TMS por id de documento aprobado (sin clave = sin envío). */
  envios?: Record<string, EstadoEnvioTms>;
  /** La flota no tiene conector del sistema del cliente: los envíos «en curso» están por conectar (se suben a mano). */
  sinConexion?: boolean;
  /** Por id de documento. Vacío/ausente = nada se partió (o la base aún no tiene la 0670). */
  linaje?: Record<string, LinajeVista>;
  /**
   * T-A3-31. Por id de documento: la persona a la que le toca revisarlo. Solo salen los asignados.
   * `asignacionActiva` = la flota configuró un destinatario de revisión o ya hay casos asignados: SOLO entonces la bandeja
   * muestra la columna «Asignado a» y el filtro «Mis casos». Sin configuración, la bandeja es la de siempre.
   */
  asignados?: Record<string, string>;
  revisores?: Array<{ id: string; nombre: string }>;
  asignacionActiva?: boolean;
  total: number;
  metricas: MetricasAgente;
  perfiles: PerfilVista[];
  clientes: Array<{ id: string; nombre: string }>;
  buzon: BuzonVista | null;
  configs: ConfigVista[];
}

export interface AccionesDocumentos {
  subir: AccionDoc | null;
  procesar: AccionDoc | null;
  activarBuzon: AccionDoc | null;
  guardarRemitentes: AccionDoc | null;
  guardarExport: AccionDoc | null;
  borrarExport: AccionDoc | null;
  volverVersion: AccionDoc | null;
}

const TONO_ESTADO: Record<DocumentoFila['estado'], TonoEstado> = {
  por_revisar: 'warn', aprobado: 'ok', rechazado: 'muted', fallido: 'bad', recibido: 'neutral', procesando: 'info', dividido: 'muted',
};

export function VistaDocumentos({ datos, acciones, sufijo = '', apiSufijo = '', filtroEnvio = 'todos', perfilRestringido = false, soloMios = false, usuarioId = null, tr = trEs }: {
  datos: DatosDocumentos | null; acciones: AccionesDocumentos; sufijo?: string;
  /** El filtro «estado de envío» de la bandeja (viene de `?envio=`). */
  filtroEnvio?: FiltroEnvio;
  /** El `?tenant=…` para las descargas (que son GET a /api). */
  apiSufijo?: string;
  /** Flota bajo el perfil restringido: la bandeja habla del envío al TMS, no de viajes. */
  perfilRestringido?: boolean;
  /** «Mis casos» (viene de `?mios=1`) y quién es la persona de la sesión. */
  soloMios?: boolean;
  usuarioId?: string | null; tr?: Tr;
}) {
  return (
    <EsqueletoTablaMaestra
      titulo={tr('cartaPorte.documentos.vista.documentosDeClientes')}
      apoyo={tr('cartaPorte.documentos.vista.losDocumentosQueMandan')}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/carta-porte${sufijo}`}>{tr('cartaPorte.documentos.vista.volverACartaPorte')}</BotonEnlace>}
      avisos={(
        <>
          <Aviso tono="info">
            {rico(tr('cartaPorte.documentos.vista.tusClientesMandanLa'), { strong: (c) => <strong>{c}</strong> })}
          </Aviso>
          {datos?.metricas.parcial && (
            <AvisoCompacto tono="warn" resumen={tr('cartaPorte.documentos.vista.cifrasDeLosMas', { v: numero(datos.metricas.parcial.leidos), v2: numero(datos.metricas.parcial.total) })} />
          )}
        </>
      )}
      cifras={datos === null ? undefined : cifrasUniformes(cifrasMetricas(datos.metricas, tr))}
      etiquetaCifras={tr('cartaPorte.documentos.vista.metricasDelAgente')}
    >
      {datos === null ? (
        <EstadoError reintentar>{tr('cartaPorte.documentos.vista.noPudeLeerLos')}</EstadoError>
      ) : (
        <>
          {/* La bandeja es el bloque principal (Rovaq: tira → tabla de cargas → zona de soltar); la zona de subir va después. */}
          <Bandeja tr={tr} datos={datos} acciones={acciones} sufijo={sufijo} filtroEnvio={filtroEnvio} perfilRestringido={perfilRestringido} soloMios={soloMios} usuarioId={usuarioId} />
          {acciones.subir ? <Subir tr={tr} accion={acciones.subir} clientes={datos.clientes} metricas={datos.metricas} /> : <NotaMetricas tr={tr} m={datos.metricas} />}
          <Canales tr={tr} buzon={datos.buzon} acciones={acciones} />
          <Perfiles tr={tr} perfiles={datos.perfiles} acciones={acciones} />
          <Exportacion tr={tr} configs={datos.configs} acciones={acciones} apiSufijo={apiSufijo} />
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}

function cifrasMetricas(m: MetricasAgente, tr: Tr = trEs): PropsCifra[] {
  return [
    { info: 'carta_porte_docs.recibidos', etiqueta: tr('cartaPorte.documentos.vista.documentosRecibidos90Dias'), valor: numero(m.recibidos), nota: tr('cartaPorte.documentos.vista.porRevisarSinPoder', { v: numero(m.porRevisar), v2: numero(m.fallidos) }) },
    { info: 'carta_porte_docs.aprobados', etiqueta: tr('cartaPorte.documentos.vista.aprobados'), valor: numero(m.aprobados), nota: tr('cartaPorte.documentos.vista.rechazados', { n: numero(m.rechazados) }) },
    {
      info: 'carta_porte_docs.sin_correccion',
      etiqueta: tr('cartaPorte.documentos.vista.aprobadosSinCorreccion'),
      valor: m.pctSinCorreccion === null ? '—' : porcentaje(m.pctSinCorreccion, 0),
      nota: m.pctSinCorreccion === null ? tr('cartaPorte.documentos.vista.aunNoHayAprobados') : tr('cartaPorte.documentos.vista.deConfirmarUnDato', { v: numero(m.sinCorreccion), v2: numero(m.aprobados) }),
    },
    {
      info: 'carta_porte_docs.tiempo_ahorrado',
      etiqueta: tr('cartaPorte.documentos.vista.tiempoAhorradoPorEmbarque'),
      valor: m.minutosAhorradosPorEmbarque === null ? '—' : `${numero(m.minutosAhorradosPorEmbarque)} min`,
      nota: m.minutosAhorradosPorEmbarque === null
        ? tr('cartaPorte.documentos.vista.seCalculaConEl')
        : tr('cartaPorte.documentos.vista.estimacionMinDeCaptura', { v: numero(MINUTOS_CAPTURA_MANUAL_EMBARQUE), v2: numero(m.minutosRevisionPromedio ?? 0), v3: numero(m.aprobadosMedidos) }),
    },
  ];
}

function NotaMetricas({ m, tr = trEs }: { m: MetricasAgente; tr?: Tr }) {
  return (
    <p className="rv-doc__tenue">
      {tr('cartaPorte.documentos.vista.costoDeIaEn', { v: usd4(m.costoUsdTotal), v2: m.costoUsdPorDocumento !== null ? ' ' + tr('cartaPorte.documentos.vista.porDocumento', { v: usd4(m.costoUsdPorDocumento) }) : '', v3: m.sinModelo > 0 ? ' ' + tr('cartaPorte.documentos.vista.documentosSeLeyeronSin', { v: numero(m.sinModelo) }) : '', v4: m.aprobadosSinMedir > 0 ? ' ' + tr('cartaPorte.documentos.vista.aprobadosNoTienenTiempo', { v: numero(m.aprobadosSinMedir) }) : '' })}
    </p>
  );
}

function Subir({ accion, clientes, metricas, tr = trEs }: { accion: AccionDoc; clientes: Array<{ id: string; nombre: string }>; metricas: MetricasAgente; tr?: Tr }) {
  return (
    <Tarjeta titulo={tr('cartaPorte.documentos.vista.subirUnDocumento')} info="carta_porte_docs.subir">
      <FormaAccion accion={accion} enctype="multipart/form-data">
        {/* Zona de soltar de Rovaq (`/imports`): 1.5px dashed #d6d6d9 sobre el lienzo, radio 12, 20×16. Sin archivo elegido el envío queda apagado (punteado). */}
        <div className="rv-doc__zona">
          <CampoArchivo id="cp-archivo" name="archivo" required accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.xml,.eml,.txt"
            textoBoton={tr('cartaPorte.documentos.vista.seleccionarArchivo')} etiqueta={tr('cartaPorte.documentos.vista.archivoPdfFotoExcel')} />
        </div>
        <div className="rv-forma__rejilla">
          <CampoSelect id="cp-cliente" name="clienteId" defaultValue="" etiqueta={tr('cartaPorte.documentos.vista.deQueClienteEs')}>
            <option value="">{tr('cartaPorte.documentos.vista.sinIndicar')}</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </CampoSelect>
        </div>
        <BotonEnvio icono={<Icono icono={Upload} />} etiqueta={tr('cartaPorte.documentos.vista.subirYLeer')} pendiente={tr('cartaPorte.documentos.vista.leyendoElDocumento')} />
      </FormaAccion>
      <NotaMetricas tr={tr} m={metricas} />
    </Tarjeta>
  );
}

function Bandeja({ datos, acciones, sufijo, filtroEnvio, perfilRestringido, soloMios, usuarioId, tr = trEs }: { datos: DatosDocumentos; acciones: AccionesDocumentos; sufijo: string; filtroEnvio: FiltroEnvio; perfilRestringido: boolean; soloMios: boolean; usuarioId: string | null; tr?: Tr }) {
  const conAsignacion = datos.asignacionActiva === true;
  const mios = conAsignacion && soloMios && usuarioId !== null;
  const nombreDe = new Map((datos.revisores ?? []).map((r) => [r.id, r.nombre]));
  const base = datos.filas.filter((d) => pasaFiltroEnvio(d, datos.envios, filtroEnvio));
  const orden = (mios ? soloMisCasos(base, datos.asignados ?? {}, usuarioId) : base).sort((a, b) => prioridadEstado(a.estado) - prioridadEstado(b.estado) || (a.createdAt < b.createdAt ? 1 : -1));
  const cliente = new Map(datos.clientes.map((c) => [c.id, c.nombre]));
  const raiz = `/dashboard/carta-porte/documentos${sufijo}`;

  const faltaDe = (d: DocumentoFila) => {
    const v = d.validacion;
    const lin = datos.linaje?.[d.id];
    if (d.estado === 'por_revisar' && v) {
      return (
        <span className="rv-doc__falta">
          {v.bloqueos > 0 && <strong data-tono="bad">{tr('cartaPorte.documentos.vista.porCorregir', { v: numero(v.bloqueos) })}</strong>}
          {v.bloqueos > 0 && v.porConfirmar > 0 && ' · '}
          {v.porConfirmar > 0 && <strong data-tono="warn">{tr('cartaPorte.documentos.vista.porConfirmar', { v: numero(v.porConfirmar) })}</strong>}
          {v.bloqueos === 0 && v.porConfirmar === 0 && <span data-tono="ok">{tr('cartaPorte.documentos.vista.listoParaAprobar')}</span>}
        </span>
      );
    }
    if (d.estado === 'fallido') return <span className="rv-doc__falta"><span data-tono="bad">{d.ultimoError ?? tr('cartaPorte.documentos.vista.noSePudoLeer')}</span></span>;
    if (d.estado === 'aprobado') {
      const envio = datos.envios?.[d.id] ? rotuloEnvio(datos.envios[d.id], datos.sinConexion, tr) : tr('cartaPorte.documentos.vista.sinEnvio');
      return perfilRestringido ? (
        <span className="rv-doc__falta"><span data-tono="muted">{tr('cartaPorte.documentos.vista.envioAlTms2', { v: envio })}</span></span>
      ) : (
        <span className="rv-doc__falta">
          <span data-tono={d.viajeId ? 'ok' : 'warn'}>{d.viajeId ? tr('cartaPorte.documentos.vista.conViaje') : tr('cartaPorte.documentos.vista.sinViajeTodavia')}</span>
          <span data-tono="muted"> · {tr('cartaPorte.documentos.vista.tmsDosPuntos')} {envio}</span>
        </span>
      );
    }
    if (d.estado === 'rechazado') return <span className="rv-doc__falta"><span data-tono="muted">{d.rechazoMotivo}</span></span>;
    if (d.estado === 'dividido') return <span className="rv-doc__falta"><span data-tono="muted">{lin?.rol === 'padre' ? tr('cartaPorte.documentos.vista.traeEmbarquesCadaUno', { v: numero(lin.total) }) : tr('cartaPorte.documentos.vista.seSeparoEnUn')}</span></span>;
    return '—';
  };

  const columnas: ColumnaBase<DocumentoFila>[] = [
    { id: 'estado', titulo: tr('cartaPorte.documentos.vista.estado'), celda: (d) => <StatusChip tono={TONO_ESTADO[d.estado]}>{ROTULO_ESTADO[d.estado]}</StatusChip> },
    {
      id: 'archivo', titulo: tr('cartaPorte.documentos.vista.archivo'), principal: true,
      celda: (d) => {
        const lin = datos.linaje?.[d.id];
        return (
          <>
            <span className="rv-doc__archivo">{d.nombreArchivo}</span>
            <span className="rv-doc__sub">
              {pesoArchivo(d.bytes)}{d.clienteId && cliente.get(d.clienteId) ? ` · ${cliente.get(d.clienteId)}` : ''} · {ROTULO_FORMATO[d.formato] ?? d.formato} · {ROTULO_CANAL[d.canal] ?? d.canal}
              {d.riesgoInyeccion && <span data-tono="warn"> {tr('cartaPorte.documentos.vista.traeInstruccionesParaUn')}</span>}
            </span>
            {lin?.rol === 'hijo' && (
              <span className="rv-doc__sub rv-doc__sub--tenue">
                <Icono icono={Layers} tam={14} />{' '}
                {tr('cartaPorte.documentos.vista.embarqueDe', { n: numero(lin.indice ?? 0), total: numero(lin.total) })}{lin.clave ? ' ' + tr('cartaPorte.documentos.vista.folio', { clave: lin.clave }) : ''}
              </span>
            )}
          </>
        );
      },
    },
    { id: 'falta', titulo: tr('cartaPorte.documentos.vista.loQueFalta'), celda: faltaDe },
    ...(conAsignacion ? [{
      id: 'asignado', titulo: tr('cartaPorte.documentos.vista.asignadoA'),
      celda: (d: DocumentoFila) => datos.asignados?.[d.id]
        ? (nombreDe.get(datos.asignados[d.id]) ?? tr('cartaPorte.documentos.vista.otraPersona'))
        : <span className="rv-doc__sub">{d.estado === 'por_revisar' ? tr('cartaPorte.documentos.vista.todosLosRevisores') : '—'}</span>,
    } satisfies ColumnaBase<DocumentoFila>] : []),
    { id: 'recibido', titulo: tr('cartaPorte.documentos.vista.recibido'), celda: (d) => fechaHoraMx(d.createdAt) },
    {
      id: 'accion', titulo: tr('cartaPorte.documentos.vista.accion'), alinear: 'der',
      celda: (d) => (d.estado === 'recibido' || (d.estado === 'fallido' && d.intentos < 5)) && acciones.procesar ? (
        <FormaAccion accion={acciones.procesar} className="rv-doc__accion">
          <input type="hidden" name="documentoId" value={d.id} />
          <BotonEnvio variante="secundario" etiqueta={d.estado === 'fallido' ? tr('cartaPorte.documentos.vista.reintentar') : tr('cartaPorte.documentos.vista.leerAhora')} pendiente={tr('cartaPorte.documentos.vista.leyendo')} icono={<Icono icono={RotateCcw} />} />
        </FormaAccion>
      ) : (
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/carta-porte/documentos/${d.id}${sufijo}`}>
          {d.estado === 'por_revisar' ? tr('cartaPorte.documentos.vista.revisar') : tr('cartaPorte.documentos.vista.ver')}
        </BotonEnlace>
      ),
    },
  ];

  return (
    <Tarjeta titulo={tr('cartaPorte.documentos.vista.bandejaDeRevision')} info="carta_porte_docs.bandeja">
      <BarraFiltros etiqueta={tr('cartaPorte.documentos.vista.filtrosDeLaBandeja')} enLinea nActivos={(mios ? 1 : 0) + (filtroEnvio !== 'todos' ? 1 : 0)} limpiarHref={raiz}>
        {conAsignacion && usuarioId !== null && (
          <FiltroOpciones etiqueta={tr('cartaPorte.documentos.vista.asignacion')} valor={mios ? 'mios' : 'todos'} porDefecto="todos" ariaLabel={tr('cartaPorte.documentos.vista.filtrarPorPersona')}
            opciones={[
              { valor: 'todos', rotulo: tr('cartaPorte.documentos.vista.filtroTodos'), href: raiz },
              { valor: 'mios', rotulo: tr('cartaPorte.documentos.vista.misCasos'), href: `${raiz}${sufijo ? '&' : '?'}mios=1` },
            ]} />
        )}
        <FiltroOpciones etiqueta={tr('cartaPorte.documentos.vista.envioAlTms')} valor={filtroEnvio} porDefecto="todos" ariaLabel={tr('cartaPorte.documentos.vista.filtrarPorEstadoDe')}
          opciones={filtrosEnvio(datos.sinConexion, tr).map((f) => ({ valor: f.clave, rotulo: f.rotulo, href: f.clave === 'todos' ? raiz : `${raiz}${sufijo ? '&' : '?'}envio=${f.clave}` }))} />
      </BarraFiltros>
      {orden.length === 0 ? (
        // El vacío de la bandeja es una caja punteada como los demás vacíos de la página, no texto suelto.
        <EstadoVacio contenido icono={Inbox} titulo={mios ? tr('cartaPorte.documentos.vista.tituloSinCasos') : tr('cartaPorte.documentos.vista.tituloSinDocumentos')}>
          {mios
            ? tr('cartaPorte.documentos.vista.noTienesCasosAsignados')
            : filtroEnvio === 'todos'
            ? tr('cartaPorte.documentos.vista.todaviaNoHaLlegado')
            : tr('cartaPorte.documentos.vista.ningunDocumentoAprobadoTiene')}
        </EstadoVacio>
      ) : (
        <TablaBase
          etiqueta={tr('cartaPorte.documentos.vista.documentosDeCartaPorte')}
          columnas={columnas}
          filas={orden}
          idFila={(d) => d.id}
          tarjetaMovil
        />
      )}
      {datos.filas.length < datos.total && (
        <p className="rv-doc__nota">{tr('cartaPorte.documentos.vista.seMuestranDeLos', { v: numero(datos.filas.length), v2: numero(datos.total) })}</p>
      )}
    </Tarjeta>
  );
}

function Canales({ buzon, acciones, tr = trEs }: { buzon: BuzonVista | null; acciones: AccionesDocumentos; tr?: Tr }) {
  return (
    <section className="rv-doc__canales">
      <Tarjeta titulo={tr('cartaPorte.documentos.vista.correoDeTuFlota')} info="carta_porte_docs.correo">
        {buzon === null ? (
          <>
            <p className="rv-doc__nota">{tr('cartaPorte.documentos.vista.activaUnBuzonPropio')}</p>
            {acciones.activarBuzon && (
              <FormaAccion accion={acciones.activarBuzon}><BotonEnvio etiqueta={tr('cartaPorte.documentos.vista.activarBuzon')} /></FormaAccion>
            )}
          </>
        ) : (
          <>
            {buzon.direccion ? (
              <p className="rv-doc__nota">
                {tr('cartaPorte.documentos.vista.direccion')} <code className="rv-doc__codigo rv-doc__selecta">{buzon.direccion}</code>
                {!buzon.activo && <StatusChip tono="warn">{tr('cartaPorte.documentos.vista.apagado')}</StatusChip>}
              </p>
            ) : (
              <AvisoCompacto tono="warn" resumen={buzon.dominioConfigurado ? tr('cartaPorte.documentos.vista.laDireccionNoSe') : tr('cartaPorte.documentos.vista.elDominioDeCorreo')} />
            )}
            {buzon.activo && buzon.remitentes.length === 0 && <AvisoCompacto tono="warn" resumen={AVISO_SIN_REMITENTES} />}
            {acciones.guardarRemitentes && (
              <FormaAccion accion={acciones.guardarRemitentes}>
                <CampoTextarea id="cp-remitentes" name="remitentes" rows={3} defaultValue={buzon.remitentes.join('\n')}
                  etiqueta={tr('cartaPorte.documentos.vista.remitentesDeTusClientes')}
                  ayuda={tr('cartaPorte.documentos.vista.unCorreoDeOtro')} />
                <BotonEnvio variante="secundario" etiqueta={tr('cartaPorte.documentos.vista.guardarRemitentes')} />
              </FormaAccion>
            )}
          </>
        )}
      </Tarjeta>
      <Tarjeta titulo="WhatsApp" info="carta_porte_docs.whatsapp">
        <p className="rv-doc__nota">{tr('cartaPorte.documentos.vista.quienDespachaEnTu')}</p>
      </Tarjeta>
    </section>
  );
}

function Perfiles({ perfiles, acciones, tr = trEs }: { perfiles: PerfilVista[]; acciones: AccionesDocumentos; tr?: Tr }) {
  return (
    <Tarjeta titulo={tr('cartaPorte.documentos.vista.formatosQueLikidaYa')} info="carta_porte_docs.formatos">
      {perfiles.length === 0 ? (
        <EstadoVacio icono={Layers} contenido titulo={tr('cartaPorte.documentos.vista.tituloSinFormatos')}>{tr('cartaPorte.documentos.vista.todaviaNingunoCuandoApruebes')}</EstadoVacio>
      ) : (
        perfiles.map((p) => (
          <Disclosure key={p.id} titulo={p.nombre} resumen={tr('cartaPorte.documentos.vista.versionCamposReconocidos', { v: ROTULO_FORMATO[p.formato] ?? p.formato, versionActiva: p.versionActiva, v2: numero(p.mapeos) })}>
            <ul className="rv-doc__lista">
              {p.versiones.map((v) => (
                <li key={v.version}>
                  <span className="rv-doc__codigo">v{v.version}</span>
                  <span className="rv-doc__sub--tenue">{v.nota ?? tr('cartaPorte.documentos.vista.versionInicial')}</span>
                  {v.version === p.versionActiva ? (
                    <StatusChip tono="ok">{tr('cartaPorte.documentos.vista.activa')}</StatusChip>
                  ) : acciones.volverVersion && (
                    <FormaAccion accion={acciones.volverVersion} className="rv-doc__accion">
                      <input type="hidden" name="perfilId" value={p.id} /><input type="hidden" name="version" value={v.version} />
                      <BotonEnvio variante="secundario" etiqueta={tr('cartaPorte.documentos.vista.volverAEsta')} pendiente="…" />
                    </FormaAccion>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        ))
      )}
    </Tarjeta>
  );
}

const EJEMPLO_CONFIG = `{
  "porMercancia": true,
  "delimitador": ",",
  "columnas": [
    { "encabezado": "Folio", "campo": "folio_cliente" },
    { "encabezado": "RFC Remitente", "campo": "origen_rfc" },
    { "encabezado": "CP Origen", "campo": "origen_cp" },
    { "encabezado": "Producto", "campo": "mercancia.bienes_transp" },
    { "encabezado": "Peso kg", "campo": "mercancia.peso_kg" },
    { "encabezado": "Sistema", "constante": "LIKIDA" }
  ]
}`;

function Exportacion({ configs, acciones, apiSufijo, tr = trEs }: { configs: ConfigVista[]; acciones: AccionesDocumentos; apiSufijo: string; tr?: Tr }) {
  const liga = (config: string, formato: string) => `/api/export/carta-porte-docs?config=${encodeURIComponent(config)}&formato=${formato}${apiSufijo}`;
  const descarga = (href: string, rotulo: string, clave: string) => (
    <BotonEnlace key={clave} tamano="sm" variante="secondary" href={href} icono={<Icono icono={Download} />}>{rotulo}</BotonEnlace>
  );
  return (
    <Tarjeta titulo={tr('cartaPorte.documentos.vista.exportarLoAprobado')} info="carta_porte_docs.exportar">
      <p className="rv-doc__nota">
        {rico(tr('cartaPorte.documentos.vista.soloSalenDocumentosStrong'), { strong: (c) => <strong>{c}</strong> })}
      </p>
      <div className="rv-doc__enlaces">
        {descarga(liga('estandar', 'csv'), tr('cartaPorte.documentos.vista.estandarCsv'), 'csv')}
        {descarga(liga('estandar', 'json'), tr('cartaPorte.documentos.vista.estandarJson'), 'json')}
        {descarga(liga('estandar', 'xlsx'), tr('cartaPorte.documentos.vista.estandarExcel'), 'xlsx')}
        {/* A37-L-03: si una descarga se cortó, los aprobados ya figuran como exportados; esta liga los baja todos otra vez. */}
        {descarga(`${liga('estandar', 'csv')}&todos=1`, tr('cartaPorte.documentos.vista.volverADescargarTodos'), 'todos')}
        {configs.map((c) => descarga(liga(c.id, c.formato), `${c.nombre} · ${c.formato.toUpperCase()}`, c.id))}
        {configs.map((c) => descarga(liga(c.id, 'xlsx'), `${c.nombre} · ${tr('cartaPorte.documentos.vista.excel')}`, `${c.id}-xlsx`))}
      </div>
      {acciones.guardarExport && (
        <Disclosure variante="linea" titulo={tr('cartaPorte.documentos.vista.declararUnFormatoDestino')}>
          <FormaAccion accion={acciones.guardarExport} className="rv-doc__forma">
            <div className="rv-forma__rejilla">
              <CampoTexto id="cp-exp-nombre" name="nombre" required maxLength={80} placeholder={tr('cartaPorte.documentos.vista.clienteDemo')} etiqueta={tr('cartaPorte.documentos.vista.nombreSiYaExiste')} />
              <CampoSelect id="cp-exp-formato" name="formato" defaultValue="csv" etiqueta={tr('cartaPorte.documentos.vista.formato')}>
                <option value="csv">CSV</option><option value="json">JSON</option>
              </CampoSelect>
            </div>
            <CampoTextarea id="cp-exp-config" name="config" rows={10} required defaultValue={EJEMPLO_CONFIG} etiqueta={tr('cartaPorte.documentos.vista.mapeoJson')} claseControl="rv-doc__codigo"
              ayuda={<>{rico(tr('cartaPorte.documentos.vista.codePormercanciaFalseCode'), { code: (c) => <code>{c}</code> })}</>} />
            <Disclosure variante="linea" titulo={tr('cartaPorte.documentos.vista.camposDelSistema')}>
              <CamposSistema etiqueta={tr('cartaPorte.documentos.vista.camposQueSePueden')} campos={[
                { etiqueta: tr('cartaPorte.documentos.vista.delComplemento'), valor: <><code>origen_cp</code>, <code>destino_rfc</code>…</>, nota: tr('cartaPorte.documentos.vista.loQueSeLeyo') },
                { etiqueta: tr('cartaPorte.documentos.vista.deLaMercancia'), valor: <><code>mercancia.peso_kg</code>…</>, nota: tr('cartaPorte.documentos.vista.unaFilaPorPartida') },
                { etiqueta: tr('cartaPorte.documentos.vista.delSistema'), valor: <><code>documento.id</code>, <code>documento.archivo</code>, <code>documento.viaje_folio</code>…</>, nota: tr('cartaPorte.documentos.vista.losPoneLikidaNo') },
              ]} />
            </Disclosure>
            <BotonEnvio etiqueta={tr('cartaPorte.documentos.vista.guardarFormato')} />
          </FormaAccion>
          {configs.length > 0 && acciones.borrarExport && (
            <ul className="rv-doc__lista">
              {configs.map((c) => (
                <li key={c.id}>
                  <span>{c.nombre}</span>
                  <FormaAccion accion={acciones.borrarExport as AccionDoc} className="rv-doc__accion">
                    <input type="hidden" name="id" value={c.id} />
                    <BotonEnvio variante="peligro" etiqueta={tr('cartaPorte.documentos.vista.quitar')} pendiente="…"
                      confirmar={{ titulo: tr('cartaPorte.documentos.vista.quitarFormatoTitulo', { nombre: c.nombre }), descripcion: tr('cartaPorte.documentos.vista.quitarFormatoAlcance'), etiquetaConfirmar: tr('cartaPorte.documentos.vista.quitarFormato') }} />
                  </FormaAccion>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      )}
      <p className="rv-doc__pie">
        <Icono icono={TriangleAlert} tam={14} />
        {tr('cartaPorte.documentos.vista.elArchivoLoAbre')}
      </p>
    </Tarjeta>
  );
}
