import { describe, it, expect, vi } from 'vitest';

// A37-S45-06: las pantallas Inicio/Contador deben juzgar con el MISMO perfil
// que el chat y el MCP. El perfil declara que la flota NO califica a la
// facilidad del 15% y la config legada no dice nada (o dice que sí).

let perfil: unknown = {};
vi.mock('./repo', async (orig) => ({
  ...(await orig<typeof import('./repo')>()),
  getPerfilCrudo: async () => perfil,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { opcionesFiscalesConPerfil, opcionesDe } = await import('./fiscal');
const { DEMO_CONFIG } = await import('./config');
const { declararFacilidad15 } = await import('./perfil/preguntas');

describe('opcionesFiscalesConPerfil', () => {
  it('el perfil manda sobre la config legada: NO elegible al 15%', async () => {
    const cfg = { ...DEMO_CONFIG, facilidadCombustibleEfectivo: { dedicacionExclusivaCarga: true, regimenElegible: true } };
    perfil = declararFacilidad15(false, false);
    // Sin perfil (lo que hacían las pantallas) la config legada decía «sí».
    expect(opcionesDe(cfg).elegible15).toBe(true);
    // Con perfil, la misma cifra que el chat y el MCP.
    const o = await opcionesFiscalesConPerfil('t1', cfg);
    expect(o.elegible15).toBe(false);
    expect(o).toEqual(opcionesDe(cfg, perfil));
  });

  it('si el perfil no se puede leer, degrada a la config (best-effort)', async () => {
    perfil = {};
    const o = await opcionesFiscalesConPerfil('t1', DEMO_CONFIG);
    expect(o).toEqual(opcionesDe(DEMO_CONFIG));
  });
});
