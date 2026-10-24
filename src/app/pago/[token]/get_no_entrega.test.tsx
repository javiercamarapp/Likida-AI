// A37-S21-03: un GET al portal NO sella la entrega del REP ni escribe una fila
// de bitácora por cada visita.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  anotar: vi.fn(async (..._a: unknown[]) => {}), sellarAcceso: vi.fn(async (..._a: unknown[]) => {}),
  sellarRep: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', '203.0.113.9']]) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true }));
vi.mock('./forma', () => ({ FormaDePago: () => null }));
vi.mock('@/lib/likida/portal_pago_escritura', () => ({ sellarRepEntregado: (...a: unknown[]) => m.sellarRep(...a) }));
vi.mock('@/lib/likida/portal_pago_lectura', () => ({
  resolverLiga: async () => ({ ok: true, liga: { ligaId: 'l1', tenantId: 't1', facturaId: 'f1', estado: 'vigente' } }),
  vistaDelPortal: async () => ({
    ok: true,
    vista: {
      ligaId: 'l1', tenantId: 't1', facturaId: 'f1', flota: 'Flota Sintética', cliente: 'Cliente Sintético',
      factura: { serie: 'A', folio: '1', cfdiUuid: null, fecha: '2026-08-14', venceEn: null, estatus: 'emitida', total: 100, moneda: 'MXN', saldo: 0, pagado: 100 },
      propuestas: [], metodos: [],
      reps: [{ cfdiUuid: '11111111-1111-4111-8111-111111111111', fechaPago: '2026-08-20', impPagado: 100, tieneXml: false }],
    },
  }),
  anotarAcceso: (...a: unknown[]) => m.anotar(...a),
  sellarUltimoAcceso: (...a: unknown[]) => m.sellarAcceso(...a),
}));

const { default: PaginaPago } = await import('./page');

beforeEach(() => vi.clearAllMocks());

describe('A37-S21-03 portal de pago: GET', () => {
  it('no sella el REP como entregado (aunque no tenga XML) y deduplica la vista', async () => {
    await PaginaPago({ params: Promise.resolve({ token: 'tok' }) });
    expect(m.sellarRep).not.toHaveBeenCalled();
    expect(m.anotar).toHaveBeenCalledTimes(1);
    expect(m.anotar.mock.calls[0][1]).toBe('vista');
    expect(m.anotar.mock.calls[0][3]).toMatchObject({ unaVezCadaMs: expect.any(Number) });
  });
});
