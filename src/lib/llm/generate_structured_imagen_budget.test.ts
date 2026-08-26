import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const create = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (query: unknown) => query }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: loggerError } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured } = await import('./openrouter');
const { createLlmBudget } = await import('./budget');

/**
 * BACK-19c2-1 (CRÍTICO) — la reserva de presupuesto medía el input en
 * CARACTERES y `calcCost` cobra su segundo argumento como TOKENS.
 *
 * Para texto la sobre-reserva 1:1 es una cota conservadora deliberada. Para
 * una foto NO lo es: `generateStructured` mete el data-URL base64 completo
 * dentro de `body.messages`, y un modelo de visión cobra la imagen a tarifa
 * fija, no por byte. Resultado: con `maxRunUsd = $0.50` la reserva rebasaba el
 * techo a partir de ~1,976,000 caracteres de data-URL (≈1.44 MB de imagen) y
 * `reserveLlmBudget` lanzaba ANTES de llamar al proveedor — mientras
 * `api/dashboard/ingesta/limites.ts:24` admite `MAX_DATAURL = 4_000_000`
 * diciendo por escrito que «una foto de celular normal cabe».
 *
 * El chofer manda la foto de su ticket y lee «fallo técnico»; el costo real de
 * esa llamada, medido en `openrouter.ts:192`, es ~$0.0016.
 */
describe('generateStructured — el data-URL de una foto no se cobra por byte', () => {
  beforeEach(() => {
    create.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
    create.mockResolvedValue({
      choices: [{ message: { content: '{"monto":123}' } }],
      model: 'google/gemini-3.1-flash-lite',
      usage: { prompt_tokens: 1200, completion_tokens: 40 },
    });
  });

  // 3 MB de data-URL: exactamente lo que `MAX_DATAURL = 4_000_000` deja pasar
  // por la ruta de ingesta, y lo que pesa una foto de celular normal.
  const fotoDe3MB = `data:image/jpeg;base64,${'A'.repeat(3_000_000)}`;

  it('una foto de 3 MB llega al proveedor en vez de morir en la reserva', async () => {
    const budget = createLlmBudget('tenant-foto', '00000000-0000-4000-8000-00000000c201');

    const r = await generateStructured({
      role: 'ocr',
      system: 'extrae',
      messages: [{ role: 'user', content: 'este ticket' }],
      images: [fotoDe3MB],
      schema: z.object({ monto: z.number() }),
      schemaName: 'comprobante',
      budget,
    });

    expect(r.data).toEqual({ monto: 123 });
    // Si la reserva se hubiera calculado por caracteres, `reserveLlmBudget`
    // habría lanzado y el proveedor nunca se habría llamado.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('la reserva de esa foto cabe holgadamente en el techo por corrida', async () => {
    const budget = createLlmBudget('tenant-foto', '00000000-0000-4000-8000-00000000c202');

    await generateStructured({
      role: 'ocr',
      system: 'extrae',
      messages: [{ role: 'user', content: 'este ticket' }],
      images: [fotoDe3MB],
      schema: z.object({ monto: z.number() }),
      schemaName: 'comprobante',
      budget,
    });

    const reserva = rpc.mock.calls.find((c) => c[0] === 'reservar_presupuesto_llm')?.[1] as
      | { p_reserva_usd: number }
      | undefined;
    expect(reserva).toBeDefined();
    // Techo por corrida: $0.50. Por caracteres la reserva pedía ~$0.75.
    expect(reserva!.p_reserva_usd).toBeLessThan(0.5);
  });

  it('el texto largo sigue sobre-reservándose: la cota conservadora no se tocó', async () => {
    const budget = createLlmBudget('tenant-texto', '00000000-0000-4000-8000-00000000c203');

    await generateStructured({
      role: 'ocr',
      system: 'extrae',
      messages: [{ role: 'user', content: 'x'.repeat(40_000) }],
      schema: z.object({ monto: z.number() }),
      schemaName: 'comprobante',
      budget,
    });

    const reserva = rpc.mock.calls.find((c) => c[0] === 'reservar_presupuesto_llm')?.[1] as
      | { p_reserva_usd: number }
      | undefined;
    expect(reserva).toBeDefined();
    // 40,000 caracteres de texto se siguen contando 1:1 como tokens de entrada:
    // 40_000 * 0.25 / 1e6 = $0.010, más la salida. Muy por encima de lo que
    // costaría contarlos a ~4 caracteres por token.
    expect(reserva!.p_reserva_usd).toBeGreaterThan(0.01);
  });

  it('BACKEND-19C2-1: si el proveedor truena, NO liquida al monto reservado', async () => {
    create.mockReset();
    loggerError.mockReset();
    create.mockRejectedValueOnce(new Error('el modelo rechazó la petición (dato de negocio, no red)'));
    const budget = createLlmBudget('tenant-error-ocr', '00000000-0000-4000-8000-00000000c204');

    await expect(generateStructured({
      role: 'ocr',
      system: 'extrae',
      messages: [{ role: 'user', content: 'este ticket' }],
      schema: z.object({ monto: z.number() }),
      schemaName: 'comprobante',
      budget,
    })).rejects.toThrow();

    expect(rpc).toHaveBeenCalledWith('reservar_presupuesto_llm', expect.objectContaining({ p_tenant_id: 'tenant-error-ocr' }));
    expect(rpc).not.toHaveBeenCalledWith('liquidar_presupuesto_llm', expect.anything());
    expect(loggerError).toHaveBeenCalledWith('llm.reserva_sin_liquidar_por_error', expect.objectContaining({ reservaId: expect.any(String) }));
  });
});
