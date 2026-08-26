import { describe, it, expect, vi, beforeEach } from 'vitest';

// ARQ-19C2-2 — `ingresarFacturaDesdeFoto` llamaba a `extraerComprobante` sin
// `signal` ni `budget`: sin señal, la visión cae al default del SDK de
// OpenAI (10 min) en vez del deadline razonable de la ruta; sin presupuesto,
// la lectura no gasta contra el tope diario del tenant. Mismo patrón que
// `api/dashboard/ingesta/route.ts`.

const extraerComprobante = vi.fn(async (..._a: unknown[]) => ({ legible: false, gasto: { cfdiUuid: undefined, monto: 0 } }));
vi.mock('./intake/ocr', () => ({ extraerComprobante: (...a: unknown[]) => extraerComprobante(...(a as [])) }));

const { ingresarFacturaDesdeFoto } = await import('./proveedores');

beforeEach(() => { extraerComprobante.mockClear(); });

describe('ingresarFacturaDesdeFoto — presupuesto y señal de la visión', () => {
  it('pasa un AbortSignal y un LlmBudget del tenant a extraerComprobante', async () => {
    const r = await ingresarFacturaDesdeFoto('tenant-foto-1', 'data:image/jpeg;base64,AAAA', null);

    // Foto "ilegible" a propósito: basta para llegar al llamado sin tocar la
    // base de datos (validarFotoParaIngreso corta antes de cualquier query).
    expect(r.ok).toBe(false);
    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    const [, signal, budget] = extraerComprobante.mock.calls[0] as unknown as [unknown, AbortSignal, { tenantId: string }];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(budget).toMatchObject({ tenantId: 'tenant-foto-1' });
  });
});
