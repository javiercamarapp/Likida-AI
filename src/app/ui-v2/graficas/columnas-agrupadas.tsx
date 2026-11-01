'use client';

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { TooltipGrafica } from '../componentes/overlay';
import type { Matiz } from '../metricas';
import { cadaCuantas, compactEs, esConteoPequeno, niceScale, ranuraEn } from './escala';
import { CintaLectura, LecturaSeries, LeyendaFina, TablaGrafica, TEXTO_SIN_DATO, useAncho } from './partes';

/** `valores[i]` null = sin dato en ese periodo (se dibuja «s/d», NUNCA una barra en cero). */
export interface SerieAgrupada { nombre: string; valores: ReadonlyArray<number | null> }

const PAD_T = 20, PAD_B = 22, PAD_R = 6;

/** Columnas agrupadas (varias series por periodo, UN matiz en tonos): mismo plano, eje, rejilla, tooltip, foco con flechas y
 *  «Ver como tabla» que `Columnas`. Cada serie lleva su tono y su nombre en la leyenda (el color no es la única señal). El tooltip
 *  lista todas las series del periodo con su total. Crecen una vez al montar (420 ms, escalón de 14 ms por periodo). */
export function ColumnasAgrupadas({ categorias, series, matiz = 2, etiqueta, formato = (v) => String(v), formatoEje = compactEs, unidad, parciales = [] }: {
  categorias: readonly string[];
  series: readonly SerieAgrupada[];
  matiz?: Matiz;
  etiqueta: string;
  /** Cifra exacta (tooltip, tabla, aria). */
  formato?: (v: number) => string;
  /** Cifra compacta del eje Y. */
  formatoEje?: (v: number) => string;
  unidad?: string;
  /** Índices de periodos incompletos: trama 45°, rótulo «parcial», sin total comparable. */
  parciales?: readonly number[];
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [activa, setActiva] = useState<number | null>(null);
  const plano = useRef<SVGSVGElement>(null);
  const n = categorias.length;
  const k = Math.max(1, series.length);
  const todos = series.flatMap((s) => s.valores).filter((v): v is number => v !== null);
  const trama = `rv-trama-${useId().replace(/:/g, '')}`;
  const esParcial = (ci: number) => parciales.includes(ci);
  const max = Math.max(0, ...todos);
  const eje = niceScale(max, { entero: esConteoPequeno(todos) });
  const marcas = eje.ticks.map((t) => (t === 0 ? '0' : formatoEje(t)));
  const alto = 200;
  const padL = Math.max(34, Math.max(...marcas.map((t) => t.length)) * 6.4 + 14);
  const W = Math.max(ancho || 560, 240);
  const anchoPlano = W - padL - PAD_R;
  const altoPlano = alto - PAD_T - PAD_B;
  const base = PAD_T + altoPlano;
  const ranura = anchoPlano / Math.max(1, n);
  const hueco = 3;
  const anchoBarra = Math.max(3, Math.min(14, (ranura * 0.7 - hueco * (k - 1)) / k));
  const anchoGrupo = anchoBarra * k + hueco * (k - 1);
  const Y = (v: number) => base - (v / eje.max) * altoPlano;
  const cada = cadaCuantas(n, anchoPlano, Math.max(40, Math.max(...categorias.map((c) => c.length)) * 6.6 + 12));
  const nombreSerie = (s: SerieAgrupada) => s.nombre;

  const filasDe = (ci: number) => series.map((s, si) => ({ tono: si, nombre: nombreSerie(s), texto: s.valores[ci] == null ? 'Sin datos' : formato(s.valores[ci] as number) }));
  /** Total solo con lo que hay: si falta alguna serie se dice «n de N» y se calla el total cuando no hay ninguna. */
  const totalDe = (ci: number) => {
    const hay = series.filter((s) => s.valores[ci] != null);
    if (hay.length === 0) return undefined;
    const suma = formato(hay.reduce((a, s) => a + (s.valores[ci] as number), 0));
    return hay.length < series.length ? `${suma} (${hay.length} de ${series.length})` : suma;
  };
  const lectura = activa === null ? null : <LecturaSeries titulo={categorias[activa]} parcial={esParcial(activa)} filas={filasDe(activa)} total={series.length > 1 ? totalDe(activa) : undefined} />;

  const alTeclear = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') { setActiva(null); return; }
    const mover = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -n : e.key === 'End' ? n : 0;
    if (!mover) return;
    e.preventDefault();
    const actual = Number((e.target as Element).closest('[data-i]')?.getAttribute('data-i') ?? 0);
    const sig = Math.max(0, Math.min(n - 1, Math.abs(mover) === n ? (mover < 0 ? 0 : n - 1) : actual + mover));
    plano.current?.querySelector<SVGGElement>(`[data-i="${sig}"]`)?.focus();
  };
  const recorrer = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    setActiva(ranuraEn(e.clientX - r.left - padL, n, anchoPlano));
  };
  const tabla = categorias.map((c, ci) => ({ rotulo: `${c}${esParcial(ci) ? ' (incompleto)' : ''}`, celdas: series.map((s) => (s.valores[ci] == null ? '—' : formato(s.valores[ci] as number))) }));

  return (
    <figure className="rv-gr rv-colum rv-colum--agrupada" data-matiz={matiz} aria-label={etiqueta}>
      <ul className="rv-leyenda-series" aria-label="Series">
        {series.map((s, si) => <li key={s.nombre}><i className={`rv-gt__sw rv-tono-${si}`} aria-hidden="true" />{nombreSerie(s)}</li>)}
      </ul>
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
          {categorias.map((c, ci) => {
            const x0 = padL + ranura * ci + (ranura - anchoGrupo) / 2;
            return (
              <g key={`${c}-${ci}`} className="rv-colum__col" data-i={ci} role="img" tabIndex={activa === ci || (activa === null && ci === Math.max(0, n - 1)) ? 0 : -1}
                aria-label={`${c}: ${series.map((s) => `${nombreSerie(s)} ${s.valores[ci] == null ? 'sin datos' : formato(s.valores[ci] as number)}`).join(', ')}${esParcial(ci) ? ' (parcial, periodo incompleto)' : ''}`}
                data-activa={activa === ci || undefined}
                onPointerEnter={(e) => { if (e.pointerType !== 'touch') setActiva(ci); }} onFocus={() => setActiva(ci)}
                onBlur={(e) => { if (!plano.current?.contains(e.relatedTarget as Node | null)) setActiva(null); }}>
                <rect className="rv-colum__golpe" x={padL + ranura * ci} y={PAD_T - 4} width={ranura} height={altoPlano + PAD_B + 4} rx="6" />
                {series.map((s, si) => {
                  const v = s.valores[ci];
                  const x = x0 + si * (anchoBarra + hueco);
                  if (v == null) return <text key={s.nombre} className="rv-gr__nota" x={x + anchoBarra / 2} y={base - 6} textAnchor="middle">{TEXTO_SIN_DATO}</text>;
                  const h = Math.max(v > 0 ? 2 : 0, (v / eje.max) * altoPlano);
                  if (h <= 0) return null;
                  const top = base - h;
                  const r = Math.min(3, anchoBarra / 2, h);
                  return <path key={s.nombre} className={`rv-colum__barra rv-tono-${si}`} data-r={Math.min(ci, 31)} data-parcial={esParcial(ci) || undefined} {...(esParcial(ci) ? { fill: `url(#${trama})` } : {})}
                    d={`M${x.toFixed(1)},${base}V${(top + r).toFixed(1)}Q${x.toFixed(1)},${top.toFixed(1)} ${(x + r).toFixed(1)},${top.toFixed(1)}H${(x + anchoBarra - r).toFixed(1)}Q${(x + anchoBarra).toFixed(1)},${top.toFixed(1)} ${(x + anchoBarra).toFixed(1)},${(top + r).toFixed(1)}V${base}Z`} />;
                })}
                {esParcial(ci) ? <text className="rv-gr__nota" x={padL + ranura * ci + ranura / 2} y={PAD_T - 6} textAnchor="middle">parcial</text> : null}
                {ci % cada === 0 ? <text className="rv-gr__marca rv-gr__marca-x" x={padL + ranura * ci + ranura / 2} y={alto - 6} textAnchor="middle">{c}</text> : null}
              </g>
            );
          })}
        </svg>
        <TooltipGrafica activo={activa !== null} onCerrar={() => setActiva(null)} ancla={() => plano.current?.querySelector(`[data-i="${activa}"] .rv-colum__golpe`) ?? null}>{lectura}</TooltipGrafica>
      </div>
      <LeyendaFina parcial={parciales.length > 0} sinDato={series.some((s) => s.valores.some((v) => v === null))} />
      <TablaGrafica titulo={etiqueta} primera="Periodo" encabezados={series.map((s) => (unidad ? `${nombreSerie(s)} (${unidad})` : nombreSerie(s)))} filas={tabla} />
    </figure>
  );
}
