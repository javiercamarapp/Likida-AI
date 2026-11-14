import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los rechazos y fallos del webhook de entrada quedan contados para las alertas de la guardia (alertas_webhook.ts).
// Se fija: 400/5xx registran; 401 no (ya es `llave_invalida`); el éxito no; registrar no cambia la respuesta.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));
const registrar = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/seguridad/registro_acceso', () => ({ registrarRechazoWebhookLiq: (...a: unknown[]) => registrar(...a) }));
const recibir = vi.fn();
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({ recibirDesglose: (...a: unknown[]) => recibir(...a) }));

const { POST } = await import('./route');
const URL_BASE = 'https://app.likida.ai/api/v1/liquidaciones-externas/desgloses';
const postear = (cuerpo: unknown) => POST(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }));

beforeEach(() => { registrar.mockClear(); recibir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }); });

describe('registro de rechazos del webhook de liquidaciones', () => {
  it('un 400 de validación se cuenta con su status y código', async () => {
    const r = await postear({ desgloses: [] });
    expect(r.status).toBe(400);
    expect(registrar).toHaveBeenCalledWith({ status: 400, codigo: 'parametro_invalido' });
  });
  it('un 401 de la puerta NO se cuenta aquí (ya lo registra como llave_invalida)', async () => {
    const { errorApi } = await import('@/app/api/v1/_comun');
    abrir.mockResolvedValue({ ok: false, respuesta: errorApi('no_autenticado', 'x') });
    const r = await postear({ desgloses: [] });
    expect(r.status).toBe(401);
    expect(registrar).not.toHaveBeenCalled();
  });
  it('una excepción no capturada se cuenta como 500 y se relanza', async () => {
    abrir.mockRejectedValue(new Error('revienta'));
    await expect(postear({ desgloses: [] })).rejects.toThrow('revienta');
    expect(registrar).toHaveBeenCalledWith({ status: 500, codigo: 'excepcion_no_capturada' });
  });
  it('si registrar falla, la respuesta no cambia', async () => {
    registrar.mockRejectedValueOnce(new Error('base caída'));
    const r = await postear({ desgloses: [] });
    expect(r.status).toBe(400);
  });
});
