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
  const motor = etiquetas('./cuadre/engine.ts', 'const m: Record<string, string> = {');
  const pdf = etiquetas('./liquidacion/pdf.ts', 'const CONCEPTO_LABEL: Record<string, string> = {');
  const panel = etiquetas('../../app/dashboard/[id]/page.tsx', 'const CONCEPTO');

  it('el motor y el PDF cubren los mismos conceptos', () => {
    expect(Object.keys(motor).sort()).toEqual(Object.keys(pdf).sort());
  });

  it('el motor y el panel cubren los mismos conceptos', () => {
    expect(Object.keys(motor).sort()).toEqual(Object.keys(panel).sort());
  });

  it('y les ponen la MISMA etiqueta', () => {
    // Aquí es donde se cazó `otro: 'Gasto'` contra `otro: 'Otro'`.
    for (const k of Object.keys(motor)) {
      expect(pdf[k], `"${k}" difiere entre el motor y el PDF`).toBe(motor[k]);
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
