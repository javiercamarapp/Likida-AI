import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CAPA E1 — la unidad del transcriptor. Lo que estas pruebas fijan es el
// contrato fail-closed: no entender es un resultado (jamás una invención),
// el presupuesto agotado no cobra, y el costo de escuchar se asienta SIEMPRE
// que hubo llamada — inteligible o no.
// ═══════════════════════════════════════════════════════════════════════════

const downloadMediaAsDataUrl = vi.fn();
const generateStructured = vi.fn();
const registrarCosto = vi.fn();

vi.mock('@/lib/meta/client', () => ({
  downloadMediaAsDataUrl: (...a: unknown[]) => downloadMediaAsDataUrl(...a),
}));
vi.mock('@/lib/llm/openrouter', () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
}));
vi.mock('./costos', () => ({
  registrarCosto: (...a: unknown[]) => registrarCosto(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { transcribirNotaDeVoz, formatoDesdeMime } = await import('./voz_transcrita');
const { LlmBudgetExceededError } = await import('@/lib/llm/budget');

const AUDIO_OGG = 'data:audio/ogg; codecs=opus;base64,T2dnUw==';

function respuesta(data: { inteligible: boolean; texto: string | null }) {
  return { data, raw: '', model: 'google/gemini-3.5-flash-lite', tokensIn: 120, tokensOut: 30, cost: 0.0004 };
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadMediaAsDataUrl.mockResolvedValue(AUDIO_OGG);
});

describe('formatoDesdeMime', () => {
  it('mapea los mimes reales de WhatsApp y cae a ogg (la nota de voz nativa) ante lo desconocido', () => {
    expect(formatoDesdeMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(formatoDesdeMime('audio/mpeg')).toBe('mp3');
    expect(formatoDesdeMime('audio/mp4')).toBe('mp4');
    expect(formatoDesdeMime('audio/amr')).toBe('amr');
    expect(formatoDesdeMime(null)).toBe('ogg');
    expect(formatoDesdeMime('application/desconocido')).toBe('ogg');
  });
});

describe('transcribirNotaDeVoz', () => {
  it('audio claro → texto, con el costo asentado en fase transcripcion', async () => {
    generateStructured.mockResolvedValue(respuesta({ inteligible: true, texto: 'se me ponchó una llanta en la caseta' }));
    const r = await transcribirNotaDeVoz({ tenantId: 't1', mediaId: 'm1' });
    expect(r).toEqual({ ok: true, texto: 'se me ponchó una llanta en la caseta' });
    expect(registrarCosto).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', fase: 'transcripcion', costoUsd: 0.0004 }));
    // El audio viajó con el formato correcto derivado del mime del data-URL.
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      role: 'transcripcion',
      audios: [{ data: 'T2dnUw==', format: 'ogg' }],
    }));
  });

  it('audio ininteligible → motivo ilegible, y el costo se asienta igual (se pagó por escuchar)', async () => {
    generateStructured.mockResolvedValue(respuesta({ inteligible: false, texto: null }));
    const r = await transcribirNotaDeVoz({ tenantId: 't1', mediaId: 'm1' });
    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
    expect(registrarCosto).toHaveBeenCalled();
  });

  it('inteligible=true con texto vacío también es ilegible — un "sí entendí" sin palabras no se procesa', async () => {
    generateStructured.mockResolvedValue(respuesta({ inteligible: true, texto: '   ' }));
    const r = await transcribirNotaDeVoz({ tenantId: 't1', mediaId: 'm1' });
    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
  });

  it('presupuesto agotado → motivo presupuesto y CERO costo asentado (la reserva rechazada no cobró)', async () => {
    generateStructured.mockRejectedValue(new LlmBudgetExceededError('tenant', 0.01, 0.005));
    const r = await transcribirNotaDeVoz({ tenantId: 't1', mediaId: 'm1' });
    expect(r).toEqual({ ok: false, motivo: 'presupuesto' });
    expect(registrarCosto).not.toHaveBeenCalled();
  });

  it('descarga caída → fallo nuestro, sin llamada LLM y sin costo', async () => {
    downloadMediaAsDataUrl.mockResolvedValue(null);
    const r = await transcribirNotaDeVoz({ tenantId: 't1', mediaId: 'm1' });
    expect(r).toEqual({ ok: false, motivo: 'fallo' });
    expect(generateStructured).not.toHaveBeenCalled();
    expect(registrarCosto).not.toHaveBeenCalled();
  });

  it('proveedor caído → fallo nuestro, no un regaño al chofer', async () => {
    generateStructured.mockRejectedValue(new Error('502 provider down'));
    const r = await transcribirNotaDeVoz({ tenantId: 't1', mediaId: 'm1' });
    expect(r).toEqual({ ok: false, motivo: 'fallo' });
  });
});
