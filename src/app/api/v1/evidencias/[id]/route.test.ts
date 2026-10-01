import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /v1/evidencias/{id}: el ÁREA (operación), que el TENANT sale de la credencial, y que «no existe», «es de otra flota»
// y «ya se purgó» son lo mismo (404). El archivo nunca se sirve: se redirige a una URL firmada de corta vida.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:operacion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));
const rutaDeEvidencia = vi.fn(async (..._a: unknown[]): Promise<string | null> => 't-1/v/ev.jpg');
const urlFirmadaEvidencia = vi.fn(async (..._a: unknown[]): Promise<string | null> => 'https://storage.example/firmada?token=abc');
vi.mock('@/lib/likida/conductor/repo_validacion', () => ({
  rutaDeEvidencia: (...a: unknown[]) => rutaDeEvidencia(...a), urlFirmadaEvidencia: (...a: unknown[]) => urlFirmadaEvidencia(...a),
}));

const { GET } = await import('./route');
const E = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const get = (id: string) => GET(new Request(`https://app.likida.ai/api/v1/evidencias/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:operacion' });
  rutaDeEvidencia.mockReset(); rutaDeEvidencia.mockResolvedValue('t-1/v/ev.jpg');
  urlFirmadaEvidencia.mockReset(); urlFirmadaEvidencia.mockResolvedValue('https://storage.example/firmada?token=abc');
});

describe('GET /v1/evidencias/{id}', () => {
  it('pide el área operacion, busca en la flota de la credencial y redirige (302) a la URL firmada', async () => {
    const r = await get(E.toUpperCase());
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://storage.example/firmada?token=abc');
    expect(abrir.mock.calls[0][1]).toBe('operacion');
    expect(rutaDeEvidencia).toHaveBeenCalledWith('t-1', E);
    expect(urlFirmadaEvidencia).toHaveBeenCalledWith('t-1', 't-1/v/ev.jpg');
  });

  it('«no existe», «de otra flota» y «ya purgada» contestan lo mismo: 404', async () => {
    rutaDeEvidencia.mockResolvedValue(null);
    expect((await get(E)).status).toBe(404);
    rutaDeEvidencia.mockResolvedValue('t-1/v/ev.jpg');
    urlFirmadaEvidencia.mockResolvedValue(null); // la firma se niega (ruta que no cuelga de la flota)
    expect((await get(E)).status).toBe(404);
  });

  it('un id que no es uuid es 400 y no consulta nada', async () => {
    expect((await get("x'; drop table viaje_hito_evidencia;--")).status).toBe(400);
    expect(rutaDeEvidencia).not.toHaveBeenCalled();
  });

  it('sin credencial no lee nada', async () => {
    abrir.mockResolvedValue({ ok: false, respuesta: new Response(null, { status: 401 }) });
    expect((await get(E)).status).toBe(401);
    expect(rutaDeEvidencia).not.toHaveBeenCalled();
  });

  it('una lectura que revienta es 500 sin filtrar el mensaje interno', async () => {
    rutaDeEvidencia.mockRejectedValue(new Error('relation "viaje_hito_evidencia" does not exist'));
    const r = await get(E);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('viaje_hito_evidencia');
  });
});
