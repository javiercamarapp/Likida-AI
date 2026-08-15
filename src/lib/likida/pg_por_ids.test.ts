// ═══════════════════════════════════════════════════════════════════════════
// `traerPorIds` — el `.in('id', ids)` sin techo silencioso (auditoría de
// escala 15k, docs/escala-15k.md §2). Un `.in()` de miles de ids se recorta a
// `max_rows` igual que cualquier select, y además viaja en la URL. El helper
// parte en tandas de IDS_POR_TANDA para que ninguna pueda tocar ninguno de
// los dos techos.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { traerPorIds, IDS_POR_TANDA } = await import('./pg');

describe('traerPorIds — tandas que no tocan el recorte de 1,000', () => {
  it('con menos ids que una tanda hace UNA sola llamada', async () => {
    const llamadas: string[][] = [];
    const filas = await traerPorIds(
      ['a', 'b', 'c'],
      (tanda) => { llamadas.push(tanda); return Promise.resolve({ data: tanda.map((id) => ({ id })), error: null }); },
      'prueba',
    );
    expect(llamadas).toEqual([['a', 'b', 'c']]);
    expect(filas).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('parte en tandas de IDS_POR_TANDA y ninguna llamada lleva más', async () => {
    const ids = Array.from({ length: IDS_POR_TANDA * 2 + 7 }, (_, i) => `id-${i}`);
    const llamadas: number[] = [];
    const filas = await traerPorIds(
      ids,
      (tanda) => { llamadas.push(tanda.length); return Promise.resolve({ data: tanda.map((id) => ({ id })), error: null }); },
      'prueba',
    );
    expect(llamadas.reduce((s, n) => s + n, 0)).toBe(ids.length);
    expect(Math.max(...llamadas)).toBeLessThanOrEqual(IDS_POR_TANDA);
    expect(llamadas).toHaveLength(3);
    expect(filas).toHaveLength(ids.length);
  });

  it('conserva el orden de las tandas aunque la red conteste desordenada', async () => {
    const ids = Array.from({ length: IDS_POR_TANDA + 1 }, (_, i) => `id-${i}`);
    // La primera tanda tarda MÁS que la segunda: sin el ensamblado por índice,
    // el resultado saldría con la tanda 2 antes que la 1.
    let primera = true;
    const filas = await traerPorIds<{ id: string }>(
      ids,
      (tanda) => {
        const demora = primera ? 20 : 0;
        primera = false;
        return new Promise((res) => setTimeout(
          () => res({ data: tanda.map((id) => ({ id })), error: null }), demora,
        ));
      },
      'prueba',
    );
    expect(filas.map((f) => f.id)).toEqual(ids);
  });

  it('un error en CUALQUIER tanda lanza — nunca un resultado parcial mudo', async () => {
    const ids = Array.from({ length: IDS_POR_TANDA + 1 }, (_, i) => `id-${i}`);
    let n = 0;
    await expect(traerPorIds(
      ids,
      () => Promise.resolve(n++ === 0
        ? { data: [], error: null }
        : { data: null, error: { message: 'se cayó la base' } }),
      'prueba',
    )).rejects.toThrow(/se cayó la base/);
  });

  it('con cero ids no llama a la base', async () => {
    const construir = vi.fn();
    const filas = await traerPorIds([], construir, 'prueba');
    expect(filas).toEqual([]);
    expect(construir).not.toHaveBeenCalled();
  });
});
