import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-A3-01: responder al cliente con el CCP timbrado. Fail-closed: rol, flota de la sesión, confirmación humana.
const sesion = { actual: { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' } };
const { resolver, bitacora, fijar, leer, confirmar } = vi.hoisted(() => ({
  resolver: vi.fn(), bitacora: vi.fn(async () => true), fijar: vi.fn(), leer: vi.fn(), confirmar: vi.fn(),
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: resolver }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: bitacora }));
vi.mock('@/lib/likida/carta_porte_docs/ccp_respuesta_repo', () => ({ fijarRespuestaActiva: fijar, leerPorId: leer, depsCcp: () => ({}) }));
vi.mock('@/lib/likida/carta_porte_docs/ccp_respuesta', () => ({ confirmarYResponder: confirmar }));

import { confirmarRespuestaCcp, fijarRespuestaCcp } from './ccp_actions';

const CCP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const forma = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  sesion.actual = { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' };
  resolver.mockImplementation(async () => sesion.actual);
});

describe('fijarRespuestaCcp', () => {
  it('un rol sin permiso no cambia nada', async () => {
    resolver.mockImplementation(async () => ({ ...sesion.actual, rol: 'contador' }));
    expect(await fijarRespuestaCcp(null, forma({ activo: 'si' }))).toMatchObject({ ok: false });
    expect(fijar).not.toHaveBeenCalled();
  });
  it('enciende con el tenant de la SESIÓN (no el del formulario) y deja bitácora', async () => {
    fijar.mockResolvedValue('ok');
    const r = await fijarRespuestaCcp(null, forma({ activo: 'si', tenant_id: 'ajeno' }));
    expect(r).toMatchObject({ ok: true });
    expect(fijar).toHaveBeenCalledWith('t-sesion', true, 'u-sesion');
    expect(bitacora).toHaveBeenCalledTimes(1);
  });
  it('cualquier cosa distinta de «si» APAGA (fail-closed)', async () => {
    fijar.mockResolvedValue('ok');
    await fijarRespuestaCcp(null, forma({ activo: 'tal vez' }));
    expect(fijar).toHaveBeenCalledWith('t-sesion', false, 'u-sesion');
  });
  it('sin la migración lo dice y no finge', async () => {
    fijar.mockResolvedValue('sin_migracion');
    expect(await fijarRespuestaCcp(null, forma({ activo: 'si' }))).toMatchObject({ ok: false });
  });
});

describe('confirmarRespuestaCcp', () => {
  it('un rol sin permiso no responde a nadie', async () => {
    resolver.mockImplementation(async () => ({ ...sesion.actual, rol: 'contador' }));
    expect(await confirmarRespuestaCcp(null, forma({ ccpId: CCP }))).toMatchObject({ ok: false });
    expect(confirmar).not.toHaveBeenCalled();
  });
  it('rechaza un id que no es UUID sin tocar la base', async () => {
    expect(await confirmarRespuestaCcp(null, forma({ ccpId: '1; drop' }))).toMatchObject({ ok: false });
    expect(leer).not.toHaveBeenCalled();
  });
  it('lee la fila SOLO de la flota de la sesión y confirma con el destino escrito', async () => {
    leer.mockResolvedValue({ id: CCP });
    confirmar.mockResolvedValue({ ok: true, respondido: true, estado: 'respondido' });
    const r = await confirmarRespuestaCcp(null, forma({ ccpId: CCP, destino: 'cliente@ejemplo.test' }));
    expect(r).toMatchObject({ ok: true });
    expect(leer).toHaveBeenCalledWith('t-sesion', CCP);
    expect(confirmar).toHaveBeenCalledWith(expect.anything(), 't-sesion', { id: CCP }, 'cliente@ejemplo.test');
  });
  it('si el correo no salió NO dice «listo»', async () => {
    leer.mockResolvedValue({ id: CCP });
    confirmar.mockResolvedValue({ ok: true, respondido: false, estado: 'error_envio' });
    expect(await confirmarRespuestaCcp(null, forma({ ccpId: CCP }))).toMatchObject({ ok: false });
  });
  it('un motivo de rechazo (ya respondida, sin destino…) se explica en español', async () => {
    leer.mockResolvedValue({ id: CCP });
    confirmar.mockResolvedValue({ ok: false, motivo: 'ya_respondida' });
    expect(await confirmarRespuestaCcp(null, forma({ ccpId: CCP }))).toEqual({ ok: false, error: 'Ya se le respondió al cliente con este CCP.' });
  });
});
