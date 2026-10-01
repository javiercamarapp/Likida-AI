'use client';

import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, FileUp, MessageCircle, TriangleAlert } from 'lucide-react';
import { numero } from '@/lib/formato';
import { validarArchivoElegido } from '@/lib/http/subidas_formulario';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';
import { DialogoConfirmar } from '../admin/ui/confirmar';
import { useNotificar } from '../admin/ui/notificaciones';
import { AvisoResultado } from '../admin/ui/aviso-resultado';

// ═══════════════════════════════════════════════════════════════════════════
// LA CARGA MASIVA, EN TRES TIEMPOS: plantilla → revisar → confirmar (W2).
//
// Un tenant con 250 camiones y 250 choferes no los da de alta de uno en uno.
// Esta pieza sirve a Operadores y a Unidades con el mismo flujo:
//
//   1. descargar la plantilla (CSV con la fila de ejemplo y la columna «patio»);
//   2. subir el archivo y REVISARLO: nada se escribe, y se ve cuántas filas
//      entrarían, cuántas ya estaban y cuáles traen un problema, fila por fila;
//   3. CONFIRMAR, con un diálogo que dice cuántas se van a crear.
//
// EL ARCHIVO VIVE EN ESTADO DE REACT, no solo en el `<input>`: React 19 resetea
// los campos no controlados de un formulario cuando su acción termina, y la
// confirmación se quedaría sin archivo. El servidor vuelve a leer y a validar TODO
// al confirmar (la vista previa que ve el navegador no es de fiar) y comprueba
// la huella: si el archivo no es el que se revisó, no escribe.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionImportacion = (
  previo: ResultadoImportacionUI | null,
  datos: FormData,
) => Promise<ResultadoImportacionUI | null>;

const MAX_MB = 4;

/** Un CSV a partir de filas, con BOM (Excel en español lo abre con acentos) y
 *  comillas RFC 4180. */
export function csvDeProblemas(filas: ReadonlyArray<{ fila: number; motivo: string }>): string {
  const celda = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + ['fila,motivo', ...filas.map((f) => `${f.fila},${celda(f.motivo)}`)].join('\r\n') + '\r\n';
}

