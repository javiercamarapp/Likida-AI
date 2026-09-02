// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 13, seguridad — verificación: /api/demo es la ÚNICA de las tres
// rutas que usan `bodyExcede` que llamaba `req.json()` directo, sin la
// segunda medición sobre el texto REAL. `bodyExcede` solo mira
// `content-length`, que una petición `Transfer-Encoding: chunked` no declara
// — con esa cabecera ausente, un POST sin sesión (esta ruta es pública)
// materializaba el cuerpo entero en memoria sin ningún tope. `_escritura.ts`
// ya documentaba la doctrina ("se mide dos veces"); esta ruta no la seguía.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach } from 'vitest';
import { reiniciarLimites } from '@/lib/ratelimit';

const { POST, GET } = await import('./route');

function peticion(init: { crudo: string; conLargo?: boolean }): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  // Sin `content-length`: es justo el caso `Transfer-Encoding: chunked` que
  // `bodyExcede` no puede medir — la primera comprobación pasa siempre.
  if (init.conLargo) headers.set('content-length', String(init.crudo.length));
  return new Request('https://x/api/demo', { method: 'POST', headers, body: init.crudo });
}

afterEach(() => reiniciarLimites());

describe('POST /api/demo — el cuerpo se mide también sin content-length', () => {
  it('un cuerpo gigante SIN content-length se corta igual (413), no se parsea', async () => {
    // 64 KB es el tope; 70 KB de puro relleno en un campo que el motor de
    // cuadre ni siquiera usa — si esto se parseara, no tronaría por forma,
    // tronaría por memoria en producción con un payload real de gigabytes.
    const gigante = JSON.stringify({ comprobantes: [], anticipo: 0, relleno: 'x'.repeat(70 * 1024) });
    const r = await POST(peticion({ crudo: gigante }));
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/payload muy grande/);
  });

  it('el mismo cuerpo gigante CON content-length también se corta (la primera capa, intacta)', async () => {
    const gigante = JSON.stringify({ comprobantes: [], anticipo: 0, relleno: 'x'.repeat(70 * 1024) });
    const r = await POST(peticion({ crudo: gigante, conLargo: true }));
    expect(r.status).toBe(413);
  });

  it('un cuerpo dentro del tope sigue corriendo el motor de cuadre normal', async () => {
    const cuerpo = JSON.stringify({
      comprobantes: [{ concepto: 'diesel', monto: 100 }],
      anticipo: 500,
    });
    const r = await POST(peticion({ crudo: cuerpo }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.totalComprobado).toBe(100);
  });

  it('JSON inválido dentro del tope es 400, no un 500', async () => {
    const r = await POST(peticion({ crudo: 'esto no es json' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/JSON inválido/);
  });
});

describe('GET /api/demo — SEG-8 (auditoría 24): no expone la salud de configuración', () => {
  it('contesta ok y nada más: ni `config`, ni qué integraciones están puestas', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toEqual({ ok: true });
    expect(JSON.stringify(cuerpo)).not.toMatch(/llm|whatsapp|supabase|config/i);
  });
});
