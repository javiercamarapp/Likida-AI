import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S56-08: el combo de unidades de despacho armaba `.not('id','in',(todos
// los ids ocupados))` tras releer TODOS los viajes abiertos en cada tecla. En
// una flota de 250 camiones casi todos ocupados, la URL pasaba de 9 KB. Ahora
// se pagina el catálogo y, por página, se pregunta cuáles de ESOS ids (≤100)
// tienen viaje abierto: ninguna lista de ids crece con la flota.

type Resp = { data: unknown[] | null; error: { message: string } | null };
const d = vi.hoisted(() => ({
  unidades: [] as Array<{ id: string; numero_economico: string }>,
  ocupadas: new Set<string>(),
  llamadas: [] as Array<{ tabla: string; ops: Array<[string, ...unknown[]]> }>,
  falla: null as string | null,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const ll = { tabla, ops: [] as Array<[string, ...unknown[]]> };
      d.llamadas.push(ll);
      const op = (n: string) => ll.ops.find((o) => o[0] === n);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not', 'ilike', 'order', 'limit', 'range']) {
        b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
      }
      b.then = (res: (v: unknown) => unknown) => {
        if (d.falla) return res({ data: null, error: { message: d.falla } } satisfies Resp);
        if (tabla === 'unidad') {
          const [desde, hasta] = (op('range')?.slice(1) as [number, number]) ?? [0, 19];
          return res({ data: d.unidades.slice(desde, hasta + 1), error: null } satisfies Resp);
        }
        const ids = (op('in') && ll.ops.filter((o) => o[0] === 'in' && o[1] === 'unidad_id')[0]?.[2]) as string[] | undefined;
        return res({ data: (ids ?? []).filter((i) => d.ocupadas.has(i)).map((i) => ({ unidad_id: i })), error: null } satisfies Resp);
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buscarCatalogo, TOPE_CATALOGO } from './repo';

const flota = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u-${String(i).padStart(3, '0')}`, numero_economico: `T-${i}` }));
beforeEach(() => {
  d.llamadas.length = 0; d.ocupadas = new Set(); d.falla = null; d.unidades = flota(5);
});

describe('buscarCatalogo(unidad) — sin listas de ids por la URL (A37-S56-08)', () => {
  it('excluye las unidades con viaje abierto y NUNCA manda `.not(id, in, …)`', async () => {
    d.ocupadas = new Set(['u-001', 'u-003']);
    const r = await buscarCatalogo('t-1', 'unidad');
    expect(r.map((o) => o.id)).toEqual(['u-000', 'u-002', 'u-004']);
    expect(d.llamadas.flatMap((l) => l.ops).some((o) => o[0] === 'not')).toBe(false);
  });

  it('flota grande casi toda ocupada: ninguna petición lleva más de 100 ids y encuentra las libres', async () => {
    d.unidades = flota(300);
    d.ocupadas = new Set(d.unidades.filter((u) => u.id !== 'u-250' && u.id !== 'u-299').map((u) => u.id));
    const r = await buscarCatalogo('t-1', 'unidad');
    expect(r.map((o) => o.id)).toEqual(['u-250', 'u-299']);
    for (const l of d.llamadas) {
      for (const o of l.ops) if (o[0] === 'in' && o[1] === 'unidad_id') expect((o[2] as string[]).length).toBeLessThanOrEqual(100);
    }
  });

  it('se detiene al juntar el tope del combo sin leer toda la flota', async () => {
    d.unidades = flota(1_000);
    const r = await buscarCatalogo('t-1', 'unidad');
    expect(r).toHaveLength(TOPE_CATALOGO);
    expect(d.llamadas.filter((l) => l.tabla === 'unidad')).toHaveLength(1);
  });

  it('conserva el filtro por texto, el orden por numero_economico con desempate por id y el tenant', async () => {
    await buscarCatalogo('t-1', 'unidad', 'T-0');
    const u = d.llamadas.find((l) => l.tabla === 'unidad')!;
    expect(u.ops).toContainEqual(['eq', 'tenant_id', 't-1']);
    expect(u.ops).toContainEqual(['eq', 'activo', true]);
    expect(u.ops).toContainEqual(['ilike', 'numero_economico', '%T-0%']);
    expect(u.ops.filter((o) => o[0] === 'order').map((o) => o[1])).toEqual(['numero_economico', 'id']);
    const v = d.llamadas.find((l) => l.tabla === 'viaje')!;
    expect(v.ops).toContainEqual(['eq', 'tenant_id', 't-1']);
    expect(v.ops).toContainEqual(['in', 'estatus', ['abierto', 'en_cuadre']]);
  });

  it('si la lectura de viajes falla, LANZA (un combo vacío por error se leería como "no hay unidades")', async () => {
    d.falla = 'timeout';
    await expect(buscarCatalogo('t-1', 'unidad')).rejects.toThrow('timeout');
  });
});
