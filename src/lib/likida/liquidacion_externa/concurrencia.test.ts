import { describe, it, expect } from 'vitest';
import { mapAcotado } from './concurrencia';

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('mapAcotado', () => {
  it('conserva el orden de la entrada aunque las tareas terminen en otro orden', async () => {
    const r = await mapAcotado([30, 5, 20, 1], 4, async (ms, i) => { await pausa(ms); return `${i}:${ms}`; });
    expect(r).toEqual(['0:30', '1:5', '2:20', '3:1']);
  });
  it('nunca excede el límite y sí usa el paralelismo', async () => {
    let vuelo = 0; let max = 0;
    await mapAcotado(new Array(20).fill(0), 6, async () => { vuelo++; max = Math.max(max, vuelo); await pausa(3); vuelo--; });
    expect(max).toBe(6);
  });
  it('con límite 1 es secuencial', async () => {
    let vuelo = 0; let max = 0;
    await mapAcotado([1, 2, 3, 4], 1, async () => { vuelo++; max = Math.max(max, vuelo); await pausa(2); vuelo--; });
    expect(max).toBe(1);
  });
  it('la primera falla deja de repartir, espera a las que iban y se relanza', async () => {
    const iniciadas: number[] = []; let terminadas = 0;
    await expect(mapAcotado([0, 1, 2, 3, 4, 5, 6, 7], 2, async (x) => {
      iniciadas.push(x);
      await pausa(5);
      if (x === 1) throw new Error('boom');
      terminadas++;
    })).rejects.toThrow('boom');
    expect(iniciadas.length).toBeLessThan(8);
    expect(terminadas).toBe(iniciadas.length - 1); // ninguna promesa quedó huérfana
  });
  it('lista vacía y límites absurdos no cuelgan', async () => {
    expect(await mapAcotado([], 6, async () => 1)).toEqual([]);
    expect(await mapAcotado([1, 2], 0, async (x) => x)).toEqual([1, 2]);
    expect(await mapAcotado([1, 2], Number.NaN, async (x) => x)).toEqual([1, 2]);
  });
});
