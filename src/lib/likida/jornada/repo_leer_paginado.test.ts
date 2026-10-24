import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S10-06 — `leerJornadas` ya no corta en 900 expedientes ni arma un `.in()` de 900 uuid (≈33 KB de URL).
// El doble implementa lo justo de PostgREST: filtros, orden, `range` y `in`, y registra el tamaño de cada `.in()`.

interface Dia { id: string; operador_id: string; dia: string; estado: string; cerrado_en: null; cerrado_por_email: null; conforme_operador_en: null; conforme_wa_message_id: null }
let expedientes: Dia[] = [];
const tamanosIn: number[] = [];

function constructor(tabla: string) {
  let lista: Array<Record<string, unknown>> = tabla === 'jornada_dia' ? [...expedientes] : [];
  let rango: [number, number] | null = null;
  let conCount = false;
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: (_c: string, o?: { count?: string }) => { conCount = o?.count === 'exact'; return b; },
    eq: () => b, gte: () => b, lte: () => b,
    order: () => b,
    in: (_c: string, ids: string[]) => { tamanosIn.push(ids.length); lista = lista.filter((f) => ids.includes(String(f.jornada_id))); return b; },
    range: (d: number, h: number) => { rango = [d, h]; return b; },
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      const total = lista.length;
      const filas = rango ? lista.slice(rango[0], rango[1] + 1) : lista;
      return Promise.resolve({ data: filas, error: null, count: conCount ? total : null }).then(res, rej);
    },
  });
  return b;
}

vi.mock('../presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerJornadas, TOPE_EXPEDIENTES, TOPE_EXPEDIENTES_EXPORTACION } = await import('./repo');

const hacer = (n: number): Dia[] => Array.from({ length: n }, (_, i) => ({
  id: `j-${String(i).padStart(5, '0')}`, operador_id: `op-${i % 40}`, dia: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  estado: 'abierto', cerrado_en: null, cerrado_por_email: null, conforme_operador_en: null, conforme_wa_message_id: null,
}));

beforeEach(() => { tamanosIn.length = 0; expedientes = []; });

describe('A37-S10-06: leerJornadas pagina expedientes y trocea los ids de asientos', () => {
  it('con tope de exportación lee más de 900 expedientes sin truncar', async () => {
    expedientes = hacer(2300);
    const r = await leerJornadas('t-1', '2026-09-01', '2026-09-30', null, { tope: TOPE_EXPEDIENTES_EXPORTACION });
    expect(r.dias).toHaveLength(2300);
    expect(r.truncada).toBe(false);
  });

  it('ningún .in() lleva más de 100 uuid (la URL de 900 uuid rebotaba en el gateway)', async () => {
    expedientes = hacer(1200);
    await leerJornadas('t-1', '2026-09-01', '2026-09-30', null, { tope: TOPE_EXPEDIENTES_EXPORTACION });
    expect(tamanosIn.length).toBeGreaterThan(0);
    expect(Math.max(...tamanosIn)).toBeLessThanOrEqual(100);
  });

  it('sin opciones el tope sigue siendo el del panel (900) y se DECLARA truncada si hay más', async () => {
    expedientes = hacer(TOPE_EXPEDIENTES + 50);
    const r = await leerJornadas('t-1', '2026-09-01', '2026-09-30');
    expect(r.dias).toHaveLength(TOPE_EXPEDIENTES);
    expect(r.truncada).toBe(true);
  });

  it('exactamente el tope NO es truncado (se pide una fila de más para demostrarlo)', async () => {
    expedientes = hacer(TOPE_EXPEDIENTES);
    const r = await leerJornadas('t-1', '2026-09-01', '2026-09-30');
    expect(r.dias).toHaveLength(TOPE_EXPEDIENTES);
    expect(r.truncada).toBe(false);
  });
});
