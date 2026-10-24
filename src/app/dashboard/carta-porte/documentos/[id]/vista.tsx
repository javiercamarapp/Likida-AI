import Link from 'next/link';
import { ArrowLeft, BookOpen, Check, Download, CircleHelp, FileSearch, Send, ShieldAlert, Trash2, TriangleAlert, Truck } from 'lucide-react';
import { fechaHoraMx, numero, pesoArchivo, usd4 } from '@/lib/formato';
import { ROTULO_CANAL, ROTULO_ESTADO, ROTULO_FORMATO, ROTULO_ORIGEN, ROTULO_ORIGEN_HALLAZGO, type FilaCampo, type Revision } from '@/lib/likida/carta_porte_docs/presentacion';
import type { DocumentoFila, EstadoEnvioTms } from '@/lib/likida/carta_porte_docs/repo';
import { CAUSAS_RECHAZO, type CausaRechazo } from '@/lib/likida/carta_porte_docs/metricas';
import { propuestaVacia, type PropuestaCatalogo } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import { FRASE_ENVIADO_SIMULADO, ROTULO_SIMULADO } from '@/lib/likida/carta_porte_docs/salida_simulada';
import { lineasDelOriginal, marcaDeFila, resumenDeMarcas } from '@/lib/likida/carta_porte_docs/revision_formato';
import { AvisosLectura } from './avisos_lectura';
import { BotonEnvio, CAMPO, ETIQUETA, FormaAccion, type AccionDoc } from '../forma_accion';

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

const ROTULO_EVENTO: Record<string, string> = {
  recibido: 'Recibido', duplicado_recibido: 'Llegó otra vez (mismo archivo)', extraccion_iniciada: 'Lectura iniciada', extraccion_ok: 'Leído',
  extraccion_fallida: 'No se pudo leer', escalada: 'Se releyó con un modelo más fuerte', revision_abierta: 'Se abrió para revisar', campo_corregido: 'Se corrigieron datos',
  aprobado: 'Aprobado', rechazado: 'Rechazado', reabierto: 'Reabierto', salida_viaje: 'Viaje creado o completado', perfil_aprendido: 'El perfil del cliente aprendió',
  exportado: 'Exportado', envio_preparado: 'Envío al TMS preparado', envio_subido_a_mano: 'Marcado como subido a mano al TMS', purgado: 'Archivo borrado por retención', dividido: 'Se separó en un documento por embarque',
};

function color(sev: 'bloqueo' | 'confirmar' | 'aviso'): string {
  return sev === 'bloqueo' ? 'var(--bad)' : sev === 'confirmar' ? 'var(--warn)' : 'var(--muted)';
}

/** El envío al TMS tal como lo ve la pantalla: el estado más la fecha del próximo reintento y la ubicación del rechazo (nunca valores). */
export interface EnvioVista { estado: EstadoEnvioTms; proximaRevision?: string | null; motivo?: string | null; /** La flota sale por el simulador (T-A3-42): todo se rotula «Simulado». */ simulado?: boolean }

/** Lo que dice la tarjeta «Envío al sistema del cliente» en lenguaje llano. Sin envío = todavía no se ha enviado nada. */
export function fraseEnvio(e: EnvioVista | null): string {
  if (!e || e.estado === 'descartado') return 'Aún no se ha enviado nada.';
  const cuando = e.proximaRevision ? fechaHoraMx(e.proximaRevision) : null;
  switch (e.estado) {
    case 'pendiente_prechequeo': case 'listo': return 'Listo para enviar.';
    case 'enviando': return 'Enviándose al sistema del cliente…';
    case 'pendiente_reque': return `Esperando que exista el requerimiento${cuando ? ` — se reintentará el ${cuando}` : ''}.`;
    case 'error_transitorio': return `El sistema del cliente no contestó${cuando ? ` — se reintentará el ${cuando}` : ' — se reintentará'}.`;
    case 'enviado': return e.simulado ? FRASE_ENVIADO_SIMULADO : 'Enviado.';
    case 'rechazado_tms': return `El sistema del cliente lo rechazó${e.motivo ? `: ${e.motivo}` : ''} — corrige y vuelve a aprobar.`;
    case 'subido_a_mano': return 'Subido a mano.';
  }
}

