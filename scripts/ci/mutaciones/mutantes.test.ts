/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// La sonda pesada (correr.mjs) se corre a mano; esta prueba barata solo garantiza que el catalogo no se pudra: cada
// mutante sigue aplicandose a UNA sola linea del codigo actual y apunta a pruebas que existen.
const RAIZ = process.cwd();
const { mutantes } = JSON.parse(readFileSync(join(RAIZ, 'scripts/ci/mutaciones/mutantes.json'), 'utf8')) as {
  mutantes: Array<{ nombre: string; regla: string; archivo: string; viejo: string; nuevo: string; pruebas: string[] }>;
};

describe('catalogo de mutantes del cuadre', () => {
  it('cubre doble conteo, monto ilegible y signo', () => {
    const n = mutantes.map((m) => m.nombre);
    expect(n).toEqual(expect.arrayContaining(['doble_conteo_duplicados', 'monto_ilegible_cuenta_como_cero_o_negativo', 'signo_de_la_diferencia']));
    expect(new Set(n).size).toBe(n.length);
  });
  it.each(mutantes.map((m) => [m.nombre, m] as const))('%s: el fragmento aparece una sola vez y cambia algo', (_n, m) => {
    const fuente = readFileSync(join(RAIZ, m.archivo), 'utf8');
    expect(fuente.split(m.viejo).length - 1).toBe(1);
    expect(m.nuevo).not.toBe(m.viejo);
    expect(m.regla.length).toBeGreaterThan(20);
    for (const p of m.pruebas) expect(existsSync(join(RAIZ, p)), p).toBe(true);
  });
});
