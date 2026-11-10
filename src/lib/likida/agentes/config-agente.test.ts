import { describe, it, expect, vi, beforeEach } from 'vitest';

const filaActual = { estado: 'vivo', runner_habilitado: true, presupuesto_dia_usd: '2.5', modelo_rol: 'barato' };
let lectura: { data: unknown; error: { message: string } | null } = { data: [filaActual], error: null };
const update = vi.fn((_p: Record<string, unknown>) => ({ eq: () => Promise.resolve({ error: null }) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => Promise.resolve(lectura) }) }),
      update: (p: Record<string, unknown>) => update(p),
    }),
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
const anotar = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => anotar(...a) }));

const { validarCambioConfig, actualizarAgente, diferencias } = await import('./config-agente');
const { DatoInvalido } = await import('@/lib/likida/errores');

beforeEach(() => { update.mockClear(); anotar.mockClear(); lectura = { data: [{ ...filaActual }], error: null }; });

describe('validarCambioConfig', () => {
  it('campos vacíos = sin cambio; ninguno es un error', () => {
    expect(() => validarCambioConfig({})).toThrow(DatoInvalido);
  });
  it('normaliza estado, runner, presupuesto y modelo', () => {
    expect(validarCambioConfig({ estado: 'pausado', runnerHabilitado: 'no', presupuestoDiaUsd: '3,456', modeloRol: 'barato' }))
      .toEqual({ estado: 'pausado', runner_habilitado: false, presupuesto_dia_usd: 3.46, modelo_rol: 'barato' });
    expect(validarCambioConfig({ presupuestoDiaUsd: 'sin_tope', modeloRol: 'sin_declarar' })).toEqual({ presupuesto_dia_usd: null, modelo_rol: null });
  });
  it('rechaza estado desconocido, presupuesto negativo, enorme o no numérico', () => {
    expect(() => validarCambioConfig({ estado: 'zombi' })).toThrow(/estado/);
    expect(() => validarCambioConfig({ presupuestoDiaUsd: '-1' })).toThrow(/presupuesto/);
    expect(() => validarCambioConfig({ presupuestoDiaUsd: '9999' })).toThrow(/no puede pasar/);
    expect(() => validarCambioConfig({ presupuestoDiaUsd: 'mucho' })).toThrow(/presupuesto/);
    expect(() => validarCambioConfig({ runnerHabilitado: 'tal vez' })).toThrow(/runner/);
  });
});

describe('actualizarAgente', () => {
  it('sin motivo no escribe', async () => {
    await expect(actualizarAgente('cobranza', { estado: 'pausado' }, '  ', 'u-1')).rejects.toThrow(/motivo/);
    expect(update).not.toHaveBeenCalled();
  });
  it('escribe solo lo que cambió y firma agente.config con antes/después y motivo', async () => {
    const r = await actualizarAgente('cobranza', { estado: 'pausado', runnerHabilitado: 'si', presupuestoDiaUsd: '2.5' }, 'incidente 12', 'u-javier');
    expect(update).toHaveBeenCalledWith({ estado: 'pausado' });
    expect(r.cambios).toEqual({ estado: { antes: 'vivo', despues: 'pausado' } });
    const entrada = anotar.mock.calls[0][0] as { accion: string; entidadId: string; actor: { id: string }; detalle: { motivo: string } };
    expect(entrada.accion).toBe('agente.config');
    expect(entrada.entidadId).toBe('cobranza');
    expect(entrada.actor.id).toBe('u-javier');
    expect(entrada.detalle.motivo).toBe('incidente 12');
  });
  it('si ya está así, lo dice y no escribe', async () => {
    await expect(actualizarAgente('cobranza', { estado: 'vivo' }, 'x', 'u-1')).rejects.toThrow(/ya está así/);
    expect(update).not.toHaveBeenCalled();
  });
  it('falla cerrado si no puede leer la fila actual', async () => {
    lectura = { data: null, error: { message: 'caído' } };
    await expect(actualizarAgente('cobranza', { estado: 'pausado' }, 'x', 'u-1')).rejects.toThrow(/no se pudo leer/);
    expect(update).not.toHaveBeenCalled();
  });
  it('agente inexistente o id inválido', async () => {
    lectura = { data: [], error: null };
    await expect(actualizarAgente('fantasma', { estado: 'pausado' }, 'x', 'u-1')).rejects.toThrow(/No existe/);
    await expect(actualizarAgente('Mal Id!', { estado: 'pausado' }, 'x', 'u-1')).rejects.toThrow(/inválido/);
  });
  it('diferencias ignora valores iguales', () => {
    expect(diferencias({ estado: 'vivo' }, { estado: 'vivo' })).toEqual({});
  });
});
