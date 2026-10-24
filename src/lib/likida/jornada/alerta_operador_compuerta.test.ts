import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-A5-05: el aviso de tope de jornada AL OPERADOR le escribe con la jornada en curso; pasa por la compuerta del chofer.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base'); } }));
const wa = vi.fn(async () => ({ ok: true, via: 'texto', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback: wa }));
const estado = { habilitado: true, ventana: true, emergencia: false, ilegible: false };
vi.mock('../conductor/repo', async () => {
  const { CONFIG_CONDUCTOR_DEFAULT } = await import('../conductor/config');
  return {
    leerAgenteChoferHabilitado: vi.fn(async () => ({ habilitado: estado.habilitado, razon: 'x' })),
    leerConfigConductor: vi.fn(async () => {
      if (estado.ilegible) throw new Error('caída');
      return estado.ventana ? { ...CONFIG_CONDUCTOR_DEFAULT, horaInicio: 0, horaFin: 24 } : { ...CONFIG_CONDUCTOR_DEFAULT, horaInicio: 7, horaFin: 7 };
    }),
  };
});
vi.mock('../conductor/trabajo', () => ({ hayEmergenciaDeTelefono: vi.fn(async () => estado.emergencia) }));
vi.mock('../conductor/escalamiento', () => ({ destinatariosEscalacion: vi.fn() }));
vi.mock('./repo', () => ({ asientosDeJornada: vi.fn(), leerPolitica: vi.fn() }));

const { puertosAlertaReales } = await import('./alerta_tope_datos');
const MSG = { texto: 'aviso', plantilla: { nombre: 'p' } } as never;
const AHORA = new Date('2026-10-10T18:00:00Z');

beforeEach(() => { wa.mockClear(); Object.assign(estado, { habilitado: true, ventana: true, emergencia: false, ilegible: false }); });

describe('enviarWa al operador', () => {
  it('todo abierto: envía', async () => {
    expect(await puertosAlertaReales.enviarWa('521', MSG, 't1', AHORA, 'jornada.alerta_operador')).toMatchObject({ ok: true });
    expect(wa).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['Agente 5 no habilitado', { habilitado: false }],
    ['fuera de la ventana', { ventana: false }],
    ['emergencia abierta', { emergencia: true }],
    ['config ilegible', { ilegible: true }],
  ])('%s: NO envía y el rechazo no es reintentable', async (_n, cambio) => {
    Object.assign(estado, cambio);
    const r = await puertosAlertaReales.enviarWa('521', MSG, 't1', AHORA, 'jornada.alerta_operador');
    expect(r).toMatchObject({ ok: false, reintentable: false });
    expect(wa).not.toHaveBeenCalled();
  });
  it('el aviso al encargado no pasa por esta compuerta', async () => {
    estado.habilitado = false;
    expect(await puertosAlertaReales.enviarWa('521', MSG, 't1', AHORA, 'jornada.alerta_encargado')).toMatchObject({ ok: true });
  });
});
