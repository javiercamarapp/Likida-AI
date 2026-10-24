import { describe, it, expect } from 'vitest';
import { clasificarFalloModelo, limpiarMensajeSeguro } from './fallo_modelo';

// El motivo REAL de un fallo del modelo, sin llaves ni cuerpos. Antes la
// bitácora solo decía «El modelo no pudo extraer el dossier.» y nadie podía
// distinguir una llave vencida de un crédito agotado.

function apiError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}
function envuelto(causa: unknown, msg = 'Falló generación estructurada'): Error {
  const e = new Error(`${msg}: x`, { cause: causa });
  e.name = 'StructuredError';
  return e;
}

describe('clasificarFalloModelo — la clase sale del status y del texto', () => {
  it.each([
    [apiError(401, '401 Incorrect API key provided'), 'auth'],
    [apiError(403, 'forbidden'), 'auth'],
    [apiError(402, '402 Insufficient credits'), 'credito'],
    [apiError(429, 'Too many requests'), 'limite'],
    [apiError(404, 'No endpoints found for openai/gpt-oss-120b'), 'modelo_no_disponible'],
    [apiError(503, 'upstream down'), 'red'],
    [new Error('getaddrinfo ENOTFOUND openrouter.ai'), 'red'],
    [new Error('OPENROUTER_API_KEY no configurada'), 'auth'],
    [new Error('algo rarísimo'), 'desconocido'],
  ])('%s -> %s', (err, clase) => {
    expect(clasificarFalloModelo(err).clase).toBe(clase);
  });

  it('el status vive en la cadena de cause (el SDK lo entierra ahí)', () => {
    const f = clasificarFalloModelo(envuelto(apiError(401, 'nope')));
    expect(f).toMatchObject({ clase: 'auth', status: 401, detalle: 'HTTP 401' });
  });

  it('un JSON mal formado del modelo es de formato', () => {
    const e = new Error('JSON parse falló');
    e.name = 'StructuredError';
    expect(clasificarFalloModelo(e).clase).toBe('formato');
  });
});

describe('nunca filtra secretos', () => {
  it('tapa llaves sk-…, Bearer y tokens largos antes de recortar', () => {
    const sucio = 'Incorrect API key provided: sk-or-v1-abcdef1234567890abcdef1234567890 Authorization: Bearer abc123SECRETabc123SECRETabc123SECRET';
    const limpio = limpiarMensajeSeguro(sucio);
    expect(limpio).not.toMatch(/sk-or/);
    expect(limpio).not.toMatch(/abc123SECRET/);
    const f = clasificarFalloModelo(apiError(401, sucio));
    expect(f.mensaje).not.toMatch(/sk-or|SECRET/);
    expect(f.detalle).not.toMatch(/sk-or|SECRET/);
  });

  it('el mensaje se recorta a 200 y el detalle a 80', () => {
    const f = clasificarFalloModelo(new Error('x'.repeat(500) + ' y '.repeat(50)));
    expect(f.mensaje.length).toBeLessThanOrEqual(200);
    expect(f.detalle.length).toBeLessThanOrEqual(80);
  });
});
