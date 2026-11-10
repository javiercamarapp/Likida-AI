import { beforeEach, describe, expect, it, vi } from 'vitest';

// La lista completa de facturas de la mensualidad (pestaña «Facturas»): lee TODO estado, ordena con desempate, filtra por estado y
// periodo, y una base caída LANZA (nunca «ninguna factura»). `truncado` delata que la base tiene más de lo leído.
let respuesta: { data: unknown; error: { message: string } | null; count: number | null } = { data: [], error: null, count: 0 };
const llamadas: Array<[string, ...unknown[]]> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) b[m] = (...a: unknown[]) => { llamadas.push([m, ...a]); return b; };
    b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respuesta).then(res, rej);
    return { from: () => b };
  },
}));
const { listarFacturasSaas, TECHO_FACTURAS_SAAS } = await import('./transferencia');

const fila = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `f-${n}`, tenant_id: 't', periodo_inicio: '2026-10-01', periodo_fin: '2026-10-31', monto: '17500', subtotal: null, iva: null, moneda: 'MXN',
  estado: 'pendiente', referencia: 'R', metodo_cobro: 'transferencia', referencia_banco: null, pagada_en: null, conciliada_en: null, cfdi_uuid: null,
  timbrada_en: null, cfdi_cancelado_en: null, cfdi_xml_url: null, cfdi_verificacion_url: null, creada_en: '2026-10-31T00:00:00Z', tenant: { nombre: 'Flota' }, ...extra,
});

beforeEach(() => { llamadas.length = 0; });

describe('listarFacturasSaas', () => {
  it('mapea sin inventar: lo que no existe es null, no 0', async () => {
    respuesta = { data: [fila(1)], error: null, count: 1 };
    const r = await listarFacturasSaas();
    expect(r.filas[0]).toMatchObject({ monto: 17500, subtotal: null, iva: null, cfdiUuid: null, pagadaEn: null, tenantNombre: 'Flota' });
    expect(r.truncado).toBe(false);
  });

  it('aplica estado y rango de periodo, y ordena con desempate por id', async () => {
    respuesta = { data: [], error: null, count: 0 };
    await listarFacturasSaas({ estado: 'pagada', desde: '2026-01-01', hasta: '2026-06-30' });
    expect(llamadas).toContainEqual(['eq', 'estado', 'pagada']);
    expect(llamadas).toContainEqual(['gte', 'periodo_inicio', '2026-01-01']);
    expect(llamadas).toContainEqual(['lte', 'periodo_inicio', '2026-06-30']);
    expect(llamadas.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual(['periodo_inicio', 'id']);
  });

  it('el límite nunca pasa del techo', async () => {
    respuesta = { data: [], error: null, count: 0 };
    await listarFacturasSaas({ limite: 999_999 });
    expect(llamadas.find((c) => c[0] === 'limit')?.[1]).toBe(TECHO_FACTURAS_SAAS);
  });

  it('si la base tiene más de lo leído, lo dice (truncado)', async () => {
    respuesta = { data: [fila(1)], error: null, count: 5000 };
    const r = await listarFacturasSaas();
    expect(r.truncado).toBe(true);
    expect(r.total).toBe(5000);
  });

  it('una base caída LANZA — nunca devuelve una lista vacía', async () => {
    respuesta = { data: null, error: { message: 'caída' }, count: null };
    await expect(listarFacturasSaas()).rejects.toThrow(/caída/);
  });
});
