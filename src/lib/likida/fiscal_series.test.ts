// ═══════════════════════════════════════════════════════════════════════════
// `getGastosFiscalesSeries` — las 3 ventanas que "En riesgo/perdido" y
// "Recuperable pidiendo factura" ciclan con sus flechas ‹ › en el Resumen
// del dueño (`MotorFiscalPeriodo`, 8-ago-2026). Lo que se prueba: los
// límites de fecha que viajan a la RPC `gastos_fiscales_agregados_tenant`
// (mig. 0151) en cada ventana, y que la config del tenant se lee UNA vez.
// `resumirPerdidas` está cubierta en `fiscal.test.ts`; la equivalencia
// celdas-vs-filas en `fiscal_agregado.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
let lecturasConfig = 0;
/** `fn:p_desde` → el error que esa llamada debe devolver. Las demás van bien. */
let fallar: Record<string, { message: string }> = {};
/** `fn:p_desde` → cuántos ms tarda esa llamada en romper. */
let retardos: Record<string, number> = {};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      const error = fallar[`${fn}:${String(args.p_desde)}`];
      // El retardo lo fija cada caso: es lo que hace la prueba
      // DISCRIMINANTE. Con `Promise.all`, la ventana lenta rompe cuando la
      // función ya se rindió con la rápida, y su causa nunca sale en el
      // mensaje; con `allSettled` sí.
      const ms = error ? (retardos[`${fn}:${String(args.p_desde)}`] ?? 0) : 0;
      return new Promise((resolver) => setTimeout(() => resolver(error ? { data: null, error } : { data: [], error: null }), ms));
    },
  }),
}));
vi.mock('./config', async (orig) => {
  const real = await orig<typeof import('./config')>();
  return { ...real, getConfig: async () => { lecturasConfig += 1; return real.DEMO_CONFIG; } };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getGastosFiscalesSeries } = await import('./fiscal');

beforeEach(() => { fallar = {}; retardos = {}; llamadas.length = 0; });

describe('getGastosFiscalesSeries', () => {
  it('semanal pide los últimos 7 días (desde=hoy-6, hasta=hoy)', async () => {
    llamadas.length = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    expect(llamadas[0].fn).toBe('gastos_fiscales_agregados_tenant');
    expect(llamadas[0].args.p_desde).toBe('2026-08-02');
    expect(llamadas[0].args.p_hasta).toBe('2026-08-08');
  });

  it('mensual pide los últimos 30 días (desde=hoy-29, hasta=hoy)', async () => {
    llamadas.length = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    expect(llamadas[1].args.p_desde).toBe('2026-07-10');
    expect(llamadas[1].args.p_hasta).toBe('2026-08-08');
  });

  it('histórico no manda cota — y ya no cuesta la tabla entera: son celdas', async () => {
    llamadas.length = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    expect(llamadas[2].args.p_desde).toBeNull();
    expect(llamadas[2].args.p_hasta).toBeNull();
  });

  it('las tres llamadas van con el MISMO tenant, tope y cortes; la config se lee una vez', async () => {
    llamadas.length = 0; lecturasConfig = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    expect(lecturasConfig).toBe(1);
    for (const l of llamadas) {
      expect(l.args.p_tenant).toBe('t1');
      expect(l.args.p_tope_efectivo).toBe(llamadas[0].args.p_tope_efectivo);
      expect(l.args.p_cortes).toEqual(llamadas[0].args.p_cortes);
    }
  });

  it('devuelve las 3 llaves, cada una un arreglo (aunque venga vacío)', async () => {
    const r = await getGastosFiscalesSeries('t1', '2026-08-08');
    expect(r).toHaveProperty('semanal');
    expect(r).toHaveProperty('mensual');
    expect(r).toHaveProperty('historico');
    expect(Array.isArray(r.historico)).toBe(true);
  });
});

describe('getGastosFiscalesSeries — falla en bloque, sin rechazos sueltos (FE-4)', () => {
  it('si una ventana rompe, LANZA nombrándola — nunca un [] que se lee como "$0 en riesgo"', async () => {
    fallar = { 'gastos_fiscales_agregados_tenant:null': { message: 'timeout de la vista histórica' } };
    await expect(getGastosFiscalesSeries('t1', '2026-08-08')).rejects.toThrow(/historico.*timeout de la vista histórica/);
  });

  it('espera a las TRES: la causa de la ventana LENTA no se pierde tras la rápida', async () => {
    // Con `Promise.all` el mensaje traería solo el timeout de la semanal —el
    // síntoma— y la causa real (la histórica, más lenta) se perdería.
    fallar = {
      'gastos_fiscales_agregados_tenant:2026-08-02': { message: 'timeout de red' },
      'gastos_fiscales_agregados_tenant:null': { message: 'function gastos_fiscales_agregados_tenant does not exist' },
    };
    retardos = { 'gastos_fiscales_agregados_tenant:2026-08-02': 1, 'gastos_fiscales_agregados_tenant:null': 25 };
    const err = await getGastosFiscalesSeries('t1', '2026-08-08').catch((e: Error) => e);
    expect(String(err)).toMatch(/semanal \(getGastosFiscales: timeout de red\)/);
    expect(String(err)).toMatch(/historico \(getGastosFiscales: function gastos_fiscales_agregados_tenant does not exist\)/);
    // Las tres llamadas se hicieron y las tres se esperaron.
    expect(llamadas.filter((l) => l.fn === 'gastos_fiscales_agregados_tenant')).toHaveLength(3);
  });
});
