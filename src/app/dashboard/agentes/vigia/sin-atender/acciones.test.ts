import { beforeEach, describe, expect, it, vi } from 'vitest';

// Las acciones de servidor: el tenant sale de la sesión firmada, jamás del formulario; sin flota firmada o sin ruta no se toca nada.
const resolver = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/tenant-atado', () => ({ resolverTenantAtadoFirmado: resolver, MENSAJE_FLOTA_CAMBIO: 'La flota cambió.' }));
vi.mock('@/lib/auth/flota_cambio', () => ({ CAMPO_FLOTA_PINTADA: 'flota' }));
const puedeVerRuta = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.ejemplo.test' }));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ emailDeUsuario: vi.fn(async () => 'u@ejemplo.test') }));
const logica = vi.hoisted(() => ({ revisarPanel: vi.fn(), enviarResumenPanel: vi.fn() }));
vi.mock('@/lib/likida/vigia/sin_atender_aviso/acciones', () => logica);

const { revisarSinAtenderAccion, enviarResumenAccion } = await import('./acciones');
const forma = (o: Record<string, string> = {}) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  puedeVerRuta.mockReturnValue(true);
  resolver.mockResolvedValue({ tenantId: 't-sesion', rol: 'flota_admin', userId: 'u1' });
  logica.revisarPanel.mockResolvedValue({ ok: true, resultado: {}, notas: [] });
  logica.enviarResumenPanel.mockResolvedValue({ ok: true, mensaje: 'listo' });
});

describe('acciones de servidor de «sin atender»', () => {
  it('sin flota firmada vigente: responde con el mensaje de flota y no llama a la lógica', async () => {
    resolver.mockResolvedValue(null);
    expect(await revisarSinAtenderAccion(null, forma())).toEqual({ ok: false, error: 'La flota cambió.' });
    expect(await enviarResumenAccion(null, forma())).toEqual({ ok: false, error: 'La flota cambió.' });
    expect(logica.revisarPanel).not.toHaveBeenCalled();
    expect(logica.enviarResumenPanel).not.toHaveBeenCalled();
  });
  it('rol sin ruta: SIN acceso y no llama a la lógica', async () => {
    puedeVerRuta.mockReturnValue(false);
    expect(await revisarSinAtenderAccion(null, forma())).toMatchObject({ ok: false, error: 'No tienes acceso a esta pantalla.' });
    expect(await enviarResumenAccion(null, forma())).toMatchObject({ ok: false, error: 'No tienes acceso a esta pantalla.' });
    expect(logica.revisarPanel).not.toHaveBeenCalled();
    expect(logica.enviarResumenPanel).not.toHaveBeenCalled();
  });
  it('con acceso: el tenant y el rol son los de la sesión aunque el formulario traiga otro tenant', async () => {
    await revisarSinAtenderAccion(null, forma({ tenantId: 't-ajeno', tenant: 't-ajeno' }));
    await enviarResumenAccion(null, forma({ tenantId: 't-ajeno', fechaCorte: '2026-11-01' }));
    for (const m of [logica.revisarPanel, logica.enviarResumenPanel]) {
      expect(m.mock.calls[0]![0]).toMatchObject({ tenantId: 't-sesion', rol: 'flota_admin', usuarioId: 'u1', email: 'u@ejemplo.test' });
    }
  });
});
