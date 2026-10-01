import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./repo', () => ({ crearRepoVigia: () => ({ marca: 'repo' }) }));
vi.mock('./modelo', () => ({ crearModeloClasificador: () => ({ marca: 'clasificador' }), crearModeloPulidor: () => ({ marca: 'pulidor' }) }));

const { crearDepsVigia } = await import('./deps');

afterEach(() => { delete process.env.LIKIDA_VIGIA_MODELO; delete process.env.LIKIDA_VIGIA_PULIR; });

describe('cableado real del Vigía', () => {
  it('por omisión: clasificador por modelo encendido, pulido APAGADO', () => {
    const d = crearDepsVigia();
    expect(d.repo).toEqual({ marca: 'repo' });
    expect(d.modelo).toEqual({ marca: 'clasificador' });
    expect(d.pulir).toBeNull();
  });
  it('LIKIDA_VIGIA_MODELO=no deja solo las reglas', () => {
    process.env.LIKIDA_VIGIA_MODELO = 'no';
    expect(crearDepsVigia().modelo).toBeNull();
  });
  it('LIKIDA_VIGIA_PULIR=si enciende el pulido; cualquier otro valor (o un marcador) no', () => {
    process.env.LIKIDA_VIGIA_PULIR = 'si';
    expect(crearDepsVigia().pulir).toEqual({ marca: 'pulidor' });
    process.env.LIKIDA_VIGIA_PULIR = 'tal vez';
    expect(crearDepsVigia().pulir).toBeNull();
    process.env.LIKIDA_VIGIA_PULIR = '[SENSITIVE]';
    expect(crearDepsVigia().pulir).toBeNull();
  });
});
