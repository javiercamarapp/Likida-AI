import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/ccp-timbrado — el aviso del TMS con el CCP ya timbrado (T-A3-33).
//
// Se fija la PUERTA y el contrato, con dobles de base, Storage y correo:
//   1. la credencial va primero (sin ella no se lee el cuerpo) y la flota sale de ella: un `tenant_id` es 400;
//   2. un aviso nuevo es 201 y el mismo UUID otra vez es 200 sin un segundo correo;
//   3. una referencia ajena es 404 sin correo; archivos mal formados o grandes son 400;
//   4. la respuesta no devuelve rutas de Storage, direcciones ni el contenido;
//   5. sin activar «responder al cliente» solo se guarda.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: '11111111-1111-4111-8111-111111111111', rol: 'llave:operacion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

import { dobleCcp, pdfSintetico, REFERENCIA, UUID_FISCAL, xmlCcp } from '@/lib/likida/carta_porte_docs/ccp_respuesta.fixture';

let doble = dobleCcp();
vi.mock('@/lib/likida/carta_porte_docs/ccp_respuesta_repo', () => ({ depsCcp: () => doble.deps }));

const { POST } = await import('./route');

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const CUERPO = (p: Record<string, unknown> = {}) => ({ referencia: REFERENCIA, xmlBase64: b64(xmlCcp()), pdfBase64: b64(pdfSintetico()), ...p });
const postear = (cuerpo: unknown) => POST(new Request('https://app.likida.ai/api/v1/ccp-timbrado', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
}));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const conocerCliente = () => doble.e.filas.push({
  id: 'previa', tenantId: '11111111-1111-4111-8111-111111111111', documentoId: 'd', envioId: 'e', uuid: 'cccccccc-1111-4222-8333-dddddddddddd',
  pdfRuta: 'p', xmlRuta: 'x', destinoCorreo: 'compras@cliente-sintetico.test', estado: 'respondido', respondidoEn: '2026-10-01T00:00:00.000Z',
});

beforeEach(() => {
  doble = dobleCcp();
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: '11111111-1111-4111-8111-111111111111', rol: 'llave:operacion' });
});

describe('POST /v1/ccp-timbrado', () => {
  it('pide el área operacion y, sin credencial, no lee el cuerpo ni toca nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: Response.json({ error: { codigo: 'no_autenticado', mensaje: 'x' } }, { status: 401 }) });
    const r = await postear(CUERPO());
    expect(r.status).toBe(401);
    expect(abrir).toHaveBeenCalledWith(expect.anything(), 'operacion');
    expect(doble.e.archivos.size).toBe(0);
  });

  it('aviso nuevo: 201; el mismo UUID otra vez: 200 y UN solo correo', async () => {
    conocerCliente();
    const r1 = await postear(CUERPO());
    expect(r1.status).toBe(201);
    expect(await json(r1)).toEqual({ estado: 'respondido', duplicado: false, respondido: true });
    const r2 = await postear(CUERPO());
    expect(r2.status).toBe(200);
    expect(await json(r2)).toEqual({ estado: 'respondido', duplicado: true, respondido: true });
    expect(doble.e.correos).toHaveLength(1);
  });

  it('sin activar «responder al cliente» solo guarda: 201 guardado, 0 correos', async () => {
    doble.e.config.activa = false; conocerCliente();
    const r = await postear(CUERPO());
    expect(r.status).toBe(201);
    expect(await json(r)).toEqual({ estado: 'guardado', duplicado: false, respondido: false });
    expect(doble.e.correos).toHaveLength(0);
  });

  it('la respuesta no filtra rutas de Storage, direcciones ni el UUID', async () => {
    conocerCliente();
    const texto = JSON.stringify(await json(await postear(CUERPO())));
    expect(texto).not.toMatch(/ccp\/|@|\.pdf|\.xml|compras|aaaaaaaa/i);
    expect(UUID_FISCAL).toBeTruthy();
  });

  it('referencia ajena: 404 sin guardar y sin correo', async () => {
    conocerCliente();
    const r = await postear(CUERPO({ referencia: 'REF-AJENA' }));
    expect(r.status).toBe(404);
    expect((await json(r)).error.codigo).toBe('no_encontrado');
    expect(doble.e.correos).toHaveLength(0);
    expect(doble.e.archivos.size).toBe(0);
  });

  it('un tenant_id en el cuerpo es 400: la flota sale de la credencial', async () => {
    const r = await postear(CUERPO({ tenant_id: '22222222-2222-4222-8222-222222222222' }));
    expect(r.status).toBe(400);
    expect(doble.e.archivos.size).toBe(0);
  });

  it.each([
    ['sin referencia', { referencia: undefined }],
    ['xml que no es base64', { xmlBase64: '***no es base64***' }],
    ['pdf vacío', { pdfBase64: '' }],
    ['xml que no es un CCP timbrado', { xmlBase64: b64(new TextEncoder().encode('<a/>')) }],
    ['pdf que no es PDF', { pdfBase64: b64(new TextEncoder().encode('hola')) }],
    ['archivo de más de 8 MB', { pdfBase64: b64(new Uint8Array(8 * 1024 * 1024 + 1)) }],
  ])('cuerpo inválido (%s): 400 y nada guardado', async (_n, cambio) => {
    const r = await postear(CUERPO(cambio));
    expect(r.status).toBe(400);
    expect((await json(r)).error.codigo).toBe('parametro_invalido');
    expect(doble.e.archivos.size).toBe(0);
    expect(doble.e.correos).toHaveLength(0);
  });

  it('un cuerpo que no es JSON es 400', async () => {
    expect((await postear('esto no es json')).status).toBe(400);
  });

  it('sin la migración 0794: 503 dependencia_no_disponible', async () => {
    doble.e.config.activa = 'sin_migracion';
    const r = await postear(CUERPO());
    expect(r.status).toBe(503);
  });

  it('una falla interna (Storage caído) es 500 sin el mensaje interno', async () => {
    doble.deps.subirArchivo = async () => { throw new Error('relation "secreta" violates constraint'); };
    conocerCliente();
    const r = await postear(CUERPO());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toMatch(/relation|constraint|secreta/);
  });
});
