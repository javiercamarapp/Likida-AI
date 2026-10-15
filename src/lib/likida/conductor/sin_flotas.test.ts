import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no debe tocar la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { sinFlotasEnViajes, sinFlotasEnCandidatos, sinFlotasEnValidacion } = await import('./sin_flotas');

const V = (tenantId: string, id: string) => ({ tenantId, id });
const saltar = new Set(['con-perfil']);

describe('el Conductor no mira a las flotas con perfil (fase 1)', () => {
  it('viajesActivos y viajes dejan fuera a las flotas a saltar y conservan el resto de los puertos', async () => {
    const viajesActivos = vi.fn(async (_n: number) => [V('con-perfil', 'a'), V('libre', 'b')]);
    const viajes = vi.fn(async (_n: number) => [V('con-perfil', 'c'), V('libre', 'd')]);
    const otro = vi.fn();
    const p = sinFlotasEnViajes({ viajesActivos, viajes, otro }, saltar);
    expect((await p.viajesActivos(10)).map((v) => v.id)).toEqual(['b']);
    expect((await p.viajes(10)).map((v) => v.id)).toEqual(['d']);
    expect(p.otro).toBe(otro);
  });

  it('candidatos directos y de validación se filtran por su flota', async () => {
    const dir = sinFlotasEnCandidatos(async (_n: number) => [V('con-perfil', 'a'), V('libre', 'b')], saltar);
    expect((await dir(5)).map((c) => c.id)).toEqual(['b']);
    const val = sinFlotasEnValidacion(async (_d: Date, _n: number) => [{ viaje: V('con-perfil', 'a') }, { viaje: V('libre', 'b') }], saltar);
    expect((await val(new Date(), 5)).map((c) => c.viaje.id)).toEqual(['b']);
  });

  it('SIN flotas a saltar no cambia nada: devuelve los mismos puertos y funciones', () => {
    const p = { viajesActivos: async () => [V('x', 'a')] };
    expect(sinFlotasEnViajes(p, new Set())).toBe(p);
    const f = async () => [V('x', 'a')];
    expect(sinFlotasEnCandidatos(f, new Set())).toBe(f);
  });
});
