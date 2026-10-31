'use client';

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { TooltipGrafica } from '../componentes/overlay';
import type { Matiz } from '../metricas';
import { cadaCuantas, compactEs, esConteoPequeno, geometriaColumnas, indicesEtiquetados, niceScale, ranuraEn, variacionVsAnterior } from './escala';
import type { TipoDato } from './kind-badge';
import { CintaLectura, LecturaPunto, LeyendaFina, TablaGrafica, TEXTO_SIN_DATO, useAncho } from './partes';

export interface ColumnaDato {
  /** Etiqueta corta del eje X («7 sep»). */
  etiqueta: string;
  valor: number | null;
  /** Periodo incompleto: trama 45°, rótulo «parcial», nunca se compara. */
  parcial?: boolean;
  /** Nombre completo para el tooltip, la tabla y el lector de pantalla («Semana del 7 sep»). */
  largo?: string;
  detalle?: string;
}

const PAD_T = 20, PAD_B = 22, PAD_R = 6;

/** Columnas de UN matiz, a píxeles reales, con la forma y las medidas de Vexa (`ColumnPlot`): eje Y de 3 marcas, rejilla tenue,
 *  etiquetas directas del máximo y del último periodo completo, tooltip al pasar/tocar/enfocar con variación contra el periodo
 *  anterior, foco por columna con flechas, «Ver como tabla» y estados sin dato (s/d) / parcial (trama) / estimado (KindBadge).
 *  Un valor null NUNCA se dibuja como cero. Todo en cero o sin dato ⇒ plano vacío con UNA línea que dice qué falta.
 *  Crecen una vez al montar (CSS, 420 ms, escalón de 14 ms); con reduced-motion aparecen quietas. */
