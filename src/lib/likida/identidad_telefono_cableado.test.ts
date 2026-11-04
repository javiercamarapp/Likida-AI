// F1 lote B, L1H (CT-SEG-07 / X-01): la compuerta de identidad única tiene que correr ANTES de resolver al operador en el
// camino del mensaje entrante. Prueba de fuente (el procesador es demasiado grande para armarlo entero en una prueba):
// si alguien mueve la compuerta después de `resolveOperador`, o la quita, el mensaje vuelve a resolver "el primero que gane".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const fuente = readFileSync('src/lib/likida/processor.ts', 'utf8');

describe('processor: compuerta de identidad por teléfono', () => {
  it('importa exigirIdentidadUnica', () => {
    expect(fuente).toMatch(/import\s*\{[^}]*exigirIdentidadUnica[^}]*\}\s*from\s*'\.\/identidad_telefono'/);
  });

  it('la llama con el remitente ANTES de la resolución del operador del turno', () => {
    const iCompuerta = fuente.indexOf('await exigirIdentidadUnica(msg.from)');
    const iOperador = fuente.indexOf('const op = await resolveOperador(msg.from);');
    expect(iCompuerta).toBeGreaterThan(-1);
    expect(iOperador).toBeGreaterThan(-1);
    expect(iCompuerta).toBeLessThan(iOperador);
  });
});
