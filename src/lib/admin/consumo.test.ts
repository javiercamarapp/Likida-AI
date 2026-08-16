import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CONSUMO POR AGENTE — lo que se fija:
//  · Los INSIGHTS son reglas con dato: techo ≥80% = problema; fallos gastan;
//    habilitado-sin-techo = problema; y "lo que el panel NO ve" siempre se
//    dice. Una regla sin dato NO se dispara.
//  · Base caída LANZA — un panel de gasto vacío afirmaría "salió gratis".
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, order: () => b, gte: () => b, limit: () => b,
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(respuestas.get(t) ?? { data: [], error: null }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
let aislados: string[] = [];
vi.mock('@/lib/llm/openrouter', () => ({ modelosAisladosDeFallback: () => aislados }));

const { getConsumoPorAgente } = await import('./consumo');

const AHORA = Date.parse('2026-08-16T18:00:00Z');
const hoy = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

beforeEach(() => { respuestas.clear(); aislados = []; });

describe('las reglas, cada una con su dato', () => {
  it('agente al 80%+ del techo de HOY = problema, con las cifras citadas', async () => {
    respuestas.set('agente_definicion', { data: [{ id: 'redactor', nombre: 'Redactor', estado: 'vivo', runner_habilitado: true, presupuesto_dia_usd: 1 }], error: null });
    respuestas.set('agente_corrida', { data: [{ agente: 'redactor', estado: 'ok', inicio: hoy(1), costo_usd: 0.9 }], error: null });
    const r = await getConsumoPorAgente(AHORA);
    expect(r.agentes[0].pctTechoHoy).toBe(90);
    const p = r.insights.find((i) => i.tipo === 'problema' && /techo/.test(i.titulo));
    expect(p?.titulo).toContain('90%');
  });

  it('habilitado para el runner SIN techo = problema (el runner nace acotado)', async () => {
    respuestas.set('agente_definicion', { data: [{ id: 'x', nombre: 'X', estado: 'vivo', runner_habilitado: true, presupuesto_dia_usd: null }], error: null });
    const r = await getConsumoPorAgente(AHORA);
    expect(r.insights.some((i) => i.tipo === 'problema' && /SIN techo/i.test(i.titulo))).toBe(true);
  });

  it('los fallos se cuentan con el absoluto al lado, y modelos sin red de respaldo = recomendación', async () => {
    aislados = ['modelo/aislado'];
    respuestas.set('agente_definicion', { data: [{ id: 'a', nombre: 'A', estado: 'vivo', runner_habilitado: false, presupuesto_dia_usd: null }], error: null });
    respuestas.set('agente_corrida', { data: [
      { agente: 'a', estado: 'ok', inicio: hoy(30), costo_usd: 0.01 },
      { agente: 'a', estado: 'fallo', inicio: hoy(29), costo_usd: 0.01 },
    ], error: null });
    const r = await getConsumoPorAgente(AHORA);
    expect(r.insights.some((i) => /1 de 2 corridas en fallo/.test(i.titulo))).toBe(true);
    expect(r.insights.some((i) => i.tipo === 'recomendacion' && /sin red de respaldo/.test(i.titulo))).toBe(true);
  });

  it('lo que el panel NO ve se dice SIEMPRE (el copiloto va al log)', async () => {
    const r = await getConsumoPorAgente(AHORA);
    expect(r.insights.some((i) => /NO ve/.test(i.titulo))).toBe(true);
  });

  it('base caída LANZA — jamás "la IA salió gratis"', async () => {
    respuestas.set('agente_corrida', { data: null, error: { message: 'db down' } });
    await expect(getConsumoPorAgente(AHORA)).rejects.toThrow();
  });
});
