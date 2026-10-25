import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S47-07 · un QR de CFDI con `tt=1e999` o `tt=Infinity` no puede meter Infinity como monto del gasto:
// la cabecera de ocr.ts promete que un total ilegible jamás se vuelve una cifra.
const generateStructured = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, generateStructured: (...a: unknown[]) => generateStructured(...a) };
});
const qr = vi.hoisted(() => ({ texto: '' }));
vi.mock('./cfdi_imagen', async (orig) => {
  const actual = (await orig()) as typeof import('./cfdi_imagen');
  const { parseCfdiQr } = await import('./cfdi');
  return {
    ...actual,
    decodificarCodigosYReducir: async (buf: Buffer) => ({
      codigos: [{ texto: qr.texto, formato: 'QRCode', cfdi: parseCfdiQr(qr.texto) }],
      reducida: buf,
    }),
    redimensionarParaVision: async (buf: Buffer) => buf,
  };
});

const { extraerComprobante } = await import('./ocr');
const TICKET =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const respuesta = () => ({
  data: {
    concepto: 'otro', producto: null, monto: 250, subtotal: null, iva_monto: null,
    iva_tasa: null, litros: null, precio_unitario: null, forma_pago: 'tarjeta',
    fecha: '2026-07-25', folio: '999', web_id: null, estacion: null,
    rfc_emisor: null, cfdi_uuid: null, url_facturacion: null,
    confianza: 0.95, legible: true,
  },
  raw: '{}', model: 'google/gemini-3.6-flash', tokensIn: 100, tokensOut: 200, cost: 0.01,
});

describe('A37-S47-07 · un total no finito del QR no es un monto', () => {
  beforeEach(() => { generateStructured.mockReset(); generateStructured.mockResolvedValue(respuesta()); });

  it.each(['1e999', 'Infinity'])('tt=%s: el monto sigue siendo el del OCR, finito', async (tt) => {
    qr.texto = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?re=AAA010101AAA&tt=${tt}`;
    const r = await extraerComprobante([TICKET]);
    expect(Number.isFinite(r.gasto.monto)).toBe(true);
    expect(r.gasto.monto).toBe(250);
  });

  it('un total finito del QR sigue mandando sobre el OCR', async () => {
    qr.texto = 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?re=AAA010101AAA&tt=300.50';
    const r = await extraerComprobante([TICKET]);
    expect(r.gasto.monto).toBe(300.5);
  });
});
