import { describe, it, expect } from 'vitest';
import { enLotes } from './lotes';

describe('enLotes — concurrencia acotada (REND-C1)', () => {
  it('nunca corren más de N a la vez, y el orden de salida es el de entrada', async () => {
    let vivos = 0, pico = 0;
    const r = await enLotes([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      vivos++; pico = Math.max(pico, vivos);
      await new Promise((res) => setTimeout(res, 5));
      vivos--;
      return n * 10;
    });
    expect(pico).toBeLessThanOrEqual(3);
    expect(r.map((x) => ('ok' in x ? x.ok : null))).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('un elemento que lanza no tumba el lote — su error viaja en su lugar', async () => {
    const r = await enLotes([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(r[0]).toEqual({ ok: 1 });
    expect('error' in r[1] && (r[1].error as Error).message).toBe('boom');
    expect(r[2]).toEqual({ ok: 3 });
  });

  it('vacío devuelve vacío; tamaño inválido truena ruidoso', async () => {
    expect(await enLotes([], 5, async (x) => x)).toEqual([]);
    await expect(enLotes([1], 0, async (x) => x)).rejects.toThrow('≥ 1');
  });
});

// ── conPool (ESC-1) ────────────────────────────────────────────────────────
describe('conPool', () => {
  it('mantiene el ancho ocupado: N en vuelo, no tandas que esperan al más lento', async () => {
    const { conPool } = await import('./lotes');
    let enVuelo = 0;
    let pico = 0;
    const duraciones = [30, 1, 1, 1, 1, 1];
    const r = await conPool(duraciones, 2, async (ms, i) => {
      enVuelo++;
      pico = Math.max(pico, enVuelo);
      await new Promise((res) => setTimeout(res, ms));
      enVuelo--;
      return i;
    });
    expect(pico).toBe(2);
    // Resultados EN ORDEN de entrada, aunque hayan terminado desordenados.
    expect(r).toEqual([0, 1, 2, 3, 4, 5].map((ok) => ({ ok })));
  });

  it('un elemento que lanza no tumba a los demás', async () => {
    const { conPool } = await import('./lotes');
    const r = await conPool([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(r[0]).toEqual({ ok: 1 });
    expect(r[1]).toHaveProperty('error');
    expect(r[2]).toEqual({ ok: 3 });
  });

  it('ancho 0 no se acepta: sería un pool que no avanza', async () => {
    const { conPool } = await import('./lotes');
    await expect(conPool([1], 0, async (n) => n)).rejects.toThrow(/ancho/);
  });
});
