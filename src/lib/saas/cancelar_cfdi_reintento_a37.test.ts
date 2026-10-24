// A37-S61-06: el reembolso dispara charge.refunded y credit_note.created. El primero
// marca la factura cancelada ANTES de llamar al PAC; si el PAC falla, el segundo
// evento salía por 'ya_cancelada' sin reintentar el CFDI. Datos sintéticos.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
let factura: Fila | null = null;
const updates: Fila[] = [];

function tabla() {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    maybeSingle: () => Promise.resolve({ data: factura, error: null }),
    update: (v: Fila) => { updates.push(v); return api; },
    upsert: () => Promise.resolve({ error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return api;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => tabla() }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const cancelarCfdi = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./facturapi', () => ({ cancelarCfdi: (...a: unknown[]) => cancelarCfdi(...a), facturapiConfigurado: () => true }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

const { cancelarFacturaDeStripe } = await import('./suscripcion');

const base = (extra: Fila): Fila => ({
  id: 'f1', monto: 1000, estado: 'cancelada', cfdi_uuid: 'uuid-sintetico', cfdi_proveedor_id: 'prov-1', cfdi_cancelado_en: null, ...extra,
});

beforeEach(() => {
  updates.length = 0;
  cancelarCfdi.mockReset(); cancelarCfdi.mockResolvedValue(undefined);
  alertarOperador.mockClear();
  logger.error.mockClear();
});

describe('A37-S61-06 cancelarFacturaDeStripe reintenta el CFDI pendiente', () => {
  it('factura ya cancelada con CFDI vivo: el segundo evento reintenta la cancelación ante el PAC', async () => {
    factura = base({});
    const r = await cancelarFacturaDeStripe('in_1', '02', 1000);
    expect(r).toBe('ya_cancelada');
    expect(cancelarCfdi).toHaveBeenCalledWith('prov-1', '02');
    expect(updates.some((u) => typeof u.cfdi_cancelado_en === 'string')).toBe(true);
  });

  it('ya cancelada y con CFDI ya cancelado: no vuelve a llamar al PAC', async () => {
    factura = base({ cfdi_cancelado_en: '2026-10-01T00:00:00Z' });
    await cancelarFacturaDeStripe('in_1', '02', 1000);
    expect(cancelarCfdi).not.toHaveBeenCalled();
  });

  it('si el PAC vuelve a fallar, no lanza (el webhook sigue en 200) pero alerta al operador', async () => {
    factura = base({});
    cancelarCfdi.mockRejectedValue(new Error('PAC 503'));
    const r = await cancelarFacturaDeStripe('in_1', '02', 1000);
    expect(r).toBe('ya_cancelada');
    expect(alertarOperador).toHaveBeenCalledWith('stripe.cfdi_sin_cancelar', expect.objectContaining({ facturaId: 'f1' }));
  });

  it('primer evento (factura pagada) cuyo PAC falla también alerta al operador', async () => {
    factura = base({ estado: 'pagada' });
    cancelarCfdi.mockRejectedValue(new Error('PAC 503'));
    const r = await cancelarFacturaDeStripe('in_1', '02', 1000);
    expect(r).toBe('cancelada');
    expect(alertarOperador).toHaveBeenCalledWith('stripe.cfdi_sin_cancelar', expect.objectContaining({ facturaId: 'f1' }));
  });
});
