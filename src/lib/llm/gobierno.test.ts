import { describe, it, expect, vi, beforeEach } from 'vitest';

const sondear = vi.hoisted(() => vi.fn());
const revisar = vi.hoisted(() => vi.fn());
vi.mock('./credencial', () => ({ sondearLlave: sondear }));
vi.mock('./alerta_tope', () => ({ revisarTopesIa: revisar }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { tocaGobiernoIa, gobiernoIaEncendido, correrGobiernoIa } from './gobierno';

const a = (min: number) => Date.UTC(2026, 10, 4, 12, min, 30);
beforeEach(() => { sondear.mockReset(); revisar.mockReset(); });

describe('gobierno de IA en la guardia', () => {
  it('toca una de cada tres pasadas de 5 minutos: minutos 0, 15, 30, 45', () => {
    expect([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].filter((m) => tocaGobiernoIa(a(m)))).toEqual([0, 15, 30, 45]);
  });
  it('solo se enciende con IA_GOBIERNO=encendido', () => {
    expect(gobiernoIaEncendido({} as NodeJS.ProcessEnv)).toBe(false);
    expect(gobiernoIaEncendido({ IA_GOBIERNO: 'si' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(gobiernoIaEncendido({ IA_GOBIERNO: 'encendido' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it('apagado: no toca ni la red ni la base', async () => {
    expect(await correrGobiernoIa(a(0), {} as NodeJS.ProcessEnv)).toEqual({ estado: 'apagado' });
    expect(sondear).not.toHaveBeenCalled(); expect(revisar).not.toHaveBeenCalled();
  });
  it('encendido pero fuera de turno: omitido', async () => {
    expect(await correrGobiernoIa(a(5), { IA_GOBIERNO: 'encendido' } as unknown as NodeJS.ProcessEnv)).toEqual({ estado: 'omitido' });
    expect(sondear).not.toHaveBeenCalled();
  });
  it('encendido y en turno: corre sonda y barrido y resume', async () => {
    sondear.mockResolvedValue({ estado: 'ok' });
    revisar.mockResolvedValue({ flotas: 3, avisos: [{ tenantId: 'x', nivel: 80 }] });
    expect(await correrGobiernoIa(a(15), { IA_GOBIERNO: 'encendido' } as unknown as NodeJS.ProcessEnv)).toEqual({ estado: 'ok', llave: 'ok', flotas: 3, avisos: 1 });
  });
  it('si el barrido da error (p. ej. migración 0990 sin aplicar) lo dice sin lanzar; si todo revienta, también', async () => {
    sondear.mockResolvedValue({ estado: 'llave_invalida' });
    revisar.mockResolvedValue({ flotas: 0, avisos: [], error: 'function uso_llm_dia_por_flota does not exist' });
    const r = await correrGobiernoIa(a(30), { IA_GOBIERNO: 'encendido' } as unknown as NodeJS.ProcessEnv);
    expect(r.estado).toBe('error'); expect(r.llave).toBe('llave_invalida');
    sondear.mockRejectedValue(new Error('boom'));
    expect((await correrGobiernoIa(a(30), { IA_GOBIERNO: 'encendido' } as unknown as NodeJS.ProcessEnv)).estado).toBe('error');
  });
});
