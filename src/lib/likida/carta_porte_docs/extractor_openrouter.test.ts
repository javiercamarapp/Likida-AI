import { describe, it, expect, vi, beforeEach } from 'vitest';

// A39-S60-01: la reserva de presupuesto de IA es `rpc(..., p_run_id uuid)`. El extractor armaba
// `cp-<uuid>`: Postgres lo rechazaba SIEMPRE y la extracción nunca corría. El runId debe ser un uuid real.
const creados: Array<{ tenantId: string; runId: string; proposito: string }> = [];
vi.mock('@/lib/llm/budget', () => ({
  createLlmBudget: (tenantId: string, runId: string, proposito: string) => {
    creados.push({ tenantId, runId, proposito });
    return { tenantId, runId, proposito };
  },
}));
vi.mock('@/lib/llm/openrouter', () => ({
  generateStructured: vi.fn(async () => ({ data: {}, model: 'm', tokensIn: 1, tokensOut: 1, cost: 0 })),
}));

import { crearExtractorOpenRouter } from './extractor_openrouter';

const UUID_ESTRICTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('crearExtractorOpenRouter', () => {
  beforeEach(() => { creados.length = 0; });

  it('A39-S60-01: el runId del presupuesto es un uuid (sin prefijo), distinto por corrida', () => {
    crearExtractorOpenRouter('00000000-0000-4000-8000-000000000001', 'interactivo');
    crearExtractorOpenRouter('00000000-0000-4000-8000-000000000001', 'ocr_lote');
    expect(creados).toHaveLength(2);
    for (const c of creados) expect(c.runId).toMatch(UUID_ESTRICTO);
    expect(creados[0].runId).not.toBe(creados[1].runId);
  });
});
