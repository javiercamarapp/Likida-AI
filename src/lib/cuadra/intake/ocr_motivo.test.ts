import { describe, it, expect, vi, beforeEach } from 'vitest';

// El bug de fondo: TODO fallo salía como "foto ilegible", así que a un bug
// nuestro el operador respondía reenviando la misma foto — que fallaba igual.
// Aquí se fija la distinción: 'ilegible' (reenviar sirve) vs 'fallo_tecnico'
// (reenviar NO sirve).
const generateStructured = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, generateStructured: (...a: unknown[]) => generateStructured(...a) };
});

const { extraerComprobante } = await import('./ocr');
const { TruncatedError, StructuredError } = await import('@/lib/llm/openrouter');

// 1x1 PNG: data-URL válida, sin QR que decodificar.
const IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const respuesta = (over: Record<string, unknown> = {}) => ({
  data: {
    concepto: 'diesel', producto: null, monto: 1000, subtotal: null, iva_monto: null,
    iva_tasa: null, litros: null, precio_unitario: null, forma_pago: 'tarjeta',
    fecha: '2026-07-27', folio: '1404755', web_id: null, estacion: null,
    rfc_emisor: null, cfdi_uuid: null, confianza: 0.95, legible: true, ...over,
  },
  raw: '{}', model: 'google/gemini-3.6-flash', tokensIn: 100, tokensOut: 200, cost: 0.01,
});

describe('extraerComprobante — motivo del fallo', () => {
  // Cuerpo con llaves a propósito: `() => mock.mockReset()` DEVUELVE el mock, y
  // vitest toma lo que devuelve un beforeEach como callback de limpieza — o sea
  // que llamaría al mock al terminar el test, disparando su implementación (y si
  // esa implementación lanza, el test falla en el teardown, no en el cuerpo).
  beforeEach(() => { generateStructured.mockReset(); });

  it('foto de verdad ilegible → motivo "ilegible" (reenviar sirve)', async () => {
    generateStructured.mockResolvedValue(respuesta({ legible: false }));
    const r = await extraerComprobante(IMG);
    expect(r.legible).toBe(false);
    expect(r.motivo).toBe('ilegible');
  });

  it('sin monto → "ilegible" aunque el modelo diga que se lee', async () => {
    generateStructured.mockResolvedValue(respuesta({ monto: null }));
    const r = await extraerComprobante(IMG);
    expect(r.motivo).toBe('ilegible');
  });

  it('respuesta truncada → "fallo_tecnico", NO "ilegible"', async () => {
    // Se lanza SÍNCRONO en vez de devolver una promesa rechazada: el catch de
    // ocr.ts lo atrapa igual, y así no queda una promesa suelta que vitest
    // contabilice como rechazo sin manejar y tumbe el test por fuera.
    generateStructured.mockImplementation(() => {
      throw new TruncatedError('Respuesta truncada: se agotaron los 1200 tokens', 1184, 1200, '{"monto": 100', {
        model: 'google/gemini-3.6-flash', tokensIn: 2000, tokensOut: 1184, cost: 0.013,
      });
    });
    const r = await extraerComprobante(IMG);
    expect(r.legible).toBe(false);
    expect(r.motivo).toBe('fallo_tecnico');
  });

  it('el fallo técnico contabiliza su costo (antes reportaba $0)', async () => {
    generateStructured.mockImplementation(() => {
      throw new StructuredError('JSON parse falló', undefined, 'x', {
        model: 'google/gemini-3.6-flash', tokensIn: 2000, tokensOut: 1184, cost: 0.013,
      });
    });
    const r = await extraerComprobante(IMG);
    expect(r.motivo).toBe('fallo_tecnico');
    expect(r.costo.costoUsd).toBe(0.013);
    expect(r.costo.tokensOut).toBe(1184);
    expect(r.costo.modelo).toBe('google/gemini-3.6-flash');
  });

  it('comprobante bueno → legible, sin motivo, con método de pago y fecha', async () => {
    generateStructured.mockResolvedValue(respuesta());
    const r = await extraerComprobante(IMG);
    expect(r.legible).toBe(true);
    expect(r.motivo).toBeUndefined();
    expect(r.gasto.formaPago).toBe('04');       // tarjeta → c_FormaPago 04
    expect(r.gasto.fecha).toBe('2026-07-27');
  });

  it('pago en efectivo → c_FormaPago 01 (lo que mira la regla de combustible)', async () => {
    generateStructured.mockResolvedValue(respuesta({ forma_pago: 'efectivo' }));
    const r = await extraerComprobante(IMG);
    expect(r.gasto.formaPago).toBe('01');
  });
});