export function ImportadorMasivo({
  entidad, accion, plantillaCsv, archivoPlantilla, columnas, hrefPatios, ofrecerInvitacion = false, patioDelJefe = null, tope,
  estadoInicial = null,
}: {
  entidad: 'operadores' | 'unidades';
  accion: AccionImportacion;
  /** El texto de la plantilla (con BOM), armado en el servidor. */
  plantillaCsv: string;
  archivoPlantilla: string;
  /** Qué columnas trae, en una frase. */
  columnas: string;
  /** A dónde se crean los patios (con el sufijo del superadmin). */
  hrefPatios: string;
  ofrecerInvitacion?: boolean;
  /** El nombre del patio de un jefe con patio: toda su carga cae ahí. */
  patioDelJefe?: string | null;
  tope: number;
  /** Para renderizar la pantalla YA con un resultado (pruebas de render, SSR de un
   *  resultado conocido). En uso normal arranca `null`. */
  estadoInicial?: ResultadoImportacionUI | null;
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, estadoInicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [claveRevisada, setClaveRevisada] = useState<string | null>(null);
  const [invitar, setInvitar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { notificar } = useNotificar();

  const clave = archivo ? `${archivo.name}|${archivo.size}|${archivo.lastModified}` : null;
  const sustantivo = entidad === 'operadores' ? 'operadores' : 'unidades';
  const singular = entidad === 'operadores' ? 'operador' : 'unidad';

  function enviar(paso: 'previsualizar' | 'confirmar') {
    if (!archivo) return;
    const fd = new FormData();
    fd.set('archivo', archivo);
    fd.set('paso', paso);
    if (paso === 'confirmar') {
      fd.set('huella', estado?.huella ?? '');
      if (invitar) fd.set('invitar', 'on');
    } else {
      setClaveRevisada(clave);
    }
    startTransition(() => { ejecutar(fd); });
  }

  // Tras confirmar: se limpia lo elegido. Se ajusta DURANTE el render (el patrón de
  // React para derivar estado de otro estado) y no en un efecto: un `setState`
  // dentro de un efecto provoca un render en cascada.
  const [confirmadoVisto, setConfirmadoVisto] = useState<unknown>(null);
  if (estado?.confirmado && confirmadoVisto !== estado) {
    setConfirmadoVisto(estado);
    setArchivo(null);
    setClaveRevisada(null);
    setInvitar(false);
  }

  // Los efectos de FUERA de React (refrescar el registro de abajo, el toast y vaciar
  // el `<input type=file>`) sí viven en el efecto: no tocan estado.
  const avisado = useRef<unknown>(null);
  useEffect(() => {
    if (!estado || avisado.current === estado) return;
    avisado.current = estado;
    if (!estado.confirmado) return;
    router.refresh();
    notificar({
      tono: 'ok',
      mensaje: `Se dieron de alta ${numero(estado.nuevas)} ${estado.nuevas === 1 ? singular : sustantivo}${estado.yaEstaban > 0 ? ` (${numero(estado.yaEstaban)} ya estaban)` : ''}.`,
    });
    if (estado.invitacion && estado.invitacion.fallidas.length > 0) {
      notificar({ tono: 'aviso', mensaje: `${numero(estado.invitacion.fallidas.length)} invitaciones no salieron. Revisa el detalle abajo.` });
    }
    if (entrada.current) entrada.current.value = '';
  }, [estado, router, notificar, singular, sustantivo]);

  const hrefErrores = useMemo(
    () => (estado && estado.problemas.length > 0
      ? `data:text/csv;charset=utf-8,${encodeURIComponent(csvDeProblemas(estado.problemas))}`
      : null),
    [estado],
  );

  const revisado = !!estado && !estado.error && estado.paso === 'previsualizar' && clave !== null && clave === claveRevisada;
  const puedeConfirmar = revisado && !estado.excedeTope && estado.nuevas > 0;
  const nombreArchivoErrores = `errores-${entidad}.csv`;

  return (
    <section id="importar" aria-labelledby="titulo-importar" className="card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          <FileSpreadsheet aria-hidden width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="titulo-importar" className="font-display text-[15px] font-semibold">Cargar {sustantivo} desde Excel o CSV</h2>
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Para dar de alta tu flota completa de una vez. Primero se <strong>revisa</strong> el archivo —no se escribe nada—,
            ves cuántas filas entran y cuáles traen un problema, y recién entonces confirmas.
          </p>

          <ol className="mt-3 space-y-3 text-[13px]">
            <li>
              <p className="font-medium">1. Descarga la plantilla</p>
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{columnas}</p>
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(plantillaCsv)}`} download={archivoPlantilla}
                className="hairline mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)]">
                <Download aria-hidden width={13} height={13} strokeWidth={2} />
                Descargar plantilla (.csv)
              </a>
            </li>
            <li>
              <p className="font-medium">2. Sube tu archivo y revísalo</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label htmlFor={`archivo-${entidad}`} className="sr-only">Archivo CSV o Excel con los {sustantivo}</label>
                <input
                  ref={entrada} id={`archivo-${entidad}`} type="file" accept=".csv,.xlsx,.xls"
                  onChange={(e) => { validarArchivoElegido(e.currentTarget); setArchivo(e.currentTarget.files?.[0] ?? null); }}
                  className="text-[12.5px] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium"
                  style={{ color: 'var(--muted)' }}
                />
                <button type="button" onClick={() => enviar('previsualizar')} disabled={!archivo || pendiente}
                  className="hairline inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)] disabled:opacity-50">
                  <FileUp aria-hidden width={13} height={13} strokeWidth={2} className={pendiente ? 'animate-pulse' : ''} />
                  {pendiente ? 'Revisando…' : 'Revisar archivo'}
                </button>
              </div>
              <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--faint)' }}>
                Máximo {MAX_MB} MB y {numero(tope)} filas por archivo. {patioDelJefe
                  ? <>Tu carga cae en tu patio, <strong>{patioDelJefe}</strong>.</>
                  : <>La columna «patio» debe llevar el nombre de un patio que ya exista en <Link href={hrefPatios} className="underline">Patios</Link>.</>}
              </p>
            </li>
          </ol>

          <div aria-live="polite" className="mt-3 space-y-3">
            {estado?.error && <AvisoResultado estado={{ ok: false, error: estado.error }} />}

            {estado && (!estado.error || estado.leidas > 0) && estado.huella !== '' && (
              <div className="space-y-3">
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  Archivo <strong style={{ color: 'var(--ink2)' }}>{estado.archivo}</strong> · {numero(estado.leidas)} filas con datos leídas
                  {estado.confirmado ? ' · CARGA CONFIRMADA' : revisado ? ' · solo revisado, todavía no se escribió nada' : ''}
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <Cifra titulo={estado.confirmado ? `Se dieron de alta` : `Se darían de alta`} valor={estado.nuevas} tono={estado.nuevas > 0 ? 'ok' : undefined} />
                  <Cifra titulo="Ya estaban" valor={estado.yaEstaban} nota="no se tocan" />
                  <Cifra titulo="Con problema" valor={estado.conProblema} tono={estado.conProblema > 0 ? 'bad' : undefined} nota="no entran" />
                </div>

                {estado.excedeTope && (
                  <p role="alert" className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
                    <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    El archivo trae más de {numero(tope)} filas. Pártelo en archivos más chicos: no se importa a medias.
                  </p>
                )}

                {estado.avisos.filter((a) => !/tope es/.test(a)).map((a) => (
                  <p key={a} className="text-[12px]" style={{ color: 'var(--warn)' }}>{a}</p>
                ))}

                {estado.patiosDesconocidos.length > 0 && (
                  <p className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
                    El archivo menciona patios que no existen en tu flota: <strong>{estado.patiosDesconocidos.slice(0, 8).join(', ')}</strong>
                    {estado.patiosDesconocidos.length > 8 ? ` y ${numero(estado.patiosDesconocidos.length - 8)} más` : ''}.{' '}
                    <Link href={hrefPatios} className="underline">Créalos en Patios</Link> y vuelve a subir el archivo, o corrige el nombre.
                  </p>
                )}

                {estado.muestra.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <caption className="pb-1 text-left text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--faint)' }}>
                        {estado.confirmado ? 'Las primeras que se dieron de alta' : 'Así entrarían las primeras'}
                      </caption>
                      <tbody>
                        {estado.muestra.map((m) => (
                          <tr key={m.fila}>
                            <th scope="row" className="w-16 py-1 pr-2 text-left font-normal tabular" style={{ color: 'var(--faint)' }}>fila {m.fila}</th>
                            <td className="py-1 pr-3 font-medium">{m.titulo}</td>
                            <td className="py-1" style={{ color: 'var(--muted)' }}>{m.detalle}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {estado.problemas.length > 0 && (
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12.5px] font-medium" style={{ color: 'var(--bad)' }}>
                        {numero(estado.conProblema)} {estado.conProblema === 1 ? 'fila no entra' : 'filas no entran'}
                      </p>
                      {hrefErrores && (
                        <a href={hrefErrores} download={nombreArchivoErrores}
                          className="hairline inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)]">
                          <Download aria-hidden width={12} height={12} strokeWidth={2} />
                          Descargar errores (.csv)
                        </a>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg hairline">
                      <table className="w-full text-[12.5px]">
                        <caption className="sr-only">Filas del archivo que no entran, con su motivo</caption>
                        <thead>
                          <tr className="text-left" style={{ color: 'var(--faint)' }}>
                            <th scope="col" className="etiqueta-mono w-16 px-3 py-1.5 text-[10px] font-normal uppercase">Fila</th>
                            <th scope="col" className="etiqueta-mono px-3 py-1.5 text-[10px] font-normal uppercase">Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {estado.problemas.map((p) => (
                            <tr key={`${p.fila}-${p.motivo}`}>
                              <td className="px-3 py-1 tabular" style={{ color: 'var(--muted)' }}>{p.fila}</td>
                              <td className="px-3 py-1">{p.motivo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {estado.conProblema > estado.problemas.length && (
                      <p className="mt-1 text-[11.5px]" style={{ color: 'var(--faint)' }}>
                        Se muestran las primeras {numero(estado.problemas.length)} de {numero(estado.conProblema)}; corrige el archivo y vuelve a revisarlo para ver el resto.
                      </p>
                    )}
                  </div>
                )}

                {estado.confirmado && estado.invitacion && (
                  <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                    <p className="flex items-center gap-1.5 font-medium">
                      <MessageCircle aria-hidden width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                      Invitaciones por WhatsApp: {numero(estado.invitacion.enviadas)} enviadas
                    </p>
                    {estado.invitacion.error && <p style={{ color: 'var(--bad)' }}>{estado.invitacion.error}</p>}
                    {estado.invitacion.fallidas.slice(0, 10).map((f) => (
                      <p key={f.nombre + f.motivo} style={{ color: 'var(--warn)' }}>{f.nombre}: {f.motivo}</p>
                    ))}
                    {estado.invitacion.pendientesRestantes > 0 && (
                      <p style={{ color: 'var(--muted)' }}>
                        Quedan {numero(estado.invitacion.pendientesRestantes)} por invitar: usa «Enviar invitaciones pendientes» en el registro de abajo.
                      </p>
                    )}
                  </div>
                )}

                {puedeConfirmar && (
                  <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
                    {ofrecerInvitacion && (
                      <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
                        <input type="checkbox" checked={invitar} onChange={(e) => setInvitar(e.target.checked)} className="mt-0.5 h-4 w-4" />
                        <span>
                          <strong>Invitar por WhatsApp a los operadores nuevos.</strong>{' '}
                          <span style={{ color: 'var(--muted)' }}>
                            Cada invitación es un mensaje de WhatsApp (plantilla con costo de Meta). Marca esto solo si son tus
                            choferes y aceptaron recibir mensajes de la empresa. Salen hasta 40 por vez; el resto queda pendiente.
                          </span>
                        </span>
                      </label>
                    )}
                    <button type="button" onClick={() => setConfirmando(true)} disabled={pendiente}
                      className="h-9 rounded-lg px-4 text-[13px] font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
                      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                      {pendiente ? 'Importando…' : `Importar ${numero(estado.nuevas)} ${estado.nuevas === 1 ? singular : sustantivo}`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <DialogoConfirmar
        abierto={confirmando} tono="normal" pendiente={pendiente}
        titulo={`Dar de alta ${numero(estado?.nuevas ?? 0)} ${(estado?.nuevas ?? 0) === 1 ? singular : sustantivo}`}
        descripcion={
          <>
            Se crearán {numero(estado?.nuevas ?? 0)} {sustantivo} nuevos en tu flota
            {(estado?.yaEstaban ?? 0) > 0 ? `; los ${numero(estado?.yaEstaban ?? 0)} que ya estaban no se tocan` : ''}
            {(estado?.conProblema ?? 0) > 0 ? `; las ${numero(estado?.conProblema ?? 0)} filas con problema NO entran` : ''}.
            {invitar ? ' Además se mandará la invitación por WhatsApp a los nuevos (hasta 40 en este paso).' : ' No se manda ningún WhatsApp.'}
          </>
        }
        etiquetaConfirmar="Sí, dar de alta"
        onCancelar={() => setConfirmando(false)}
        onConfirmar={() => { setConfirmando(false); enviar('confirmar'); }}
      />
    </section>
  );
}

function Cifra({ titulo, valor, nota, tono }: { titulo: string; valor: number; nota?: string; tono?: 'ok' | 'bad' }) {
  const color = tono === 'ok' ? 'var(--ok)' : tono === 'bad' ? 'var(--bad)' : 'var(--ink)';
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{titulo}</p>
      <p className="font-display text-[22px] font-semibold tabular" style={{ color }}>{numero(valor)}</p>
      {nota && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{nota}</p>}
    </div>
  );
}
