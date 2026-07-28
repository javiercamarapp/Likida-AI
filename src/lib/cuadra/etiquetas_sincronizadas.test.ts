import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

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
    // Si alguien añade un concepto a types/cuadra.ts y no lo etiqueta, sale en
    // pantalla como la clave cruda o como undefined.
    const tipos = readFileSync(new URL('../../types/cuadra.ts', import.meta.url), 'utf8');
    const i = tipos.indexOf('export type ConceptoGasto');
    const decl = tipos.slice(i, tipos.indexOf(';', i));
    const conceptos = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(conceptos.length, 'no se pudo leer ConceptoGasto').toBeGreaterThan(3);
    for (const c of conceptos) expect(motor[c], `falta etiqueta para "${c}"`).toBeTruthy();
  });
});

// El MISMO patrón, en el otro mapa duplicado del panel. `ESTATUS` vive en las dos
// páginas del dashboard con el mismo contenido copiado; el auditor lo señaló como
// "latente para el próximo estatus nuevo". Es exactamente lo que pasó con
// CONCEPTO dos veces, así que se cierra antes de que pase una tercera.
/**
 * Igual que `etiquetas`, para mapas cuyo valor es un objeto:
 *   clave: { label: '…', color: '…' }
 * El extractor simple corta en el primer `}` y aquí eso caía dentro del primer
 * valor anidado.
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

describe('etiquetas de estatus — las dos páginas del panel dicen lo mismo', () => {
  const lista = etiquetasAnidadas('../../app/dashboard/page.tsx', 'const ESTATUS');
  const detalle = etiquetasAnidadas('../../app/dashboard/[id]/page.tsx', 'const ESTATUS');

  it('cubren los mismos estatus', () => {
    expect(Object.keys(lista).sort()).toEqual(Object.keys(detalle).sort());
  });

  it('con las mismas etiquetas y los mismos colores', () => {
    expect(lista).toEqual(detalle);
  });

  it('cubren todos los estatus que el tipo permite', () => {
    const tipos = readFileSync(new URL('../../types/cuadra.ts', import.meta.url), 'utf8');
    const i = tipos.indexOf('export type EstatusLiquidacion');
    const decl = tipos.slice(i, tipos.indexOf(';', i));
    const estatus = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(estatus.length, 'no se pudo leer EstatusLiquidacion').toBeGreaterThan(1);
    for (const e of estatus) expect(lista[e], `falta etiqueta para el estatus "${e}"`).toBeTruthy();
  });
});
