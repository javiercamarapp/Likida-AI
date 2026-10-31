'use client';

import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { BarraFiltros, BotonEnlace, Boton, PanelLateral, type ChipFiltro } from '@/app/ui-v2/componentes';
import { armarPasosCincoAgentes, type SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { conPaso } from './puesta-en-marcha/con-paso';
import { useDeclaraciones } from './puesta-en-marcha/usar-declaraciones';
import { elegirAcciones, RANGOS, ROTULO_RANGO, type FilaAtencion, type RangoResumen } from './resumen-datos';

// Piezas de cliente del Resumen v2: la barra de periodo, «Requiere tu atención» (con su panel lateral de detalle) y «Siguiente
// mejor acción». Las dos últimas leen las declaraciones del navegador para que la Puesta en marcha coincida con el asistente.

/** Barra de filtros de UNA fila (40 px): el periodo. Mueve todas las cifras de abajo (la URL manda; el servidor relee). */
export function FiltrosResumen({ rango, fuentes }: { rango: RangoResumen; fuentes: string }) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const [pendiente, empezar] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const chips: ChipFiltro[] = RANGOS.map((r) => ({ id: r, etiqueta: ROTULO_RANGO[r], activo: r === rango }));
  const elegir = (id: string) => {
    const p = new URLSearchParams(params?.toString() ?? '');
    p.set('rango', id);
    empezar(() => router.replace(`${ruta}?${p.toString()}`, { scroll: false }));
  };
  // Mientras llega el nuevo periodo las tarjetas conservan sus datos previos, atenuadas (sin capa de carga).
  return (
    <div ref={ref} data-pendiente={pendiente || undefined} aria-busy={pendiente || undefined}>
      <BarraFiltros chips={chips} onChip={elegir} fuentes={fuentes} />
    </div>
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

const ROTULO_SEV = { accion: 'Te toca a ti', atencion: 'En espera o por mirar', info: 'Informativo' } as const;

function FilaVisual({ f, onAbrir }: { f: FilaAtencion; onAbrir?: () => void }) {
  const cuerpo = (
    <>
      <i className="rv-at__punto" data-sev={f.sinPendiente && f.severidad === 'info' ? 'ok' : f.severidad} aria-hidden="true" />
      <span className="rv-at__texto">
        <span className="rv-at__titulo" title={f.titulo}>{f.titulo}</span>
        <span className="rv-at__detalle" title={f.detalle}>{f.detalle}</span>
      </span>
      {f.sinPendiente && f.severidad === 'info' ? <Check width={16} height={16} aria-hidden="true" className="rv-at__ok" /> : onAbrir ? <ChevronRight width={16} height={16} aria-hidden="true" className="rv-at__flecha" /> : null}
      <span className="rv-sr">{ROTULO_SEV[f.severidad]}</span>
    </>
  );
  return onAbrir
    ? <button type="button" className="rv-at__fila" onClick={onAbrir}>{cuerpo}</button>
    : <div className="rv-at__fila" data-quieta>{cuerpo}</div>;
}

export function ListaAtencion({ filas, senales, ambito, soloLectura, sufijo, visibles = 3 }: {
  filas: readonly FilaAtencion[]; senales: SenalesAsistente | null; ambito: string; soloLectura: boolean; sufijo: string; visibles?: number;
}) {
  const marcha = useMarcha(senales, ambito, soloLectura, sufijo);
  const [panel, setPanel] = useState<'todas' | string | null>(null);
  const todas = useMemo<FilaAtencion[]>(() => {
    if (!marcha) return [...filas];
    const { r, paso, href } = marcha;
    const f: FilaAtencion = {
      id: 'marcha', severidad: paso.estado === 'atencion' || paso.estado === 'sin_dato' || paso.responsable !== 'tu_lado' ? 'atencion' : 'accion',
      titulo: `Puesta en marcha: ${r.listos} de ${r.total} pasos`, detalle: `Sigue: ${paso.titulo}`, href,
      queSignifica: paso.resumen, queHacer: paso.accion?.texto, fuente: 'Señales de tu cuenta y lo que declaraste en este navegador', textoAccion: 'Continuar',
    };
    // El relleno «sin pendientes» cede su lugar a la fila real.
    const reales = filas.filter((x) => !x.sinPendiente);
    const relleno = filas.filter((x) => x.sinPendiente);
    return [f, ...reales, ...relleno];
  }, [filas, marcha]);
  const mostradas = todas.slice(0, visibles);
  const actual = panel && panel !== 'todas' ? todas.find((f) => f.id === panel) ?? null : null;
  const abrible = (f: FilaAtencion) => (f.sinPendiente ? undefined : () => setPanel(f.id));

  return (
    <>
      <ul className="rv-at" aria-label="Requiere tu atención">
        {mostradas.map((f) => <li key={f.id}><FilaVisual f={f} onAbrir={abrible(f)} /></li>)}
      </ul>
      <div className="rv-at__pie">
        <Boton tamano="sm" variante="ghost" onClick={() => setPanel('todas')} icono={<ArrowRight />}>Ver todas{todas.length > visibles ? ` (${todas.length})` : ''}</Boton>
      </div>
      <PanelLateral
        abierto={panel !== null} onCerrar={() => setPanel(null)} ancho={420}
        titulo={actual ? actual.titulo : 'Requiere tu atención'}
        descripcion={actual ? ROTULO_SEV[actual.severidad] : 'Lo que espera una decisión o una mirada tuya.'}
        pie={actual?.href ? <BotonEnlace tamano="sm" variante="secondary" href={actual.href} icono={<ArrowRight />}>{actual.textoAccion ?? 'Abrir'}</BotonEnlace> : undefined}
      >
        {actual ? (
          <dl className="rv-infotexto">
            <div><dt>Qué pasa</dt><dd>{actual.detalle}</dd></div>
            {actual.queSignifica ? <div><dt>Qué significa</dt><dd>{actual.queSignifica}</dd></div> : null}
            {actual.queHacer ? <div><dt>Qué hacer</dt><dd>{actual.queHacer}</dd></div> : null}
            {actual.fuente ? <div><dt>Fuente y corte</dt><dd>{actual.fuente}</dd></div> : null}
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

const ATAJOS = [
  { href: '/dashboard/despacho', nombre: 'Nuevo viaje' },
  { href: '/dashboard/viajes', nombre: 'Viajes' },
  { href: '/dashboard/operadores', nombre: 'Operadores' },
] as const;

export function SiguienteAccion({ filas, senales, ambito, soloLectura, sufijo }: {
  filas: readonly FilaAtencion[]; senales: SenalesAsistente | null; ambito: string; soloLectura: boolean; sufijo: string;
}) {
  const marcha = useMarcha(senales, ambito, soloLectura, sufijo);
  const acciones = elegirAcciones({ marcha: marcha ? { titulo: marcha.paso.titulo, resumen: marcha.paso.resumen, href: marcha.href } : null, filas });
  const [principal, ...despues] = acciones;
  return (
    <>
      {principal ? (
        <div className="rv-sig">
          <p className="rv-sig__titulo">{principal.titulo}</p>
          <p className="rv-sig__porque">{principal.porQue}</p>
          <BotonEnlace variante="primary" href={principal.href} icono={<ArrowRight />}>{principal.textoBoton}</BotonEnlace>
        </div>
      ) : (
        <div className="rv-sig">
          <p className="rv-sig__titulo">Nada urgente por hacer hoy</p>
          <p className="rv-sig__porque">No hay pasos pendientes ni alertas de los agentes en este periodo.</p>
        </div>
      )}
      <ul className="rv-atajos" aria-label={despues.length ? 'Después y atajos' : 'Atajos'}>
        {despues.slice(0, 2).map((a) => <li key={a.id}><Link href={a.href} className="rv-atajos__fila"><span>Después: {a.titulo}</span><ChevronRight width={16} height={16} aria-hidden="true" /></Link></li>)}
        {ATAJOS.slice(0, Math.max(0, 2 - despues.length)).map((a) => (
          <li key={a.href}><Link href={`${a.href}${sufijo}`} className="rv-atajos__fila"><span>{a.nombre}</span><ChevronRight width={16} height={16} aria-hidden="true" /></Link></li>
        ))}
      </ul>
    </>
  );
}
