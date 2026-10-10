import { numero } from '@/lib/formato';
import { resumenDeBloque, type BloqueVista } from './respuesta';

// Las gráficas que el asistente puede entregar (P6): una dona se pinta como una barra de proporciones con su leyenda y una serie como una línea
// sencilla con sus extremos. Ambas llevan su resumen en palabras (`resumenDeBloque`) como etiqueta accesible y la leyenda dice los números: nada
// depende solo del color. Componentes puros (sin estado) para poder probarlos con `renderToStaticMarkup`.

const COLORES = ['var(--ok)', 'var(--warn)', 'var(--bad)', 'var(--muted)', 'var(--faint)', 'var(--line2)'] as const;

export function Dona({ b }: { b: Extract<BloqueVista, { tipo: 'dona' }> }) {
  const total = b.segmentos.reduce((t, x) => t + x.valor, 0);
  return (
    <figure className="card p-3 space-y-2" aria-label={resumenDeBloque(b) ?? 'Proporciones'}>
      <div role="img" aria-label={resumenDeBloque(b) ?? 'Proporciones'} className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--line2)' }}>
        {total > 0 && b.segmentos.map((s, i) => (
          <span key={`${s.etiqueta}-${i}`} style={{ width: `${(s.valor / total) * 100}%`, background: COLORES[i % COLORES.length] }} />
        ))}
      </div>
      <ul className="grid gap-1 text-[12.5px]">
        {b.segmentos.map((s, i) => (
          <li key={`${s.etiqueta}-${i}`} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: COLORES[i % COLORES.length] }} />{s.etiqueta}</span>
            <span className="cifra-mono">{numero(s.valor)}{total > 0 ? ` · ${Math.round((s.valor / total) * 100)} %` : ''}</span>
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
  return (
    <figure className="card p-3 space-y-1.5" aria-label={resumenDeBloque(b) ?? 'Serie'}>
      <svg role="img" aria-label={resumenDeBloque(b) ?? 'Serie'} viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
        <polyline fill="none" stroke="var(--muted)" strokeWidth="1.5" points={puntos} />
        <circle cx={x(b.puntos.length - 1)} cy={y(ultimo.valor)} r="2.5" fill="var(--ok)" />
      </svg>
      <div className="flex flex-wrap justify-between gap-x-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
        <span>{primero.dia}: <span className="cifra-mono">{numero(primero.valor)}</span></span>
        <span>mín <span className="cifra-mono">{numero(min)}</span> · máx <span className="cifra-mono">{numero(max)}</span></span>
        <span>{ultimo.dia}: <span className="cifra-mono">{numero(ultimo.valor)}</span></span>
      </div>
    </figure>
  );
}
