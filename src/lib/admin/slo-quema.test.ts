import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcs = new Map<string, { data: unknown; error: { message: string } | null }>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (_fn: string, args: { p_desde: string }) => {
      const r = rpcs.get(args.p_desde) ?? { data: null, error: { message: 'no mockeada' } };
      return Promise.resolve(r);
    },
  }),
}));
const AHORA = 1_755_000_000_000;
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => AHORA }));

const {
  SLOS_CON_PRESUPUESTO, REGLAS_QUEMA, VENTANA_MS, evaluarQuema, evaluacionSinLector, evaluarSlosEnQuema,
  presupuestoDe, quemaDe, NOTA_CALIBRACION,
} = await import('./slo-quema');

const def = SLOS_CON_PRESUPUESTO[0]; // objetivo 0.95 => presupuesto de error 5 %

/** n eventos con `malos` fallidos. */
const m = (total: number, malos: number) => ({ buenos: total - malos, total });

beforeEach(() => rpcs.clear());

describe('quemaDe / presupuestoDe', () => {
  it('quema = tasa de error observada / permitida', () => {
    expect(quemaDe(m(100, 5), 0.95)).toBeCloseTo(1);
    expect(quemaDe(m(100, 72), 0.95)).toBeCloseTo(14.4);
    expect(quemaDe(m(100, 0), 0.95)).toBe(0);
  });
  it('sin denominador suficiente o datos incoherentes: null, nunca 0', () => {
    expect(quemaDe(m(4, 4), 0.95)).toBeNull();
    expect(quemaDe(null, 0.95)).toBeNull();
    expect(quemaDe(undefined, 0.95)).toBeNull();
    expect(quemaDe({ buenos: 11, total: 10 }, 0.95)).toBeNull();
    expect(quemaDe({ buenos: NaN, total: 10 }, 0.95)).toBeNull();
    expect(quemaDe(m(100, 5), 1)).toBeNull();
    expect(quemaDe(m(100, 5), 0)).toBeNull();
  });
  it('presupuesto de 30 días: consumido, restante y agotado', () => {
    expect(presupuestoDe(m(200, 5), 0.95)).toEqual({ consumidoPct: 50, restantePct: 50, agotado: false });
    expect(presupuestoDe(m(200, 10), 0.95)).toEqual({ consumidoPct: 100, restantePct: 0, agotado: true });
    expect(presupuestoDe(m(200, 30), 0.95)?.restantePct).toBe(0);
    expect(presupuestoDe(m(3, 3), 0.95)).toBeNull();
  });
});

