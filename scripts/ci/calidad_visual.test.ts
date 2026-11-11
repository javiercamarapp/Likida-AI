// F22 — Guardas de choques visuales SIN red ni producción. Cada guarda tiene (a) su corrida real contra src/**/*.css con una
// base que solo baja y (b) una prueba de sanidad: un caso sintético MALO que la hace fallar y uno BUENO que no.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { alturasAViewport, colisionesDeClases, evaluarDesborde, evaluarH1, evaluarTitulosEncimados } from './calidad-visual.mjs';
import base from './calidad-visual-base.json';

const RAIZ = join(__dirname, '..', '..');
function hojas(dir: string, acc: Array<{ ruta: string; css: string }> = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) hojas(p, acc);
    else if (n.endsWith('.css')) acc.push({ ruta: relative(RAIZ, p), css: readFileSync(p, 'utf8') });
  }
  return acc;
}
const CSS = hojas(join(RAIZ, 'src'));
const claveColision = (c: { clave: string; propiedad: string }) => `${c.clave.replace(/^\|/, '')}|${c.propiedad}`;

describe('colisión de clases CSS entre hojas (causa de .rv-fila)', () => {
  it('sanidad: el mismo selector con display distinto en dos hojas se marca', () => {
    const malo = colisionesDeClases([
      { ruta: 'a.css', css: '[data-ui="v2"] .rv-fila { display:flex; height:100dvh; }' },
      { ruta: 'b.css', css: '.rv-fila { display:grid; }' },
    ]);
    expect(malo.map((c: { propiedad: string }) => c.propiedad)).toEqual(['display']);
  });
  it('sanidad: lo legítimo no se marca (mismo valor, otra @media, otro selector, propiedad de tema)', () => {
    const bueno = colisionesDeClases([
      { ruta: 'a.css', css: '.x { display:flex } .y { display:flex } @media (min-width:768px){ .z { display:block } }' },
      { ruta: 'b.css', css: '.x { display:flex } .y-hijo { display:grid } .z { display:grid } .w { color:red }' },
      { ruta: 'c.css', css: '.w { color:blue }' },
    ]);
    expect(bueno).toEqual([]);
  });
  it('sanidad: una misma hoja que se pisa a sí misma no es colisión entre hojas', () => {
    expect(colisionesDeClases([{ ruta: 'a.css', css: '.x{display:flex} .x{display:grid}' }])).toEqual([]);
  });
  it('la base solo baja: ninguna colisión nueva y ninguna entrada obsoleta', () => {
    const hoy = colisionesDeClases(CSS).map(claveColision);
    const nuevas = hoy.filter((k: string) => !base.colisiones.includes(k));
    const obsoletas = base.colisiones.filter((k) => !hoy.includes(k));
    expect({ nuevas, obsoletas }).toEqual({ nuevas: [], obsoletas: [] });
  });
});

describe('altura a viewport (height:100vh) fuera de la lista conocida', () => {
  it('sanidad: height:100vh/100dvh se marca; min-height y 100% no', () => {
    expect(alturasAViewport([{ ruta: 'a.css', css: '.t { height: 100vh } .u { height:100dvh }' }])).toHaveLength(2);
    expect(alturasAViewport([{ ruta: 'a.css', css: '.t { min-height: 100vh } .u { height:100% } .v{max-height:100vh}' }])).toEqual([]);
  });
  it('la base solo baja', () => {
    const hoy = alturasAViewport(CSS);
    expect({ nuevas: hoy.filter((k: string) => !base.alturasAViewport.includes(k)), obsoletas: base.alturasAViewport.filter((k) => !hoy.includes(k)) })
      .toEqual({ nuevas: [], obsoletas: [] });
  });
});

describe('evaluadores de medidas del DOM (los usa pruebas-navegador/calidad-visual.nav.ts)', () => {
  it('desborde horizontal: 472 contra 412 falla; 412 contra 412 y 1 px de redondeo pasan', () => {
    expect(evaluarDesborde({ scrollWidth: 472, innerWidth: 412 })).toHaveLength(1);
    expect(evaluarDesborde({ scrollWidth: 412, innerWidth: 412 })).toEqual([]);
    expect(evaluarDesborde({ scrollWidth: 413, innerWidth: 412 })).toEqual([]);
  });
  it('un solo h1: cero y dos fallan, uno pasa', () => {
    expect(evaluarH1([])).toHaveLength(1);
    expect(evaluarH1(['Resumen', 'Resumen'])).toHaveLength(1);
    expect(evaluarH1(['Resumen'])).toEqual([]);
  });
  it('títulos encimados o triturados: se detectan; una caja sana y vecinas sin solape pasan', () => {
    const encimados = [
      { texto: 'Entrar a los otros paneles', x: 16, y: 100, w: 120, h: 18 },
      { texto: 'Primera tarjeta', x: 16, y: 105, w: 200, h: 18 },
    ];
    expect(evaluarTitulosEncimados(encimados).some((f: string) => f.includes('se encima'))).toBe(true);
    const triturado = [{ texto: 'Entrar a los otros paneles', x: 16, y: 100, w: 60, h: 108 }];
    expect(evaluarTitulosEncimados(triturado).length).toBeGreaterThan(0);
    const sano = [
      { texto: 'Entrar a los otros paneles', x: 16, y: 100, w: 340, h: 18 },
      { texto: 'Primera tarjeta', x: 16, y: 130, w: 200, h: 18 },
    ];
    expect(evaluarTitulosEncimados(sano)).toEqual([]);
  });
});
