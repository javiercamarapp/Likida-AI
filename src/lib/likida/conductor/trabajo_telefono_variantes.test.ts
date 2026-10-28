import { describe, it, expect, vi } from 'vitest';

// Bajo de la ola 8: `esVoluntarioDePiloto` (y las otras dos lecturas por teléfono del puerto de envío) comparaban el teléfono con IGUALDAD EXACTA.
// El mismo celular llega como 52… o 521… según por dónde entre: un voluntario real no se reconocía (y un chofer con emergencia abierta tampoco).
const inArgs: Array<[string, unknown[]]> = [];
let filas: Array<Record<string, unknown>> = [];
function consulta() {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, eq: () => q, order: () => q, limit: () => q,
    in: (c: string, v: unknown[]) => { inArgs.push([c, v]); return q; },
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(res, rej),
  });
  return q;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => consulta() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: <T,>(q: T) => q }));

const { esVoluntarioDePiloto } = await import('./trabajo');

describe('esVoluntarioDePiloto normaliza el teléfono', () => {
  it('pregunta por TODAS las formas del mismo número (52…, 521…, con y sin +, nacional)', async () => {
    inArgs.length = 0;
    filas = [{ agente_voluntario: true, activo: true }];
    expect(await esVoluntarioDePiloto('t1', '5219991234567')).toBe(true);
    const [col, vals] = inArgs[0];
    expect(col).toBe('telefono');
    expect(vals).toEqual(expect.arrayContaining(['5219991234567', '529991234567', '+529991234567', '9991234567']));
  });
  it('sigue fail-closed: sin operador voluntario vigente es false', async () => {
    filas = [{ agente_voluntario: false, activo: true }];
    expect(await esVoluntarioDePiloto('t1', '529991234567')).toBe(false);
  });
});
