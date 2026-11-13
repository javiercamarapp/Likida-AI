import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import Link from 'next/link';
import { BookOpen, Check, Download, CircleHelp, Send, ShieldAlert, Trash2, TriangleAlert, Truck } from 'lucide-react';
import { fechaHoraMx, numero, pesoArchivo, usd4 } from '@/lib/formato';
import { ROTULO_CANAL, ROTULO_ESTADO, ROTULO_FORMATO, ROTULO_ORIGEN, ROTULO_ORIGEN_HALLAZGO, type FilaCampo, type Revision } from '@/lib/likida/carta_porte_docs/presentacion';
import type { DocumentoFila, EstadoEnvioTms } from '@/lib/likida/carta_porte_docs/repo';
import { CAUSAS_RECHAZO, type CausaRechazo } from '@/lib/likida/carta_porte_docs/metricas';
import { propuestaVacia, type PropuestaCatalogo } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import { FRASE_ENVIADO_SIMULADO, ROTULO_SIMULADO } from '@/lib/likida/carta_porte_docs/salida_simulada';
import { lineasDelOriginal, marcaDeFila, resumenDeMarcas } from '@/lib/likida/carta_porte_docs/revision_formato';
import { BotonEnlace, Chip, Fieldset, Icono, cx } from '@/app/ui-v2/componentes';
import { EsqueletoFicha } from '@/app/ui-v2/esqueletos';
import { AvisosLectura } from './avisos_lectura';
import { BotonEnvio, ETIQUETA, FormaAccion, type AccionDoc } from '../forma_accion';

/**
 * LA REVISIÓN: el documento a la izquierda, lo que se leyó a la derecha, campo por campo.
 *
 * Reglas de lo que se pinta:
 *   · TODOS los campos del complemento aparecen, también los que el documento no trae (un hueco que no se
 *     ve no se llena);
 *   · cada valor dice qué tan seguro está el agente y de dónde salió (XML, perfil del cliente, modelo, una
 *     persona), con la evidencia literal que citó;
 *   · lo que hay que corregir (rojo) o confirmar (ámbar) dice POR QUÉ, y no se aprueba hasta resolverlo;
 *   · si el documento trae texto con forma de instrucción para un modelo, se dice arriba y TODO dato crítico
 *     pide confirmación a mano;
 *   · si el documento es una foto o un escaneo (sin texto que anclar), también se dice arriba: esos datos
 *     críticos dependen solo de lo que vio el modelo de visión, sin verificación cruzada (ver
 *     `taparCriticosSinAnclaje` en extractor.ts).
 */

