import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S11-02 — confirmar un acuse por id no puede confirmar uno NUEVO del chofer que el integrador nunca leyó.
// El doble implementa lo justo de PostgREST (select/in/eq/is/not/update) sobre una tabla en memoria.

interface Fila { id: string; tenant_id: string; acuse_en: string | null; acuse_confirmado_en: string | null }
let tabla: Fila[] = [];

function constructor() {
  let op: 'select' | 'update' = 'select';
  let cambios: Partial<Fila> = {};
  const filtros: Array<(f: Fila) => boolean> = [];
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    update: (c: Partial<Fila>) => { op = 'update'; cambios = c; return b; },
    eq: (c: keyof Fila, v: unknown) => { filtros.push((f) => f[c] === v); return b; },
    in: (c: keyof Fila, v: unknown[]) => { filtros.push((f) => v.includes(f[c])); return b; },
    is: (c: keyof Fila, v: null) => { filtros.push((f) => f[c] === v); return b; },
    not: (c: keyof Fila, _o: string, v: null) => { filtros.push((f) => f[c] !== v); return b; },
    order: () => b,
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      const af = tabla.filter((f) => filtros.every((p) => p(f)));
      if (op === 'update') for (const f of af) Object.assign(f, cambios);
      return Promise.resolve({ data: af.map((f) => ({ ...f })), error: null }).then(res, rej);
    },
  });
  return b;
}

vi.mock('../presupuesto', async (orig) => ({ ...(await orig<Record<string, unknown>>()), acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => constructor() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { confirmarAcuses } = await import('./repo');

const T = 't-1';
const A1 = '2026-10-02T10:00:00.000000+00:00';
const A2 = '2026-10-02T10:05:00.000000+00:00';
const AHORA = '2026-10-02T11:00:00.000Z';

beforeEach(() => { tabla = [{ id: 'x', tenant_id: T, acuse_en: A1, acuse_confirmado_en: null }]; });

describe('A37-S11-02: confirmarAcuses condicionado al acuse leído', () => {
  it('el integrador leyó A1, el chofer cambió a A2 y confirma [x]: NO se confirma, sale en `cambiaron` y el acuse vuelve a pendiente', async () => {
    const leidos = new Map([['x', A1]]);
    tabla[0].acuse_en = A2; // el chofer cambió su respuesta (acuse_en nuevo, confirmado = null)
    const r = await confirmarAcuses(T, ['x'], AHORA, leidos);
    expect(r).toEqual({ confirmadas: [], yaConfirmadas: [], noAplican: [], cambiaron: ['x'] });
    expect(tabla[0].acuse_confirmado_en).toBeNull();
  });

  it('el acuse leído sigue vigente: se confirma', async () => {
    const r = await confirmarAcuses(T, ['x'], AHORA, new Map([['x', A1]]));
    expect(r).toEqual({ confirmadas: ['x'], yaConfirmadas: [], noAplican: [], cambiaron: [] });
    expect(tabla[0].acuse_confirmado_en).toBe(AHORA);
  });

  it('sin `respuestaEn` (forma anterior, solo el id) se confirma lo vigente, como siempre', async () => {
    tabla[0].acuse_en = A2;
    const r = await confirmarAcuses(T, ['x'], AHORA);
    expect(r.confirmadas).toEqual(['x']);
    expect(r.cambiaron).toEqual([]);
  });

  it('un reintento sobre un acuse ya confirmado sigue siendo idempotente (yaConfirmadas)', async () => {
    tabla[0].acuse_confirmado_en = AHORA;
    const r = await confirmarAcuses(T, ['x'], AHORA, new Map([['x', A1]]));
    expect(r).toEqual({ confirmadas: [], yaConfirmadas: ['x'], noAplican: [], cambiaron: [] });
  });

  it('un id de otra flota cae en noAplican aunque traiga respuestaEn', async () => {
    const r = await confirmarAcuses('t-OTRA', ['x'], AHORA, new Map([['x', A1]]));
    expect(r.noAplican).toEqual(['x']);
    expect(tabla[0].acuse_confirmado_en).toBeNull();
  });
});