describe('reglas de quema en dos ventanas', () => {
  it('las ventanas y umbrales son los del plan', () => {
    expect(REGLAS_QUEMA.map((r) => [r.severidad, r.umbral, r.larga, r.corta])).toEqual([
      ['pagina', 14.4, '1h', '5m'], ['pagina', 6, '6h', '30m'], ['ticket', 1, '3d', '6h'],
    ]);
    expect(VENTANA_MS['1h']).toBe(3_600_000);
  });

  it('página rápida: exige AMBAS ventanas sobre 14.4', () => {
    const ev = evaluarQuema(def, { '1h': m(100, 80), '5m': m(10, 9) });
    expect(ev).toMatchObject({ nivel: 'pagina', regla: 'pagina_rapida' });
    // Larga alta pero la corta ya se recuperó: no página rápida.
    const rec = evaluarQuema(def, { '1h': m(100, 80), '5m': m(10, 0) });
    expect(rec.nivel).not.toBe('pagina');
  });

  it('página lenta (6 en 6 h y 30 min) y ticket (1 en 3 d y 6 h)', () => {
    expect(evaluarQuema(def, { '6h': m(100, 35), '30m': m(20, 7) })).toMatchObject({ nivel: 'pagina', regla: 'pagina_lenta' });
    expect(evaluarQuema(def, { '3d': m(100, 6), '6h': m(40, 3) })).toMatchObject({ nivel: 'ticket', regla: 'ticket_lento' });
  });

  it('la más grave gana', () => {
    const ev = evaluarQuema(def, { '1h': m(100, 80), '5m': m(10, 9), '3d': m(100, 6), '6h': m(40, 3) });
    expect(ev.regla).toBe('pagina_rapida');
  });

  it('evaluable y bajo el umbral: ninguna (no sin_medir)', () => {
    const ev = evaluarQuema(def, { '3d': m(100, 2), '6h': m(40, 1), '30d': m(300, 3) });
    expect(ev.nivel).toBe('ninguna');
    expect(ev.presupuesto?.agotado).toBe(false);
  });

  it('muestra insuficiente en una ventana: la regla no alerta ni tranquiliza', () => {
    const ev = evaluarQuema(def, { '3d': m(100, 50), '6h': m(2, 2) });
    expect(ev.nivel).toBe('sin_medir');
    expect(ev.razon).toMatch(/muestra suficiente/);
  });

  it('sin ninguna muestra: sin_medir con razón y nota de calibración', () => {
    const ev = evaluarQuema(def, {});
    expect(ev).toMatchObject({ nivel: 'sin_medir', presupuesto: null, nota: NOTA_CALIBRACION });
    expect(ev.razon).toBeTruthy();
    expect(Object.values(ev.quemas).every((q) => q === null)).toBe(true);
  });

  it('objetivo sin presupuesto (1) no divide entre cero', () => {
    expect(evaluarQuema({ ...def, objetivo: 1 }, { '1h': m(100, 50), '5m': m(10, 5) }).nivel).toBe('sin_medir');
  });
});

describe('lector y evaluación de los cinco SLO', () => {
  const desde = (v: keyof typeof VENTANA_MS) => new Date(AHORA - VENTANA_MS[v]).toISOString();

  it('son los cinco SLO de la guardia y los cuatro sin historial salen sin_medir con su porqué', async () => {
    expect(SLOS_CON_PRESUPUESTO.map((s) => s.clave)).toEqual(['agentes_exito', 'agentes_p95', 'wa_inbox', 'stripe_sellado', 'bus_ordenes']);
    const ev = evaluacionSinLector(SLOS_CON_PRESUPUESTO[2]);
    expect(ev).toMatchObject({ nivel: 'sin_medir', presupuesto: null });
    expect(ev.razon).toMatch(/historial/);
  });

  it('lee una ventana por llamada y evalúa agentes_exito', async () => {
    for (const v of Object.keys(VENTANA_MS) as Array<keyof typeof VENTANA_MS>) {
      const malos = v === '1h' || v === '5m' ? 9 : 0;
      rpcs.set(desde(v), { data: { total: 10, ok: 10 - malos, medibles: 10, p95Segundos: 5 }, error: null });
    }
    const evs = await evaluarSlosEnQuema();
    const exito = evs.find((e) => e.clave === 'agentes_exito')!;
    expect(exito).toMatchObject({ nivel: 'pagina', regla: 'pagina_rapida' });
    expect(evs.filter((e) => e.nivel === 'sin_medir').map((e) => e.clave)).toEqual(['agentes_p95', 'wa_inbox', 'stripe_sellado', 'bus_ordenes']);
  });

  it('falla cerrada: si la base falla, sin_medir y lo dice (no cero)', async () => {
    const evs = await evaluarSlosEnQuema();
    const exito = evs.find((e) => e.clave === 'agentes_exito')!;
    expect(exito.nivel).toBe('sin_medir');
    expect(exito.razon).toMatch(/no se pudo leer/);
  });

  it('una ventana con error no contamina las demás', async () => {
    for (const v of ['3d', '6h', '30d'] as const) rpcs.set(desde(v), { data: { total: 100, ok: 94, medibles: 100, p95Segundos: 1 }, error: null });
    const exito = (await evaluarSlosEnQuema()).find((e) => e.clave === 'agentes_exito')!;
    expect(exito.nivel).toBe('ticket'); // 6 % de error / 5 % permitido = 1.2 en 3 d y 6 h
  });
});
