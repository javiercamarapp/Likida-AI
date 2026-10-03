import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ claim: vi.fn(), completar: vi.fn(), liberar: vi.fn(), avisar: vi.fn() }));
vi.mock('./conv', () => ({
  claimMessage: (...a: unknown[]) => m.claim(...a),
  completarMessageClaim: (...a: unknown[]) => m.completar(...a),
  releaseMessageClaim: (...a: unknown[]) => m.liberar(...a),
  crearMessageLeaseOwner: () => 'owner-1',
}));
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: (...a: unknown[]) => m.avisar(...a), parametrosAvisoOficina: (...a: string[]) => a as [string, string, string] }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { avisarPerfilTarjetasUnaVez, textoAvisoPerfilTarjetas, claveAvisoPerfilTarjetas } = await import('./aviso_perfil_tarjetas');
const a = { tenantId: 't1', telefonoDinero: '5215500001111', folio: 'F-1', operador: 'Juan' };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.claim.mockResolvedValue({ status: 'nuevo', token: 'tok', owner: 'owner-1' });
  m.avisar.mockResolvedValue({ ok: true, via: 'texto', id: 'w' });
});

describe('aviso único del perfil de tarjetas', () => {
  it('la primera vez manda el aviso con la instrucción y sella el claim por flota', async () => {
    expect(await avisarPerfilTarjetasUnaVez(a)).toBe('enviado');
    expect(m.claim).toHaveBeenCalledWith(claveAvisoPerfilTarjetas('t1'), 'owner-1', true);
    const texto = String(m.avisar.mock.calls[0][1]);
    expect(texto).toContain('Tarjetas a nombre de la empresa');
    expect(texto).toContain('Quién paga en la bomba');
    expect(texto).toContain('https://app.test/dashboard/onboarding');
    expect(m.completar).toHaveBeenCalledWith(claveAvisoPerfilTarjetas('t1'), 'tok', 'owner-1');
  });
  it('si ya se avisó (claim duplicado o en curso) NO manda otro: uno por flota, no uno por viaje', async () => {
    for (const status of ['duplicado', 'en_curso']) {
      m.claim.mockResolvedValue({ status, owner: 'owner-1' });
      expect(await avisarPerfilTarjetasUnaVez(a)).toBe('ya_avisado');
    }
    expect(m.avisar).not.toHaveBeenCalled();
  });
  it('si no se puede reclamar (indeterminado) se calla en vez de arriesgar duplicados', async () => {
    m.claim.mockResolvedValue({ status: 'indeterminado', owner: 'owner-1' });
    expect(await avisarPerfilTarjetasUnaVez(a)).toBe('indeterminado');
    expect(m.avisar).not.toHaveBeenCalled();
  });
  it('si el envío falla se libera el claim para que el siguiente cierre lo reintente', async () => {
    m.avisar.mockResolvedValue({ ok: false, motivo: 'x', fueraDeVentana: false, reintentable: false, encolado: false });
    expect(await avisarPerfilTarjetasUnaVez(a)).toBe('fallo');
    expect(m.liberar).toHaveBeenCalledWith(claveAvisoPerfilTarjetas('t1'), 'tok', 'owner-1');
    expect(m.completar).not.toHaveBeenCalled();
  });
  it('si quedó en el outbox no se suelta el claim ni se reenvía', async () => {
    m.avisar.mockResolvedValue({ ok: false, motivo: 'red', fueraDeVentana: false, reintentable: true, encolado: true });
    expect(await avisarPerfilTarjetasUnaVez(a)).toBe('enviado');
    expect(m.liberar).not.toHaveBeenCalled();
  });
  it('el texto no lleva cifras de dinero', () => {
    expect(textoAvisoPerfilTarjetas('F-1', 'https://x')).not.toMatch(/\$|\d{3,}/);
  });
});
