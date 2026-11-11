import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import Link from 'next/link';
import { FileInput, TriangleAlert, Mail, MessageCircle, Upload, Download, RotateCcw, Layers } from 'lucide-react';
import { EstadoVacio, EstadoError } from '../../estados';
import { fechaHoraMx, numero, pesoArchivo, porcentaje, usd4 } from '@/lib/formato';
import { AVISO_SIN_REMITENTES } from '@/lib/correo/remitente';
import { soloMisCasos } from '@/lib/likida/carta_porte_docs/revisor';
import { prioridadEstado, ROTULO_CANAL, ROTULO_ESTADO, ROTULO_FORMATO } from '@/lib/likida/carta_porte_docs/presentacion';
import { MINUTOS_CAPTURA_MANUAL_EMBARQUE, type MetricasAgente } from '@/lib/likida/carta_porte_docs/metricas';
import type { DocumentoFila, EstadoEnvioTms } from '@/lib/likida/carta_porte_docs/repo';
import { BotonEnvio, FormaAccion, type AccionDoc } from './forma_accion';
import { BarraFiltros, CamposSistema, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, Disclosure, FiltroOpciones, MarcoPagina, Aviso, BotonEnlace, TituloRecuadro, InfoTip } from '@/app/ui-v2/componentes';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';

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

const PILL: Record<DocumentoFila['estado'], { fg: string; bg: string }> = {
  por_revisar: { fg: 'var(--warn)', bg: 'var(--warnbg, var(--canvas))' },
  aprobado: { fg: 'var(--ok)', bg: 'var(--okbg)' },
  rechazado: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  fallido: { fg: 'var(--bad)', bg: 'var(--badbg)' },
  recibido: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  procesando: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  dividido: { fg: 'var(--muted)', bg: 'var(--canvas)' },
};

