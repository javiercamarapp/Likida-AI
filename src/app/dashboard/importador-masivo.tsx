'use client';

import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FileUp } from 'lucide-react';
import { numero } from '@/lib/formato';
import { validarArchivoElegido } from '@/lib/http/subidas_formulario';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';
import { DialogoConfirmar } from '../admin/ui/confirmar';
import { useNotificar } from '../admin/ui/notificaciones';
import { AvisoResultado } from '../admin/ui/aviso-resultado';
import { Aviso, Boton, BotonEnlace, CampoArchivo, Casilla, Icono, InfoTip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';

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
  // A37-S18-10: el motivo puede traer celdas del archivo subido. Una que empiece
  // con = + - @ (o tab/CR) Excel la evalúa como fórmula: se le antepone apóstrofo.
  const celda = (crudo: string) => {
    const v = /^[=+\-@\t\r]/.test(crudo) ? `'${crudo}` : crudo;
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return '﻿' + ['fila,motivo', ...filas.map((f) => `${f.fila},${celda(f.motivo)}`)].join('\r\n') + '\r\n';
}

export function ImportadorMasivo({
  entidad, accion, plantillaCsv, archivoPlantilla, columnas, hrefPatios, ofrecerInvitacion = false, patioDelJefe = null, tope,
  estadoInicial = null,
}: {
  entidad: 'operadores' | 'unidades' | 'dispositivos_gps';
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
  const esGps = entidad === 'dispositivos_gps';
  const sustantivo = entidad === 'operadores' ? 'operadores' : esGps ? 'dispositivos GPS' : 'unidades';
  const singular = entidad === 'operadores' ? 'operador' : esGps ? 'dispositivo GPS' : 'unidad';
  // W3: el mapeo de GPS LIGA dispositivos a unidades que ya existen, no da de alta nada.
  const verboPasado = esGps ? 'ligaron' : 'dieron de alta';

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
      mensaje: `Se ${verboPasado} ${numero(estado.nuevas)} ${estado.nuevas === 1 ? singular : sustantivo}${estado.yaEstaban > 0 ? ` (${numero(estado.yaEstaban)} ya estaban)` : ''}.`,
    });
    if (estado.invitacion && estado.invitacion.fallidas.length > 0) {
      notificar({ tono: 'aviso', mensaje: `${numero(estado.invitacion.fallidas.length)} invitaciones no salieron. Revisa el detalle abajo.` });
    }
    if (entrada.current) entrada.current.value = '';
  }, [estado, router, notificar, singular, sustantivo, verboPasado]);

  const hrefErrores = useMemo(
    () => (estado && estado.problemas.length > 0
      ? `data:text/csv;charset=utf-8,${encodeURIComponent(csvDeProblemas(estado.problemas))}`
      : null),
    [estado],
  );

  const revisado = !!estado && !estado.error && estado.paso === 'previsualizar' && clave !== null && clave === claveRevisada;
  const puedeConfirmar = revisado && !estado.excedeTope && estado.nuevas > 0;
  const nombreArchivoErrores = `errores-${entidad}.csv`;

  const tituloCarga = esGps ? 'Ligar dispositivos GPS desde Excel o CSV' : `Cargar ${sustantivo} desde Excel o CSV`;
  const rotuloMuestra = estado?.confirmado ? (esGps ? 'Las primeras que se ligaron' : 'Las primeras que se dieron de alta') : (esGps ? 'Así se ligarían las primeras' : 'Así entrarían las primeras');

  return (
    <div id="importar">
      <Tarjeta titulo={tituloCarga} info="importador.carga">
        <p className="text-[12px] text-[var(--muted)]">
          {esGps ? 'Para ligar el GPS de toda tu flota de una vez a unidades que YA existen (no se dan de alta unidades).' : 'Para dar de alta tu flota completa de una vez.'} Primero se <strong>revisa</strong> el archivo —no se escribe nada—,
          ves cuántas filas entran y cuáles traen un problema, y recién entonces confirmas.
        </p>

        <ol className="mt-3 space-y-3 text-[13px]">
          <li>
            <p className="font-medium">1. Descarga la plantilla</p>
            <p className="text-[12px] text-[var(--muted)]">{columnas}</p>
            <BotonEnlace
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(plantillaCsv)}`} download={archivoPlantilla}
              tamano="sm" className="mt-1.5" icono={<Icono icono={Download} tam={14} />}
            >
              Descargar plantilla (.csv)
            </BotonEnlace>
          </li>
          <li>
            <p className="font-medium">2. Sube tu archivo y revísalo</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CampoArchivo
                entradaRef={entrada} id={`archivo-${entidad}`} accept=".csv,.xlsx,.xls"
                etiqueta={`Archivo CSV o Excel con los ${sustantivo}`} etiquetaOculta nombreArchivo={archivo?.name ?? ''}
                onChange={(e) => { validarArchivoElegido(e.currentTarget); setArchivo(e.currentTarget.files?.[0] ?? null); }}
                className="min-w-0 flex-1 basis-64"
              />
              <Boton
                onClick={() => enviar('previsualizar')} disabled={!archivo} loading={pendiente}
                icono={<Icono icono={FileUp} tam={14} />}
              >
                {pendiente ? 'Revisando…' : 'Revisar archivo'}
              </Boton>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--faint)]">
              Máximo {MAX_MB} MB y {numero(tope)} filas por archivo. {esGps ? 'Un dispositivo es de una sola unidad y una unidad tiene un solo dispositivo.' : patioDelJefe
                ? <>Tu carga cae en tu patio, <strong>{patioDelJefe}</strong>.</>
                : <>La columna «patio» debe llevar el nombre de un patio que ya exista en <Link href={hrefPatios} className="underline">Patios</Link>.</>}
            </p>
          </li>
        </ol>

        <div aria-live="polite" className="mt-3 space-y-3">
          {estado?.error && <AvisoResultado estado={{ ok: false, error: estado.error }} />}

          {estado && (!estado.error || estado.leidas > 0) && estado.huella !== '' && (
            <div className="space-y-3">
              <p className="text-[12px] text-[var(--muted)]">
                Archivo <strong className="text-[var(--ink2)]">{estado.archivo}</strong> · {numero(estado.leidas)} filas con datos leídas
                {estado.confirmado ? ' · CARGA CONFIRMADA' : revisado ? ' · solo revisado, todavía no se escribió nada' : ''}
              </p>

              <div className="grid grid-cols-3 gap-2">
                <Cifra info="importador.nuevas" titulo={estado.confirmado ? (esGps ? 'Se ligaron' : 'Se dieron de alta') : (esGps ? 'Se ligarían' : 'Se darían de alta')} valor={estado.nuevas} tono={estado.nuevas > 0 ? 'ok' : undefined} />
                <Cifra info="importador.ya_estaban" titulo="Ya estaban" valor={estado.yaEstaban} nota="no se tocan" />
                <Cifra info="importador.con_problema" titulo="Con problema" valor={estado.conProblema} tono={estado.conProblema > 0 ? 'bad' : undefined} nota="no entran" />
              </div>

              {estado.excedeTope && (
                <Aviso tono="warn">
                  El archivo trae más de {numero(tope)} filas. Pártelo en archivos más chicos: no se importa a medias.
                </Aviso>
              )}

              {estado.avisos.filter((a) => !/tope es/.test(a)).map((a) => (
                <Aviso key={a} tono="warn">{a}</Aviso>
              ))}

              {estado.patiosDesconocidos.length > 0 && (
                <Aviso tono="warn">
                  El archivo menciona patios que no existen en tu flota: <strong>{estado.patiosDesconocidos.slice(0, 8).join(', ')}</strong>
                  {estado.patiosDesconocidos.length > 8 ? ` y ${numero(estado.patiosDesconocidos.length - 8)} más` : ''}.{' '}
                  <Link href={hrefPatios} className="underline">Créalos en Patios</Link> y vuelve a subir el archivo, o corrige el nombre.
                </Aviso>
              )}

              {estado.muestra.length > 0 && (
                <TablaBase
                  etiqueta={rotuloMuestra} densa altoMaximo={false}
                  columnas={COLUMNAS_MUESTRA} filas={estado.muestra} idFila={(m) => String(m.fila)}
                />
              )}

              {estado.problemas.length > 0 && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-[var(--bad)]">
                      {numero(estado.conProblema)} {estado.conProblema === 1 ? 'fila no entra' : 'filas no entran'}
                    </p>
                    {hrefErrores && (
                      <BotonEnlace href={hrefErrores} download={nombreArchivoErrores} variante="ghost" tamano="sm" icono={<Icono icono={Download} tam={14} />}>
                        Descargar errores (.csv)
                      </BotonEnlace>
                    )}
                  </div>
                  <TablaBase
                    etiqueta="Filas del archivo que no entran, con su motivo" densa
                    columnas={COLUMNAS_PROBLEMAS} filas={estado.problemas} idFila={(p) => `${p.fila}-${p.motivo}`}
                  />
                  {estado.conProblema > estado.problemas.length && (
                    <p className="mt-1 text-[11px] text-[var(--faint)]">
                      Se muestran las primeras {numero(estado.problemas.length)} de {numero(estado.conProblema)}; corrige el archivo y vuelve a revisarlo para ver el resto.
                    </p>
                  )}
                </div>
              )}

              {estado.confirmado && estado.invitacion && (
                <Aviso tono={estado.invitacion.error || estado.invitacion.fallidas.length > 0 ? 'warn' : 'ok'}>
                  <strong>Invitaciones por WhatsApp: {numero(estado.invitacion.enviadas)} enviadas</strong>
                  {estado.invitacion.error && <span className="block">{estado.invitacion.error}</span>}
                  {estado.invitacion.fallidas.slice(0, 10).map((f) => (
                    <span key={f.nombre + f.motivo} className="block">{f.nombre}: {f.motivo}</span>
                  ))}
                  {estado.invitacion.pendientesRestantes > 0 && (
                    <span className="block">
                      Quedan {numero(estado.invitacion.pendientesRestantes)} por invitar: usa «Enviar invitaciones pendientes» en el registro de abajo.
                    </span>
                  )}
                </Aviso>
              )}

              {puedeConfirmar && (
                <div className="space-y-2 border-t border-[var(--line)] pt-3">
                  {ofrecerInvitacion && (
                    <Casilla
                      checked={invitar} onChange={(e) => setInvitar(e.target.checked)}
                      etiqueta="Invitar por WhatsApp a los operadores nuevos."
                      ayuda="Cada invitación es un mensaje de WhatsApp (plantilla con costo de Meta). Marca esto solo si son tus choferes y aceptaron recibir mensajes de la empresa. Salen hasta 40 por vez; el resto queda pendiente."
                    />
                  )}
                  <Boton variante="primary" onClick={() => setConfirmando(true)} disabled={pendiente}>
                    {pendiente ? (esGps ? 'Ligando…' : 'Importando…') : `${esGps ? 'Ligar' : 'Importar'} ${numero(estado.nuevas)} ${estado.nuevas === 1 ? singular : sustantivo}`}
                  </Boton>
                </div>
              )}
            </div>
          )}
        </div>
      </Tarjeta>

      <DialogoConfirmar
        abierto={confirmando} tono="normal" pendiente={pendiente}
        titulo={`${esGps ? 'Ligar' : 'Dar de alta'} ${numero(estado?.nuevas ?? 0)} ${(estado?.nuevas ?? 0) === 1 ? singular : sustantivo}`}
        descripcion={
          <>
            {esGps ? 'Se ligarán' : 'Se crearán'} {numero(estado?.nuevas ?? 0)} {sustantivo}{esGps ? ' a sus unidades' : ' nuevos en tu flota'}
            {(estado?.yaEstaban ?? 0) > 0 ? `; los ${numero(estado?.yaEstaban ?? 0)} que ya estaban no se tocan` : ''}
            {(estado?.conProblema ?? 0) > 0 ? `; las ${numero(estado?.conProblema ?? 0)} filas con problema NO entran` : ''}.
            {esGps ? ' No se crea ninguna unidad ni se manda ningún WhatsApp.' : invitar ? ' Además se mandará la invitación por WhatsApp a los nuevos (hasta 40 en este paso).' : ' No se manda ningún WhatsApp.'}
          </>
        }
        etiquetaConfirmar={esGps ? 'Sí, ligar' : 'Sí, dar de alta'}
        onCancelar={() => setConfirmando(false)}
        onConfirmar={() => { setConfirmando(false); enviar('confirmar'); }}
      />
    </div>
  );
}

type FilaMuestra = ResultadoImportacionUI['muestra'][number];
type FilaProblema = ResultadoImportacionUI['problemas'][number];

const COLUMNAS_MUESTRA: readonly ColumnaBase<FilaMuestra>[] = [
  { id: 'fila', titulo: 'Fila', celda: (m) => <span className="tabular text-[var(--faint)]">fila {m.fila}</span> },
  { id: 'titulo', titulo: 'Registro', principal: true, celda: (m) => <span className="font-medium">{m.titulo}</span> },
  { id: 'detalle', titulo: 'Detalle', celda: (m) => <span className="text-[var(--muted)]">{m.detalle}</span> },
];

const COLUMNAS_PROBLEMAS: readonly ColumnaBase<FilaProblema>[] = [
  { id: 'fila', titulo: 'Fila', celda: (p) => <span className="tabular text-[var(--muted)]">{p.fila}</span> },
  { id: 'motivo', titulo: 'Motivo', celda: (p) => p.motivo },
];

const COLOR_CIFRA = { ok: 'text-[var(--ok)]', bad: 'text-[var(--bad)]' } as const;

function Cifra({ titulo, valor, nota, tono, info }: { titulo: string; valor: number; nota?: string; tono?: 'ok' | 'bad'; info: InfoClave }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] text-[var(--muted)]">{titulo}<InfoTip clave={info} /></p>
      <p className={`font-display text-[20px] font-semibold tabular ${tono ? COLOR_CIFRA[tono] : 'text-[var(--ink)]'}`}>{numero(valor)}</p>
      {nota && <p className="text-[11px] text-[var(--faint)]">{nota}</p>}
    </div>
  );
}
