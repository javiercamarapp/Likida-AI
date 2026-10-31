import { describe, it, expect, vi, beforeEach } from 'vitest';

// H759-2 (verificación del PR #759): la fecha de corte NO falla abierta. Si la configuración de envío no se puede leer, una flota bajo
// `cinco_agentes` no recibe desgloses como si no tuviera corte (el histórico saldría como correos reales): se lanza (reintentable).

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let perfil: string | null = null;
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => perfil }));
let lectura: { ok: true; valor: Record<string, unknown> } | { ok: false; motivo: 'no_disponible' } = { ok: false, motivo: 'no_disponible' };
vi.mock('./repo_correo', async (orig) => ({
  ...(await orig<typeof import('./repo_correo')>()),
  leerConfigCorreo: async () => lectura,
}));

const { dependenciasDesglosePorOmision } = await import('./desglose_recibir');
const { CONFIG_CORREO_POR_DEFECTO } = await import('./repo_correo');

beforeEach(() => { perfil = null; lectura = { ok: false, motivo: 'no_disponible' }; });

describe('H759-2 · la configuración ilegible no se convierte en «sin corte»', () => {
  it('bajo cinco_agentes, config no disponible LANZA (no devuelve el defecto)', async () => {
    perfil = 'cinco_agentes';
    await expect(dependenciasDesglosePorOmision.leerConfig('t1')).rejects.toThrow(/no se pudo leer la configuración/);
  });

  it('sin perfil conserva el comportamiento de siempre (el defecto)', async () => {
    perfil = null;
    expect(await dependenciasDesglosePorOmision.leerConfig('t1')).toEqual(CONFIG_CORREO_POR_DEFECTO);
  });

  it('bajo cinco_agentes con la configuración leída devuelve la configuración (con su corte)', async () => {
    perfil = 'cinco_agentes';
    lectura = { ok: true, valor: { ...CONFIG_CORREO_POR_DEFECTO, noEnviarAntes: '2026-11-02' } };
    expect((await dependenciasDesglosePorOmision.leerConfig('t1')).noEnviarAntes).toBe('2026-11-02');
  });
});