function Confianza({ c }: { c: number | null }) {
  if (c === null) return <span className="text-[10.5px]" style={{ color: 'var(--faint)' }}>sin dato</span>;
  const pct = Math.round(c * 100);
  const fg = c >= 0.9 ? 'var(--ok)' : c >= 0.8 ? 'var(--warn)' : 'var(--bad)';
  return <span className="text-[10.5px] font-medium cifra-mono" style={{ color: fg }} title="Qué tan seguro está el agente de que leyó exactamente lo que dice el documento">{pct} %</span>;
}

function Campo({ f, editable }: { f: FilaCampo; editable: boolean }) {
  const id = `f-${f.nombre.replace(/:/g, '-')}`;
  const marca = marcaDeFila(f);
  const resaltado = marca.inferido || marca.bajaConfianza;
  const borde = f.bloqueado ? 'var(--bad)' : f.porConfirmar ? 'var(--warn)' : resaltado ? 'var(--warn)' : undefined;
  return (
    <div className="space-y-1" data-marca={marca.inferido ? 'inferido' : marca.bajaConfianza ? 'poco-seguro' : undefined}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-medium">{f.rotulo}{f.critico && <abbr title="Dato crítico: si falta o es dudoso, no se aprueba" className="no-underline" style={{ color: 'var(--marca)' }}> *</abbr>}</label>
        <span className="flex items-center gap-1.5">
          {marca.inferido && <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded" style={{ color: 'var(--warn)', border: '1px solid var(--warn)' }}>Inferido</span>}
          {!marca.inferido && marca.bajaConfianza && <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded" style={{ color: 'var(--warn)', border: '1px solid var(--warn)' }}>Poco seguro</span>}
          {f.origen && <span className="text-[10.5px]" style={{ color: 'var(--faint)' }}>{ROTULO_ORIGEN[f.origen]}</span>}
          <Confianza c={f.confianza} />
        </span>
      </div>
      <input id={id} name={f.nombre} defaultValue={f.valor} readOnly={!editable} autoComplete="off" spellCheck={false}
        className={CAMPO} style={{ background: 'var(--surface)', ...(borde ? { borderColor: borde } : {}) }} aria-invalid={f.bloqueado || undefined} />
      {f.evidencia && <p className="text-[10.5px] truncate" style={{ color: 'var(--faint)' }} title={f.evidencia}>Evidencia: «{f.evidencia}»</p>}
      {marca.avisos.map((a) => <p key={a} className="text-[10.5px]" style={{ color: 'var(--warn)' }}>{a}</p>)}
      {f.notas.map((n) => <p key={n} className="text-[10.5px]" style={{ color: 'var(--muted)' }}>{n}</p>)}
      {f.hallazgos.map((h) => (
        <p key={`${h.codigo}-${h.mensaje}`} className="text-[11px] flex items-start gap-1" style={{ color: color(h.severidad) }}>
          <TriangleAlert width={11} height={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />{h.origen && <strong className="font-medium">{ROTULO_ORIGEN_HALLAZGO[h.origen]}:</strong>} {h.mensaje}
        </p>
      ))}
      {editable && f.porConfirmar && (
        <label className="text-[11px] inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" name={f.nombreConfirmar} defaultChecked={false} />
          Ya lo revisé contra el documento: es correcto
        </label>
      )}
    </div>
  );
}

/** T-A3-31: a quién le toca este caso y a quién se le puede pasar. `null` = la flota no usa asignación (no se pinta nada). */
export interface RevisorVista { actualId: string | null; opciones: Array<{ id: string; nombre: string }> }

export function VistaRevision({ doc, revision, original, operadores, eventos, acciones, sufijo = '', envio = null, salida = null, puedeEliminar = false, embarque = null, hijos = [], perfilRestringido = false, catalogo = null, revisor = null }: {
  doc: DocumentoFila;
  revision: Revision | null;
  original: OriginalVista;
  operadores: Array<{ id: string; nombre: string }>;
  eventos: EventoVista[];
  acciones: { revisar: AccionDoc | null; reasignar?: AccionDoc | null };
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
  catalogo?: CatalogoBanner | null;
}) {
  const editable = doc.estado === 'por_revisar';
  const meta = doc.extraccion?.meta;
  return (
    <main className="max-w-[1500px] mx-auto px-5 py-6 space-y-4">
      <Link href={`/dashboard/carta-porte/documentos${sufijo}`} className="text-[12.5px] font-medium inline-flex items-center gap-1 hover:opacity-75" style={{ color: 'var(--marca)' }}>
        <ArrowLeft width={13} height={13} strokeWidth={1.75} /> Volver a los documentos
      </Link>

      <header className="space-y-1">
        <h1 className="font-display text-[19px] font-semibold flex flex-wrap items-center gap-2">
          <FileSearch width={18} height={18} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          <span className="break-all">{doc.nombreArchivo}</span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full hairline" style={{ color: 'var(--muted)' }}>{ROTULO_ESTADO[doc.estado]}</span>
        </h1>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {ROTULO_FORMATO[doc.formato] ?? doc.formato} · {ROTULO_CANAL[doc.canal] ?? doc.canal} · {pesoArchivo(doc.bytes)} · recibido {fechaHoraMx(doc.createdAt)}
          {doc.remitente ? ` · de ${doc.remitente}` : ''}{doc.asunto ? ` · «${doc.asunto}»` : ''}
        </p>
        {meta && (
          <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
            Lectura: {meta.origen === 'xml' ? 'directa del XML, sin modelo' : meta.origen === 'perfil' ? 'con el perfil del cliente, sin modelo' : meta.origen === 'perfil+llm' ? 'perfil del cliente + modelo para lo que faltaba' : `modelo nivel ${meta.nivel}`}
            {doc.modelo ? ` (${doc.modelo})` : ''} · {usd4(doc.costoUsd)}
            {meta.escalamientos.length > 0 ? ` · se releyó ${numero(meta.escalamientos.length)} ${meta.escalamientos.length === 1 ? 'vez' : 'veces'} con un modelo más fuerte` : ''}
          </p>
        )}
        <AvisosLectura meta={meta} />
        {doc.riesgoInyeccion && (
          <p className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-1.5" role="alert" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
            <ShieldAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            Este documento trae texto con forma de instrucción para un modelo de IA («ignora lo anterior», «aprueba»…). Se ignoró, pero ningún dato crítico
            se aprueba sin que lo confirmes tú, y de este documento el perfil del cliente no aprende.
          </p>
        )}
        {(doc.formato === 'imagen' || doc.formato === 'pdf_escaneado') && (
          <p className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-1.5" role="status" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
            <TriangleAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {doc.formato === 'imagen' ? 'Esta es una foto' : 'Este es un PDF escaneado'}: no hay texto del documento contra el que verificar lo que leyó el
            modelo, así que los datos críticos dependen solo de su lectura de la imagen. Se te pide confirmarlos aunque el modelo diga que está muy seguro — revísalos contra la foto con cuidado.
          </p>
        )}
        {embarque && (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Embarque {numero(embarque.indice)} de {numero(embarque.total)}{embarque.clave ? ` (folio ${embarque.clave})` : ''} del archivo{' '}
            <Link href={`/dashboard/carta-porte/documentos/${embarque.padreId}${sufijo}`} className="font-medium" style={{ color: 'var(--marca)' }}>{embarque.padreNombre}</Link>.
          </p>
        )}
        {revisor && (
          <div className="text-[12px] flex flex-wrap items-center gap-2" style={{ color: 'var(--muted)' }}>
            <span>Asignado a: <strong style={{ color: 'var(--ink)' }}>{revisor.opciones.find((o) => o.id === revisor.actualId)?.nombre ?? (revisor.actualId ? 'Otra persona' : 'Todos los revisores')}</strong></span>
            {editable && acciones.reasignar && (
              <FormaAccion accion={acciones.reasignar} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="documentoId" value={doc.id} />
                <label className="sr-only" htmlFor="revisorId">Reasignar a</label>
                <select id="revisorId" name="revisorId" defaultValue={revisor.actualId ?? ''} className={`${CAMPO} !w-auto`}>
                  <option value="">Todos los revisores</option>
                  {revisor.opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
                <BotonEnvio variante="secundario" etiqueta="Reasignar" pendiente="Reasignando…" />
              </FormaAccion>
            )}
          </div>
        )}
        {doc.estado === 'fallido' && <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>{doc.ultimoError}</p>}
        {doc.estado === 'rechazado' && <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Rechazado: {doc.rechazoMotivo}</p>}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <section aria-label="El documento" className="card p-3 space-y-2 xl:sticky xl:top-4 max-h-[85vh] overflow-auto">
          <h2 className="text-[12.5px] font-medium">El documento</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage: next/image exigiría declarar el dominio y optimizaría un documento que NO se debe recomprimir */}
          {original.tipo === 'imagen' && <img src={original.url} alt="Documento del cliente" className="w-full rounded-md hairline" />}
          {original.tipo === 'imagenes' && original.urls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt={`Página ${i + 1} del documento del cliente`} className="w-full rounded-md hairline" />
          ))}
          {original.tipo === 'texto' && <TextoOriginal texto={original.texto} revision={revision} />}
          {original.tipo === 'nada' && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{original.motivo}</p>}
        </section>

        <section aria-label="Lo que se leyó" className="space-y-3">
          {doc.estado === 'dividido' ? (
            <div className="card p-4 space-y-2.5">
              <p className="text-[12.5px]">
                Este archivo traía varios embarques. Cada uno es un documento aparte, con su propia revisión, su aprobación y su viaje;
                este queda como constancia de lo que llegó.
              </p>
              {hijos.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No hay embarques ligados a este archivo.</p>
              ) : (
                <ul className="space-y-1.5 text-[12.5px]">
                  {hijos.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="cifra-mono" style={{ color: 'var(--faint)' }}>{numero(h.indice)}.</span>
                      <Link href={`/dashboard/carta-porte/documentos/${h.id}${sufijo}`} className="font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
                        {h.clave ? `Folio ${h.clave}` : h.nombre}
                      </Link>
                      <span style={{ color: 'var(--muted)' }}>
                        {ROTULO_ESTADO[h.estado]}
                        {h.estado === 'por_revisar' && h.bloqueos > 0 ? ` · ${numero(h.bloqueos)} por corregir` : ''}
                        {h.estado === 'por_revisar' && h.bloqueos === 0 && h.porConfirmar > 0 ? ` · ${numero(h.porConfirmar)} por confirmar` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : revision === null ? (
            <div className="card p-4 space-y-3">
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {doc.estado === 'fallido' ? 'El documento no se pudo leer; no hay datos que revisar.' : 'El documento todavía no tiene datos leídos.'}
              </p>
              {doc.estado === 'fallido' && acciones.revisar && (
                <FormaAccion accion={acciones.revisar} className="space-y-2">
                  <input type="hidden" name="documentoId" value={doc.id} />
                  <input type="hidden" name="version" value={doc.version} />
                  <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    Si la causa ya se arregló (llave, proveedor caído, archivo mal subido), vuelve a leerlo. También sirve reenviar el mismo archivo.
                  </p>
                  <BotonEnvio variante="secundario" intencion="reintentar" etiqueta="Reintentar lectura" pendiente="Reintentando…" />
                </FormaAccion>
              )}
            </div>
          ) : acciones.revisar ? (
            <FormaAccion accion={acciones.revisar} className="space-y-3">
              <input type="hidden" name="documentoId" value={doc.id} />
              <input type="hidden" name="version" value={doc.version} />

              <Resumen revision={revision} />
              {revision.generales.map((h) => (
                <p key={h.codigo + h.mensaje} className="text-[12px] flex items-start gap-1.5" style={{ color: color(h.severidad) }}>
                  <CircleHelp width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />{h.origen && <strong className="font-medium">{ROTULO_ORIGEN_HALLAZGO[h.origen]}:</strong>} {h.mensaje}
                </p>
              ))}

              {revision.grupos.map((g) => (
                <fieldset key={g.id} className="card p-3.5 space-y-3">
                  <legend className="text-[12.5px] font-medium px-1">{g.titulo}</legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">{g.filas.map((f) => <Campo key={f.nombre} f={f} editable={editable} />)}</div>
                </fieldset>
              ))}

              {revision.mercancias.map((m) => (editable || !m.esNuevo) && (
                <fieldset key={m.indice} className="card p-3.5 space-y-3">
                  <legend className="text-[12.5px] font-medium px-1">{m.esNuevo ? 'Agregar una mercancía que falte' : `Mercancía ${m.indice + 1}`}</legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">{m.filas.map((f) => <Campo key={f.nombre} f={f} editable={editable} />)}</div>
                  {!m.esNuevo && editable && (
                    <BotonEnvio variante="peligro" intencion={`quitar:${m.indice}`} etiqueta="Quitar este renglón" pendiente="Quitando…" icono={<Trash2 width={13} height={13} strokeWidth={1.75} />} />
                  )}
                </fieldset>
              ))}

              {editable && (
                <div className="card p-3.5 space-y-3 sticky bottom-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <BotonEnvio variante="secundario" intencion="guardar" etiqueta="Guardar cambios" pendiente="Guardando…" />
                    <BotonEnvio intencion="aprobar" etiqueta="Aprobar" pendiente="Aprobando…" icono={<Check width={14} height={14} strokeWidth={1.75} />} />
                    <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{perfilRestringido ? 'Aprobar guarda lo que escribiste, revalida y prepara el envío al sistema del cliente. No timbra nada.' : 'Aprobar guarda lo que escribiste, revalida y crea o completa el viaje. No timbra nada.'}</span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="grow min-w-[220px]">
                      <label htmlFor="cp-rechazo" className={ETIQUETA}>Rechazar el documento (motivo)</label>
                      <input id="cp-rechazo" name="motivo" maxLength={500} placeholder="No es un embarque nuestro / está duplicado…" className={CAMPO} style={{ background: 'var(--surface)' }} />
                    </div>
                    <div>
                      <label htmlFor="cp-rechazo-causa" className={ETIQUETA}>Causa</label>
                      <select id="cp-rechazo-causa" name="causa" defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
                        <option value="">Sin clasificar</option>
                        {(Object.keys(CAUSAS_RECHAZO) as CausaRechazo[]).filter((c) => c !== 'tms_rechazo').map((c) => <option key={c} value={c}>{CAUSAS_RECHAZO[c]}</option>)}
                      </select>
                    </div>
                    <BotonEnvio variante="peligro" intencion="rechazar" etiqueta="Rechazar" pendiente="…" />
                  </div>
                  {!perfilRestringido && operadores.length > 0 && (
                    <div>
                      <label htmlFor="cp-operador" className={ETIQUETA}>Operador del viaje (solo si el documento no lo dice con claridad)</label>
                      <select id="cp-operador" name="operadorId" defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
                        <option value="">El del documento</option>
                        {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {!editable && (
                <div className="card p-3.5 space-y-3">
                  {doc.estado === 'aprobado' && perfilRestringido && (
                    <div className="space-y-1" aria-label="Envío al sistema del cliente">
                      <p className="text-[12.5px] font-medium flex items-center gap-1.5">
                        <Send width={14} height={14} strokeWidth={1.75} style={{ color: envio?.estado === 'rechazado_tms' ? 'var(--bad)' : envio?.estado === 'enviado' ? 'var(--ok)' : 'var(--muted)' }} />Envío al sistema del cliente
                        {envio?.simulado && <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded" style={{ color: 'var(--warn)', border: '1px solid var(--warn)' }} data-testid="rotulo-simulado">{ROTULO_SIMULADO}</span>}
                      </p>
                      <p className="text-[12.5px]" role="status">{fraseEnvio(envio)}</p>
                    </div>
                  )}
                  {doc.estado === 'aprobado' && !perfilRestringido && (
                    <>
                      <p className="text-[12.5px] flex items-center gap-1.5">
                        <Truck width={14} height={14} strokeWidth={1.75} style={{ color: doc.viajeId ? 'var(--ok)' : 'var(--warn)' }} />
                        {doc.viajeId ? <>Con viaje{salida ? ` ${salida.folio}` : ''}. <Link href={`/dashboard/carta-porte/borrador/${doc.viajeId}${sufijo}`} className="font-medium" style={{ color: 'var(--marca)' }}>Ver el borrador del complemento →</Link></> : 'Todavía sin viaje: elige el operador y créalo.'}
                      </p>
                      {operadores.length > 0 && (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="grow min-w-[220px]">
                            <label htmlFor="cp-operador2" className={ETIQUETA}>Operador</label>
                            <select id="cp-operador2" name="operadorId" defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
                              <option value="">El del documento</option>
                              {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                            </select>
                          </div>
                          <BotonEnvio variante="secundario" intencion="viaje" etiqueta={doc.viajeId ? 'Actualizar el viaje' : 'Crear el viaje'} pendiente="…" />
                        </div>
                      )}
                    </>
                  )}
                  {doc.estado === 'aprobado' && catalogo && !propuestaVacia(catalogo.propuesta) && <BannerCatalogo catalogo={catalogo} />}
                  {doc.estado === 'aprobado' && envio?.estado !== 'enviado' && (
                    <div className="space-y-2" aria-label="Modo manual">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={`/api/export/carta-porte-docs${sufijo ? `${sufijo}&` : '?'}formato=plantilla_tms&documento=${doc.id}`} download
                          className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 hairline transition-opacity hover:opacity-85" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                          <Download width={14} height={14} strokeWidth={1.75} />Descargar plantilla del TMS
                        </a>
                        {envio?.estado !== 'subido_a_mano' && (
                          <>
                            <div>
                              <label htmlFor="referenciaTms" className={ETIQUETA}>Referencia que te dio el sistema del cliente (opcional)</label>
                              <input id="referenciaTms" name="referenciaTms" maxLength={200} autoComplete="off" spellCheck={false} className={CAMPO} style={{ background: 'var(--surface)' }} />
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>Con ella Likida reconoce el aviso del CCP timbrado de esta carga; sin ella el aviso se rechaza.</p>
                            </div>
                            <BotonEnvio variante="secundario" intencion="subido_a_mano" etiqueta="Ya la subí a mano" pendiente="Marcando…" icono={<Check width={14} height={14} strokeWidth={1.75} />} />
                          </>
                        )}
                      </div>
                      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                        {envio?.estado === 'subido_a_mano'
                          ? 'Marcada como subida a mano: Likida no la reenvía.'
                          : 'Descarga la plantilla, súbela al TMS y avisa aquí: así Likida no la reintenta. No se envía nada por ti.'}
                      </p>
                    </div>
                  )}
                  <BotonEnvio variante="secundario" intencion="reabrir" etiqueta="Reabrir para corregir" pendiente="…" />
                </div>
              )}
            </FormaAccion>
          ) : (
            <p className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Tu rol no puede revisar este documento.</p>
          )}
        </section>
      </div>

      {puedeEliminar && acciones.revisar && doc.estado !== 'procesando' && (
        <FormaAccion accion={acciones.revisar} className="card p-3.5 space-y-2 max-w-xl">
          <input type="hidden" name="documentoId" value={doc.id} />
          <input type="hidden" name="version" value={doc.version} />
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Eliminar borra el archivo y todo lo leído de él (nombres, licencias y RFC de terceros). Úsalo para una solicitud de cancelación o un documento subido por error.
            Las mercancías que ya pasaron a un viaje se conservan.
          </p>
          <BotonEnvio variante="peligro" intencion="eliminar" etiqueta="Eliminar documento y archivo" pendiente="Eliminando…" icono={<Trash2 width={13} height={13} strokeWidth={1.75} />} />
        </FormaAccion>
      )}

      {eventos.length > 0 && (
        <details className="card p-3.5">
          <summary className="cursor-pointer text-[12.5px] font-medium select-none">Bitácora de este documento ({numero(eventos.length)})</summary>
          <ul className="pt-2.5 space-y-1 text-[12px]">
            {eventos.map((e, i) => <li key={i} className="flex gap-3"><span className="cifra-mono" style={{ color: 'var(--faint)' }}>{fechaHoraMx(e.creadoEn)}</span><span>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</span></li>)}
          </ul>
        </details>
      )}
    </main>
  );
}

/**
 * «¿Guardar estos datos en el catálogo de <cliente>?»: solo lo que una PERSONA tecleó o confirmó en esta revisión. Nunca
 * automático: no se guarda nada hasta apretar el botón, y el SKU —que el documento no declara— lo confirma la persona.
 */
function BannerCatalogo({ catalogo }: { catalogo: CatalogoBanner }) {
  const { propuesta } = catalogo;
  return (
    <div className="space-y-2.5 rounded-lg p-3" role="region" aria-label="Guardar en el catálogo" style={{ background: 'var(--canvas)' }}>
      <p className="text-[12.5px] font-medium flex items-center gap-1.5">
        <BookOpen width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />¿Guardar estos datos en el catálogo de {catalogo.cliente}?
      </p>
      <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Los escribiste tú en esta revisión. Si los guardas, el próximo documento con el mismo producto, remitente o destinatario saldrá con ellos ya llenos. No se guarda nada solo.
      </p>
      <ul className="space-y-2">
        {propuesta.productos.map((p) => (
          <li key={`p${p.indice}`} className="space-y-1">
            <label className="text-[12px] inline-flex items-start gap-1.5 cursor-pointer">
              <input type="checkbox" name="cat_prod" value={p.indice} defaultChecked className="mt-0.5" />
              <span>
                Mercancía {p.indice + 1}{p.descripcion ? ` («${p.descripcion.slice(0, 60)}»)` : ''}: clave {p.campos.bienes_transp}, unidad {p.campos.clave_unidad}
                {p.campos.embalaje ? `, embalaje ${p.campos.embalaje}` : ''}{p.campos.fraccion ? `, fracción ${p.campos.fraccion}` : ''}
                {p.estado === 'cambia' ? ' — actualiza el SKU que ya está en el catálogo' : ''}
              </span>
            </label>
            <div className="pl-5 max-w-xs">
              <label htmlFor={`cat-sku-${p.indice}`} className={ETIQUETA}>SKU del cliente (tal como aparece en el documento)</label>
              <input id={`cat-sku-${p.indice}`} name={`cat_sku_${p.indice}`} defaultValue={p.skuSugerido} maxLength={80} autoComplete="off" spellCheck={false} className={CAMPO} style={{ background: 'var(--surface)' }} />
            </div>
          </li>
        ))}
        {propuesta.partes.map((p) => (
          <li key={p.lado}>
            <label className="text-[12px] inline-flex items-start gap-1.5 cursor-pointer">
              <input type="checkbox" name="cat_parte" value={p.lado} defaultChecked className="mt-0.5" />
              <span>{p.rol === 'remitente' ? 'Remitente' : 'Destinatario'} «{p.alias}»: RFC {p.campos.rfc}{p.campos.cp ? `, CP ${p.campos.cp}` : ''}{p.estado === 'cambia' ? ' — actualiza el que ya está en el catálogo' : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <BotonEnvio variante="secundario" intencion="guardar_catalogo" etiqueta="Guardar en el catálogo" pendiente="Guardando…" icono={<BookOpen width={13} height={13} strokeWidth={1.75} />} />
    </div>
  );
}

/** El texto del documento; las líneas donde hay algo por mirar (poco seguro, por confirmar, por corregir) van resaltadas. */
function TextoOriginal({ texto, revision }: { texto: string; revision: Revision | null }) {
  const { lineas, recortado } = lineasDelOriginal(texto, revision);
  return (
    <>
      <pre className="text-[11.5px] whitespace-pre-wrap break-words cifra-mono">
        {lineas.map((l, i) => (l.resaltada
          ? <mark key={i} data-linea-resaltada style={{ display: 'block', background: 'var(--warnbg, var(--canvas))', color: 'inherit' }}>{l.texto}{'\n'}</mark>
          : <span key={i}>{l.texto}{'\n'}</span>))}
      </pre>
      {recortado && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Se muestra solo el principio del documento.</p>}
    </>
  );
}

function Resumen({ revision }: { revision: Revision }) {
  const { bloqueos, porConfirmar, listoParaAprobar } = revision;
  const { inferidos, pocoSeguros } = resumenDeMarcas(revision);
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] px-3.5 py-2.5 rounded-lg" role="status"
        style={{ background: listoParaAprobar ? 'var(--okbg)' : 'var(--canvas)', color: listoParaAprobar ? 'var(--ok)' : 'var(--ink)' }}>
        {listoParaAprobar
          ? 'Todo en orden: puedes aprobar.'
          : <>Para aprobar falta resolver {bloqueos > 0 && <strong style={{ color: 'var(--bad)' }}>{numero(bloqueos)} {bloqueos === 1 ? 'dato por corregir' : 'datos por corregir'}</strong>}{bloqueos > 0 && porConfirmar > 0 && ' y '}{porConfirmar > 0 && <strong style={{ color: 'var(--warn)' }}>{numero(porConfirmar)} {porConfirmar === 1 ? 'dato por confirmar' : 'datos por confirmar'}</strong>}.</>}
      </p>
      {(inferidos > 0 || pocoSeguros > 0) && (
        <p className="text-[12px] px-3.5" style={{ color: 'var(--warn)' }} data-testid="resumen-marcas">
          Resaltados para que los mires: {inferidos > 0 && <strong>{numero(inferidos)} {inferidos === 1 ? 'dato inferido' : 'datos inferidos'} (no vienen en el documento)</strong>}{inferidos > 0 && pocoSeguros > 0 && ' y '}{pocoSeguros > 0 && <strong>{numero(pocoSeguros)} {pocoSeguros === 1 ? 'dato poco seguro' : 'datos poco seguros'}</strong>}.
          {' '}Si corriges algo y apruebas, el formato de este cliente aprende y el siguiente documento igual sale sin modelo.
        </p>
      )}
    </div>
  );
}
