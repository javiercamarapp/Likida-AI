// ═══════════════════════════════════════════════════════════════════════════
// CONSTELACIÓN — escena de líneas y puntos finos (SVG, sin dibujos): un núcleo y N nodos unidos por trazos de 1 px, con
// polvo de puntos de fondo. Los nodos encendidos son los pasos terminados; el siguiente lleva un halo quieto.
// Determinista (PRNG con semilla): el mismo HTML en servidor y cliente. Solo números como rótulos (no duplica textos de la
// pantalla). Decorativa: aria-hidden. La animación (trazos que se dibujan, halo que respira) solo existe en `no-preference`.
// ═══════════════════════════════════════════════════════════════════════════

const W = 720;
const H = 420;

function prng(semilla: number) {
  let s = semilla >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Nodos sobre una curva suave que sube de izquierda a derecha (coordenadas fijas: una ruta, no un azar). */
function nodos(n: number): Array<{ x: number; y: number }> {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return { x: 190 + t * 440, y: 290 - Math.sin(t * Math.PI * 0.9) * 130 - t * 40 };
  });
}

export function Constelacion({ total = 6, listos = 0, className }: { total?: number; listos?: number; className?: string }) {
  const rnd = prng(20261028);
  const polvo = Array.from({ length: 110 }, () => ({ x: rnd() * W, y: rnd() * H, r: 0.5 + rnd() * 1.1, o: 0.12 + rnd() * 0.4 }));
  const ns = nodos(total);
  const nucleo = { x: 64, y: 330 };
  const siguiente = Math.min(listos, total - 1);
  const ruta = ns.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <svg className={`rv-constelacion${className ? ` ${className}` : ''}`} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      <g className="rv-const__polvo">
        {polvo.map((p, i) => <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={p.r.toFixed(2)} opacity={p.o.toFixed(2)} />)}
      </g>
      <g className="rv-const__orbitas">
        <circle cx={nucleo.x} cy={nucleo.y} r="46" />
        <circle cx={nucleo.x} cy={nucleo.y} r="92" strokeDasharray="2 6" />
        <ellipse cx="400" cy="210" rx="330" ry="150" strokeDasharray="1 7" />
      </g>
      <g className="rv-const__lineas">
        {ns.map((p, i) => <path key={i} className="rv-trazo" pathLength={1} d={`M${nucleo.x} ${nucleo.y} L${p.x.toFixed(1)} ${p.y.toFixed(1)}`} style={{ animationDelay: `${i * 60}ms` }} />)}
        <path className="rv-trazo rv-const__ruta" pathLength={1} d={ruta} />
      </g>
      <circle className="rv-const__nucleo" cx={nucleo.x} cy={nucleo.y} r="7" />
      <circle className="rv-const__nucleo-aro" cx={nucleo.x} cy={nucleo.y} r="14" />
      {ns.map((p, i) => (
        <g key={i} className="rv-const__nodo" data-estado={i < listos ? 'listo' : i === siguiente ? 'siguiente' : 'espera'} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
          {i === siguiente && i >= listos ? <circle className="rv-const__halo" r="22" /> : null}
          <circle className="rv-const__aro" r="11" />
          <circle className="rv-const__punto" r="4.5" />
          <text x="0" y="-22" textAnchor="middle">{String(i + 1).padStart(2, '0')}</text>
        </g>
      ))}
    </svg>
  );
}
