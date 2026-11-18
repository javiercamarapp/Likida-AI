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
import { useT } from '@/lib/i18n/proveedor';
import { rico } from '@/lib/i18n/rico';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { dashboard_b as dashboard_bEs } from '@/lib/i18n/es/dashboard_b';

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
  const { t, tp } = useT('dashboard_b', dashboard_bEs);
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
  const sustantivo = entidad === 'operadores' ? t('imp.sust.operadores') : esGps ? t('imp.sust.gps') : t('imp.sust.unidades');
  const singular = entidad === 'operadores' ? t('imp.sing.operadores') : esGps ? t('imp.sing.gps') : t('imp.sing.unidades');
  // W3: el mapeo de GPS LIGA dispositivos a unidades que ya existen, no da de alta nada.

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
      mensaje: t(
        esGps ? (estado.yaEstaban > 0 ? 'imp.noti.liga_ya' : 'imp.noti.liga') : (estado.yaEstaban > 0 ? 'imp.noti.alta_ya' : 'imp.noti.alta'),
        { n: numero(estado.nuevas), cosa: estado.nuevas === 1 ? singular : sustantivo, ya: numero(estado.yaEstaban) },
      ),
    });
    if (estado.invitacion && estado.invitacion.fallidas.length > 0) {
      notificar({ tono: 'aviso', mensaje: t('imp.noti.invit_fallidas', { n: numero(estado.invitacion.fallidas.length) }) });
    }
    if (entrada.current) entrada.current.value = '';
  }, [estado, router, notificar, singular, sustantivo, esGps, t]);

  const hrefErrores = useMemo(
    () => (estado && estado.problemas.length > 0
      ? `data:text/csv;charset=utf-8,${encodeURIComponent(csvDeProblemas(estado.problemas))}`
      : null),
    [estado],
  );

  const revisado = !!estado && !estado.error && estado.paso === 'previsualizar' && clave !== null && clave === claveRevisada;
  const puedeConfirmar = revisado && !estado.excedeTope && estado.nuevas > 0;
  const nombreArchivoErrores = `errores-${entidad}.csv`;

  const tituloCarga = esGps ? t('imp.titulo.gps') : t('imp.titulo.otro', { cosa: sustantivo });
  const rotuloMuestra = estado?.confirmado ? (esGps ? t('imp.muestra.liga_ok') : t('imp.muestra.alta_ok')) : (esGps ? t('imp.muestra.liga') : t('imp.muestra.alta'));
  const pintores = { strong: (c: React.ReactNode) => <strong>{c}</strong>, enlace: (c: React.ReactNode) => <Link href={hrefPatios} className="underline">{c}</Link> };

  return (
    <div id="importar">
      <Tarjeta titulo={tituloCarga} info="importador.carga">
        <p className="text-[12px] text-[var(--muted)]">
          {rico(t(esGps ? 'imp.intro.gps' : 'imp.intro.alta'), pintores)}
        </p>

        <ol className="mt-3 space-y-3 text-[13px]">
          <li>
            <p className="font-medium">{t('imp.paso1')}</p>
            <p className="text-[12px] text-[var(--muted)]">{columnas}</p>
            <BotonEnlace
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(plantillaCsv)}`} download={archivoPlantilla}
              tamano="sm" className="mt-1.5" icono={<Icono icono={Download} tam={14} />}
            >
              {t('imp.descargar_plantilla')}
            </BotonEnlace>
          </li>
          <li>
            <p className="font-medium">{t('imp.paso2')}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CampoArchivo
                entradaRef={entrada} id={`archivo-${entidad}`} accept=".csv,.xlsx,.xls"
                etiqueta={t('imp.archivo_etq', { cosa: sustantivo })} etiquetaOculta nombreArchivo={archivo?.name ?? ''}
                onChange={(e) => { validarArchivoElegido(e.currentTarget); setArchivo(e.currentTarget.files?.[0] ?? null); }}
                className="min-w-0 flex-1 basis-64"
              />
              <Boton
                onClick={() => enviar('previsualizar')} disabled={!archivo} loading={pendiente}
                icono={<Icono icono={FileUp} tam={14} />}
              >
                {pendiente ? t('imp.revisando') : t('imp.revisar')}
              </Boton>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--faint)]">
              {t('imp.limite', { mb: MAX_MB, n: numero(tope) })} {esGps ? t('imp.limite.gps') : patioDelJefe
                ? rico(t('imp.limite.patio', { patio: patioDelJefe }), pintores)
                : rico(t('imp.limite.columna'), pintores)}
            </p>
          </li>
        </ol>

        <div aria-live="polite" className="mt-3 space-y-3">
          {estado?.error && <AvisoResultado estado={{ ok: false, error: estado.error }} />}

          {estado && (!estado.error || estado.leidas > 0) && estado.huella !== '' && (
            <div className="space-y-3">
              <p className="text-[12px] text-[var(--muted)]">
                {rico(t('imp.arch.linea', { archivo: estado.archivo, n: numero(estado.leidas) }), { strong: (c) => <strong className="text-[var(--ink2)]">{c}</strong> })}
                {estado.confirmado ? t('imp.arch.confirmada') : revisado ? t('imp.arch.revisado') : ''}
              </p>

              <div className="grid grid-cols-3 gap-2">
                <Cifra info="importador.nuevas" titulo={estado.confirmado ? (esGps ? t('imp.cifra.liga_ok') : t('imp.cifra.alta_ok')) : (esGps ? t('imp.cifra.liga') : t('imp.cifra.alta'))} valor={estado.nuevas} tono={estado.nuevas > 0 ? 'ok' : undefined} />
                <Cifra info="importador.ya_estaban" titulo={t('imp.cifra.ya')} valor={estado.yaEstaban} nota={t('imp.cifra.ya_nota')} />
                <Cifra info="importador.con_problema" titulo={t('imp.cifra.problema')} valor={estado.conProblema} tono={estado.conProblema > 0 ? 'bad' : undefined} nota={t('imp.cifra.problema_nota')} />
              </div>

              {estado.excedeTope && (
                <Aviso tono="warn">
                  {t('imp.excede', { n: numero(tope) })}
                </Aviso>
              )}

              {estado.avisos.filter((a) => !/tope es/.test(a)).map((a) => (
                <Aviso key={a} tono="warn">{a}</Aviso>
              ))}

              {estado.patiosDesconocidos.length > 0 && (
                <Aviso tono="warn">
                  {rico(t('imp.patios.desc', {
                    lista: estado.patiosDesconocidos.slice(0, 8).join(', '),
                    mas: estado.patiosDesconocidos.length > 8 ? t('imp.patios.mas_n', { n: numero(estado.patiosDesconocidos.length - 8) }) : '',
                  }), pintores)}{' '}
                  {rico(t('imp.patios.crear'), pintores)}
                </Aviso>
              )}

              {estado.muestra.length > 0 && (
                <TablaBase
                  etiqueta={rotuloMuestra} densa altoMaximo={false}
                  columnas={columnasMuestra(t)} filas={estado.muestra} idFila={(m) => String(m.fila)}
                />
              )}

              {estado.problemas.length > 0 && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-[var(--bad)]">
                      {tp('imp.prob.titulo', estado.conProblema, { n: numero(estado.conProblema) })}
                    </p>
                    {hrefErrores && (
                      <BotonEnlace href={hrefErrores} download={nombreArchivoErrores} variante="ghost" tamano="sm" icono={<Icono icono={Download} tam={14} />}>
                        {t('imp.prob.descargar')}
                      </BotonEnlace>
                    )}
                  </div>
                  <TablaBase
                    etiqueta={t('imp.prob.tabla')} densa
                    columnas={columnasProblemas(t)} filas={estado.problemas} idFila={(p) => `${p.fila}-${p.motivo}`}
                  />
                  {estado.conProblema > estado.problemas.length && (
                    <p className="mt-1 text-[11px] text-[var(--faint)]">
                      {t('imp.prob.muestra', { a: numero(estado.problemas.length), b: numero(estado.conProblema) })}
                    </p>
                  )}
                </div>
              )}

              {estado.confirmado && estado.invitacion && (
                <Aviso tono={estado.invitacion.error || estado.invitacion.fallidas.length > 0 ? 'warn' : 'ok'}>
                  <strong>{t('imp.inv.titulo', { n: numero(estado.invitacion.enviadas) })}</strong>
                  {estado.invitacion.error && <span className="block">{estado.invitacion.error}</span>}
                  {estado.invitacion.fallidas.slice(0, 10).map((f) => (
                    <span key={f.nombre + f.motivo} className="block">{f.nombre}: {f.motivo}</span>
                  ))}
                  {estado.invitacion.pendientesRestantes > 0 && (
                    <span className="block">
                      {t('imp.inv.quedan', { n: numero(estado.invitacion.pendientesRestantes) })}
                    </span>
                  )}
                </Aviso>
              )}

              {puedeConfirmar && (
                <div className="space-y-2 border-t border-[var(--line)] pt-3">
                  {ofrecerInvitacion && (
                    <Casilla
                      checked={invitar} onChange={(e) => setInvitar(e.target.checked)}
                      etiqueta={t('imp.invitar.etq')}
                      ayuda={t('imp.invitar.ayuda')}
                    />
                  )}
                  <Boton variante="primary" onClick={() => setConfirmando(true)} disabled={pendiente}>
                    {pendiente ? (esGps ? t('imp.btn.ligando') : t('imp.btn.importando')) : t(esGps ? 'imp.btn.ligar' : 'imp.btn.importar', { n: numero(estado.nuevas), cosa: estado.nuevas === 1 ? singular : sustantivo })}
                  </Boton>
                </div>
              )}
            </div>
          )}
        </div>
      </Tarjeta>

      <DialogoConfirmar
        abierto={confirmando} tono="normal" pendiente={pendiente}
        titulo={t(esGps ? 'imp.dlg.titulo_liga' : 'imp.dlg.titulo_alta', { n: numero(estado?.nuevas ?? 0), cosa: (estado?.nuevas ?? 0) === 1 ? singular : sustantivo })}
        descripcion={
          <>
            {t(esGps ? 'imp.dlg.liga' : 'imp.dlg.alta', { n: numero(estado?.nuevas ?? 0), cosa: sustantivo })}
            {(estado?.yaEstaban ?? 0) > 0 ? t('imp.dlg.ya', { n: numero(estado?.yaEstaban ?? 0) }) : ''}
            {(estado?.conProblema ?? 0) > 0 ? t('imp.dlg.problema', { n: numero(estado?.conProblema ?? 0) }) : ''}.
            {esGps ? t('imp.dlg.cola_gps') : invitar ? t('imp.dlg.cola_invitar') : t('imp.dlg.cola_sin')}
          </>
        }
        etiquetaConfirmar={esGps ? t('imp.dlg.confirmar_liga') : t('imp.dlg.confirmar_alta')}
        onCancelar={() => setConfirmando(false)}
        onConfirmar={() => { setConfirmando(false); enviar('confirmar'); }}
      />
    </div>
  );
}

type FilaMuestra = ResultadoImportacionUI['muestra'][number];
type FilaProblema = ResultadoImportacionUI['problemas'][number];

const columnasMuestra = (t: TrDe<'dashboard_b'>): readonly ColumnaBase<FilaMuestra>[] => [
  { id: 'fila', titulo: t('imp.col.fila'), celda: (m) => <span className="tabular text-[var(--faint)]">{t('imp.col.fila_n', { n: m.fila })}</span> },
  { id: 'titulo', titulo: t('imp.col.registro'), principal: true, celda: (m) => <span className="font-medium">{m.titulo}</span> },
  { id: 'detalle', titulo: t('imp.col.detalle'), celda: (m) => <span className="text-[var(--muted)]">{m.detalle}</span> },
];

const columnasProblemas = (t: TrDe<'dashboard_b'>): readonly ColumnaBase<FilaProblema>[] => [
  { id: 'fila', titulo: t('imp.col.fila'), celda: (p) => <span className="tabular text-[var(--muted)]">{p.fila}</span> },
  { id: 'motivo', titulo: t('imp.col.motivo'), celda: (p) => p.motivo },
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
