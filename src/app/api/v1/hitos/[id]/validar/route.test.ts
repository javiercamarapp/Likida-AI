import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /v1/hitos/{id}/validar — la puerta. Se fija: solo con LLAVE de API del área administracion (nunca la cookie), el
// hito se resuelve DENTRO de la flota de la llave (404 igual para «no existe» y «no es tuyo»), el motivo es obligatorio y
// queda con la llave como firma, solo se valida lo ya reportado, y un reintento no es un error.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion', llaveId: 'a1b2c3d4-0000-4000-8000-000000000000' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const hitoDeFlota = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown> | null> => ({ id: H, viajeId: V, tipo: 'llegada_carga', estado: 'recibido' }));
const validarHitoOficina = vi.fn(async (..._a: unknown[]): Promise<string> => 'ok');
vi.mock('@/lib/likida/conductor/repo_validacion', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/conductor/repo_validacion')>()),
  hitoDeFlota: (...a: unknown[]) => hitoDeFlota(...a),
  validarHitoOficina: (...a: unknown[]) => validarHitoOficina(...a),
}));

const ruta = await import('./route');
const H = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0aa';
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0bb';
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = (id: string, cuerpo: unknown) => ruta.POST(
  new Request(`https://app.likida.ai/api/v1/hitos/${id}/validar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  [abrir, hitoDeFlota, validarHitoOficina].forEach((f) => f.mockClear());
  hitoDeFlota.mockResolvedValue({ id: H, viajeId: V, tipo: 'llegada_carga', estado: 'recibido' });
  validarHitoOficina.mockResolvedValue('ok');
});

describe('POST /v1/hitos/{id}/validar', () => {
  it('valida con la llave como firma: motivo en la bitácora, flota de la credencial, área administracion', async () => {
    const r = await post(H, { motivo: 'Confirmado por el almacén de Zapopan' });
    expect(r.status).toBe(200);
    expect((await json(r)).datos).toMatchObject({ id: H, viajeId: V, tipo: 'llegada_carga', estado: 'validado', validadoPor: 'oficina' });
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    const [tenant, hito, actor, motivo] = validarHitoOficina.mock.calls[0] as [string, string, { usuarioId: unknown; email: string }, string];
    expect([tenant, hito]).toEqual(['t-1', H]);
    expect(actor).toEqual({ usuarioId: null, email: 'llave-api:a1b2c3d4' });
    expect(motivo).toBe('Confirmado por el almacén de Zapopan');
  });

  it('SIN llave (cookie del panel) no hay firma posible: 403 y no se toca nada', async () => {
    abrir.mockResolvedValueOnce({ ok: true, tenantId: 't-1', rol: 'flota_admin' });
    const r = await post(H, { motivo: 'Confirmado por el almacén' });
    expect(r.status).toBe(403);
    expect((await json(r)).error.mensaje).toContain('llave de API');
    expect(hitoDeFlota).not.toHaveBeenCalled();
  });

  it('si la credencial no alcanza el área, la respuesta de la puerta se devuelve tal cual (y nada corre)', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response(JSON.stringify({ error: { codigo: 'sin_permiso' } }), { status: 403 }) });
    expect((await post(H, { motivo: 'Confirmado por el almacén' })).status).toBe(403);
    expect(hitoDeFlota).not.toHaveBeenCalled();
  });

  it('el motivo es obligatorio (5 a 200) y sin él no se consulta nada', async () => {
    for (const m of [undefined, '', '   ', 'ok', 'x'.repeat(201), 123]) {
      const r = await post(H, m === undefined ? {} : { motivo: m });
      expect(r.status, String(m)).toBe(400);
      expect((await json(r)).error.mensaje).toContain('motivo');
    }
    expect(hitoDeFlota).not.toHaveBeenCalled();
    expect(validarHitoOficina).not.toHaveBeenCalled();
  });

  it('una llave desconocida (p. ej. tenant_id) es 400: no es una puerta a otra flota', async () => {
    const r = await post(H, { motivo: 'Confirmado por el almacén', tenant_id: 'otra' });
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toContain('tenant_id');
  });

  it('un id que no es uuid es 400; uno que no existe EN LA FLOTA es 404 (igual que uno de otra flota)', async () => {
    expect((await post('no-es-uuid', { motivo: 'Confirmado por el almacén' })).status).toBe(400);
    hitoDeFlota.mockResolvedValueOnce(null);
    const r = await post(H, { motivo: 'Confirmado por el almacén' });
    expect(r.status).toBe(404);
    expect(validarHitoOficina).not.toHaveBeenCalled();
    // la búsqueda se hizo con la flota de la llave
    expect(hitoDeFlota.mock.calls[0][0]).toBe('t-1');
  });

  it('un reintento (ya estaba validado) es 200 idempotente y NO vuelve a escribir la bitácora', async () => {
    hitoDeFlota.mockResolvedValueOnce({ id: H, viajeId: V, tipo: 'llegada_carga', estado: 'validado' });
    const r = await post(H, { motivo: 'Confirmado por el almacén' });
    expect(r.status).toBe(200);
    expect((await json(r)).datos).toMatchObject({ estado: 'validado', idempotente: true });
    expect(validarHitoOficina).not.toHaveBeenCalled();
  });

  it('no se valida lo que el chofer nunca reportó (esperado/omitido/escalado): 409 que dice el estado', async () => {
    for (const estado of ['esperado', 'omitido', 'escalado']) {
      hitoDeFlota.mockResolvedValueOnce({ id: H, viajeId: V, tipo: 'salida_carga', estado });
      const r = await post(H, { motivo: 'Confirmado por el almacén' });
      expect(r.status, estado).toBe(409);
      expect((await json(r)).error.mensaje).toContain(estado);
    }
    expect(validarHitoOficina).not.toHaveBeenCalled();
  });

  it('carrera: el hito cambió entre la lectura y la acción (la base dice hito_cambio) → 409', async () => {
    validarHitoOficina.mockResolvedValueOnce('hito_cambio');
    const r = await post(H, { motivo: 'Confirmado por el almacén' });
    expect(r.status).toBe(409);
  });

  it('la base falla → 503, no un 200 falso', async () => {
    validarHitoOficina.mockResolvedValueOnce('fallo');
    expect((await post(H, { motivo: 'Confirmado por el almacén' })).status).toBe(503);
    hitoDeFlota.mockRejectedValueOnce(new Error('caída'));
    expect((await post(H, { motivo: 'Confirmado por el almacén' })).status).toBeGreaterThanOrEqual(500);
  });
});