function Cifra({ rotulo, valor, nota, info }: { rotulo: string; valor: string; nota?: string; info: InfoClave }) {
  return (
    <div className="card p-3.5 space-y-0.5">
      <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--muted)' }}>{rotulo}<InfoTip clave={info} /></p>
      <p className="cifra-mono text-[20px] font-medium">{valor}</p>
      {nota && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{nota}</p>}
    </div>
  );
}

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
    <MarcoPagina titulo={tr('cartaPorte.documentos.vista.documentosDeClientes')} apoyo={tr('cartaPorte.documentos.vista.losDocumentosQueMandan')} acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/carta-porte${sufijo}`}>{tr('cartaPorte.documentos.vista.volverACartaPorte')}</BotonEnlace>}>
      <Aviso tono="info">
        {rico(tr('cartaPorte.documentos.vista.tusClientesMandanLa'), { strong: (c) => <strong>{c}</strong> })}
      </Aviso>

      {datos === null ? (
        <EstadoError mensaje={tr('cartaPorte.documentos.vista.noPudeLeerLos')} />
      ) : (
        <>
          <Metricas tr={tr} m={datos.metricas} />
          {acciones.subir && <Subir tr={tr} accion={acciones.subir} clientes={datos.clientes} />}
          <Bandeja tr={tr} datos={datos} acciones={acciones} sufijo={sufijo} filtroEnvio={filtroEnvio} perfilRestringido={perfilRestringido} soloMios={soloMios} usuarioId={usuarioId} />
          <Canales tr={tr} buzon={datos.buzon} acciones={acciones} />
          <Perfiles tr={tr} perfiles={datos.perfiles} acciones={acciones} />
          <Exportacion tr={tr} configs={datos.configs} acciones={acciones} apiSufijo={apiSufijo} />
        </>
      )}
    </MarcoPagina>
  );
}

function Metricas({ m, tr = trEs }: { m: MetricasAgente; tr?: Tr }) {
  return (
    <section className="space-y-2" aria-label={tr('cartaPorte.documentos.vista.metricasDelAgente')}>
      {m.parcial && (
        <p className="text-[12px]" role="note" style={{ color: 'var(--warn)' }}>
          {tr('cartaPorte.documentos.vista.cifrasDeLosMas', { v: numero(m.parcial.leidos), v2: numero(m.parcial.total) })}
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Cifra info="carta_porte_docs.recibidos" rotulo={tr('cartaPorte.documentos.vista.documentosRecibidos90Dias')} valor={numero(m.recibidos)} nota={tr('cartaPorte.documentos.vista.porRevisarSinPoder', { v: numero(m.porRevisar), v2: numero(m.fallidos) })} />
        <Cifra info="carta_porte_docs.aprobados" rotulo={tr('cartaPorte.documentos.vista.aprobados')} valor={numero(m.aprobados)} nota={`${numero(m.rechazados)} rechazados`} />
        <Cifra
          info="carta_porte_docs.sin_correccion"
          rotulo={tr('cartaPorte.documentos.vista.aprobadosSinCorreccion')}
          valor={m.pctSinCorreccion === null ? '—' : porcentaje(m.pctSinCorreccion, 0)}
          nota={m.pctSinCorreccion === null ? tr('cartaPorte.documentos.vista.aunNoHayAprobados') : tr('cartaPorte.documentos.vista.deConfirmarUnDato', { v: numero(m.sinCorreccion), v2: numero(m.aprobados) })}
        />
        <Cifra
          info="carta_porte_docs.tiempo_ahorrado"
          rotulo={tr('cartaPorte.documentos.vista.tiempoAhorradoPorEmbarque')}
          valor={m.minutosAhorradosPorEmbarque === null ? '—' : `${numero(m.minutosAhorradosPorEmbarque)} min`}
          nota={m.minutosAhorradosPorEmbarque === null
            ? tr('cartaPorte.documentos.vista.seCalculaConEl')
            : tr('cartaPorte.documentos.vista.estimacionMinDeCaptura', { v: numero(MINUTOS_CAPTURA_MANUAL_EMBARQUE), v2: numero(m.minutosRevisionPromedio ?? 0), v3: numero(m.aprobadosMedidos) })}
        />
      </div>
      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
        {tr('cartaPorte.documentos.vista.costoDeIaEn', { v: usd4(m.costoUsdTotal), v2: m.costoUsdPorDocumento !== null ? ' ' + tr('cartaPorte.documentos.vista.porDocumento', { v: usd4(m.costoUsdPorDocumento) }) : '', v3: m.sinModelo > 0 ? ' ' + tr('cartaPorte.documentos.vista.documentosSeLeyeronSin', { v: numero(m.sinModelo) }) : '', v4: m.aprobadosSinMedir > 0 ? ' ' + tr('cartaPorte.documentos.vista.aprobadosNoTienenTiempo', { v: numero(m.aprobadosSinMedir) }) : '' })}
      </p>
    </section>
  );
}

function Subir({ accion, clientes, tr = trEs }: { accion: AccionDoc; clientes: Array<{ id: string; nombre: string }>; tr?: Tr }) {
  return (
    <section className="card p-4 space-y-3">
      <TituloRecuadro info="carta_porte_docs.subir"><Upload width={14} height={14} strokeWidth={1.75} /> {tr('cartaPorte.documentos.vista.subirUnDocumento')}</TituloRecuadro>
      <FormaAccion accion={accion} enctype="multipart/form-data">
        <div className="rv-forma__rejilla">
          <CampoArchivo id="cp-archivo" name="archivo" required accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.xml,.eml,.txt"
            etiqueta={tr('cartaPorte.documentos.vista.archivoPdfFotoExcel')} />
          <CampoSelect id="cp-cliente" name="clienteId" defaultValue="" etiqueta={tr('cartaPorte.documentos.vista.deQueClienteEs')}>
            <option value="">{tr('cartaPorte.documentos.vista.sinIndicar')}</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </CampoSelect>
        </div>
        <BotonEnvio etiqueta={tr('cartaPorte.documentos.vista.subirYLeer')} pendiente="Leyendo el documento…" />
      </FormaAccion>
    </section>
  );
}

function Bandeja({ datos, acciones, sufijo, filtroEnvio, perfilRestringido, soloMios, usuarioId, tr = trEs }: { datos: DatosDocumentos; acciones: AccionesDocumentos; sufijo: string; filtroEnvio: FiltroEnvio; perfilRestringido: boolean; soloMios: boolean; usuarioId: string | null; tr?: Tr }) {
  const conAsignacion = datos.asignacionActiva === true;
  const mios = conAsignacion && soloMios && usuarioId !== null;
  const nombreDe = new Map((datos.revisores ?? []).map((r) => [r.id, r.nombre]));
  const base = datos.filas.filter((d) => pasaFiltroEnvio(d, datos.envios, filtroEnvio));
  const orden = (mios ? soloMisCasos(base, datos.asignados ?? {}, usuarioId) : base).sort((a, b) => prioridadEstado(a.estado) - prioridadEstado(b.estado) || (a.createdAt < b.createdAt ? 1 : -1));
  const cliente = new Map(datos.clientes.map((c) => [c.id, c.nombre]));
  return (
    <section className="space-y-2">
      <TituloRecuadro info="carta_porte_docs.bandeja">{tr('cartaPorte.documentos.vista.bandejaDeRevision')}</TituloRecuadro>
      <BarraFiltros etiqueta={tr('cartaPorte.documentos.vista.filtrosDeLaBandeja')} enLinea nActivos={(mios ? 1 : 0) + (filtroEnvio !== 'todos' ? 1 : 0)} limpiarHref={`/dashboard/carta-porte/documentos${sufijo}`}>
        {conAsignacion && usuarioId !== null && (
          <FiltroOpciones etiqueta={tr('cartaPorte.documentos.vista.asignacion')} valor={mios ? 'mios' : 'todos'} porDefecto="todos" ariaLabel="Filtrar por persona asignada"
            opciones={[
              { valor: 'todos', rotulo: 'Todos', href: `/dashboard/carta-porte/documentos${sufijo}` },
              { valor: 'mios', rotulo: 'Mis casos', href: `/dashboard/carta-porte/documentos${sufijo}${sufijo ? '&' : '?'}mios=1` },
            ]} />
        )}
        <FiltroOpciones etiqueta={tr('cartaPorte.documentos.vista.envioAlTms')} valor={filtroEnvio} porDefecto="todos" ariaLabel={tr('cartaPorte.documentos.vista.filtrarPorEstadoDe')}
          opciones={filtrosEnvio(datos.sinConexion, tr).map((f) => ({ valor: f.clave, rotulo: f.rotulo, href: f.clave === 'todos' ? `/dashboard/carta-porte/documentos${sufijo}` : `/dashboard/carta-porte/documentos${sufijo}${sufijo ? '&' : '?'}envio=${f.clave}` }))} />
      </BarraFiltros>
      {orden.length === 0 ? (
        <EstadoVacio icono={<FileInput width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {mios
            ? tr('cartaPorte.documentos.vista.noTienesCasosAsignados')
            : filtroEnvio === 'todos'
            ? tr('cartaPorte.documentos.vista.todaviaNoHaLlegado')
            : tr('cartaPorte.documentos.vista.ningunDocumentoAprobadoTiene')}
        </EstadoVacio>
      ) : (
        <div className="card overflow-x-auto">
          <table aria-label={tr('cartaPorte.documentos.vista.documentosDeCartaPorte')} className="w-full text-[12px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                {[tr('cartaPorte.documentos.vista.estado'), tr('cartaPorte.documentos.vista.archivo'), tr('cartaPorte.documentos.vista.formatoCanal'), tr('cartaPorte.documentos.vista.loQueFalta'), ...(conAsignacion ? [tr('cartaPorte.documentos.vista.asignadoA')] : []), tr('cartaPorte.documentos.vista.recibido'), ''].map((h) => <th scope="col" key={h} className="px-3 py-2 font-medium text-[11px]">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {orden.map((d) => {
                const p = PILL[d.estado];
                const v = d.validacion;
                const lin = datos.linaje?.[d.id];
                return (
                  <tr key={d.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-3 py-2"><span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: p.fg, background: p.bg }}>{ROTULO_ESTADO[d.estado]}</span></td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <p className="truncate font-medium">{d.nombreArchivo}</p>
                      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                        {pesoArchivo(d.bytes)}{d.clienteId && cliente.get(d.clienteId) ? ` · ${cliente.get(d.clienteId)}` : ''}
                        {d.riesgoInyeccion && <span style={{ color: 'var(--warn)' }}> {tr('cartaPorte.documentos.vista.traeInstruccionesParaUn')}</span>}
                      </p>
                      {lin?.rol === 'hijo' && (
                        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                          <Layers width={11} height={11} strokeWidth={1.75} className="inline -mt-0.5 mr-1" />
                          {tr('cartaPorte.documentos.vista.embarqueDe', { n: numero(lin.indice ?? 0), total: numero(lin.total) })}{lin.clave ? ' ' + tr('cartaPorte.documentos.vista.folio', { clave: lin.clave }) : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">{ROTULO_FORMATO[d.formato] ?? d.formato} · {ROTULO_CANAL[d.canal] ?? d.canal}</td>
                    <td className="px-3 py-2">
                      {d.estado === 'por_revisar' && v ? (
                        <span>
                          {v.bloqueos > 0 && <strong style={{ color: 'var(--bad)' }}>{tr('cartaPorte.documentos.vista.porCorregir', { v: numero(v.bloqueos) })}</strong>}
                          {v.bloqueos > 0 && v.porConfirmar > 0 && ' · '}
                          {v.porConfirmar > 0 && <strong style={{ color: 'var(--warn)' }}>{tr('cartaPorte.documentos.vista.porConfirmar', { v: numero(v.porConfirmar) })}</strong>}
                          {v.bloqueos === 0 && v.porConfirmar === 0 && <span style={{ color: 'var(--ok)' }}>{tr('cartaPorte.documentos.vista.listoParaAprobar')}</span>}
                        </span>
                      ) : d.estado === 'fallido' ? (
                        <span style={{ color: 'var(--bad)' }}>{d.ultimoError ?? tr('cartaPorte.documentos.vista.noSePudoLeer')}</span>
                      ) : d.estado === 'aprobado' ? (
                        perfilRestringido ? (
                          <span style={{ color: 'var(--muted)' }}>{tr('cartaPorte.documentos.vista.envioAlTms2', { v: datos.envios?.[d.id] ? rotuloEnvio(datos.envios[d.id], datos.sinConexion, tr) : tr('cartaPorte.documentos.vista.sinEnvio') })}</span>
                        ) : (
                          <span style={{ color: d.viajeId ? 'var(--ok)' : 'var(--warn)' }}>{d.viajeId ? tr('cartaPorte.documentos.vista.conViaje') : tr('cartaPorte.documentos.vista.sinViajeTodavia')}<span style={{ color: 'var(--muted)' }}> · {tr('cartaPorte.documentos.vista.tmsDosPuntos')} {datos.envios?.[d.id] ? rotuloEnvio(datos.envios[d.id], datos.sinConexion, tr) : tr('cartaPorte.documentos.vista.sinEnvio')}</span></span>
                        )
                      ) : d.estado === 'rechazado' ? (
                        <span style={{ color: 'var(--muted)' }}>{d.rechazoMotivo}</span>
                      ) : d.estado === 'dividido' ? (
                        <span style={{ color: 'var(--muted)' }}>{lin?.rol === 'padre' ? tr('cartaPorte.documentos.vista.traeEmbarquesCadaUno', { v: numero(lin.total) }) : tr('cartaPorte.documentos.vista.seSeparoEnUn')}</span>
                      ) : '—'}
                    </td>
                    {conAsignacion && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        {datos.asignados?.[d.id]
                          ? (nombreDe.get(datos.asignados[d.id]) ?? tr('cartaPorte.documentos.vista.otraPersona'))
                          : <span style={{ color: 'var(--faint)' }}>{d.estado === 'por_revisar' ? tr('cartaPorte.documentos.vista.todosLosRevisores') : '—'}</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap">{fechaHoraMx(d.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {(d.estado === 'recibido' || (d.estado === 'fallido' && d.intentos < 5)) && acciones.procesar ? (
                        <FormaAccion accion={acciones.procesar} className="inline">
                          <input type="hidden" name="documentoId" value={d.id} />
                          <BotonEnvio variante="secundario" etiqueta={d.estado === 'fallido' ? 'Reintentar' : 'Leer ahora'} pendiente="Leyendo…" icono={<RotateCcw width={13} height={13} strokeWidth={1.75} />} />
                        </FormaAccion>
                      ) : (
                        <Link href={`/dashboard/carta-porte/documentos/${d.id}${sufijo}`} className="text-[12px] font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
                          {d.estado === 'por_revisar' ? tr('cartaPorte.documentos.vista.revisar') : tr('cartaPorte.documentos.vista.ver')}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {datos.filas.length < datos.total && (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{tr('cartaPorte.documentos.vista.seMuestranDeLos', { v: numero(datos.filas.length), v2: numero(datos.total) })}</p>
      )}
    </section>
  );
}

function Canales({ buzon, acciones, tr = trEs }: { buzon: BuzonVista | null; acciones: AccionesDocumentos; tr?: Tr }) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="card p-4 space-y-2.5">
        <TituloRecuadro info="carta_porte_docs.correo"><Mail width={14} height={14} strokeWidth={1.75} /> {tr('cartaPorte.documentos.vista.correoDeTuFlota')}</TituloRecuadro>
        {buzon === null ? (
          <>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {tr('cartaPorte.documentos.vista.activaUnBuzonPropio')}
            </p>
            {acciones.activarBuzon && (
              <FormaAccion accion={acciones.activarBuzon}><BotonEnvio etiqueta={tr('cartaPorte.documentos.vista.activarBuzon')} /></FormaAccion>
            )}
          </>
        ) : (
          <>
            {buzon.direccion ? (
              <p className="text-[12px]">{tr('cartaPorte.documentos.vista.direccion')} <code className="cifra-mono select-all">{buzon.direccion}</code>{!buzon.activo && <strong style={{ color: 'var(--warn)' }}> {tr('cartaPorte.documentos.vista.apagado')}</strong>}</p>
            ) : (
              <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
                {buzon.dominioConfigurado ? tr('cartaPorte.documentos.vista.laDireccionNoSe') : tr('cartaPorte.documentos.vista.elDominioDeCorreo')}
              </p>
            )}
            {buzon.activo && buzon.remitentes.length === 0 && (
              <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>{AVISO_SIN_REMITENTES}</p>
            )}
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
      </div>
      <div className="card p-4 space-y-2">
        <TituloRecuadro info="carta_porte_docs.whatsapp"><MessageCircle width={14} height={14} strokeWidth={1.75} /> WhatsApp</TituloRecuadro>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {tr('cartaPorte.documentos.vista.quienDespachaEnTu')}
        </p>
      </div>
    </section>
  );
}

function Perfiles({ perfiles, acciones, tr = trEs }: { perfiles: PerfilVista[]; acciones: AccionesDocumentos; tr?: Tr }) {
  return (
    <section className="space-y-2">
      <TituloRecuadro info="carta_porte_docs.formatos"><Layers width={14} height={14} strokeWidth={1.75} /> {tr('cartaPorte.documentos.vista.formatosQueLikidaYa')}</TituloRecuadro>
      {perfiles.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {tr('cartaPorte.documentos.vista.todaviaNingunoCuandoApruebes')}
        </p>
      ) : (
        <div className="space-y-2">
          {perfiles.map((p) => (
            <Disclosure key={p.id} titulo={p.nombre} resumen={tr('cartaPorte.documentos.vista.versionCamposReconocidos', { v: ROTULO_FORMATO[p.formato] ?? p.formato, versionActiva: p.versionActiva, v2: numero(p.mapeos) })}>
              <ul className="space-y-1.5 text-[12px]">
                {p.versiones.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-2">
                    <span className="cifra-mono">v{v.version}</span>
                    <span style={{ color: 'var(--muted)' }}>{v.nota ?? tr('cartaPorte.documentos.vista.versionInicial')}</span>
                    {v.version === p.versionActiva ? (
                      <span className="text-[11px] font-medium" style={{ color: 'var(--ok)' }}>{tr('cartaPorte.documentos.vista.activa')}</span>
                    ) : acciones.volverVersion && (
                      <FormaAccion accion={acciones.volverVersion} className="inline">
                        <input type="hidden" name="perfilId" value={p.id} /><input type="hidden" name="version" value={v.version} />
                        <BotonEnvio variante="secundario" etiqueta={tr('cartaPorte.documentos.vista.volverAEsta')} pendiente="…" />
                      </FormaAccion>
                    )}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))}
        </div>
      )}
    </section>
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
  return (
    <section className="space-y-2">
      <TituloRecuadro info="carta_porte_docs.exportar"><Download width={14} height={14} strokeWidth={1.75} /> {tr('cartaPorte.documentos.vista.exportarLoAprobado')}</TituloRecuadro>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {rico(tr('cartaPorte.documentos.vista.soloSalenDocumentosStrong'), { strong: (c) => <strong>{c}</strong> })}
      </p>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <a className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga('estandar', 'csv')}>{tr('cartaPorte.documentos.vista.estandarCsv')}</a>
        <a className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga('estandar', 'json')}>{tr('cartaPorte.documentos.vista.estandarJson')}</a>
        <a className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga('estandar', 'xlsx')}>{tr('cartaPorte.documentos.vista.estandarExcel')}</a>
        {/* A37-L-03: si una descarga se cortó, los aprobados ya figuran como exportados; esta liga los baja todos otra vez. */}
        <a className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={`${liga('estandar', 'csv')}&todos=1`}>{tr('cartaPorte.documentos.vista.volverADescargarTodos')}</a>
        {configs.map((c) => (
          <a key={c.id} className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga(c.id, c.formato)}>{c.nombre} · {c.formato.toUpperCase()}</a>
        ))}
        {configs.map((c) => (
          <a key={`${c.id}-xlsx`} className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga(c.id, 'xlsx')}>{c.nombre} · {tr('cartaPorte.documentos.vista.excel')}</a>
        ))}
      </div>
      {acciones.guardarExport && (
        <Disclosure titulo={tr('cartaPorte.documentos.vista.declararUnFormatoDestino')}>
          <FormaAccion accion={acciones.guardarExport} className="space-y-3">
            <div className="rv-forma__rejilla">
              <CampoTexto id="cp-exp-nombre" name="nombre" required maxLength={80} placeholder={tr('cartaPorte.documentos.vista.clienteDemo')} etiqueta={tr('cartaPorte.documentos.vista.nombreSiYaExiste')} />
              <CampoSelect id="cp-exp-formato" name="formato" defaultValue="csv" etiqueta={tr('cartaPorte.documentos.vista.formato')}>
                <option value="csv">CSV</option><option value="json">JSON</option>
              </CampoSelect>
            </div>
            <CampoTextarea id="cp-exp-config" name="config" rows={10} required defaultValue={EJEMPLO_CONFIG} etiqueta={tr('cartaPorte.documentos.vista.mapeoJson')} claseControl="cifra-mono"
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
            <ul className="pt-3 space-y-1 text-[12px]">
              {configs.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span>{c.nombre}</span>
                  <FormaAccion accion={acciones.borrarExport as AccionDoc} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <BotonEnvio variante="peligro" etiqueta={tr('cartaPorte.documentos.vista.quitar')} pendiente="…" />
                  </FormaAccion>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      )}
      <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--faint)' }}>
        <TriangleAlert width={12} height={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        {tr('cartaPorte.documentos.vista.elArchivoLoAbre')}
      </p>
    </section>
  );
}
