import { afterEach, describe, expect, it } from 'vitest';
import { reiniciarLimites } from '@/lib/ratelimit';

// CT-SEG-20: JSON valido pero no objeto ("null", "5", "[]", comprobantes no arreglo) tiraba un TypeError => 500.
const { POST } = await import('./route');
const pet = (crudo: string) => new Request('https://x/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: crudo });
afterEach(() => reiniciarLimites());

describe('POST /api/demo: formas JSON inesperadas no son 500 (CT-SEG-20)', () => {
  it.each(['null', '5', '"hola"', 'true', '[]', '[1,2]'])('cuerpo %s => 400', async (crudo) => {
    const r = await POST(pet(crudo));
    expect(r.status).toBe(400);
  });
  it.each([
    '{"comprobantes":"x"}',
    '{"comprobantes":{"a":1}}',
    '{"comprobantes":[null]}',
    '{"comprobantes":[5,"x"]}',
    '{"anticipo":"mil"}',
  ])('forma interna invalida %s => 400, no 500', async (crudo) => {
    const r = await POST(pet(crudo));
    expect(r.status).toBe(400);
  });
  it('un cuerpo valido sigue funcionando', async () => {
    const r = await POST(pet(JSON.stringify({ anticipo: 1000, comprobantes: [{ concepto: 'alimentacion', monto: 200 }] })));
    expect(r.status).toBe(200);
  });
  it('un objeto vacio sigue funcionando (como antes)', async () => {
    expect((await POST(pet('{}'))).status).toBe(200);
  });
});
