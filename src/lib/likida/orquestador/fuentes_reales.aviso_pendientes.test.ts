import { describe, expect, it, vi } from 'vitest';

// R09-4: la lista de tareas con aviso pendiente no la acapara una sola flota. El cliente de Supabase es un doble que
// entrega la «tabla» por páginas según el `range` pedido.
type Fila = { tenant_id: string; id: string };
let tabla: Fila[] = [];
const rangos: Array<[number, number]> = [];
function cadena(): unknown {
  let rango: [number, number] = [0, 9999];
  const p: unknown = new Proxy(function () { /* encadenable */ }, {
    get: (_t, k) => {
      if (k === 'range') return (a: number, b: number) => { rango = [a, b]; rangos.push([a, b]); return p; };
      if (k === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabla.slice(rango[0], rango[1] + 1), error: null }).then(ok);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => cadena(), rpc: () => cadena() }) }));

const { puertoCicloVivoReal } = await import('./fuentes_reales');
const { TOPE_AVISOS_POR_FLOTA_Y_CORRIDA } = await import('./aviso_escalacion');

describe('pendientesDeAviso: ninguna flota acapara la corrida', () => {
  it('una flota con 100 pendientes (las más viejas) no deja sin aviso a las demás: cada flota aporta a lo más su tope', async () => {
    tabla = [
      ...Array.from({ length: 100 }, (_, i) => ({ tenant_id: 'acaparadora', id: `a${String(i).padStart(3, '0')}` })),
      { tenant_id: 'otra-1', id: 'o1' }, { tenant_id: 'otra-2', id: 'o2' },
    ];
    const r = (await puertoCicloVivoReal().pendientesDeAviso(40))!;
    expect(r.filter((x) => x.tenantId === 'acaparadora')).toHaveLength(TOPE_AVISOS_POR_FLOTA_Y_CORRIDA);
    expect(r.map((x) => x.id)).toEqual(expect.arrayContaining(['o1', 'o2']));
    expect(r.length).toBeLessThanOrEqual(40);
    expect(r[0].id).toBe('a000'); // las más viejas primero se conservan
  });

  it('con pocas pendientes lee una sola página y devuelve todo', async () => {
    rangos.length = 0;
    tabla = [{ tenant_id: 'f', id: 'x1' }, { tenant_id: 'g', id: 'x2' }];
    expect(await puertoCicloVivoReal().pendientesDeAviso(40)).toEqual([{ tenantId: 'f', id: 'x1' }, { tenantId: 'g', id: 'x2' }]);
    expect(rangos).toEqual([[0, 199]]);
  });
});