export type OriginalVista =
  | { tipo: 'imagen'; url: string }
  | { tipo: 'imagenes'; urls: string[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nada'; motivo: string };

export interface EventoVista { tipo: string; creadoEn: string }

/** Lo que se ofrece guardar en el catálogo del cliente tras aprobar (T-A3-22): los datos que tecleó una persona. */
export interface CatalogoBanner { cliente: string; propuesta: PropuestaCatalogo }

/** De qué archivo nació este documento (0670). */
export interface EmbarqueVista { indice: number; total: number; clave: string | null; padreId: string; padreNombre: string }
/** Un embarque hijo de un archivo dividido. */
export interface HijoVista { id: string; indice: number; clave: string | null; estado: DocumentoFila['estado']; nombre: string; bloqueos: number; porConfirmar: number }

const rotuloEvento = (tr: Tr): Record<string, string> => ({
  recibido: tr('cartaPorte.documentos.id.vista.evento.recibido'),
  duplicado_recibido: tr('cartaPorte.documentos.id.vista.evento.duplicado_recibido'),
  extraccion_iniciada: tr('cartaPorte.documentos.id.vista.evento.extraccion_iniciada'),
  extraccion_ok: tr('cartaPorte.documentos.id.vista.evento.extraccion_ok'),
  extraccion_fallida: tr('cartaPorte.documentos.id.vista.evento.extraccion_fallida'),
  escalada: tr('cartaPorte.documentos.id.vista.evento.escalada'),
  revision_abierta: tr('cartaPorte.documentos.id.vista.evento.revision_abierta'),
  campo_corregido: tr('cartaPorte.documentos.id.vista.evento.campo_corregido'),
  aprobado: tr('cartaPorte.documentos.id.vista.evento.aprobado'),
  rechazado: tr('cartaPorte.documentos.id.vista.evento.rechazado'),
  reabierto: tr('cartaPorte.documentos.id.vista.evento.reabierto'),
  salida_viaje: tr('cartaPorte.documentos.id.vista.evento.salida_viaje'),
  perfil_aprendido: tr('cartaPorte.documentos.id.vista.evento.perfil_aprendido'),
  exportado: tr('cartaPorte.documentos.id.vista.evento.exportado'),
  envio_preparado: tr('cartaPorte.documentos.id.vista.evento.envio_preparado'),
  envio_subido_a_mano: tr('cartaPorte.documentos.id.vista.evento.envio_subido_a_mano'),
  purgado: tr('cartaPorte.documentos.id.vista.evento.purgado'),
  dividido: tr('cartaPorte.documentos.id.vista.evento.dividido'),
});

function color(sev: 'bloqueo' | 'confirmar' | 'aviso'): string {
  return sev === 'bloqueo' ? 'text-[var(--bad)]' : sev === 'confirmar' ? 'text-[var(--warn)]' : 'text-[var(--muted)]';
}

/** El envío al TMS tal como lo ve la pantalla: el estado más la fecha del próximo reintento y la ubicación del rechazo (nunca valores). */
export interface EnvioVista { estado: EstadoEnvioTms; proximaRevision?: string | null; motivo?: string | null; /** La flota sale por el simulador (T-A3-42): todo se rotula «Simulado». */ simulado?: boolean; /** La flota NO tiene conectado el sistema del cliente (no existe adaptador): nada sale solo, se sube a mano. */ sinConexion?: boolean; /** Existe conector pero no se pudo consultar ahora (no es «por conectar»). */ salidaNoDisponible?: boolean }

/** Lo que dice la tarjeta «Envío al sistema del cliente» en lenguaje llano. Sin envío = todavía no se ha enviado nada. */
const K = 'cartaPorte.documentos.id.vista.envio.';
export const FRASE_ENVIO_NO_DISPONIBLE = trEs(`${K}noDisponible`);
export const FRASE_ENVIO_POR_CONECTAR = trEs(`${K}porConectar`);

export function fraseEnvio(e: EnvioVista | null, tr: Tr = trEs): string {
  if (!e || e.estado === 'descartado') return tr('cartaPorte.documentos.id.vista.envio.nadaEnviado');
  const cuando = e.proximaRevision ? fechaHoraMx(e.proximaRevision) : null;
  const enCamino = ['pendiente_prechequeo', 'listo', 'enviando', 'pendiente_reque', 'error_transitorio'].includes(e.estado);
  // Sin conexión real con el sistema del cliente (y sin simulador) ninguna de las fases «en camino» es cierta: no hay quien envíe.
  if (e.sinConexion && !e.simulado && enCamino) return tr('cartaPorte.documentos.id.vista.envio.porConectar');
  if (e.salidaNoDisponible && !e.simulado && enCamino) return tr('cartaPorte.documentos.id.vista.envio.noDisponible');
  switch (e.estado) {
    case 'pendiente_prechequeo': case 'listo': return tr('cartaPorte.documentos.id.vista.envio.listo');
    case 'enviando': return tr('cartaPorte.documentos.id.vista.envio.enviandose');
    case 'pendiente_reque': return cuando ? tr('cartaPorte.documentos.id.vista.envio.esperaReqCuando', { cuando }) : tr('cartaPorte.documentos.id.vista.envio.esperaReq');
    case 'error_transitorio': return cuando ? tr('cartaPorte.documentos.id.vista.envio.noContestoCuando', { cuando }) : tr('cartaPorte.documentos.id.vista.envio.noContesto');
    case 'enviado': return e.simulado ? FRASE_ENVIADO_SIMULADO : tr('cartaPorte.documentos.id.vista.envio.enviado');
    case 'rechazado_tms': return e.motivo ? tr('cartaPorte.documentos.id.vista.envio.rechazoMotivo', { motivo: e.motivo }) : tr('cartaPorte.documentos.id.vista.envio.rechazo');
    case 'subido_a_mano': return tr('cartaPorte.documentos.id.vista.envio.subidoAMano');
  }
}

function Confianza({ c, tr = trEs }: { c: number | null; tr?: Tr }) {
  if (c === null) return <span className="text-[11px] text-[var(--faint)]">{tr('cartaPorte.documentos.id.vista.sinDato')}</span>;
  const pct = Math.round(c * 100);
  const fg = c >= 0.9 ? 'text-[var(--ok)]' : c >= 0.8 ? 'text-[var(--warn)]' : 'text-[var(--bad)]';
  return <span className={cx('text-[11px] font-medium cifra-mono', fg)} title={tr('cartaPorte.documentos.id.vista.queTanSeguroEsta')}>{pct} %</span>;
}

function Campo({ f, editable, tr = trEs }: { f: FilaCampo; editable: boolean; tr?: Tr }) {
  const id = `f-${f.nombre.replace(/:/g, '-')}`;
  const marca = marcaDeFila(f);
  const resaltado = marca.inferido || marca.bajaConfianza;
  const borde = f.bloqueado ? 'border-[var(--bad)]' : f.porConfirmar || resaltado ? 'border-[var(--warn)]' : undefined;
  return (
    <div className="space-y-1" data-marca={marca.inferido ? 'inferido' : marca.bajaConfianza ? 'poco-seguro' : undefined}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-medium">{f.rotulo}{f.critico && <abbr title={tr('cartaPorte.documentos.id.vista.datoCriticoSiFalta')} className="no-underline text-[var(--marca)]"> *</abbr>}</label>
        <span className="flex items-center gap-1.5">
          {marca.inferido && <Chip tono="warn" tamano="estado">{tr('cartaPorte.documentos.id.vista.inferido')}</Chip>}
          {!marca.inferido && marca.bajaConfianza && <Chip tono="warn" tamano="estado">{tr('cartaPorte.documentos.id.vista.pocoSeguro')}</Chip>}
          {f.origen && <span className="text-[11px] text-[var(--faint)]">{ROTULO_ORIGEN[f.origen]}</span>}
          <Confianza tr={tr} c={f.confianza} />
        </span>
      </div>
      <input id={id} name={f.nombre} defaultValue={f.valor} readOnly={!editable} autoComplete="off" spellCheck={false}
        className={cx('w-full', borde)} aria-invalid={f.bloqueado || undefined} />
      {f.evidencia && <p className="text-[11px] truncate text-[var(--faint)]" title={f.evidencia}>{tr('cartaPorte.documentos.id.vista.evidencia', { evidencia: f.evidencia })}</p>}
      {marca.avisos.map((a) => <p key={a} className="text-[11px] text-[var(--warn)]">{a}</p>)}
      {f.notas.map((n) => <p key={n} className="text-[11px] text-[var(--muted)]">{n}</p>)}
      {f.hallazgos.map((h) => (
        <p key={`${h.codigo}-${h.mensaje}`} className={cx('text-[11px] flex items-start gap-1', color(h.severidad))}>
          <TriangleAlert width={11} height={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />{h.origen && <strong className="font-medium">{ROTULO_ORIGEN_HALLAZGO[h.origen]}:</strong>} {h.mensaje}
        </p>
      ))}
      {editable && f.porConfirmar && (
        <label className="text-[11px] inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" name={f.nombreConfirmar} defaultChecked={false} />
          {tr('cartaPorte.documentos.id.vista.yaLoReviseContra')}
        </label>
      )}
    </div>
  );
}

/** T-A3-31: a quién le toca este caso y a quién se le puede pasar. `null` = la flota no usa asignación (no se pinta nada). */
export interface ClientesVista { actualId: string | null; opciones: Array<{ id: string; nombre: string }> }
export interface RevisorVista { actualId: string | null; opciones: Array<{ id: string; nombre: string }> }

export function VistaRevision({ doc, revision, original, operadores, eventos, acciones, sufijo = '', envio = null, salida = null, puedeEliminar = false, embarque = null, hijos = [], perfilRestringido = false, catalogo = null, revisor = null, clientes = null, tr = trEs }: {
  doc: DocumentoFila;
  revision: Revision | null;
  original: OriginalVista;
  operadores: Array<{ id: string; nombre: string }>;
  eventos: EventoVista[];
  acciones: { revisar: AccionDoc | null; reasignar?: AccionDoc | null; asignarCliente?: AccionDoc | null };
  /** OLA1-A3: asignar el cliente de un documento por revisar (aplica su catálogo). */
  clientes?: ClientesVista | null;
  revisor?: RevisorVista | null;
  sufijo?: string;
  /** El envío al TMS de la versión vigente (solo se carga si el documento está aprobado). */
  envio?: EnvioVista | null;
  /** El resultado de la salida al viaje ya conocido (viaje ligado). */
  salida?: { folio: string } | null;
  /** Quien administra la flota puede eliminar el documento y su archivo (cancelación ARCO / subido por error). */
  puedeEliminar?: boolean;
  /** Si este documento es UN embarque de un archivo que se partió: cuál y de cuántos. */
  embarque?: EmbarqueVista | null;
  /** Si este documento es el archivo que se partió: sus embarques. */
  hijos?: HijoVista[];
  /** Flota bajo el perfil restringido: aprobar prepara el envío al TMS; no hay viaje, operador ni borrador que ofrecer. */
  perfilRestringido?: boolean;
  /** Datos tecleados por una persona que valdría la pena guardar en el catálogo del cliente (solo si el documento está aprobado). */
  catalogo?: CatalogoBanner | null; tr?: Tr;
}) {
  const editable = doc.estado === 'por_revisar';
  const meta = doc.extraccion?.meta;
  return (
    <EsqueletoFicha
      area="Carta Porte"
      titulo={doc.nombreArchivo}
      idTitulo="documento-titulo"
      volver={{ href: `/dashboard/carta-porte/documentos${sufijo}`, etiqueta: tr('cartaPorte.documentos.id.vista.volverALosDocumentos') }}
      chips={<li><Chip>{ROTULO_ESTADO[doc.estado]}</Chip></li>}
    >
      <div className="space-y-1">
        <p className="text-[12px] text-[var(--muted)]">
          {tr('cartaPorte.documentos.id.vista.recibido', { v: ROTULO_FORMATO[doc.formato] ?? doc.formato, v2: ROTULO_CANAL[doc.canal] ?? doc.canal, v3: pesoArchivo(doc.bytes), v4: fechaHoraMx(doc.createdAt), v5: doc.remitente ? ` · de ${doc.remitente}` : '', v6: doc.asunto ? ` · «${doc.asunto}»` : '' })}
        </p>
        {meta && (
          <p className="text-[11px] text-[var(--faint)]">
            {tr('cartaPorte.documentos.id.vista.lecturaDosPuntos')} {meta.origen === 'xml' ? tr('cartaPorte.documentos.id.vista.directaDelXmlSin') : meta.origen === 'perfil' ? tr('cartaPorte.documentos.id.vista.conElPerfilDel') : meta.origen === 'perfil+llm' ? tr('cartaPorte.documentos.id.vista.perfilDelClienteModelo') : tr('cartaPorte.documentos.id.vista.modeloNivel', { nivel: meta.nivel })}
            {doc.modelo ? ` (${doc.modelo})` : ''} · {usd4(doc.costoUsd)}
            {meta.escalamientos.length > 0 ? ' ' + tr('cartaPorte.documentos.id.vista.seReleyoConUn', { v: numero(meta.escalamientos.length), v2: meta.escalamientos.length === 1 ? tr('cartaPorte.documentos.id.vista.vez') : tr('cartaPorte.documentos.id.vista.veces') }) : ''}
          </p>
        )}
        <AvisosLectura tr={tr} meta={meta} />
        {doc.riesgoInyeccion && (
          <p className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-1.5 bg-[var(--warnbg,var(--canvas))] text-[var(--warn)]" role="alert">
            <ShieldAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {tr('cartaPorte.documentos.id.vista.esteDocumentoTraeTexto')}
          </p>
        )}
        {(doc.formato === 'imagen' || doc.formato === 'pdf_escaneado') && (
          <p className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-1.5 bg-[var(--warnbg,var(--canvas))] text-[var(--warn)]" role="status">
            <TriangleAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {doc.formato === 'imagen' ? tr('cartaPorte.documentos.id.vista.estaEsUnaFoto') : tr('cartaPorte.documentos.id.vista.esteEsUnPdf')}{tr('cartaPorte.documentos.id.vista.noHayTextoDel')}
          </p>
        )}
        {embarque && (
          <p className="text-[12px] text-[var(--muted)]">
            {tr('cartaPorte.documentos.id.vista.embarqueDe', { n: numero(embarque.indice), total: numero(embarque.total) })}{embarque.clave ? ' ' + tr('cartaPorte.documentos.id.vista.folio2', { clave: embarque.clave }) : ''} {tr('cartaPorte.documentos.id.vista.delArchivo')}{' '}
            <Link href={`/dashboard/carta-porte/documentos/${embarque.padreId}${sufijo}`} className="font-medium text-[var(--marca)]">{embarque.padreNombre}</Link>.
          </p>
        )}
        {revisor && (
          <div className="text-[12px] flex flex-wrap items-center gap-2 text-[var(--muted)]">
            <span>{tr('cartaPorte.documentos.id.vista.asignadoA')} <strong className="text-[var(--ink)]">{revisor.opciones.find((o) => o.id === revisor.actualId)?.nombre ?? (revisor.actualId ? tr('cartaPorte.documentos.id.vista.otraPersona') : tr('cartaPorte.documentos.id.vista.todosLosRevisores'))}</strong></span>
            {editable && acciones.reasignar && (
              <FormaAccion accion={acciones.reasignar} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="documentoId" value={doc.id} />
                <label className="sr-only" htmlFor="revisorId">{tr('cartaPorte.documentos.id.vista.reasignarA')}</label>
                <select id="revisorId" name="revisorId" defaultValue={revisor.actualId ?? ''} className="w-full !w-auto">
                  <option value="">{tr('cartaPorte.documentos.id.vista.todosLosRevisores')}</option>
                  {revisor.opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
                <BotonEnvio variante="secundario" etiqueta={tr('cartaPorte.documentos.id.vista.reasignar')} pendiente="Reasignando…" />
              </FormaAccion>
            )}
          </div>
        )}
        {editable && clientes && acciones.asignarCliente && (
          <div className="text-[12px] flex flex-wrap items-center gap-2 text-[var(--muted)]">
            <span>{tr('cartaPorte.documentos.id.vista.clienteDosPuntos')} <strong className="text-[var(--ink)]">{clientes.opciones.find((o) => o.id === clientes.actualId)?.nombre ?? tr('cartaPorte.documentos.id.vista.sinAsignarNoSe')}</strong></span>
            <FormaAccion accion={acciones.asignarCliente} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="documentoId" value={doc.id} />
              <input type="hidden" name="version" value={doc.version} />
              <label className="sr-only" htmlFor="clienteDoc">{tr('cartaPorte.documentos.id.vista.asignarCliente')}</label>
              <select id="clienteDoc" name="clienteId" defaultValue={clientes.actualId ?? ''} className="w-full !w-auto">
                <option value="">{tr('cartaPorte.documentos.id.vista.sinCliente')}</option>
                {clientes.opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
              <BotonEnvio variante="secundario" etiqueta={tr('cartaPorte.documentos.id.vista.asignarCliente')} pendiente="Asignando…" />
            </FormaAccion>
          </div>
        )}
        {doc.estado === 'fallido' && <p className="text-[12px] text-[var(--bad)]">{doc.ultimoError}</p>}
        {doc.estado === 'rechazado' && <p className="text-[12px] text-[var(--muted)]">{tr('cartaPorte.documentos.id.vista.rechazadoDosPuntos')} {doc.rechazoMotivo}</p>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <section aria-label={tr('cartaPorte.documentos.id.vista.elDocumento')} className="rv-tarjeta space-y-2 xl:sticky xl:top-4 max-h-[85vh] overflow-auto">
          {/* sin-info: rótulo del visor del archivo original, no una cifra ni un recuadro de datos */}
          <h2 className="text-[12px] font-medium">{tr('cartaPorte.documentos.id.vista.elDocumento')}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage: next/image exigiría declarar el dominio y optimizaría un documento que NO se debe recomprimir */}
          {original.tipo === 'imagen' && <img src={original.url} alt={tr('cartaPorte.documentos.id.vista.documentoDelCliente')} className="w-full rounded-md hairline" />}
          {original.tipo === 'imagenes' && original.urls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt={tr('cartaPorte.documentos.id.vista.paginaDelDocumentoDel', { v: i + 1 })} className="w-full rounded-md hairline" />
          ))}
          {original.tipo === 'texto' && <TextoOriginal tr={tr} texto={original.texto} revision={revision} />}
          {original.tipo === 'nada' && <p className="text-[12px] text-[var(--muted)]">{original.motivo}</p>}
        </section>

        <section aria-label={tr('cartaPorte.documentos.id.vista.loQueSeLeyo')} className="space-y-3">
          {doc.estado === 'dividido' ? (
            <div className="rv-tarjeta space-y-2.5">
              <p className="text-[12px]">
                {tr('cartaPorte.documentos.id.vista.esteArchivoTraiaVarios')}
              </p>
              {hijos.length === 0 ? (
                <p className="text-[12px] text-[var(--muted)]">{tr('cartaPorte.documentos.id.vista.noHayEmbarquesLigados')}</p>
              ) : (
                <ul className="space-y-1.5 text-[12px]">
                  {hijos.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="cifra-mono text-[var(--faint)]">{numero(h.indice)}.</span>
                      <Link href={`/dashboard/carta-porte/documentos/${h.id}${sufijo}`} className="font-medium hover:opacity-75 text-[var(--marca)]">
                        {h.clave ? tr('cartaPorte.documentos.id.vista.folio', { clave: h.clave }) : h.nombre}
                      </Link>
                      <span className="text-[var(--muted)]">
                        {ROTULO_ESTADO[h.estado]}
                        {h.estado === 'por_revisar' && h.bloqueos > 0 ? ' ' + tr('cartaPorte.documentos.id.vista.porCorregir', { v: numero(h.bloqueos) }) : ''}
                        {h.estado === 'por_revisar' && h.bloqueos === 0 && h.porConfirmar > 0 ? ' ' + tr('cartaPorte.documentos.id.vista.porConfirmar', { v: numero(h.porConfirmar) }) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : revision === null ? (
            <div className="rv-tarjeta space-y-3">
              <p className="text-[12px] text-[var(--muted)]">
                {doc.estado === 'fallido' ? tr('cartaPorte.documentos.id.vista.elDocumentoNoSe') : tr('cartaPorte.documentos.id.vista.elDocumentoTodaviaNo')}
              </p>
              {doc.estado === 'fallido' && acciones.revisar && (
                <FormaAccion accion={acciones.revisar} className="space-y-2">
                  <input type="hidden" name="documentoId" value={doc.id} />
                  <input type="hidden" name="version" value={doc.version} />
                  <p className="text-[12px] text-[var(--muted)]">
                    {tr('cartaPorte.documentos.id.vista.siLaCausaYa')}
                  </p>
                  <BotonEnvio variante="secundario" intencion="reintentar" etiqueta={tr('cartaPorte.documentos.id.vista.reintentarLectura')} pendiente="Reintentando…" />
                </FormaAccion>
              )}
            </div>
          ) : acciones.revisar ? (
            <FormaAccion accion={acciones.revisar} className="space-y-3">
              <input type="hidden" name="documentoId" value={doc.id} />
              <input type="hidden" name="version" value={doc.version} />

              <Resumen tr={tr} revision={revision} />
              {revision.generales.map((h) => (
                <p key={h.codigo + h.mensaje} className={cx('text-[12px] flex items-start gap-1.5', color(h.severidad))}>
                  <CircleHelp width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />{h.origen && <strong className="font-medium">{ROTULO_ORIGEN_HALLAZGO[h.origen]}:</strong>} {h.mensaje}
                </p>
              ))}

              {revision.grupos.map((g) => (
                <Fieldset key={g.id} leyenda={g.titulo}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">{g.filas.map((f) => <Campo tr={tr} key={f.nombre} f={f} editable={editable} />)}</div>
                </Fieldset>
              ))}

              {revision.mercancias.map((m) => (editable || !m.esNuevo) && (
                <Fieldset key={m.indice} leyenda={m.esNuevo ? tr('cartaPorte.documentos.id.vista.agregarUnaMercanciaQue') : tr('cartaPorte.documentos.id.vista.mercancia', { v: m.indice + 1 })}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">{m.filas.map((f) => <Campo tr={tr} key={f.nombre} f={f} editable={editable} />)}</div>
                  {!m.esNuevo && editable && (
                    <BotonEnvio variante="peligro" intencion={`quitar:${m.indice}`} etiqueta={tr('cartaPorte.documentos.id.vista.quitarEsteRenglon')} pendiente="Quitando…"
                      confirmar={{ titulo: tr('cartaPorte.documentos.id.vista.quitarLaMercancia', { v: m.indice + 1 }), descripcion: tr('cartaPorte.documentos.id.vista.seQuitaEsteRenglon'), etiquetaConfirmar: tr('cartaPorte.documentos.id.vista.siQuitar') }} icono={<Trash2 width={13} height={13} strokeWidth={1.75} />} />
                  )}
                </Fieldset>
              ))}

              {editable && (
                <div className="rv-tarjeta space-y-3 sticky bottom-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <BotonEnvio variante="secundario" intencion="guardar" etiqueta={tr('cartaPorte.documentos.id.vista.guardarCambios')} pendiente="Guardando…" />
                    <BotonEnvio intencion="aprobar" etiqueta={tr('cartaPorte.documentos.id.vista.aprobar')} pendiente="Aprobando…" icono={<Check width={14} height={14} strokeWidth={1.75} />} />
                    <span className="text-[11px] text-[var(--faint)]">{perfilRestringido ? tr('cartaPorte.documentos.id.vista.aprobarGuardaLoQue') : tr('cartaPorte.documentos.id.vista.aprobarGuardaLoQue2')}</span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="grow min-w-[220px]">
                      <label htmlFor="cp-rechazo" className={ETIQUETA}>{tr('cartaPorte.documentos.id.vista.rechazarElDocumentoMotivo')}</label>
                      <input id="cp-rechazo" name="motivo" maxLength={500} placeholder={tr('cartaPorte.documentos.id.vista.noEsUnEmbarque')} className="w-full bg-[var(--surface)]" />
                    </div>
                    <div>
                      <label htmlFor="cp-rechazo-causa" className={ETIQUETA}>{tr('cartaPorte.documentos.id.vista.causa')}</label>
                      <select id="cp-rechazo-causa" name="causa" defaultValue="" className="w-full bg-[var(--surface)]">
                        <option value="">{tr('cartaPorte.documentos.id.vista.sinClasificar')}</option>
                        {(Object.keys(CAUSAS_RECHAZO) as CausaRechazo[]).filter((c) => c !== 'tms_rechazo').map((c) => <option key={c} value={c}>{CAUSAS_RECHAZO[c]}</option>)}
                      </select>
                    </div>
                    <BotonEnvio variante="peligro" intencion="rechazar" etiqueta={tr('cartaPorte.documentos.id.vista.rechazar')} pendiente="…" />
                  </div>
                  {!perfilRestringido && operadores.length > 0 && (
                    <div>
                      <label htmlFor="cp-operador" className={ETIQUETA}>{tr('cartaPorte.documentos.id.vista.operadorDelViajeSolo')}</label>
                      <select id="cp-operador" name="operadorId" defaultValue="" className="w-full bg-[var(--surface)]">
                        <option value="">{tr('cartaPorte.documentos.id.vista.elDelDocumento')}</option>
                        {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {!editable && (
                <div className="rv-tarjeta space-y-3">
                  {doc.estado === 'aprobado' && perfilRestringido && (
                    <div className="space-y-1" aria-label={tr('cartaPorte.documentos.id.vista.envioAlSistemaDel')}>
                      <p className="text-[12px] font-medium flex items-center gap-1.5">
                        <Icono icono={Send} className={envio?.estado === 'rechazado_tms' ? 'text-[var(--bad)]' : envio?.estado === 'enviado' ? 'text-[var(--ok)]' : 'text-[var(--muted)]'} />{tr('cartaPorte.documentos.id.vista.envioAlSistemaDel')}
                        {envio?.simulado && <span data-testid="rotulo-simulado"><Chip tono="warn" tamano="estado">{ROTULO_SIMULADO}</Chip></span>}
                      </p>
                      <p className="text-[12px]" role="status">{fraseEnvio(envio, tr)}</p>
                      {envio === null && <BotonEnvio variante="secundario" intencion="preparar_envio" etiqueta={tr('cartaPorte.documentos.id.vista.prepararElEnvio')} pendiente="Preparando…" icono={<Send width={14} height={14} strokeWidth={1.75} />} />}
                    </div>
                  )}
                  {doc.estado === 'aprobado' && !perfilRestringido && (
                    <>
                      <p className="text-[12px] flex items-center gap-1.5">
                        <Icono icono={Truck} className={doc.viajeId ? 'text-[var(--ok)]' : 'text-[var(--warn)]'} />
                        {doc.viajeId ? <>{tr('cartaPorte.documentos.id.vista.conViaje')}{salida ? ` ${salida.folio}` : ''}. <Link href={`/dashboard/carta-porte/borrador/${doc.viajeId}${sufijo}`} className="font-medium text-[var(--marca)]">{tr('cartaPorte.documentos.id.vista.verElBorradorDel')}</Link></> : tr('cartaPorte.documentos.id.vista.todaviaSinViajeElige')}
                      </p>
                      {operadores.length > 0 && (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="grow min-w-[220px]">
                            <label htmlFor="cp-operador2" className={ETIQUETA}>{tr('cartaPorte.documentos.id.vista.operador')}</label>
                            <select id="cp-operador2" name="operadorId" defaultValue="" className="w-full bg-[var(--surface)]">
                              <option value="">{tr('cartaPorte.documentos.id.vista.elDelDocumento')}</option>
                              {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                            </select>
                          </div>
                          <BotonEnvio variante="secundario" intencion="viaje" etiqueta={doc.viajeId ? tr('cartaPorte.documentos.id.vista.actualizarViaje') : tr('cartaPorte.documentos.id.vista.crearViaje')} pendiente="…" />
                        </div>
                      )}
                    </>
                  )}
                  {doc.estado === 'aprobado' && catalogo && !propuestaVacia(catalogo.propuesta) && <BannerCatalogo tr={tr} catalogo={catalogo} />}
                  {doc.estado === 'aprobado' && envio?.estado !== 'enviado' && (
                    <div className="space-y-2" aria-label={tr('cartaPorte.documentos.id.vista.modoManual')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <BotonEnlace href={`/api/export/carta-porte-docs${sufijo ? `${sufijo}&` : '?'}formato=plantilla_tms&documento=${doc.id}`} download icono={<Icono icono={Download} />}>
                          {tr('cartaPorte.documentos.id.vista.descargarPlantillaDelTms')}
                        </BotonEnlace>
                        {envio?.estado !== 'subido_a_mano' && (
                          <>
                            <div>
                              <label htmlFor="referenciaTms" className={ETIQUETA}>{tr('cartaPorte.documentos.id.vista.referenciaQueTeDio')}</label>
                              <input id="referenciaTms" name="referenciaTms" maxLength={200} autoComplete="off" spellCheck={false} className="w-full bg-[var(--surface)]" />
                              <p className="text-[11px] mt-0.5 text-[var(--faint)]">{tr('cartaPorte.documentos.id.vista.conEllaLikidaReconoce')}</p>
                            </div>
                            <BotonEnvio variante="secundario" intencion="subido_a_mano" etiqueta={tr('cartaPorte.documentos.id.vista.yaLaSubiA')} pendiente="Marcando…" icono={<Check width={14} height={14} strokeWidth={1.75} />} />
                          </>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--faint)]">
                        {envio?.estado === 'subido_a_mano'
                          ? tr('cartaPorte.documentos.id.vista.marcadaComoSubidaA')
                          : tr('cartaPorte.documentos.id.vista.descargaLaPlantillaSubela')}
                      </p>
                    </div>
                  )}
                  <BotonEnvio variante="secundario" intencion="reabrir" etiqueta={tr('cartaPorte.documentos.id.vista.reabrirParaCorregir')} pendiente="…" />
                </div>
              )}
            </FormaAccion>
          ) : (
            <p className="rv-tarjeta text-[12px] text-[var(--muted)]">{tr('cartaPorte.documentos.id.vista.tuRolNoPuede')}</p>
          )}
        </section>
      </div>

      {puedeEliminar && acciones.revisar && doc.estado !== 'procesando' && (
        <FormaAccion accion={acciones.revisar} className="rv-tarjeta space-y-2 max-w-xl">
          <input type="hidden" name="documentoId" value={doc.id} />
          <input type="hidden" name="version" value={doc.version} />
          <p className="text-[12px] text-[var(--muted)]">
            {tr('cartaPorte.documentos.id.vista.eliminarBorraElArchivo')}
          </p>
          <BotonEnvio variante="peligro" intencion="eliminar" etiqueta={tr('cartaPorte.documentos.id.vista.eliminarDocumentoYArchivo')} pendiente="Eliminando…"
            confirmar={{ titulo: tr('cartaPorte.documentos.id.vista.eliminarElDocumentoY'), descripcion: tr('cartaPorte.documentos.id.vista.seBorraElArchivo'), etiquetaConfirmar: tr('cartaPorte.documentos.id.vista.siEliminar') }} icono={<Trash2 width={13} height={13} strokeWidth={1.75} />} />
        </FormaAccion>
      )}

      {eventos.length > 0 && (
        <details className="rv-tarjeta">
          <summary className="cursor-pointer text-[12px] font-medium select-none">{tr('cartaPorte.documentos.id.vista.bitacoraDeEsteDocumento', { v: numero(eventos.length) })}</summary>
          <ul className="pt-2.5 space-y-1 text-[12px]">
            {eventos.map((e, i) => <li key={i} className="flex gap-3"><span className="cifra-mono text-[var(--faint)]">{fechaHoraMx(e.creadoEn)}</span><span>{rotuloEvento(tr)[e.tipo] ?? e.tipo}</span></li>)}
          </ul>
        </details>
      )}
    </EsqueletoFicha>
  );
}

/**
 * «¿Guardar estos datos en el catálogo de <cliente>?»: solo lo que una PERSONA tecleó o confirmó en esta revisión. Nunca
 * automático: no se guarda nada hasta apretar el botón, y el SKU —que el documento no declara— lo confirma la persona.
 */
function BannerCatalogo({ catalogo, tr = trEs }: { catalogo: CatalogoBanner; tr?: Tr }) {
  const { propuesta } = catalogo;
  return (
    <div className="space-y-2.5 rounded-lg p-3 bg-[var(--canvas)]" role="region" aria-label={tr('cartaPorte.documentos.id.vista.guardarEnElCatalogo')}>
      <p className="text-[12px] font-medium flex items-center gap-1.5">
        <BookOpen className="text-[var(--muted)]" width={14} height={14} strokeWidth={1.75} />{tr('cartaPorte.documentos.id.vista.guardarEstosDatosEn')} {catalogo.cliente}?
      </p>
      <p className="text-[11px] text-[var(--muted)]">
        {tr('cartaPorte.documentos.id.vista.losEscribisteTuEn')}
      </p>
      <ul className="space-y-2">
        {propuesta.productos.map((p) => (
          <li key={`p${p.indice}`} className="space-y-1">
            <label className="text-[12px] inline-flex items-start gap-1.5 cursor-pointer">
              <input type="checkbox" name="cat_prod" value={p.indice} defaultChecked className="mt-0.5" />
              <span>
                {tr('cartaPorte.documentos.id.vista.mercanciaClaveUnidad', { v: p.indice + 1, v2: p.descripcion ? ` («${p.descripcion.slice(0, 60)}»)` : '', bienes_transp: p.campos.bienes_transp, clave_unidad: p.campos.clave_unidad, v3: p.campos.embalaje ? tr('cartaPorte.documentos.id.vista.embalaje', { embalaje: p.campos.embalaje }) : '', v4: p.campos.fraccion ? tr('cartaPorte.documentos.id.vista.fraccion', { fraccion: p.campos.fraccion }) : '', v5: p.estado === 'cambia' ? ' ' + tr('cartaPorte.documentos.id.vista.actualizaElSkuQue') : '' })}
              </span>
            </label>
            <div className="pl-5 max-w-xs">
              <label htmlFor={`cat-sku-${p.indice}`} className={ETIQUETA}>{tr('cartaPorte.documentos.id.vista.skuDelClienteTal')}</label>
              <input id={`cat-sku-${p.indice}`} name={`cat_sku_${p.indice}`} defaultValue={p.skuSugerido} maxLength={80} autoComplete="off" spellCheck={false} className="w-full bg-[var(--surface)]" />
            </div>
          </li>
        ))}
        {propuesta.partes.map((p) => (
          <li key={p.lado}>
            <label className="text-[12px] inline-flex items-start gap-1.5 cursor-pointer">
              <input type="checkbox" name="cat_parte" value={p.lado} defaultChecked className="mt-0.5" />
              <span>{p.rol === 'remitente' ? tr('cartaPorte.documentos.id.vista.remitente') : tr('cartaPorte.documentos.id.vista.destinatario')} «{p.alias}»: RFC {p.campos.rfc}{p.campos.cp ? `, CP ${p.campos.cp}` : ''}{p.estado === 'cambia' ? ' ' + tr('cartaPorte.documentos.id.vista.actualizaElQueYa') : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <BotonEnvio variante="secundario" intencion="guardar_catalogo" etiqueta={tr('cartaPorte.documentos.id.vista.guardarEnElCatalogo')} pendiente="Guardando…" icono={<BookOpen width={13} height={13} strokeWidth={1.75} />} />
    </div>
  );
}

/** El texto del documento; las líneas donde hay algo por mirar (poco seguro, por confirmar, por corregir) van resaltadas. */
function TextoOriginal({ texto, revision, tr = trEs }: { texto: string; revision: Revision | null; tr?: Tr }) {
  const { lineas, recortado } = lineasDelOriginal(texto, revision);
  return (
    <>
      <pre className="text-[11px] whitespace-pre-wrap break-words cifra-mono">
        {lineas.map((l, i) => (l.resaltada
          ? <mark key={i} data-linea-resaltada className="block bg-[var(--warnbg)] text-inherit">{l.texto}{'\n'}</mark>
          : <span key={i}>{l.texto}{'\n'}</span>))}
      </pre>
      {recortado && <p className="text-[11px] text-[var(--faint)]">{tr('cartaPorte.documentos.id.vista.seMuestraSoloEl')}</p>}
    </>
  );
}

function Resumen({ revision, tr = trEs }: { revision: Revision; tr?: Tr }) {
  const { bloqueos, porConfirmar, listoParaAprobar } = revision;
  const { inferidos, pocoSeguros } = resumenDeMarcas(revision);
  return (
    <div className="space-y-1.5">
      <p className={cx('text-[12px] px-3 py-2 rounded-lg', listoParaAprobar ? 'bg-[var(--okbg)] text-[var(--ok)]' : 'bg-[var(--canvas)] text-[var(--ink)]')} role="status">
        {listoParaAprobar
          ? tr('cartaPorte.documentos.id.vista.todoEnOrdenPuedes')
          : <>{tr('cartaPorte.documentos.id.vista.paraAprobarFaltaResolver')} {bloqueos > 0 && <strong className="text-[var(--bad)]">{numero(bloqueos)} {bloqueos === 1 ? tr('cartaPorte.documentos.id.vista.datoPorCorregir') : tr('cartaPorte.documentos.id.vista.datosPorCorregir')}</strong>}{bloqueos > 0 && porConfirmar > 0 && ' y '}{porConfirmar > 0 && <strong className="text-[var(--warn)]">{numero(porConfirmar)} {porConfirmar === 1 ? tr('cartaPorte.documentos.id.vista.datoPorConfirmar') : tr('cartaPorte.documentos.id.vista.datosPorConfirmar')}</strong>}.</>}
      </p>
      {(inferidos > 0 || pocoSeguros > 0) && (
        <p className="text-[12px] px-3.5 text-[var(--warn)]" data-testid="resumen-marcas">
          {tr('cartaPorte.documentos.id.vista.resaltadosParaQueLos')} {inferidos > 0 && <strong>{tr('cartaPorte.documentos.id.vista.noVienenEnEl', { v: numero(inferidos), v2: inferidos === 1 ? tr('cartaPorte.documentos.id.vista.datoInferido') : tr('cartaPorte.documentos.id.vista.datosInferidos') })}</strong>}{inferidos > 0 && pocoSeguros > 0 && ' y '}{pocoSeguros > 0 && <strong>{numero(pocoSeguros)} {pocoSeguros === 1 ? tr('cartaPorte.documentos.id.vista.datoPocoSeguro') : tr('cartaPorte.documentos.id.vista.datosPocoSeguros')}</strong>}.
          {' '}{tr('cartaPorte.documentos.id.vista.siCorrigesAlgoY')}
        </p>
      )}
    </div>
  );
}
