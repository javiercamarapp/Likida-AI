import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S47-08: `cfdiValido` no se puede declarar solo por parsear el QR. Tiene que esperar al estado SAT: un QR con forma válida
// que el SAT no encuentra (o que no contestó) NO es una «verificación independiente» del monto. Todo sintético.

const generateStructured = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, generateStructured: (...a: unknown[]) => generateStructured(...a) };
});
vi.mock('@/lib/observability/alerta', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, alertarOperador: vi.fn(async () => undefined) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, redactarTexto: (s: string) => s, huellaId: (s: string) => s,
}));
const decodificar = vi.fn();
vi.mock('./cfdi_imagen', () => ({
  decodificarCodigosYReducir: (...a: unknown[]) => decodificar(...a),
  redimensionarParaVision: vi.fn(async (b: Buffer) => b),
}));
const consultarCFDI = vi.fn();
vi.mock('./sat', () => ({ consultarCFDI: (...a: unknown[]) => consultarCFDI(...a) }));

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const UUID = '11111111-2222-3333-4444-555555555555';
const lectura = {
  data: {
    concepto: 'caseta', producto: null, monto: 100, subtotal: null, iva_monto: null, iva_tasa: null, litros: null,
    precio_unitario: null, forma_pago: null, fecha: '2026-07-27', folio: '1', web_id: null, estacion: null,
    rfc_emisor: null, cfdi_uuid: null, confianza: 0.4, legible: true,
  },
  raw: '{}', model: 'm', tokensIn: 1, tokensOut: 1, cost: 0.01,
};

beforeEach(() => {
  generateStructured.mockReset().mockResolvedValue(lectura);
  consultarCFDI.mockReset();
  decodificar.mockReset().mockResolvedValue({
    codigos: [{ formato: 'QRCode', texto: 'x', cfdi: { uuid: UUID, rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB020202BB2', total: 100 } }],
    reducida: null,
  });
});

async function leer() {
  const { extraerComprobante } = await import('./ocr');
  const r = await extraerComprobante(IMG);
  return (r as { gasto?: { cfdiValido?: boolean } }).gasto;
}

describe('A37-S47-08: cfdiValido espera al SAT', () => {
  it.each(['no_encontrado', 'pendiente', 'cancelado'])('QR parseado + SAT %s → cfdiValido NO es true', async (estado) => {
    consultarCFDI.mockResolvedValue({ estado });
    expect((await leer())?.cfdiValido).not.toBe(true);
  });
  it('QR parseado + SAT vigente → cfdiValido true', async () => {
    consultarCFDI.mockResolvedValue({ estado: 'vigente' });
    expect((await leer())?.cfdiValido).toBe(true);
  });
});
