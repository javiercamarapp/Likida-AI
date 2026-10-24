import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A5-47: `avisarAlChofer` manda N01 (con botones) SOLO si la flota tiene la perilla; si no, `viaje_asignado` de siempre; y si la
// configuración no se puede leer, el chofer recibe el aviso de siempre (nunca se deja de avisar por esto).

let CONFIG: { asignacionBotonesActiva?: boolean } | Error = { asignacionBotonesActiva: false };
const notificarAsignacion = vi.fn();
const notificarAsignacionConBotones = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const actualizado: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => {
        const nodo: Record<string, unknown> = {};
        nodo.eq = () => nodo;
        nodo.maybeSingle = () => Promise.resolve({
          data: tabla === 'operador' ? { telefono: '5219990000001', nombre: 'Juan Pérez' }
            : { folio: 'F-1', origen: 'A', destino: 'B', fecha_inicio: null, anticipo: 0, unidad_id: null, cita_origen_en: '2026-10-16T14:00:00.000Z' },
          error: null,
        });
        return nodo;
      },
      update: (v: Record<string, unknown>) => {
        const nodo: Record<string, unknown> = {};
        nodo.eq = () => nodo; nodo.is = () => nodo; nodo.select = () => nodo;
        nodo.then = (r: (x: unknown) => unknown) => { actualizado.push(v); return Promise.resolve({ data: [{ id: 'v-1' }], error: null }).then(r); };
        return nodo;
      },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./notificar', () => ({ notificarAsignacion, notificarAsignacionConBotones }));
vi.mock('./conductor/repo', () => ({ leerConfigConductor: async () => { if (CONFIG instanceof Error) throw CONFIG; return CONFIG; } }));

const { avisarAlChofer } = await import('./operacion');

beforeEach(() => {
  CONFIG = { asignacionBotonesActiva: false };
  notificarAsignacion.mockReset().mockResolvedValue({ enviado: true });
  notificarAsignacionConBotones.mockReset().mockResolvedValue({ enviado: true });
  actualizado.length = 0;
  for (const f of Object.values(logger)) f.mockReset();
});

describe('avisarAlChofer — N01 solo con la perilla', () => {
  it('perilla encendida: manda la asignación con botones (con el viaje, el nombre y la cita) y marca avisado_en', async () => {
    CONFIG = { asignacionBotonesActiva: true };
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(notificarAsignacion).not.toHaveBeenCalled();
    expect(notificarAsignacionConBotones).toHaveBeenCalledWith(expect.objectContaining({
      telefono: '5219990000001', tenantId: 't-1',
      viaje: expect.objectContaining({ viajeId: 'v-1', operadorNombre: 'Juan Pérez', citaEn: '2026-10-16T14:00:00.000Z', folio: 'F-1' }),
    }));
    expect(actualizado).toEqual([expect.objectContaining({ avisos_enviados: 1 })]);
  });

  it('perilla apagada (la omisión): el aviso de siempre, sin botones', async () => {
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(notificarAsignacionConBotones).not.toHaveBeenCalled();
    expect(notificarAsignacion).toHaveBeenCalledTimes(1);
  });

  it('configuración ilegible: el aviso de siempre y queda en el log', async () => {
    CONFIG = new Error('base caída');
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(notificarAsignacion).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('viaje.aviso_config_no_leida', expect.objectContaining({ tenantId: 't-1' }));
  });

  it('si N01 no sale, no se marca avisado_en (el viaje no finge haber sido avisado)', async () => {
    CONFIG = { asignacionBotonesActiva: true };
    notificarAsignacionConBotones.mockResolvedValue({ enviado: false, motivo: 'plantilla en revisión' });
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    // A37-S50-06: se reclama antes de enviar y, al no salir, se DEVUELVE (avisado_en = null).
    expect(actualizado.at(-1)).toMatchObject({ avisado_en: null });
  });
});
