import { describe, expect, it } from 'vitest';
import { clasificarFilas, estadoDeFila, huella } from './huella';
import type { FilaMapeada } from './mapeo';

// Sintético. La clave externa es la que produce el mapeo: JSON de los destinos que la componen.
const fila = (folio: string, importe: number, extra: Record<string, unknown> = {}): FilaMapeada =>
  ({ fila: { folio, importe, ...extra }, clave: JSON.stringify([folio]), indice: 0 });

describe('huella', () => {
  it('es sha256 hexadecimal, determinista y no depende del orden de las llaves', () => {
    const a = huella('peajes', '["F-1"]', { importe: 10, caseta: 'X', anidado: { b: 1, a: 2 } });
    const b = huella('peajes', '["F-1"]', { anidado: { a: 2, b: 1 }, caseta: 'X', importe: 10 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('cambia con un importe distinto, con otra clave y con otro recurso', () => {
    const base = huella('peajes', '["F-1"]', { importe: 10 });
    expect(huella('peajes', '["F-1"]', { importe: 10.01 })).not.toBe(base);
    expect(huella('peajes', '["F-2"]', { importe: 10 })).not.toBe(base);
    expect(huella('viajes', '["F-1"]', { importe: 10 })).not.toBe(base);
  });

  it('10 y 10.0 son el mismo número; "10" (texto) no; undefined equivale a campo ausente', () => {
    expect(huella('peajes', 'k', { a: 10 })).toBe(huella('peajes', 'k', { a: 10.0 }));
    expect(huella('peajes', 'k', { a: 10 })).not.toBe(huella('peajes', 'k', { a: '10' }));
    expect(huella('peajes', 'k', { a: 1, b: undefined })).toBe(huella('peajes', 'k', { a: 1 }));
  });

  it('el límite entre campos no es ambiguo (no se puede forjar una colisión moviendo texto)', () => {
    expect(huella('peajes', 'k', { a: 'x', b: 'y' })).not.toBe(huella('peajes', 'k', { a: 'xy', b: '' }));
  });

  it('valores no representables lanzan en lugar de hashear a ciegas', () => {
    expect(() => huella('peajes', 'k', { a: NaN })).toThrow(/no finito/);
    expect(() => huella('peajes', 'k', { a: () => 1 })).toThrow(/tipo no admitido/);
  });
});

describe('estadoDeFila / clasificarFilas', () => {
  it('nueva → omitida (misma huella) → actualizada (importe corregido en el origen)', () => {
    const previas = new Map<string, string>();
    const v1 = clasificarFilas('peajes', [fila('F-1', 100)], previas);
    expect(v1.filas[0].estado).toBe('nueva');
    previas.set(v1.filas[0].clave, v1.filas[0].huella);

    const v2 = clasificarFilas('peajes', [fila('F-1', 100)], previas);
    expect(v2.filas[0].estado).toBe('omitida');
    expect(v2.porAsentar).toHaveLength(0);
    expect(v2.omitidas).toBe(1);

    const v3 = clasificarFilas('peajes', [fila('F-1', 120)], previas);
    expect(v3.filas[0].estado).toBe('actualizada');
    expect(v3.porAsentar).toHaveLength(1);
  });

  it('solo cuentan los campos estables: una marca de lectura que cambia NO provoca «actualizada»', () => {
    const previas = new Map<string, string>();
    const a = clasificarFilas('peajes', [fila('F-1', 100, { fecha_recibido: '2026-01-01' })], previas, ['folio', 'importe']);
    previas.set(a.filas[0].clave, a.filas[0].huella);
    const b = clasificarFilas('peajes', [fila('F-1', 100, { fecha_recibido: '2026-02-09' })], previas, ['folio', 'importe']);
    expect(b.filas[0].estado).toBe('omitida');
    const c = clasificarFilas('peajes', [fila('F-1', 100, { fecha_recibido: '2026-02-09' })], previas); // sin lista: todo cuenta
    expect(c.filas[0].estado).toBe('actualizada');
  });

  it('la misma fila dos veces en una tanda → se asienta una sola vez; el resto de claves no se afecta', () => {
    const out = clasificarFilas('peajes', [fila('F-1', 1), fila('F-2', 2), fila('F-1', 1)], new Map());
    expect(out.filas.map((f) => f.estado)).toEqual(['nueva', 'nueva', 'omitida']);
    expect(out.porAsentar.map((f) => f.clave)).toEqual([JSON.stringify(['F-1']), JSON.stringify(['F-2'])]);
  });

  it('estadoDeFila no modifica las huellas previas', () => {
    const previas = new Map([['k', 'h1']]);
    expect(estadoDeFila(previas, 'k', 'h1')).toBe('omitida');
    expect(estadoDeFila(previas, 'k', 'h2')).toBe('actualizada');
    expect(estadoDeFila(previas, 'otra', 'h1')).toBe('nueva');
    expect([...previas.entries()]).toEqual([['k', 'h1']]);
  });
});
