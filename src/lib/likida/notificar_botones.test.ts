import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A5-47: la asignación con botones (plantilla N01) — qué se manda a Meta y cuándo NO se manda.

const sendTemplate = vi.fn();
vi.mock('@/lib/meta/client', () => ({ sendTemplate, motivoDeFalloWhatsApp: (e: string) => `motivo: ${e}` }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { notificarAsignacionConBotones, parametrosAsignacionConBotones } = await import('./notificar');
const { leerBotonConductor } = await import('./conductor/tipos');

const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d046';
const viaje = { viajeId: V, folio: 'F-1042', origen: 'Nuevo Laredo', destino: 'Monterrey', operadorNombre: 'Juan Pérez', servicio: 'importación', citaEn: '2026-10-16T14:00:00.000Z' };

beforeEach(() => { sendTemplate.mockReset(); sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.x' }); });

describe('notificarAsignacionConBotones', () => {
  it('manda N01 con los seis parámetros y los dos botones con el viaje en el payload', async () => {
    expect(await notificarAsignacionConBotones({ telefono: '5219990000001', tenantId: 't1', viaje })).toEqual({ enviado: true });
    const [tel, nombre, opciones] = sendTemplate.mock.calls[0];
    expect(tel).toBe('5219990000001');
    expect(nombre).toBe('viaje_asignado_confirmar_v1');
    expect(opciones.parametros).toEqual(['Juan', 'F-1042', 'importación', 'Nuevo Laredo', 'Monterrey', '16/10 a las 08:00']);
    expect(opciones.idioma).toBe('es_MX');
    expect(opciones.botones.map((b: { payload: string }) => leerBotonConductor(b.payload))).toEqual([
      expect.objectContaining({ prefijo: 'viaje_acepto', viajeId: V }), expect.objectContaining({ prefijo: 'viaje_rechazo', viajeId: V }),
    ]);
  });

  it('lo que falta se dice, no se inventa: sin servicio «transporte», sin cita «fecha por confirmar»', () => {
    const p = parametrosAsignacionConBotones({ viajeId: V, folio: 'F-1', origen: 'A', destino: 'B' });
    expect(p).toEqual(['chofer', 'F-1', 'transporte', 'A', 'B', 'fecha por confirmar con tu supervisor']);
    expect(p.every((x) => !/\n|\t| {4}/.test(x))).toBe(true);
  });

  it('falla cerrado y dice el motivo: sin teléfono, sin folio ni ruta, o con Meta rechazando', async () => {
    expect((await notificarAsignacionConBotones({ telefono: 'n/a', tenantId: 't1', viaje })).enviado).toBe(false);
    expect((await notificarAsignacionConBotones({ telefono: '5219990000001', tenantId: 't1', viaje: { viajeId: V } })).enviado).toBe(false);
    expect(sendTemplate).not.toHaveBeenCalled();
    sendTemplate.mockResolvedValue({ ok: false, error: 'plantilla en revisión', codigo: 132001 });
    const r = await notificarAsignacionConBotones({ telefono: '5219990000001', tenantId: 't1', viaje });
    expect(r).toEqual({ enviado: false, motivo: 'motivo: plantilla en revisión' });
  });
});
