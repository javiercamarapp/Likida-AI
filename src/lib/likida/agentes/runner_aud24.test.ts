import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, ARQ-2 / AGB-9 (ALTO, reincidente 22→23→24) — el techo de $/día
// de `atencion_faq` no cortaba cuando el proveedor omitía `usage`.
//
// `faq.ts` anota `costo_usd = NULL` (correcto: no inventa un costo) y
// `gastoDelDiaUsd` suma SOLO lo medido, así que 30 llamadas/día con el
// proveedor callado leían $0.00 contra $1.00 y el agente seguía redactando.
// Aquí se fija que, con UNA corrida de hoy sin medir, `atencion_faq` sale
// `saltado` con el motivo «NO MEDIDO» y no se le pregunta al modelo — el
// mismo candado que `contenido_fiscal` ya tenía y que la 22 y la 23 dieron
// por extendido sin extenderlo.
//
// Solo se mockea lo que la rama de éxito del cliente toca: la base, el
// interruptor y el motor de éxito (import dinámico en el runner).
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string } | null; count?: number }>>();
const consultas: string[] = [];
function builder(tabla: string) {
  const responder = () => {
    consultas.push(tabla);
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, not: () => b, gte: () => b, order: () => b,
    limit: () => b, range: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  from: (t: string) => builder(t),
  rpc: () => Promise.resolve({ data: true, error: null }),
}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/presupuesto')>()),
  acotada: (q: unknown) => q,
}));
vi.mock('../interruptores', () => ({
  INTERRUPTORES: ['global', 'agente:atencion_faq'],
  estaApagado: async () => false,
}));

const correrExito = vi.fn(async (..._a: unknown[]) => ({ resultado: 'corrio' as const, piezas: 1, costoUsd: 0.01 }));
vi.mock('./exito', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exito')>()),
  correrAgenteExito: (...a: unknown[]) => correrExito(...a),
}));

const { correrRunner } = await import('./runner');
const TENANT = 'tenant-aud24';
const FAQ = { id: 'atencion_faq', presupuesto_dia_usd: 1 };

beforeEach(() => {
  respuestas.clear();
  consultas.length = 0;
  correrExito.mockClear();
});

describe('ARQ-2/AGB-9 · atencion_faq: un costo NO MEDIDO no es cero', () => {
  it('con una corrida de hoy sin costo medido, se salta y el motivo lo dice — ni se le pregunta al modelo', async () => {
    respuestas.set('agente_definicion', [{ data: [FAQ], error: null }]);
    // 1ª consulta a agente_corrida: el CONTEO de corridas sin medir (head).
    // 2ª (no debería llegar): la suma de lo medido.
    respuestas.set('agente_corrida', [
      { data: null, error: null, count: 1 },
      { data: [{ costo_usd: 0.0 }], error: null },
    ]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.agentes[0]).toMatchObject({ agente: 'atencion_faq', resultado: 'saltado' });
    expect(r.agentes[0].motivo).toMatch(/NO MEDIDO/);
    // Se preguntó primero por lo que NO se pudo sumar; la suma no hizo falta.
    expect(consultas.filter((t) => t === 'agente_corrida')).toHaveLength(1);
  });

  it('sin corridas sin medir y bajo el techo, despacha (el candado no apaga al agente sano)', async () => {
    respuestas.set('agente_definicion', [{ data: [FAQ], error: null }]);
    respuestas.set('agente_corrida', [
      { data: null, error: null, count: 0 },
      { data: [{ costo_usd: 0.02 }], error: null },
    ]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).toHaveBeenCalledWith('atencion_faq', 'cron', undefined, undefined, expect.any(Number));
    expect(r.agentes[0].resultado).toBe('corrio');
  });

  it('sin corridas sin medir pero con el techo agotado, sigue cortando por techo', async () => {
    respuestas.set('agente_definicion', [{ data: [FAQ], error: null }]);
    respuestas.set('agente_corrida', [
      { data: null, error: null, count: 0 },
      { data: [{ costo_usd: 5 }], error: null },
    ]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/techo diario alcanzado/);
  });

  it('un conteo que PostgREST no devuelve es fail closed, no un 0 que nadie midió', async () => {
    respuestas.set('agente_definicion', [{ data: [FAQ], error: null }]);
    respuestas.set('agente_corrida', [{ data: [], error: null }]);   // sin `count`
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/fail closed/);
  });
});
