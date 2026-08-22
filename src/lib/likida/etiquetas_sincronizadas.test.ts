import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// LOS MISMOS CONCEPTOS, ESCRITOS EN TRES SITIOS, YA SE DESINCRONIZARON DOS VECES.
//
// La primera fue `viaticos` partido en tres: el dashboard se quedó corto y un
// concepto salía en blanco en pantalla. Se arregló a mano. La segunda fue
// `otro`, que decía 'Gasto' en el motor y 'Otro' en el PDF y el panel — el
// operador leía una palabra por WhatsApp y el contralor otra en el papel.
//
// Sincronizarlos a mano ya falló dos veces, así que esto no es un test de
// etiquetas: es el mecanismo que evita la tercera. Si alguien añade un concepto
// en un sitio y no en los otros, falla aquí y no en la demo.
//
// No se unificó en una constante compartida porque el dashboard es un server
// component y el PDF corre en otro runtime; el test da la garantía sin forzar
// un import que no siempre es posible.
// ═══════════════════════════════════════════════════════════════════════════

/** Saca los pares `clave: 'Etiqueta'` de un mapa literal del fuente. */
function etiquetas(ruta: string, ancla: string): Record<string, string> {
  const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
  const i = src.indexOf(ancla);
  expect(i, `no se encontró el ancla "${ancla}" en ${ruta}`).toBeGreaterThanOrEqual(0);
  const bloque = src.slice(i, src.indexOf('}', i));
  const out: Record<string, string> = {};
  for (const m of bloque.matchAll(/(\w+):\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

// ── EL BARRIDO (auditoría 18, M1 — reincidencia) ───────────────────────────
//
// Este test anclaba por RUTAS LITERALES, así que un archivo nuevo entraba al
// repo por fuera de su radar: `gasto-semanal-chart.tsx` nació el 16-ago con un
// `CONCEPTO_LABEL` propio —el nombre que este test prohíbe en el PDF— y ya
// divergía en tres valores contra el motor con la suite en verde. El mecanismo
// que sí escala es el de formato.ts: buscar el PATRÓN en TODO `src/`. Cada
// mapa de conceptos que aparezca se compara contra el motor; el que no quiera
// compararse no puede existir.
const RAIZ_SRC = new URL('../../', import.meta.url).pathname;
const PATRON_MAPA = /const (CONCEPTO(?:_LABEL)?)\s*(?::\s*Record<string,\s*string>)?\s*=\s*\{/;

function fuentes(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

/** Todos los mapas de etiquetas de concepto del árbol, con su ruta. */
function mapasDeConcepto(): Array<{ ruta: string; mapa: Record<string, string> }> {
  const out: Array<{ ruta: string; mapa: Record<string, string> }> = [];
  for (const f of fuentes(RAIZ_SRC)) {
    const src = readFileSync(f, 'utf8');
    const m = PATRON_MAPA.exec(src);
    if (!m) continue;
    const bloque = src.slice(m.index, src.indexOf('}', m.index));
    const mapa: Record<string, string> = {};
    for (const k of bloque.matchAll(/(\w+):\s*'([^']*)'/g)) mapa[k[1]] = k[2];
    out.push({ ruta: relative(RAIZ_SRC, f), mapa });
  }
  return out;
}

describe('etiquetas de concepto — TODAS las copias del árbol dicen lo mismo que el motor', () => {
  const motor = etiquetas('./cuadre/engine.ts', 'const m: Record<string, string> = {');
  const copias = mapasDeConcepto();

  it('el barrido encuentra las copias conocidas (si esto falla, el patrón se quedó ciego)', () => {
    const rutas = copias.map((c) => c.ruta);
    expect(rutas).toContain('app/dashboard/[id]/page.tsx');
    expect(rutas).toContain('app/dashboard/gasto-semanal-chart.tsx');
  });

  it('cada copia cubre los mismos conceptos que el motor, con la MISMA etiqueta', () => {
    expect(copias.length).toBeGreaterThan(0);
    for (const { ruta, mapa } of copias) {
      expect(Object.keys(mapa).sort(), `${ruta} no cubre los mismos conceptos que el motor`).toEqual(Object.keys(motor).sort());
      for (const k of Object.keys(motor)) {
        // Aquí se cazó 'Casetas'/'Facturas'/'Otros' en la gráfica del Resumen.
        expect(mapa[k], `"${k}" difiere entre el motor y ${ruta}`).toBe(motor[k]);
      }
    }
  });
});

describe('etiquetas de concepto — las tres fuentes dicen lo mismo', () => {
  // El PDF ya NO tiene mapa propio: importa `etiquetaConcepto` del motor. Una
  // función importada no puede desincronizarse, que es mejor que un test que
  // avisa cuando ya pasó. Queda el del panel, que sigue siendo una copia.
  const motor = etiquetas('./cuadre/engine.ts', 'const m: Record<string, string> = {');
  const panel = etiquetas('../../app/dashboard/[id]/page.tsx', 'const CONCEPTO');

  it('el PDF ya no tiene mapa propio: usa la función del motor', () => {
    // Si alguien vuelve a meter un mapa gemelo en el PDF, este test lo caza.
    const src = readFileSync(new URL('./liquidacion/pdf.ts', import.meta.url), 'utf8');
    expect(src).toContain('etiquetaConcepto');
    expect(src, 'volvió a aparecer un mapa de etiquetas en el PDF').not.toMatch(/const CONCEPTO_LABEL/);
  });

  it('el motor y el panel cubren los mismos conceptos', () => {
    expect(Object.keys(motor).sort()).toEqual(Object.keys(panel).sort());
  });

  it('y les ponen la MISMA etiqueta', () => {
    // Aquí es donde se cazó `otro: 'Gasto'` contra `otro: 'Otro'`.
    for (const k of Object.keys(motor)) {
      expect(panel[k], `"${k}" difiere entre el motor y el panel`).toBe(motor[k]);
    }
  });

  it('cubren todos los conceptos que el tipo permite', () => {
    // Si alguien añade un concepto a types/likida.ts y no lo etiqueta, sale en
    // pantalla como la clave cruda o como undefined.
    const tipos = readFileSync(new URL('../../types/likida.ts', import.meta.url), 'utf8');
    const i = tipos.indexOf('export type ConceptoGasto');
    const decl = tipos.slice(i, tipos.indexOf(';', i));
    const conceptos = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(conceptos.length, 'no se pudo leer ConceptoGasto').toBeGreaterThan(3);
    for (const c of conceptos) expect(motor[c], `falta etiqueta para "${c}"`).toBeTruthy();
  });
});

// ── ESTATUS: el duplicado SE ELIMINÓ, no se sigue vigilando ────────────────
//
// Este bloque comparaba las DOS copias de `ESTATUS` (la lista y el detalle del
// panel) y verificaba que no se separaran — el auditor lo había marcado como
// "latente para el próximo estatus nuevo". Al reestructurar /dashboard el mapa
// se movió a `app/dashboard/estatus.ts` y las dos páginas lo importan, así que
// ya no hay dos copias que puedan divergir: comparar una copia consigo misma
// no prueba nada.
//
// El mapa gemelo de CONCEPTO (arriba) sí se queda vigilado: vive en runtimes
// distintos (motor, PDF, panel) y no se puede importar de uno a otro. Este no.
//
// Lo que SÍ sigue siendo posible perder —y por eso se conserva— es que alguien
// añada un estatus al tipo y no lo etiquete: entonces sale en pantalla como la
// clave cruda. Eso se prueba contra la fuente única.
/**
 * Igual que `etiquetas`, para mapas cuyo valor es un objeto:
 *   clave: { label: '…', color: '…' }
 * El extractor simple corta en el primer `}` y aquí eso caería DENTRO del
 * primer valor anidado, devolviendo `label`/`color` como si fueran claves.
 */
function etiquetasAnidadas(ruta: string, ancla: string): Record<string, Record<string, string>> {
  const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
  const i = src.indexOf(ancla);
  expect(i, `no se encontró el ancla "${ancla}" en ${ruta}`).toBeGreaterThanOrEqual(0);
  const bloque = src.slice(i, src.indexOf('\n};', i) >= 0 ? src.indexOf('\n};', i) : src.indexOf('} as const', i));
  const out: Record<string, Record<string, string>> = {};
  for (const m of bloque.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    const campos: Record<string, string> = {};
    for (const f of m[2].matchAll(/(\w+):\s*'([^']*)'/g)) campos[f[1]] = f[2];
    out[m[1]] = campos;
  }
  return out;
}

describe('etiquetas de estatus — la fuente única cubre el tipo', () => {
  const unica = etiquetasAnidadas('../../app/dashboard/estatus.ts', 'export const ESTATUS');

  it('el mapa ya no está duplicado en las páginas del panel', () => {
    // Si alguien vuelve a pegar un mapa local en vez de importar el
    // compartido, este test lo caza — igual que el del PDF, arriba.
    // `/dashboard/cuadre` se borró el 10-ago-2026 (rediseño desde cero de
    // "dueño de flota") — sale de la lista junto con la página.
    for (const ruta of ['../../app/dashboard/[id]/page.tsx']) {
      const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
      expect(src, `volvió a aparecer un mapa de estatus propio en ${ruta}`).not.toMatch(/const ESTATUS[:\s]*[:=]/);
      expect(src, `${ruta} ya no usa la fuente única de estatus`).toMatch(/etiquetaEstatus/);
    }
  });

  it('cubre todos los estatus que el tipo permite', () => {
    const tipos = readFileSync(new URL('../../types/likida.ts', import.meta.url), 'utf8');
    const i = tipos.indexOf('export type EstatusLiquidacion');
    const decl = tipos.slice(i, tipos.indexOf(';', i));
    const estatus = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(estatus.length, 'no se pudo leer EstatusLiquidacion').toBeGreaterThan(1);
    for (const e of estatus) expect(unica[e], `falta etiqueta para el estatus "${e}"`).toBeTruthy();
  });
});
