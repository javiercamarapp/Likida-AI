import { describe, it, expect, vi, beforeEach } from 'vitest';

// EL FALLO QUE ESTO FIJA — medido sobre un ticket real de OXXO (28-jul-2026).
//
// El papel imprime el RFC pegado a la razón social y con guiones:
//
//     Cadena Comercial Oxxo, S.A. de C.V.(CCO-860523-1N4)
//
// El extractor lo leía, pero `esRfcValido` recibía la cadena CON puntuación,
// decía que no, y `rfcEmisor` quedaba `undefined` — ni siquiera pasaba a
// `rfcEmisorDudoso`, que es la bandeja de "se leyó algo raro". Consecuencias en
// cadena: no corre el dígito verificador, no se consulta EFOS, y el ticket no se
// puede atribuir a ningún comercio del catálogo de facturación, así que el
// operador nunca se entera de dónde ni hasta cuándo puede timbrarlo.

const generateStructured = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, generateStructured: (...a: unknown[]) => generateStructured(...a) };
});

const { extraerComprobante } = await import('./ocr');

const IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const respuesta = (over: Record<string, unknown> = {}) => ({
  data: {
    concepto: 'otro', producto: 'CUCHARA GRANDE 25PZ', monto: 41.5, subtotal: null,
    iva_monto: 5.72, iva_tasa: null, litros: null, precio_unitario: null,
    forma_pago: 'tarjeta', fecha: '2026-07-16', folio: '4688958', web_id: '10CAN50EAZ1',
    estacion: 'ITZAES MID', rfc_emisor: null, emisor: null, cfdi_uuid: null,
    url_facturacion: null, confianza: 0.98, legible: true, texto_sospechoso: null, ...over,
  },
  raw: '{}', model: 'google/gemini-3.6-flash', tokensIn: 100, tokensOut: 200, cost: 0.018,
});

beforeEach(() => generateStructured.mockReset());

describe('RFC del emisor impreso con puntuación', () => {
  it('acepta el RFC entre paréntesis y con guiones', async () => {
    generateStructured.mockResolvedValue(respuesta({ rfc_emisor: '(CCO-860523-1N4)' }));
    const r = await extraerComprobante([IMG]);
    expect(r.gasto.rfcEmisor).toBe('CCO8605231N4');
    expect(r.gasto.ocrExtra?.rfcEmisorDudoso).toBeUndefined();
  });

  it('acepta el RFC con espacios y en minúsculas', async () => {
    generateStructured.mockResolvedValue(respuesta({ rfc_emisor: ' cco 860523 1n4 ' }));
    const r = await extraerComprobante([IMG]);
    expect(r.gasto.rfcEmisor).toBe('CCO8605231N4');
  });

  // El dígito verificador sigue mandando DESPUÉS de quitar la puntuación: la
  // limpieza no puede convertirse en una puerta para RFC mal leídos. Este es el
  // valor que yo mismo leí mal de la foto (…0525… en vez de …0523…).
  it('un RFC limpio pero con dígito verificador roto NO se asienta como emisor', async () => {
    generateStructured.mockResolvedValue(respuesta({ rfc_emisor: 'CCO-860525-1N4' }));
    const r = await extraerComprobante([IMG]);
    expect(r.gasto.rfcEmisor).toBeUndefined();
    expect(r.gasto.ocrExtra?.rfcEmisorDudoso).toBe('CCO8605251N4');
  });

  it('la puntuación sola no inventa un RFC', async () => {
    generateStructured.mockResolvedValue(respuesta({ rfc_emisor: '---' }));
    const r = await extraerComprobante([IMG]);
    expect(r.gasto.rfcEmisor).toBeUndefined();
    expect(r.gasto.ocrExtra?.rfcEmisorDudoso).toBeUndefined();
  });

  it('guarda la razón social como señal de respaldo', async () => {
    generateStructured.mockResolvedValue(
      respuesta({ emisor: 'Cadena Comercial Oxxo, S.A. de C.V.' }),
    );
    const r = await extraerComprobante([IMG]);
    expect(r.gasto.ocrExtra?.emisor).toBe('Cadena Comercial Oxxo, S.A. de C.V.');
  });
});
