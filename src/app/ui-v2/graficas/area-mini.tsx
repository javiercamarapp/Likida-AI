'use client';

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { TooltipGrafica } from '../componentes/overlay';
import type { Matiz } from '../metricas';
import { cadaCuantas, compactEs, esConteoPequeno, indicesEtiquetados, niceScale, variacionVsAnterior } from './escala';
import type { TipoDato } from './kind-badge';
import { CintaLectura, LecturaPunto, TablaGrafica, useAncho } from './partes';

const PAD_T = 20, PAD_R = 14;

/** Área de UNA serie a píxeles reales, con la forma de Vexa (`AreaChart`): línea 1.75, relleno .12→0, eje Y de 3 marcas con rejilla
 *  tenue, etiquetas directas del máximo y del último valor (punto r 3.25), crosshair y tooltip al pasar, tocar o con ←/→ (Inicio/Fin,
 *  Esc), «Ver como tabla». Un nulo CORTA la línea (nunca se interpola) y el hueco se marca punteado; <2 puntos ⇒ `.mc-vacio`
 *  conservando el alto. La línea se dibuja una vez (trazo 380 ms); con reduced-motion aparece quieta. */
export function AreaMini({ valores, etiquetas, matiz = 1, etiqueta, formato = (v) => String(v), alto = 140, tipo = 'observado', unidad }: {
  valores: ReadonlyArray<number | null>;
  etiquetas?: readonly string[];
  matiz?: Matiz;
  /** Nombre accesible de la figura. */
  etiqueta: string;
  formato?: (v: number) => string;
  alto?: number;
  tipo?: TipoDato;
  unidad?: string;
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sel, setSel] = useState<number | null>(null);
  const plano = useRef<SVGSVGElement>(null);
  const idg = `rv-ag-${useId().replace(/:/g, '')}`;
  const ok = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ok.length < 2) {
    return <figure className="rv-gr mc-vacio" aria-label={etiqueta}><svg width="1" height={alto} aria-hidden="true" /><span>Sin serie suficiente</span></figure>;
  }
  const n = valores.length;
  const conEtiquetas = etiquetas !== undefined;
  const padB = conEtiquetas ? 22 : 8;
  const min = Math.min(0, ...ok), max = Math.max(...ok);
  const eje = min < 0 ? { max, ticks: [min, (min + max) / 2, max] as number[] } : niceScale(max, { entero: esConteoPequeno(valores) });
  const lo = min < 0 ? min : 0;
  const marcas = eje.ticks.map((t) => (t === 0 ? '0' : compactEs(t)));
  const padL = Math.max(30, Math.max(...marcas.map((t) => t.length)) * 6.4 + 14);
  const W = Math.max(ancho || 480, 240);
  const anchoPlano = W - padL - PAD_R;
  const altoPlano = alto - PAD_T - padB;
  const X = (i: number) => padL + (n < 2 ? anchoPlano / 2 : (i * anchoPlano) / (n - 1));
  const Y = (v: number) => PAD_T + altoPlano - ((v - lo) / ((eje.max - lo) || 1)) * altoPlano;

  // Tramos contiguos: un nulo CORTA la línea y el relleno; el hueco se marca punteado a la altura de la base.
  const tramos: Array<Array<readonly [number, number]>> = [];
  valores.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { tramos.push([]); return; }
    if (tramos.length === 0) tramos.push([]);
    tramos[tramos.length - 1].push([i, v]);
  });
  const conDatos = tramos.filter((t) => t.length > 0);
  const lineaDe = (t: ReadonlyArray<readonly [number, number]>) => t.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const huecos: Array<[number, number]> = [];
  for (let k = 0; k < conDatos.length - 1; k++) huecos.push([conDatos[k][conDatos[k].length - 1][0], conDatos[k + 1][0][0]]);
  const baseY = Y(lo);
  const puntos = valores.map((v) => ({ valor: v }));
  const rotuladas = indicesEtiquetados(puntos);
  const ultimo = rotuladas[rotuladas.length - 1] ?? -1;
  const paso = anchoPlano / Math.max(1, n - 1);
  const cada = cadaCuantas(n, anchoPlano, Math.max(44, Math.max(...(etiquetas ?? ['']).map((e) => e.length)) * 6.6 + 12));
  const etq = (i: number) => etiquetas?.[i] ?? String(i + 1);

  const lectura = sel === null ? null : (() => {
    const v = valores[sel];
    const var_ = v !== null ? variacionVsAnterior(puntos, sel) : null;
    return <LecturaPunto titulo={etq(sel)} cifra={v === null ? 'Sin datos' : formato(v)} variacion={var_} contra={var_ ? etq(sel - 1) : undefined} tipo={v === null ? undefined : tipo} />;
  })();

  const elegir = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSel(Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - padL) / paso))));
  };
  const alTeclear = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setSel((a) => Math.min(n - 1, (a ?? -1) + 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setSel((a) => Math.max(0, (a ?? n) - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setSel(0); }
    else if (e.key === 'End') { e.preventDefault(); setSel(n - 1); }
    else if (e.key === 'Escape') setSel(null);
  };
  const tabla = valores.map((v, i) => ({ rotulo: etq(i), celdas: [v === null ? '—' : formato(v)] }));

  return (
    <figure className="rv-gr rv-area" data-matiz={matiz} data-tipo={tipo} aria-label={etiqueta}>
      <div className="rv-gr-plot" ref={ref}>
        <CintaLectura>{lectura}</CintaLectura>
        <svg ref={plano} className="rv-area__svg" width={W} height={alto} viewBox={`0 0 ${W} ${alto}`} role="group" tabIndex={0}
          aria-label={`${etiqueta}. Usa las flechas izquierda y derecha para recorrer los puntos.`}
          onKeyDown={alTeclear} onPointerMove={elegir} onPointerDown={elegir} onBlur={() => setSel(null)} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setSel(null); }}>
          <defs>
            <linearGradient id={idg} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--cat, currentColor)" stopOpacity=".12" />
              <stop offset="1" stopColor="var(--cat, currentColor)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {eje.ticks.map((t, i) => (
            <g key={i}>
              <line className={i === 0 ? 'rv-colum__base' : 'rv-gr__rejilla'} x1={padL} x2={W - PAD_R} y1={Y(t)} y2={Y(t)} />
              <text className="rv-gr__marca" x={padL - 8} y={Y(t) + 4} textAnchor="end">{marcas[i]}</text>
            </g>
          ))}
          {conEtiquetas ? valores.map((_, i) => (i % cada === 0 ? <text key={i} className="rv-gr__marca rv-gr__marca-x" x={X(i)} y={alto - 6} textAnchor="middle">{etq(i)}</text> : null)) : null}
          {conDatos.filter((t) => t.length > 1).map((t) => (
            <path key={`a${t[0][0]}`} className="rv-area__relleno" d={`${lineaDe(t)}L${X(t[t.length - 1][0]).toFixed(1)},${baseY}L${X(t[0][0]).toFixed(1)},${baseY}Z`} fill={`url(#${idg})`} />
          ))}
          {huecos.map(([a, b]) => <line key={`h${a}`} className="rv-area__hueco" x1={X(a)} x2={X(b)} y1={baseY} y2={baseY} />)}
          {conDatos.map((t) => <path key={`l${t[0][0]}`} className="rv-area__linea" d={lineaDe(t)} pathLength={1} fill="none" />)}
          {conDatos.filter((t) => t.length === 1).map(([[i, v]]) => <circle key={`s${i}`} className="rv-area__aislado" cx={X(i)} cy={Y(v)} r="2.5" />)}
          {sel === null ? rotuladas.map((i) => {
            const v = valores[i] as number;
            const txt = compactEs(v);
            return (
              <g key={`d${i}`}>
                {i === ultimo ? <circle className="rv-area__punto" cx={X(i)} cy={Y(v)} r="3.25" /> : null}
                <text className="rv-gr__directa" x={X(i)} y={Y(v) - 9} textAnchor={X(i) + txt.length * 3.4 > W ? 'end' : 'middle'}>{txt}</text>
              </g>
            );
          }) : (
            <g className="rv-area__cruz" data-sel={sel}>
              <line x1={X(sel)} x2={X(sel)} y1={PAD_T} y2={PAD_T + altoPlano} />
              {valores[sel] !== null ? <circle className="rv-area__activo" cx={X(sel)} cy={Y(valores[sel] as number)} r="4" /> : null}
              <rect className="rv-area__ancla" x={X(sel) - paso / 2} y={PAD_T} width={paso} height={altoPlano} />
            </g>
          )}
        </svg>
        <TooltipGrafica activo={sel !== null} ancla={() => plano.current?.querySelector('.rv-area__ancla') ?? null}>{lectura}</TooltipGrafica>
      </div>
      <TablaGrafica titulo={etiqueta} primera="Periodo" encabezados={[unidad ? `Valor (${unidad})` : 'Valor']} filas={tabla} />
    </figure>
  );
}
