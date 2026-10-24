import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { leerConfigConductor } = vi.hoisted(() => ({ leerConfigConductor: vi.fn() }));
vi.mock('./repo', async (orig) => ({ ...((await orig()) as object), leerConfigConductor }));

const { puertosSenalVidaReales } = await import('./senal_vida_real');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');

// A37-A5-06: la señal de vida leía la config SIN la compuerta 0859. Una flota con
// `avisarSenalVida` encendido pero `agente_chofer_habilitado = false` abría
// episodios y escalaba al jefe sin haberle escrito jamás al chofer.
describe('A37-A5-06 · la señal de vida respeta la compuerta del Agente 5', () => {
  it('flota sin la marca explícita: la config sale apagada (ningún episodio)', async () => {
    leerConfigConductor.mockResolvedValue({ ...CONFIG_CONDUCTOR_DEFAULT, activo: true, avisarSenalVida: true, agenteChoferHabilitado: false });
    const c = await puertosSenalVidaReales().configDe('t1');
    expect(c.activo).toBe(false);
  });
  it('flota habilitada de forma explícita: la config pasa tal cual', async () => {
    leerConfigConductor.mockResolvedValue({ ...CONFIG_CONDUCTOR_DEFAULT, activo: true, avisarSenalVida: true, agenteChoferHabilitado: true });
    const c = await puertosSenalVidaReales().configDe('t1');
    expect(c.activo).toBe(true);
  });
});
