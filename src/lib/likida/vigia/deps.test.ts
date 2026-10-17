import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./repo', () => ({ crearRepoVigia: () => ({ marca: 'repo' }) }));
vi.mock('./modelo', () => ({ crearModeloClasificador: () => ({ marca: 'clasificador' }), crearModeloPulidor: () => ({ marca: 'pulidor' }) }));

const moduloEnStandBy = vi.fn(async (_t: string, _m: string) => true);
vi.mock('@/lib/auth/perfil_tenant', () => ({ moduloEnStandBy: (t: string, m: string) => moduloEnStandBy(t, m) }));

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

describe('cableado de «datos de la unidad» (T-A4-24)', () => {
  afterEach(() => { delete process.env.LIKIDA_VIGIA_DATOS_UNIDAD; });
  it('por omisión APAGADO: la 0798 no se da por aplicada', () => {
    expect(crearDepsVigia().datosUnidad).toBe(false);
  });
  it('LIKIDA_VIGIA_DATOS_UNIDAD=si lo enciende; cualquier otro valor (o un marcador) no', () => {
    process.env.LIKIDA_VIGIA_DATOS_UNIDAD = 'si';
    expect(crearDepsVigia().datosUnidad).toBe(true);
    process.env.LIKIDA_VIGIA_DATOS_UNIDAD = 'tal vez';
    expect(crearDepsVigia().datosUnidad).toBe(false);
    process.env.LIKIDA_VIGIA_DATOS_UNIDAD = '[SENSITIVE]';
    expect(crearDepsVigia().datosUnidad).toBe(false);
  });
});

describe('cableado del perfil (fase 1): el Vigía en «Próximamente»', () => {
  it('el puerto `enStandBy` pregunta por el módulo `vigia` del tenant', async () => {
    expect(await crearDepsVigia().enStandBy?.('t-con-perfil')).toBe(true);
    expect(moduloEnStandBy).toHaveBeenCalledWith('t-con-perfil', 'vigia');
  });
});
