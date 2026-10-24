import { describe, it, expect, vi } from 'vitest';

const propositos: string[] = [];
vi.mock('@/lib/llm/budget', () => ({
  createLlmBudget: (_t: string, _r: string, proposito: string) => { propositos.push(proposito); return { id: 'b' }; },
}));
vi.mock('../intake/ocr', () => ({
  extraerComprobante: async () => ({ legible: true, gasto: { monto: 1, cfdiUuid: null } }),
}));

import { crearPuertosPdf } from './pdf_adaptador';

// A37-S30-01 (ALTO): la visión de PDFs del buzón (correo NO autenticado) gastaba la
// bolsa 'interactivo', que incluye la reserva del chofer por WhatsApp.
describe('A37-S30-01 — la visión del buzón NO usa la reserva interactiva', () => {
  it('cobra contra un propósito de fondo (ocr_lote), nunca interactivo', async () => {
    await crearPuertosPdf('t-1').vision(['data:image/png;base64,AA=='], AbortSignal.timeout(1000));
    expect(propositos).toEqual(['ocr_lote']);
  });
});
