import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
let respuestas: Respuesta[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (res: (r: Respuesta) => unknown) => res(respuestas.shift() ?? { data: [], error: null });
          return (...args: unknown[]) => { if (prop !== 'abortSignal') reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
  }),
}));

const repo = await import('./repo');
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const actualizado = (r: Registro) => r.ops.find(([o]) => o === 'update')![1] as Record<string, unknown>;

beforeEach(() => { registros.length = 0; respuestas = []; });

// Adversarial ronda 08: cerrar un episodio sin silencio hacía que la pasada siguiente abriera otro con el mismo GPS mudo.
describe('cerrar un episodio de señal de vida deja silencio (la escalera se detiene)', () => {
  it('«Ya lo atiendo» del jefe cierra Y silencia 2 h', async () => {
    respuestas = [{ data: [{ id: 'e1' }], error: null }];
    expect(await repo.cerrarEpisodioPorJefe('t1', 'v1', AHORA)).toBe(1);
    const u = actualizado(registros[0]);
    expect(u).toMatchObject({ cierre_motivo: 'atendido_por_jefe' });
    expect(new Date(String(u.silenciado_hasta)).getTime()).toBe(AHORA.getTime() + 120 * 60_000);
  });

  it('«señal recuperada» de un episodio que ya avisó silencia (un GPS que reporta cada 50 min no repregunta cada hora)', async () => {
    await repo.cerrarEpisodioSenalVida({ id: 'e1', tenantId: 't1', nivelEnviado: 1 }, 'senal_recuperada', AHORA);
    const u = actualizado(registros[0]);
    expect(new Date(String(u.silenciado_hasta)).getTime()).toBe(AHORA.getTime() + 120 * 60_000);
  });

  it('«señal recuperada» de un episodio que nunca avisó NO silencia (nadie fue molestado)', async () => {
    await repo.cerrarEpisodioSenalVida({ id: 'e1', tenantId: 't1', nivelEnviado: 0 }, 'senal_recuperada', AHORA);
    expect(actualizado(registros[0])).not.toHaveProperty('silenciado_hasta');
  });

  it('cerrar por viaje cerrado no silencia (el viaje ya no va en tránsito)', async () => {
    await repo.cerrarEpisodioSenalVida({ id: 'e1', tenantId: 't1', nivelEnviado: 3 }, 'viaje_cerrado', AHORA);
    expect(actualizado(registros[0])).not.toHaveProperty('silenciado_hasta');
  });
});
