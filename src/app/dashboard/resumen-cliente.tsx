'use client';

import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BarraPeriodo, BotonEnlace, Boton, PanelLateral, hrefConParams } from '@/app/ui-v2/componentes';
import { armarPasosCincoAgentes, type SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { conPaso } from './puesta-en-marcha/con-paso';
import { useDeclaraciones } from './puesta-en-marcha/usar-declaraciones';
import { elegirAcciones, RANGOS, ROTULO_RANGO, type FilaAtencion, type RangoResumen } from './resumen-modelo';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// Piezas de cliente del Resumen v2: la barra de periodo, «Requiere tu atención» (con su panel lateral de detalle) y «Siguiente
// mejor acción». Las dos últimas leen las declaraciones del navegador para que la Puesta en marcha coincida con el asistente.

/** Barra de periodo del Resumen (R8, patrón Rovaq): segmentado 7 días / 30 días / Todo + chip de cobertura de fuentes. Mueve todas las cifras de abajo:
 *  el estado vive en la URL (`?rango=7|30|todo`, como siempre) y cada opción es un enlace que conserva los demás parámetros (tenant, vista, rol…).
 *  Los chips dicen el alcance vigente (periodo y fuentes leídas). No hay moneda ni botón «Filtros»: el Resumen no tiene otros criterios y no se inventan. */
export function FiltrosResumen({ rango, fuentes, periodoTexto }: { rango: RangoResumen; fuentes: string; periodoTexto?: string }) {
  const { t } = useT('resto', restoEs);
  const ruta = usePathname();
  const params = useSearchParams();
  const actuales: Record<string, string> = {};
  params?.forEach((v, k) => { actuales[k] = v; });
  return (
    <BarraPeriodo
      etiqueta={t('op.periodo_del_resumen')}
      periodo={{ etiqueta: t('op.periodo_de_las_cifras'), valor: rango, opciones: RANGOS.map((r) => ({ valor: r, etiqueta: ROTULO_RANGO[r], href: hrefConParams(ruta ?? '', actuales, { rango: r }) })) }}
      chips={[...(periodoTexto ? [{ id: 'periodo', etiqueta: periodoTexto }] : []), { id: 'fuentes', etiqueta: fuentes }]}
    />
  );
}

function useMarcha(senales: SenalesAsistente | null, ambito: string, soloLectura: boolean, sufijo: string) {
  const { declaraciones } = useDeclaraciones(ambito, soloLectura);
  return useMemo(() => {
    if (!senales) return null;
    const r = armarPasosCincoAgentes(senales, declaraciones);
    const paso = r.siguiente ? r.rutaCritica.find((p) => p.id === r.siguiente) ?? null : null;
    return paso ? { r, paso, href: conPaso('/dashboard/puesta-en-marcha', sufijo, paso.id) } : null;
  }, [senales, declaraciones, sufijo]);
}

const rotuloSev = (t: TResto = T_RESTO_ES) => ({ accion: t('op.te_toca_a_ti'), atencion: t('op.en_espera_o_por_mirar'), info: t('op.informativo') } as const);

function FilaVisual({ f, onAbrir }: { f: FilaAtencion; onAbrir?: () => void }) {
  const { t } = useT('resto', restoEs);
  const cuerpo = (
    <>
      <i className="rv-at__punto" data-sev={f.sinPendiente && f.severidad === 'info' ? 'ok' : f.severidad} aria-hidden="true" />
      <span className="rv-at__texto">
        <span className="rv-at__titulo" title={f.titulo}>{f.titulo}</span>
        <span className="rv-at__detalle" title={f.detalle}>{f.detalle}</span>
      </span>
      {f.sinPendiente && f.severidad === 'info' ? <Check width={16} height={16} aria-hidden="true" className="rv-at__ok" /> : onAbrir ? <ChevronRight width={16} height={16} aria-hidden="true" className="rv-at__flecha" /> : null}
      <span className="rv-sr">{rotuloSev(t)[f.severidad]}</span>
    </>
  );
  return onAbrir
    ? <button type="button" className="rv-at__fila" onClick={onAbrir}>{cuerpo}</button>
    : <div className="rv-at__fila" data-quieta>{cuerpo}</div>;
}

export function ListaAtencion({ filas, senales, ambito, soloLectura, sufijo, visibles = 3 }: {
  filas: readonly FilaAtencion[]; senales: SenalesAsistente | null; ambito: string; soloLectura: boolean; sufijo: string; visibles?: number;
}) {
  const { t } = useT('resto', restoEs);
  const marcha = useMarcha(senales, ambito, soloLectura, sufijo);
  const [panel, setPanel] = useState<'todas' | string | null>(null);
  const todas = useMemo<FilaAtencion[]>(() => {
    if (!marcha) return [...filas];
    const { r, paso, href } = marcha;
    const f: FilaAtencion = {
      id: 'marcha', severidad: paso.estado === 'atencion' || paso.estado === 'sin_dato' || paso.responsable !== 'tu_lado' ? 'atencion' : 'accion',
      titulo: t('op.puesta_en_marcha_de_pasos', { listos: r.listos, total: r.total }), detalle: `Sigue: ${paso.titulo}`, href,
      queSignifica: paso.resumen, queHacer: paso.accion?.texto, fuente: t('op.senales_de_tu_cuenta_y_lo'), textoAccion: t('op.continuar'),
    };
    // El relleno «sin pendientes» cede su lugar a la fila real.
    const reales = filas.filter((x) => !x.sinPendiente);
    const relleno = filas.filter((x) => x.sinPendiente);
    return [f, ...reales, ...relleno];
  }, [filas, marcha, t]);
  const mostradas = todas.slice(0, visibles);
  const actual = panel && panel !== 'todas' ? todas.find((f) => f.id === panel) ?? null : null;
  const abrible = (f: FilaAtencion) => (f.sinPendiente ? undefined : () => setPanel(f.id));

  return (
    <>
      <ul className="rv-at" aria-label={t('op.requiere_tu_atencion')}>
        {mostradas.map((f) => <li key={f.id}><FilaVisual f={f} onAbrir={abrible(f)} /></li>)}
      </ul>
      <div className="rv-at__pie">
        <Boton tamano="sm" variante="ghost" onClick={() => setPanel('todas')} icono={<ArrowRight />}>{t('op.ver_todas')}{todas.length > visibles ? ` (${todas.length})` : ''}</Boton>
      </div>
      <PanelLateral
        abierto={panel !== null} onCerrar={() => setPanel(null)} ancho={420}
        titulo={actual ? actual.titulo : t('op.requiere_tu_atencion')}
        descripcion={actual ? rotuloSev(t)[actual.severidad] : t('op.lo_que_espera_una_decision_o')}
        pie={actual?.href ? <BotonEnlace variante="secondary" href={actual.href} icono={<ArrowRight />}>{actual.textoAccion ?? 'Abrir'}</BotonEnlace> : undefined}
      >
        {actual ? (
          <dl className="rv-infotexto">
            <div><dt>{t('op.que_pasa')}</dt><dd>{actual.detalle}</dd></div>
            {actual.queSignifica ? <div><dt>{t('op.que_significa')}</dt><dd>{actual.queSignifica}</dd></div> : null}
            {actual.queHacer ? <div><dt>{t('op.que_hacer')}</dt><dd>{actual.queHacer}</dd></div> : null}
            {actual.fuente ? <div><dt>{t('op.fuente_y_corte')}</dt><dd>{actual.fuente}</dd></div> : null}
          </dl>
        ) : (
          <ul className="rv-at rv-at--panel">
            {todas.map((f) => <li key={f.id}><FilaVisual f={f} onAbrir={abrible(f)} /></li>)}
          </ul>
        )}
      </PanelLateral>
    </>
  );
}

export function SiguienteAccion({ filas, senales, ambito, soloLectura, sufijo, atajos }: {
  filas: readonly FilaAtencion[]; senales: SenalesAsistente | null; ambito: string; soloLectura: boolean; sufijo: string;
  /** Los atajos que ESTE rol abre (el servidor ya los filtró con `puedeVerRuta`). */
  atajos: ReadonlyArray<{ href: string; nombre: string }>;
}) {
  const { t } = useT('resto', restoEs);
  const marcha = useMarcha(senales, ambito, soloLectura, sufijo);
  const acciones = elegirAcciones({ marcha: marcha ? { titulo: marcha.paso.titulo, resumen: marcha.paso.resumen, href: marcha.href } : null, filas });
  const [principal, ...despues] = acciones;
  return (
    <>
      {principal ? (
        <div className="rv-sig">
          <p className="rv-sig__titulo">{principal.titulo}</p>
          <p className="rv-sig__porque">{principal.porQue}</p>
          {principal.href ? <BotonEnlace variante="primary" tamano="sm" href={principal.href} icono={<ArrowRight />}>{principal.textoBoton}</BotonEnlace> : null}
        </div>
      ) : (
        <div className="rv-sig">
          <p className="rv-sig__titulo">{t('op.nada_urgente_por_hacer_hoy')}</p>
          <p className="rv-sig__porque">{t('op.no_hay_pasos_pendientes_ni_alertas')}</p>
        </div>
      )}
      {despues.some((a) => a.href) || atajos.length > 0 ? <ul className="rv-atajos" aria-label={despues.some((a) => a.href) ? t('op.despues_y_atajos') : t('op.atajos')}>
        {despues.filter((a) => a.href).slice(0, 2).map((a) => <li key={a.id}><Link href={a.href!} className="rv-atajos__fila">{rico(t('op.e0_despues_e0', { titulo: a.titulo }), { e0: (c) => <span>{c}</span> })}<ChevronRight width={16} height={16} aria-hidden="true" /></Link></li>)}
        {atajos.slice(0, Math.max(0, 2 - despues.filter((a) => a.href).length)).map((a) => (
          <li key={a.href}><Link href={`${a.href}${sufijo}`} className="rv-atajos__fila"><span>{a.nombre}</span><ChevronRight width={16} height={16} aria-hidden="true" /></Link></li>
        ))}
      </ul> : null}
    </>
  );
}
