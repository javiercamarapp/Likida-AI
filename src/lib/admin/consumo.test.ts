import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CONSUMO POR AGENTE — lo que se fija:
//  · Los INSIGHTS son reglas con dato: techo ≥80% = problema; fallos gastan;
//    habilitado-sin-techo = problema; y "lo que el panel NO ve" siempre se
//    dice. Una regla sin dato NO se dispara.
//  · Base caída LANZA — un panel de gasto vacío afirmaría "salió gratis".
//  · FE-8: el gasto sale de `consumo_agentes()` (mig. 0162), YA AGREGADO por
//    la base. Antes se leía `agente_corrida` con `.limit(5000)` y sin `order`
//    —o sea, las 1,000 filas arbitrarias a las que PostgREST recorta— y se
//    sumaba en JS. El mock de aquí responde por NOMBRE DE RPC a propósito:
//    una prueba que siguiera alimentando filas crudas describiría una lectura
//    que ya no existe.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();
/** Los `rpc(nombre, args)` que se pidieron — para fijar que no hay `.from`. */
let rpcs: Array<{ fn: string; args: unknown }> = [];
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
    rpc: (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      return {
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(respuestas.get(fn) ?? { data: [], error: null }).then(res, rej),
      };
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
let aislados: string[] = [];
vi.mock('@/lib/llm/openrouter', () => ({ modelosAisladosDeFallback: () => aislados }));

const { getConsumoPorAgente } = await import('./consumo');

const AHORA = Date.parse('2026-08-16T18:00:00Z');

beforeEach(() => { respuestas.clear(); aislados = []; rpcs = []; });

describe('las reglas, cada una con su dato', () => {
  it('agente al 80%+ del techo de HOY = problema, con las cifras citadas', async () => {
    respuestas.set('agente_definicion', { data: [{ id: 'redactor', nombre: 'Redactor', estado: 'vivo', runner_habilitado: true, presupuesto_dia_usd: 1 }], error: null });
    respuestas.set('consumo_agentes', { data: [{ agente: 'redactor', n: 1, fallos: 0, g30: 0.9, hoy: 0.9 }], error: null });
    const r = await getConsumoPorAgente(AHORA);
    expect(r.agentes[0].pctTechoHoy).toBe(90);
    const p = r.insights.find((i) => i.tipo === 'problema' && /techo/.test(i.titulo));
    expect(p?.titulo).toContain('90%');
    // El corte del día lo hace la BASE, no un `if` de JS: los dos instantes
    // viajan como argumentos y el subtotal de hoy llega ya calculado.
    expect(rpcs.map((r2) => r2.fn)).toEqual(['consumo_agentes']);
    expect(rpcs[0].args).toMatchObject({ p_desde: expect.any(String), p_inicio_hoy: expect.any(String) });
  });

  it('habilitado para el runner SIN techo = problema (el runner nace acotado)', async () => {
    respuestas.set('agente_definicion', { data: [{ id: 'x', nombre: 'X', estado: 'vivo', runner_habilitado: true, presupuesto_dia_usd: null }], error: null });
    const r = await getConsumoPorAgente(AHORA);
    expect(r.insights.some((i) => i.tipo === 'problema' && /SIN techo/i.test(i.titulo))).toBe(true);
  });

  it('los fallos se cuentan con el absoluto al lado, y modelos sin red de respaldo = recomendación', async () => {
    aislados = ['modelo/aislado'];
    respuestas.set('agente_definicion', { data: [{ id: 'a', nombre: 'A', estado: 'vivo', runner_habilitado: false, presupuesto_dia_usd: null }], error: null });
    respuestas.set('consumo_agentes', { data: [{ agente: 'a', n: 2, fallos: 1, g30: 0.02, hoy: 0 }], error: null });
    const r = await getConsumoPorAgente(AHORA);
    expect(r.insights.some((i) => /1 de 2 corridas en fallo/.test(i.titulo))).toBe(true);
    expect(r.insights.some((i) => i.tipo === 'recomendacion' && /sin red de respaldo/.test(i.titulo))).toBe(true);
  });

  it('lo que el panel NO ve se dice SIEMPRE (el copiloto va al log)', async () => {
    const r = await getConsumoPorAgente(AHORA);
    expect(r.insights.some((i) => /NO ve/.test(i.titulo))).toBe(true);
  });

  it('base caída LANZA — jamás "la IA salió gratis"', async () => {
    respuestas.set('consumo_agentes', { data: null, error: { message: 'db down' } });
    await expect(getConsumoPorAgente(AHORA)).rejects.toThrow(/db down/);
  });

  it('la 0162 sin aplicar (respuesta que no es arreglo) también LANZA, no pinta $0', async () => {
    respuestas.set('consumo_agentes', { data: null, error: null });
    await expect(getConsumoPorAgente(AHORA)).rejects.toThrow(/0162 sin aplicar/);
  });
});