export function Columnas({ datos, matiz = 1, etiqueta, formato = (v) => String(v), vacio = 'Sin datos en el periodo', tipo = 'observado', alto = 168, variacion = true, unidad }: {
  datos: readonly ColumnaDato[];
  matiz?: Matiz;
  etiqueta: string;
  formato?: (v: number) => string;
  vacio?: string;
  /** Clase del dato: estimado/inferido pintan la barra más clara y lo dicen en el tooltip. */
  tipo?: TipoDato;
  alto?: number;
  /** Mostrar la variación contra el periodo anterior (solo entre completos). */
  variacion?: boolean;
  unidad?: string;
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [activa, setActiva] = useState<number | null>(null);
  const plano = useRef<SVGSVGElement>(null);
  const trama = `rv-trama-${useId().replace(/:/g, '')}`;
  const n = datos.length;
  const valores = datos.map((d) => d.valor);
  const max = Math.max(0, ...valores.map((v) => v ?? 0));
  const W = Math.max(ancho || 640, 240);

  if (n === 0 || max === 0) {
    return (
      <figure className="rv-gr rv-colum rv-colum--vacio" aria-label={etiqueta}>
        <svg className="rv-colum__svg" width="100%" height={alto} viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" role="img" aria-label={`${etiqueta}: ${vacio}`}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} className="rv-gr__rejilla" x1="0" x2={W} y1={alto - PAD_B - f * (alto - PAD_T - PAD_B)} y2={alto - PAD_B - f * (alto - PAD_T - PAD_B)} vectorEffect="non-scaling-stroke" />)}
          <line className="rv-colum__base" x1="0" x2={W} y1={alto - PAD_B} y2={alto - PAD_B} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="rv-colum__vacio">{vacio}</span>
      </figure>
    );
  }

  const eje = niceScale(max, { entero: esConteoPequeno(valores) });
  const marcas = eje.ticks.map((t) => (t === 0 ? '0' : compactEs(t)));
  const padL = Math.max(30, Math.max(...marcas.map((t) => t.length)) * 6.4 + 14);
  const anchoPlano = W - padL - PAD_R;
  const altoPlano = alto - PAD_T - PAD_B;
  const base = PAD_T + altoPlano;
  const { ranura, ancho: anchoBarra, desfase } = geometriaColumnas(n, anchoPlano);
  const Y = (v: number) => PAD_T + altoPlano - (v / eje.max) * altoPlano;
  const cada = cadaCuantas(n, anchoPlano, 34);
  const puntos = datos.map((d) => ({ valor: d.valor, parcial: d.parcial }));
  const rotuladas = indicesEtiquetados(puntos);
  const ultima = datos.reduce((a, d, i) => (d.valor !== null && !d.parcial ? i : a), -1);
  const nombre = (d: ColumnaDato) => d.largo ?? d.etiqueta;
  const leer = (d: ColumnaDato) => (d.valor === null ? 'sin datos' : formato(d.valor));

  const lectura = activa === null ? null : (() => {
    const d = datos[activa];
    const v = variacion && d.valor !== null ? variacionVsAnterior(puntos, activa) : null;
    return <LecturaPunto titulo={nombre(d)} parcial={d.parcial} cifra={d.valor === null ? 'Sin datos' : formato(d.valor)} variacion={v} contra={v ? datos[activa - 1].etiqueta : undefined} detalle={d.detalle} tipo={d.valor === null ? undefined : tipo} />;
  })();

  const alTeclear = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') { setActiva(null); return; }
    const mover = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -n : e.key === 'End' ? n : 0;
    if (!mover) return;
    e.preventDefault();
    const actual = Number((e.target as Element).closest('[data-i]')?.getAttribute('data-i') ?? 0);
    const sig = Math.max(0, Math.min(n - 1, Math.abs(mover) === n ? (mover < 0 ? 0 : n - 1) : actual + mover));
    plano.current?.querySelector<SVGGElement>(`[data-i="${sig}"]`)?.focus();
  };
  /** Táctil: el dedo recorre las columnas; la lectura queda en la cinta fija. */
  const recorrer = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    setActiva(ranuraEn(e.clientX - r.left - padL, n, anchoPlano));
  };
  const conDetalle = datos.some((d) => d.detalle);
  const tabla = datos.map((d) => ({ rotulo: `${nombre(d)}${d.parcial ? ' (incompleto)' : ''}`, celdas: conDetalle ? [d.valor === null ? '—' : formato(d.valor), d.detalle ?? ''] : [d.valor === null ? '—' : formato(d.valor)] }));

  return (
    <figure className="rv-gr rv-colum" data-matiz={matiz} data-tipo={tipo} aria-label={etiqueta} data-cero-fuente="">
      <div className="rv-gr-plot" ref={ref}>
        <CintaLectura>{lectura}</CintaLectura>
        <svg ref={plano} className="rv-colum__svg" width={W} height={alto} viewBox={`0 0 ${W} ${alto}`} role="group" aria-label={etiqueta}
          onKeyDown={alTeclear} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setActiva(null); }} onPointerDown={recorrer} onPointerMove={recorrer}>
          <defs>
            <pattern id={trama} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="rv-colum__trama-fondo" />
              <line x1="0" y1="0" x2="0" y2="5" className="rv-colum__trama-raya" />
            </pattern>
          </defs>
          {eje.ticks.map((t, i) => (
            <g key={i}>
              <line className={t === 0 ? 'rv-colum__base' : 'rv-gr__rejilla'} x1={padL} x2={W - PAD_R} y1={Y(t)} y2={Y(t)} />
              <text className="rv-gr__marca" x={padL - 8} y={Y(t) + 4} textAnchor="end">{marcas[i]}</text>
            </g>
          ))}
          {datos.map((d, i) => {
            const cx = padL + ranura * i + ranura / 2;
            const x0 = padL + ranura * i + desfase;
            const h = d.valor === null ? 0 : Math.max(d.valor > 0 ? 2 : 0, (d.valor / eje.max) * altoPlano);
            const arriba = base - h;
            const r = Math.min(3, anchoBarra / 2, h);
            const trazo = h > 0 ? `M${x0.toFixed(1)},${base}V${(arriba + r).toFixed(1)}Q${x0.toFixed(1)},${arriba.toFixed(1)} ${(x0 + r).toFixed(1)},${arriba.toFixed(1)}H${(x0 + anchoBarra - r).toFixed(1)}Q${(x0 + anchoBarra).toFixed(1)},${arriba.toFixed(1)} ${(x0 + anchoBarra).toFixed(1)},${(arriba + r).toFixed(1)}V${base}Z` : '';
            const directa = rotuladas.includes(i) && activa === null && d.valor !== null ? compactEs(d.valor) : null;
            const anclaTxt = directa && cx + directa.length * 3.4 > W ? 'end' : directa && cx - directa.length * 3.4 < padL ? 'start' : 'middle';
            return (
              <g key={`${d.etiqueta}-${i}`} className="rv-colum__col" data-i={i} role="img" tabIndex={activa === i || (activa === null && i === Math.max(0, ultima)) ? 0 : -1}
                aria-label={`${nombre(d)}: ${leer(d)}${d.parcial ? ' (parcial, periodo incompleto)' : ''}${d.detalle ? `. ${d.detalle}` : ''}`}
                data-activa={activa === i || undefined} data-ultima={i === ultima || undefined}
                onPointerEnter={(e) => { if (e.pointerType !== 'touch') setActiva(i); }} onFocus={() => setActiva(i)}
                onBlur={(e) => { if (!plano.current?.contains(e.relatedTarget as Node | null)) setActiva(null); }}>
                <rect className="rv-colum__golpe" x={padL + ranura * i} y={PAD_T - 4} width={ranura} height={altoPlano + PAD_B + 4} rx="6" />
                {d.valor === null
                  ? <text className="rv-gr__nota" x={cx} y={base - 6} textAnchor="middle">{TEXTO_SIN_DATO}</text>
                  : <path className="rv-colum__barra" data-r={i} data-parcial={d.parcial || undefined} d={trazo} {...(d.parcial ? { fill: `url(#${trama})` } : {})} />}
                {d.parcial && d.valor !== null && activa !== i ? <text className="rv-gr__nota" x={cx} y={arriba - 5} textAnchor={cx + 18 > W ? 'end' : 'middle'}>parcial</text> : null}
                {directa && !d.parcial ? <text className="rv-gr__directa" x={cx} y={arriba - 5} textAnchor={anclaTxt}>{directa}</text> : null}
                {i % cada === 0 ? <text className="rv-gr__marca rv-gr__marca-x" x={cx} y={alto - 6} textAnchor="middle">{d.etiqueta}</text> : null}
              </g>
            );
          })}
        </svg>
        <TooltipGrafica activo={activa !== null} ancla={() => plano.current?.querySelector(`[data-i="${activa}"] .rv-colum__golpe`) ?? null}>{lectura}</TooltipGrafica>
      </div>
      <LeyendaFina parcial={datos.some((d) => d.parcial && d.valor !== null)} sinDato={datos.some((d) => d.valor === null)} />
      <TablaGrafica titulo={etiqueta} primera="Periodo" encabezados={[unidad ? `Valor (${unidad})` : 'Valor', ...(conDetalle ? ['Detalle'] : [])]} filas={tabla} />
    </figure>
  );
}
