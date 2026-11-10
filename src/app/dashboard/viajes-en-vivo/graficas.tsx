import { numero } from '@/lib/formato';
import { resumenDeBloque, type BloqueVista } from './respuesta';
import './en-vivo.css';

// Las gráficas que el asistente puede entregar (P6): una dona se pinta como una barra de proporciones con su leyenda y una serie como una línea
// sencilla con sus extremos. Ambas llevan su resumen en palabras (`resumenDeBloque`) como etiqueta accesible y la leyenda dice los números: nada
// depende solo del color. Componentes puros (sin estado) para poder probarlos con `renderToStaticMarkup`. Sin `style=`: los anchos son atributos SVG
// y los colores salen de los matices de datos del sistema (`--chart-1..8`).

const MATICES = [1, 2, 3, 4, 5, 6] as const;
const matiz = (i: number) => `var(--chart-${MATICES[i % MATICES.length]})`;

export function Dona({ b }: { b: Extract<BloqueVista, { tipo: 'dona' }> }) {
  const total = b.segmentos.reduce((t, x) => t + x.valor, 0);
  const rotulo = resumenDeBloque(b) ?? 'Proporciones';
  let acumulado = 0;
  return (
    <figure className="rv-vv__fig" aria-label={rotulo}>
      <svg role="img" aria-label={rotulo} className="rv-vv__barra" viewBox="0 0 100 12" preserveAspectRatio="none">
        <rect x="0" y="0" width="100" height="12" fill="var(--line)" />
        {total > 0 && b.segmentos.map((s, i) => {
          const ancho = (s.valor / total) * 100;
          const x = acumulado;
          acumulado += ancho;
          return <rect key={`${s.etiqueta}-${i}`} x={x.toFixed(2)} y="0" width={ancho.toFixed(2)} height="12" fill={matiz(i)} />;
        })}
      </svg>
      <ul className="rv-vv__leyenda">
        {b.segmentos.map((s, i) => (
          <li key={`${s.etiqueta}-${i}`}>
            <span><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={matiz(i)} /></svg>{s.etiqueta}</span>
            <span className="rv-vv__num">{numero(s.valor)}{total > 0 ? ` · ${Math.round((s.valor / total) * 100)} %` : ''}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function Serie({ b }: { b: Extract<BloqueVista, { tipo: 'serie' }> }) {
  const W = 240; const H = 56; const P = 4;
  const v = b.puntos.map((p) => p.valor);
  const min = Math.min(...v); const max = Math.max(...v);
  const rango = max - min || 1;
  const x = (i: number) => (b.puntos.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (b.puntos.length - 1));
  const y = (val: number) => H - P - ((val - min) / rango) * (H - 2 * P);
  const puntos = b.puntos.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
  const primero = b.puntos[0]; const ultimo = b.puntos[b.puntos.length - 1];
  const rotulo = resumenDeBloque(b) ?? 'Serie';
  return (
    <figure className="rv-vv__fig" aria-label={rotulo}>
      <svg role="img" aria-label={rotulo} viewBox={`0 0 ${W} ${H}`} className="rv-vv__serie">
        <polyline fill="none" stroke="var(--muted)" strokeWidth="1.5" points={puntos} />
        <circle cx={x(b.puntos.length - 1)} cy={y(ultimo.valor)} r="2.5" fill="var(--ok)" />
      </svg>
      <div className="rv-vv__ext">
        <span>{primero.dia}: <span className="rv-vv__num">{numero(primero.valor)}</span></span>
        <span>mín <span className="rv-vv__num">{numero(min)}</span> · máx <span className="rv-vv__num">{numero(max)}</span></span>
        <span>{ultimo.dia}: <span className="rv-vv__num">{numero(ultimo.valor)}</span></span>
      </div>
    </figure>
  );
}
