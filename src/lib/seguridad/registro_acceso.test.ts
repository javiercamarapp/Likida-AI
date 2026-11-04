import { beforeEach, describe, expect, it, vi } from 'vitest';

const registrar = vi.fn(async (_ev: Record<string, unknown>) => {});
vi.mock('./eventos', () => ({ registrarEventoSeguridad: (ev: Record<string, unknown>) => registrar(ev) }));
let cabeceras: Headers | Error = new Headers({ 'x-real-ip': '203.0.113.5', 'user-agent': 'curl/8' });
vi.mock('next/headers', () => ({ headers: async () => { if (cabeceras instanceof Error) throw cabeceras; return cabeceras; } }));

const after = vi.fn();
vi.mock('next/server', () => ({ after: (p: unknown) => after(p) }));

const SAL = 'sal-de-prueba-0123456789';
const mod = await import('./registro_acceso');

beforeEach(() => {
  registrar.mockClear();
  cabeceras = new Headers({ 'x-real-ip': '203.0.113.5', 'user-agent': 'curl/8' });
  process.env.SEGURIDAD_SAL_RED = SAL;
});

describe('esExporteDeDinero', () => {
  it('reconoce los exportes de dinero y no los demás', () => {
    for (const p of ['/api/export/liquidaciones', '/api/export/poliza', '/api/export/facturas-proveedor', '/api/export/liquidaciones-externas',
      '/api/export/bitacora-conciliada', '/api/export/peajes-reclamacion', '/api/export/liquidaciones/'])
      expect(mod.esExporteDeDinero(p), p).toBe(true);
    for (const p of ['/api/export/jornada', '/api/export/vigia-faqs', '/api/v1/viajes', '/api/export/liquidacionesX/x']) expect(mod.esExporteDeDinero(p), p).toBe(false);
  });
});

describe('registrarExporteDinero', () => {
  it('registra un exporte de dinero con actor, flota, ruta y red; severidad info', async () => {
    await mod.registrarExporteDinero({ url: 'https://app.likida.ai/api/export/poliza?formato=sap_b1&tenant=zzz', tenantId: 't1', rol: 'contador', userId: 'u1' });
    expect(registrar).toHaveBeenCalledTimes(1);
    const ev = registrar.mock.calls[0][0];
    expect(ev).toMatchObject({ origen: 'export', tipo: 'exporte_dinero', severidad: 'info', tenantId: 't1', actor: 'u1' });
    expect(ev.detalle).toEqual({ ruta: '/api/export/poliza', rol: 'contador' }); // sin query: no se guardan los parámetros pedidos
    expect((ev.red as { ipHash: string }).ipHash).toMatch(/^[0-9a-f]{32}$/);
  });
  it('un exporte que no es de dinero no registra nada', async () => {
    await mod.registrarExporteDinero({ url: 'https://x/api/export/jornada', tenantId: 't1', rol: 'dueno', userId: 'u1' });
    expect(registrar).not.toHaveBeenCalled();
  });
  it('sin cabeceras (fuera de una petición) igual registra, sin red, y no lanza', async () => {
    cabeceras = new Error('fuera de request');
    await expect(mod.registrarExporteDinero({ url: 'https://x/api/export/poliza', tenantId: 't1', rol: 'dueno', userId: 'u1' })).resolves.toBeUndefined();
    expect(registrar.mock.calls[0][0].red).toBeUndefined();
  });
});

describe('registrarLoginFallido', () => {
  it('el actor es una huella de la cuenta, nunca el correo', async () => {
    await mod.registrarLoginFallido({ motivo: 'limite_cuenta', email: 'Juan.Perez@Empresa.com' });
    const ev = registrar.mock.calls[0][0];
    expect(ev).toMatchObject({ origen: 'auth', tipo: 'login_fallido', severidad: 'media', detalle: { motivo: 'limite_cuenta' } });
    expect(ev.actor).toMatch(/^cuenta:[0-9a-f]{12}$/);
    expect(JSON.stringify(ev)).not.toMatch(/juan|perez|empresa/i);
    expect((ev.red as { ua: string }).ua).toBe('curl/8');
  });
  it('sin correo no hay actor', async () => {
    await mod.registrarLoginFallido({ motivo: 'enlace_caducado' });
    expect(registrar.mock.calls[0][0].actor).toBeNull();
  });
});

describe('registrarLlaveInvalida', () => {
  it('toma la red de la petición y registra la ruta sin query ni la llave', async () => {
    const req = new Request('https://app.likida.ai/api/v1/viajes?x=1', { headers: { 'x-real-ip': '198.51.100.9', 'user-agent': 'tms/1', authorization: 'Bearer lk_secreta' } });
    await mod.registrarLlaveInvalida(req, 'Llave inválida');
    const ev = registrar.mock.calls[0][0];
    expect(ev).toMatchObject({ origen: 'api_v1', tipo: 'llave_invalida', severidad: 'media', detalle: { ruta: '/api/v1/viajes', motivo: 'Llave inválida' } });
    expect((ev.red as { ua: string }).ua).toBe('tms/1');
    expect(JSON.stringify(ev)).not.toContain('lk_secreta');
  });
});

describe('registrarApiNegada', () => {
  it('severidad info, con flota, ruta y causa', async () => {
    await mod.registrarApiNegada({ tenantId: 't1', pathname: '/api/v1/viajes', causa: 'perfil' });
    expect(registrar.mock.calls[0][0]).toMatchObject({ origen: 'api_v1', tipo: 'api_negada', severidad: 'info', tenantId: 't1', detalle: { ruta: '/api/v1/viajes', causa: 'perfil' } });
  });
});

describe('registrarCambioRol', () => {
  it('subir a dueño es severidad ALTA (escalada de privilegio); lo demás, media', async () => {
    await mod.registrarCambioRol({ tenantId: 't1', actorId: 'u1', usuarioId: 'u2', de: 'contador', a: 'flota_admin' });
    await mod.registrarCambioRol({ tenantId: 't1', actorId: 'u1', usuarioId: 'u2', de: 'flota_admin', a: 'contador' });
    expect(registrar.mock.calls[0][0]).toMatchObject({ origen: 'auth', tipo: 'cambio_rol', severidad: 'alta', actor: 'u1', detalle: { usuario: 'u2', de: 'contador', a: 'flota_admin' } });
    expect(registrar.mock.calls[1][0]).toMatchObject({ severidad: 'media' });
  });
});

describe('after() de Next', () => {
  it('ata el registro a after() para que no se congele tras la respuesta', async () => {
    after.mockClear();
    await mod.registrarLoginFallido({ motivo: 'x' });
    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0][0]).toBeInstanceOf(Promise);
  });
  it('fuera de una petición after() lanza y el registro sigue sin error', async () => {
    after.mockImplementationOnce(() => { throw new Error('fuera de request'); });
    await expect(mod.registrarLoginFallido({ motivo: 'x' })).resolves.toBeUndefined();
    expect(registrar).toHaveBeenCalled();
  });
});

describe('nunca lanza', () => {
  it('si registrar revienta, el vigilado sigue', async () => {
    registrar.mockRejectedValueOnce(new Error('boom'));
    await expect(mod.registrarLoginFallido({ motivo: 'x' })).resolves.toBeUndefined();
  });
});
