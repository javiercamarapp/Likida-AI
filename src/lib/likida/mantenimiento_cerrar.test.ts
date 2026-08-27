import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA FABLE CICLO 3 (c3-3, segunda mitad) — cerrar una orden con la
// lectura fresca del tablero AVANZA el odómetro declarado de la unidad.
//
// Sin esto, el flujo normal (cerrar con km real > km capturado en la forma de
// unidades) dejaba el reloj de la rutina contradictorio para el siguiente
// ciclo. El avance es solo hacia adelante: un odómetro jamás retrocede por
// cerrar una orden con un km viejo.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string } | null };
let respuestas: Record<string, Resp>;
let escrituras: Array<{ tabla: string; payload: unknown; ors: string[] }>;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let payload: unknown = null;
      const ors: string[] = [];
      const responder = (): Resp => {
        escrituras.push({ tabla, payload, ors });
        const r = respuestas[tabla];
        if (!r) throw new Error(`sin respuesta preparada para ${tabla}`);
        return r;
      };
      const b = {
        update: (fila: unknown) => { payload = fila; return b; },
        select: () => b,
        eq: () => b,
        neq: () => b,
        or: (arg: string) => { ors.push(arg); return b; },
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) => {
          try { return Promise.resolve(responder()).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej); }
        },
      };
      return b;
    },
  }),
}));
vi.mock('./presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { cerrarOrden } = await import('./mantenimiento');

beforeEach(() => {
  vi.clearAllMocks();
  respuestas = {};
  escrituras = [];
});

describe('cerrarOrden — el odómetro avanza con la lectura del cierre', () => {
  it('con km del servicio, adelanta unidad.km_actual (solo hacia adelante, por el WHERE)', async () => {
    respuestas['mantenimiento'] = { data: [{ id: 'm1', unidad_id: 'u-77' }], error: null };
    respuestas['unidad'] = { data: null, error: null };
    await cerrarOrden('t1', 'm1', 130_000);
    const avance = escrituras.find((e) => e.tabla === 'unidad');
    expect(avance?.payload).toEqual({ km_actual: 130_000 });
    // El candado de "solo hacia adelante" viaja en la consulta misma.
    expect(avance?.ors).toContainEqual('km_actual.is.null,km_actual.lt.130000');
  });

  it('sin km declarado (null), la unidad NO se toca — un km que no se midió no avanza nada', async () => {
    respuestas['mantenimiento'] = { data: [{ id: 'm1', unidad_id: 'u-77' }], error: null };
    await cerrarOrden('t1', 'm1', null);
    expect(escrituras.some((e) => e.tabla === 'unidad')).toBe(false);
  });

  it('si el avance falla, la orden queda cerrada igual y la falla queda en el log', async () => {
    respuestas['mantenimiento'] = { data: [{ id: 'm1', unidad_id: 'u-77' }], error: null };
    respuestas['unidad'] = { data: null, error: { message: 'timeout' } };
    await expect(cerrarOrden('t1', 'm1', 130_000)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('mantenimiento.odometro_no_avanzo', expect.objectContaining({ orden: 'm1' }));
  });
});
