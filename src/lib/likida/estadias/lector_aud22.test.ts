import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · PRU-A3 (ALTO) — la perilla de dinero de las estadías se leía
// por un camino al 2.4% de cobertura.
//
// `politicasDetencion` reparte los pactos declarados en dos cubetas: el de la
// FLOTA (`cliente_id === null`) y el de cada CLIENTE. De esa separación depende
// cuántos pesos se le cobran a quién por hora de detención, y no había una sola
// prueba que la ejerciera: el pacto de un cliente se podía tomar como el de la
// flota —o al revés— sin que nada enrojeciera.
//
// La mutación que sobrevivía: invertir el `if` de `cliente_id === null`.
// ═══════════════════════════════════════════════════════════════════════════

let filas: Array<Record<string, unknown>> = [];
vi.mock('@/lib/likida/pg', () => ({
  traerTodo: async () => filas,
  conteo: () => ({}),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (p: unknown) => p }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: () => ({}) }) }) }) }),
  }),
}));

const { politicasDetencion } = await import('./lector');

beforeEach(() => { filas = []; });

describe('PRU-A3: el pacto de la flota y el del cliente no se confunden', () => {
  it('`cliente_id === null` es el de la FLOTA; los demás van por cliente', async () => {
    filas = [
      { cliente_id: null, horas_libres: 2, tarifa_hora: 350, moneda: 'MXN' },
      { cliente_id: 'c-1', horas_libres: 6, tarifa_hora: 900, moneda: 'MXN' },
    ];
    const r = await politicasDetencion('t-1');

    // Si el `if` se invirtiera, estas cuatro aserciones cruzarían los montos:
    // $900/hora facturados como si fueran los $350 del pacto general.
    expect(r.flota?.tarifaHora).toBe(350);
    expect(r.flota?.horasLibres).toBe(2);
    expect(r.porCliente.get('c-1')?.tarifaHora).toBe(900);
    expect(r.porCliente.get('c-1')?.horasLibres).toBe(6);
    expect(r.porCliente.has('null')).toBe(false);
  });

  it('sin pacto de flota, `flota` es null — no se hereda el de un cliente', async () => {
    filas = [{ cliente_id: 'c-1', horas_libres: 6, tarifa_hora: 900, moneda: 'MXN' }];
    const r = await politicasDetencion('t-1');
    // Heredar aquí le cobraría a TODOS los clientes la tarifa pactada con uno.
    expect(r.flota).toBeNull();
    expect(r.porCliente.size).toBe(1);
  });

  it('varios clientes conservan cada quien su tarifa', async () => {
    filas = [
      { cliente_id: 'c-1', horas_libres: 6, tarifa_hora: 900, moneda: 'MXN' },
      { cliente_id: 'c-2', horas_libres: 4, tarifa_hora: 1200, moneda: 'MXN' },
    ];
    const r = await politicasDetencion('t-1');
    expect(r.porCliente.get('c-1')?.tarifaHora).toBe(900);
    expect(r.porCliente.get('c-2')?.tarifaHora).toBe(1200);
  });

  it('la moneda declarada se conserva, y sin ella el default es MXN', async () => {
    filas = [
      { cliente_id: null, horas_libres: 2, tarifa_hora: 350, moneda: null },
      { cliente_id: 'c-usd', horas_libres: 2, tarifa_hora: 50, moneda: 'USD' },
    ];
    const r = await politicasDetencion('t-1');
    expect(r.flota?.moneda).toBe('MXN');
    // Una tarifa en USD cobrada como MXN es un factor de ~17 en la factura.
    expect(r.porCliente.get('c-usd')?.moneda).toBe('USD');
  });
});
