import Link from 'next/link';
import { ArrowLeft, Check, CircleHelp, FileSearch, ShieldAlert, Trash2, TriangleAlert, Truck } from 'lucide-react';
import { fechaHoraMx, numero, pesoArchivo, usd4 } from '@/lib/formato';
import { ROTULO_CANAL, ROTULO_ESTADO, ROTULO_FORMATO, ROTULO_ORIGEN, type FilaCampo, type Revision } from '@/lib/likida/carta_porte_docs/presentacion';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';
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
 *     pide confirmación a mano.
 */

export type OriginalVista =
  | { tipo: 'imagen'; url: string }
  | { tipo: 'imagenes'; urls: string[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nada'; motivo: string };

export interface EventoVista { tipo: string; creadoEn: string }

const ROTULO_EVENTO: Record<string, string> = {
  recibido: 'Recibido', duplicado_recibido: 'Llegó otra vez (mismo archivo)', extraccion_iniciada: 'Lectura iniciada', extraccion_ok: 'Leído',
  extraccion_fallida: 'No se pudo leer', escalada: 'Se releyó con un modelo más fuerte', revision_abierta: 'Se abrió para revisar', campo_corregido: 'Se corrigieron datos',
  aprobado: 'Aprobado', rechazado: 'Rechazado', reabierto: 'Reabierto', salida_viaje: 'Viaje creado o completado', perfil_aprendido: 'El perfil del cliente aprendió',
  exportado: 'Exportado', purgado: 'Archivo borrado por retención',
};

function color(sev: 'bloqueo' | 'confirmar' | 'aviso'): string {
  return sev === 'bloqueo' ? 'var(--bad)' : sev === 'confirmar' ? 'var(--warn)' : 'var(--muted)';
}

function Confianza({ c }: { c: number | null }) {
  if (c === null) return <span className="text-[10.5px]" style={{ color: 'var(--faint)' }}>sin dato</span>;
  const pct = Math.round(c * 100);
  const fg = c >= 0.9 ? 'var(--ok)' : c >= 0.8 ? 'var(--warn)' : 'var(--bad)';
  return <span className="text-[10.5px] font-medium cifra-mono" style={{ color: fg }} title="Qué tan seguro está el agente de que leyó exactamente lo que dice el documento">{pct} %</span>;
}

function Campo({ f, editable }: { f: FilaCampo; editable: boolean }) {
  const id = `f-${f.nombre.replace(/:/g, '-')}`;
  const borde = f.bloqueado ? 'var(--bad)' : f.porConfirmar ? 'var(--warn)' : undefined;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-medium">{f.rotulo}{f.critico && <abbr title="Dato crítico: si falta o es dudoso, no se aprueba" className="no-underline" style={{ color: 'var(--marca)' }}> *</abbr>}</label>
        <span className="flex items-center gap-1.5">
          {f.origen && <span className="text-[10.5px]" style={{ color: 'var(--faint)' }}>{ROTULO_ORIGEN[f.origen]}</span>}
          <Confianza c={f.confianza} />
        </span>
      </div>
      <input id={id} name={f.nombre} defaultValue={f.valor} readOnly={!editable} autoComplete="off" spellCheck={false}
        className={CAMPO} style={{ background: 'var(--surface)', ...(borde ? { borderColor: borde } : {}) }} aria-invalid={f.bloqueado || undefined} />
      {f.evidencia && <p className="text-[10.5px] truncate" style={{ color: 'var(--faint)' }} title={f.evidencia}>Evidencia: «{f.evidencia}»</p>}
      {f.notas.map((n) => <p key={n} className="text-[10.5px]" style={{ color: 'var(--muted)' }}>{n}</p>)}
      {f.hallazgos.map((h) => (
        <p key={`${h.codigo}-${h.mensaje}`} className="text-[11px] flex items-start gap-1" style={{ color: color(h.severidad) }}>
          <TriangleAlert width={11} height={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />{h.mensaje}
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

export function VistaRevision({ doc, revision, original, operadores, eventos, acciones, sufijo = '', salida = null }: {
  doc: DocumentoFila;
  revision: Revision | null;
  original: OriginalVista;
  operadores: Array<{ id: string; nombre: string }>;
  eventos: EventoVista[];
  acciones: { revisar: AccionDoc | null };
  sufijo?: string;
  /** El resultado de la salida al viaje ya conocido (viaje ligado). */
  salida?: { folio: string } | null;
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
        {doc.riesgoInyeccion && (
          <p className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-1.5" role="alert" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
            <ShieldAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            Este documento trae texto con forma de instrucción para un modelo de IA («ignora lo anterior», «aprueba»…). Se ignoró, pero ningún dato crítico
            se aprueba sin que lo confirmes tú, y de este documento el perfil del cliente no aprende.
          </p>
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
          {original.tipo === 'texto' && <pre className="text-[11.5px] whitespace-pre-wrap break-words cifra-mono">{original.texto}</pre>}
          {original.tipo === 'nada' && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{original.motivo}</p>}
        </section>

        <section aria-label="Lo que se leyó" className="space-y-3">
          {revision === null ? (
            <p className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              {doc.estado === 'fallido' ? 'El documento no se pudo leer; no hay datos que revisar.' : 'El documento todavía no tiene datos leídos.'}
            </p>
          ) : acciones.revisar ? (
            <FormaAccion accion={acciones.revisar} className="space-y-3">
              <input type="hidden" name="documentoId" value={doc.id} />
              <input type="hidden" name="version" value={doc.version} />

              <Resumen revision={revision} />
              {revision.generales.map((h) => (
                <p key={h.codigo + h.mensaje} className="text-[12px] flex items-start gap-1.5" style={{ color: color(h.severidad) }}>
                  <CircleHelp width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />{h.mensaje}
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
                    <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Aprobar guarda lo que escribiste, revalida y crea o completa el viaje. No timbra nada.</span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="grow min-w-[220px]">
                      <label htmlFor="cp-rechazo" className={ETIQUETA}>Rechazar el documento (motivo)</label>
                      <input id="cp-rechazo" name="motivo" maxLength={500} placeholder="No es un embarque nuestro / está duplicado…" className={CAMPO} style={{ background: 'var(--surface)' }} />
                    </div>
                    <BotonEnvio variante="peligro" intencion="rechazar" etiqueta="Rechazar" pendiente="…" />
                  </div>
                  {operadores.length > 0 && (
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
                  {doc.estado === 'aprobado' && (
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
                  <BotonEnvio variante="secundario" intencion="reabrir" etiqueta="Reabrir para corregir" pendiente="…" />
                </div>
              )}
            </FormaAccion>
          ) : (
            <p className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Tu rol no puede revisar este documento.</p>
          )}
        </section>
      </div>

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

function Resumen({ revision }: { revision: Revision }) {
  const { bloqueos, porConfirmar, listoParaAprobar } = revision;
  return (
    <p className="text-[12.5px] px-3.5 py-2.5 rounded-lg" role="status"
      style={{ background: listoParaAprobar ? 'var(--okbg)' : 'var(--canvas)', color: listoParaAprobar ? 'var(--ok)' : 'var(--ink)' }}>
      {listoParaAprobar
        ? 'Todo en orden: puedes aprobar.'
        : <>Para aprobar falta resolver {bloqueos > 0 && <strong style={{ color: 'var(--bad)' }}>{numero(bloqueos)} {bloqueos === 1 ? 'dato por corregir' : 'datos por corregir'}</strong>}{bloqueos > 0 && porConfirmar > 0 && ' y '}{porConfirmar > 0 && <strong style={{ color: 'var(--warn)' }}>{numero(porConfirmar)} {porConfirmar === 1 ? 'dato por confirmar' : 'datos por confirmar'}</strong>}.</>}
    </p>
  );
}
