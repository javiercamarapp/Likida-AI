// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · CRÍTICO — la única salida hacia el ERP del cliente no tenía arnés.
//
// MUTACIÓN M21 (`export.ts:46-47`): el CSV intercambia `total_comprobado` con
// `anticipo`. 628 verdes. Es un mapeo A MANO de campo a campo —exactamente la
// clase de error para la que se escribió `repo_escritura.test.ts`—, pero ahí solo
// se cubrió la escritura HACIA la base, nunca la salida HACIA Excel.
//
// Este archivo es el que el contralor importa a su contabilidad. Si las columnas
// están cruzadas, cada viaje entra al ERP con el anticipo donde va el gasto
// comprobado y viceversa, y el error se propaga a la conciliación entera sin que
// nadie lo note: los dos números existen, los dos son plausibles.
//
// `toCsv` y `toLiquidacionRows` tenían cobertura CERO: ninguna prueba importaba
// `export.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { toCsv, toLiquidacionRows } from './export';

/**
 * Lee el CSV como lo lee Excel: por NOMBRE de columna, no por posición. Es la
 * única forma de que "el total comprobado está en la columna correcta" sea una
 * afirmación y no una coincidencia de orden.
 */
function porColumna(csv: string, fila = 0): Record<string, string> {
  const lineas = csv.trimEnd().split('\n');
  const cabeceras = lineas[0].split(',');
  const celdas = lineas[fila + 1].split(',');
  return Object.fromEntries(cabeceras.map((h, i) => [h, celdas[i]]));
}

// Cifras deliberadamente distintas y no confundibles entre sí: comprobado
// 4,812.50 · anticipo 5,000 · diferencia 187.50. Si dos columnas se cruzan, el
// valor cambia y la prueba lo ve.
const CRUDO = [{
  created_at: '2026-05-02T10:00:00.000Z',
  total_comprobado: 4812.5,
  total_anticipo: 5000,
  diferencia: 187.5,
  estatus: 'con_diferencias',
  diferencias: [{ tipo: 'anticipo' }, { tipo: 'sin_cfdi' }],
  viaje: { folio: 'VJ-2026-0847', operador: { nombre: 'Juan Pérez' } },
}];

describe('toLiquidacionRows — el mapeo de dinero hacia el ERP', () => {
  // MUTACIÓN M21: intercambiar estas dos líneas deja la suite verde.
  it('cada cifra cae en SU campo (M21: intercambiar comprobado y anticipo)', () => {
    const [r] = toLiquidacionRows(CRUDO);
    expect(r.total_comprobado).toBe(4812.5);
    expect(r.anticipo).toBe(5000);
    expect(r.diferencia).toBe(187.5);
  });

  // La invariante contable de la fila: comprobado + diferencia = anticipo.
  // Cruzar dos columnas la rompe aunque los tres números sigan presentes.
  it('la fila exportada cuadra sola: comprobado + diferencia = anticipo', () => {
    const [r] = toLiquidacionRows(CRUDO);
    expect(r.total_comprobado + r.diferencia).toBeCloseTo(r.anticipo, 2);
  });

  it('folio, operador, fecha, estatus y conteo de diferencias van en su campo', () => {
    const [r] = toLiquidacionRows(CRUDO);
    expect(r.folio_viaje).toBe('VJ-2026-0847');
    expect(r.operador).toBe('Juan Pérez');
    expect(r.fecha).toBe('2026-05-02');       // solo el día, sin hora
    expect(r.estatus).toBe('con_diferencias');
    expect(r.num_diferencias).toBe(2);
  });

  it('un cero se exporta como 0, no se pierde ni se vuelve vacío', () => {
    // El caso que muerde en un ERP: un 0 que llega como null o como '' hace que
    // la conciliación lo trate como "no informado" en vez de "cuadró exacto".
    const [r] = toLiquidacionRows([{ ...CRUDO[0], diferencia: 0, total_comprobado: 0 }]);
    expect(r.diferencia).toBe(0);
    expect(r.total_comprobado).toBe(0);
  });

  it('una diferencia NEGATIVA conserva su signo (es dinero que la empresa debe)', () => {
    const [r] = toLiquidacionRows([{ ...CRUDO[0], total_anticipo: 4000, diferencia: -812.5 }]);
    expect(r.diferencia).toBe(-812.5);
    expect(r.total_comprobado + r.diferencia).toBeCloseTo(r.anticipo, 2);
  });

  it('sin viaje ni operador no truena ni inventa un nombre', () => {
    const [r] = toLiquidacionRows([{ ...CRUDO[0], viaje: null }]);
    expect(r.folio_viaje).toBe('');
    expect(r.operador).toBe('');
    expect(r.total_comprobado).toBe(4812.5);   // el dinero sigue en su sitio
  });
});

describe('toCsv — lo que abre Excel', () => {
  it('la columna total_comprobado trae el comprobado, y anticipo el anticipo', () => {
    const c = porColumna(toCsv(toLiquidacionRows(CRUDO)));
    expect(c.total_comprobado).toBe('4812.5');
    expect(c.anticipo).toBe('5000');
    expect(c.diferencia).toBe('187.5');
  });

  it('la cabecera lleva los nombres que el ERP espera', () => {
    const [cab] = toCsv(toLiquidacionRows(CRUDO)).split('\n');
    expect(cab).toBe('folio_viaje,operador,fecha,total_comprobado,anticipo,diferencia,estatus,num_diferencias');
  });

  // El clásico que corre TODAS las columnas de lugar y mete el mismo error que
  // M21 sin tocar el mapeo: una razón social con coma.
  it('una coma en el nombre del operador no recorre las columnas', () => {
    const csv = toCsv(toLiquidacionRows([{
      ...CRUDO[0], viaje: { folio: 'VJ-1', operador: { nombre: 'TRANSPORTES DEL SURESTE, S.A. DE C.V.' } },
    }]));
    expect(csv).toContain('"TRANSPORTES DEL SURESTE, S.A. DE C.V."');
    // Y con el campo entrecomillado, el resto de la fila sigue alineado: 8
    // columnas, no 9. Se cuentan las comas FUERA de comillas.
    const fila = csv.trimEnd().split('\n')[1];
    let dentro = false, campos = 1;
    for (const ch of fila) {
      if (ch === '"') dentro = !dentro;
      else if (ch === ',' && !dentro) campos++;
    }
    expect(campos).toBe(8);
  });

  it('comillas y saltos de línea se escapan como manda el CSV', () => {
    const csv = toCsv([{ nota: 'dijo "ya" \n y colgó', monto: 10 }]);
    expect(csv).toContain('"dijo ""ya"" \n y colgó"');
  });

  it('sin filas devuelve vacío, no una cabecera huérfana', () => {
    expect(toCsv([])).toBe('');
  });

  it('respeta el orden de columnas que se le pida', () => {
    const csv = toCsv(toLiquidacionRows(CRUDO), ['anticipo', 'total_comprobado']);
    expect(csv.split('\n')[0]).toBe('anticipo,total_comprobado');
    expect(csv.split('\n')[1]).toBe('5000,4812.5');
  });
});
