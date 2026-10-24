import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S27-02 — `getPorCobrar()` solo trae las 50 más recientes (es la lista de
// una pantalla). Quien REPORTA cifras (cobranza, finanzas, copiloto) necesita
// TODAS las pendientes o fallidas, y si la base tiene más de las que se leen
// no puede afirmar un total: falla cerrado.

let respuesta: { data: unknown; error: { message: string } | null; count: number | null } = { data: [], error: null, count: 0 };
const limites: number[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, in: () => b, order: () => b,
      limit: (n: number) => { limites.push(n); return b; },
      then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respuesta).then(res, rej),
    });
    return { from: () => b };
  },
}));

const { getPorCobrar, getPorCobrarCompleto } = await import('./transferencia');

const fila = (n: number) => ({
  id: `f-${n}`, tenant_id: 't', periodo_inicio: '2026-01-01', periodo_fin: '2026-01-31',
  monto: 100, subtotal: 86.21, iva: 13.79, moneda: 'MXN', estado: 'pendiente', referencia: `R${n}`, cfdi_uuid: null,
  tenant: { nombre: 'Flota' },
});

beforeEach(() => { limites.length = 0; });

describe('getPorCobrarCompleto', () => {
  it('lee con el techo grande, no con 50, y devuelve todas', async () => {
    respuesta = { data: Array.from({ length: 70 }, (_, i) => fila(i)), error: null, count: 70 };
    const r = await getPorCobrarCompleto();
    expect(r).toHaveLength(70);
    expect(limites.at(-1)).toBeGreaterThan(50);
  });

  it('getPorCobrar sigue siendo la página de 50 de la pantalla', async () => {
    respuesta = { data: [fila(1)], error: null, count: 1 };
    await getPorCobrar();
    expect(limites.at(-1)).toBe(50);
  });

  it('si la base tiene más de las que se leyeron, LANZA en vez de reportar un total parcial', async () => {
    respuesta = { data: Array.from({ length: 70 }, (_, i) => fila(i)), error: null, count: 5000 };
    await expect(getPorCobrarCompleto()).rejects.toThrow(/5000 facturas/);
  });

  it('un error de lectura lanza', async () => {
    respuesta = { data: null, error: { message: 'base caída' }, count: null };
    await expect(getPorCobrarCompleto()).rejects.toThrow(/base caída/);
  });
});
